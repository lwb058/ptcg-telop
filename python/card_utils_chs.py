import requests, re, json, os, time, sys
from bs4 import BeautifulSoup, Tag
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# --- Constants and Paths ---
# Calculate the absolute path of the project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

# Paths for Simplified Chinese data
DATABASE_FILE = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'database_chs.json')
CARD_IMG_DIR = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'card_img_chs')

# --- Mappings (Placeholders for CHS version) ---
# These will need to be adapted based on the structure of tcg.mik.moe
SUPERTYPE_MAP = {
    "宝可梦": "pokemon",
    "训练家": "trainer",
    "能量": "energy"
}
EVOLUTION_STAGE_MAP = {
    "基础": "たね",
    "1阶进化": "1 進化",
    "2阶进化": "2 進化",
    "VSTAR": "V進化",
    "VMAX": "V進化"

}
TRAINER_SUBTYPE_MAP = {
    "物品": "item",
    "宝可梦道具": "tool",
    "支援者": "supporter",
    "竞技场": "stadium"
}
ENERGY_SUBTYPE_MAP = {
    "基本能量": "basic energy",
    "特殊能量": "special energy"
}
ENERGY_ICON_MAP = {
    "g": "草",
    "r": "炎",
    "w": "水",
    "l": "雷",
    "p": "超",
    "f": "闘",
    "d": "悪",
    "m": "鋼",
    "n": "竜",
    "c": "無",
    "y": "妖",
}
ENERGY_CHS_MAP = {
    "g": "草",
    "r": "火",
    "w": "水",
    "l": "雷",
    "p": "超",
    "f": "斗",
    "d": "恶",
    "m": "钢",
    "c": "无",
    "n": "龙",
    "y": "妖",
}
RARITY_ICON_MAP = {
    # Example: "C": "C"
}

# --- Helper for parsing text with icons ---
def _parse_text_with_icons(element, icon_map=ENERGY_ICON_MAP):
    """Recursively parses an element, converting styled font icons to text."""
    if not element:
        return ""
    
    result_string = ""
    # Handle cases where element might not have .contents (e.g., it's a string itself)
    if isinstance(element, str):
        return element

    for content in element.contents:
        if isinstance(content, str):
            result_string += content
        elif isinstance(content, Tag):
            # Check if the tag is a styled icon
            if 'font-family: ptcg-font-19' in content.get('style', ''):
                icon_char = content.get_text(strip=True).lower()
                # Use the provided map, with a fallback for unknown icons
                result_string += icon_map.get(icon_char, f'[{icon_char}]')
            else:
                # Recursively parse nested tags
                result_string += _parse_text_with_icons(content, icon_map)
    return result_string


# --- Core Functions (Copied from _jp) ---
def load_database(db_path=None):
    """
    Loads the card database from a local JSON file.
    """
    target_path = db_path if db_path else DATABASE_FILE
    if not os.path.exists(target_path) or os.path.getsize(target_path) == 0:
        return {}
    with open(target_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_database(data, db_path=None):
    """
    Saves the card database to a local JSON file.
    """
    target_path = db_path if db_path else DATABASE_FILE
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    temp_file_path = target_path + '.tmp'
    try:
        with open(temp_file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        os.replace(temp_file_path, target_path)
    except Exception as e:
        print(f"ERROR: Failed to save database to {target_path}: {e}", file=sys.stderr)
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

# --- CHS Specific Parsing Logic ---

def _extract_name_and_subtype(soup):
    """
    Extracts the card's full name, base name, and subtype from the soup object.
    Handles special font conversions (e.g., 'e' -> 'ex') and name suffixes (e.g., 'V', 'VMAX').
    """
    font_map = {'e': 'ex', 'X': 'GX'}
    suffix_subtypes = ["VSTAR", "VMAX", "V"]

    base_name = ""
    full_name = ""
    subtype = None
    
    try:
        # This logic is for the old template (e.g., '喷火龙ex')
        name_container_span = soup.select_one('h2 span[style*="white-space: pre-wrap"]')

        if name_container_span:
            # Priority 1: Check for special font span
            special_span = name_container_span.select_one('span[style*="font-family: ptcg-font-19"]')
            
            if special_span:
                for content in name_container_span.contents:
                    if isinstance(content, str) and content.strip():
                        base_name = content.strip()
                        break
                
                char_to_convert = special_span.get_text(strip=True)
                subtype = font_map.get(char_to_convert)
                full_name = base_name + (subtype if subtype else "")

            else:
                # Priority 2: Check for name suffixes
                raw_name_text = name_container_span.get_text(strip=True)
                found_suffix = False
                for suffix in suffix_subtypes:
                    if raw_name_text.endswith(suffix):
                        subtype = suffix
                        base_name = raw_name_text[:-len(suffix)]
                        full_name = raw_name_text
                        found_suffix = True
                        break
                
                # Priority 3: No special font or suffix
                if not found_suffix:
                    base_name = raw_name_text
                    full_name = base_name
                    subtype = None
            
            return {'full_name': full_name, 'base_name': base_name, 'subtype': subtype}

    except Exception as e:
        print(f"An error occurred during name extraction: {e}", file=sys.stderr)

    return {'full_name': None, 'base_name': None, 'subtype': None}

def _parse_template_A(soup, card_details):
    """Parses the card details from the Mantine-based template (e.g., 喷火龙ex)."""
    try:
        # --- Name and Subtype (for Pokemon) Extraction ---
        name_data = _extract_name_and_subtype(soup)
        card_details['name'] = name_data.get('full_name')
        pokemon_subtype = name_data.get('subtype')

        # --- Image URL Extraction ---
        alt_text = card_details["set_code"] + '-' + card_details["card_number"]
        image_element = soup.select_one(f'img[alt="{alt_text}"]')
        if image_element and image_element.has_attr('src'):
            from urllib.parse import urljoin
            base_url = f"https://tcg.mik.moe/cards/{card_details['set_code']}/{card_details['card_number']}"
            image_url = urljoin(base_url, image_element['src'])
            card_details['image_url'] = image_url

        # --- Supertype, Evolves, and Trainer/Energy Subtype Extraction ---
        supertype_element = soup.select_one('div.mantine-Paper-root p:nth-of-type(2) > span')
        if supertype_element:
            parts = supertype_element.get_text(strip=True).split('|')
            raw_supertype = parts[0].strip()
            supertype_en = SUPERTYPE_MAP.get(raw_supertype, raw_supertype)
            card_details['supertype'] = supertype_en
            
            if len(parts) > 1:
                detail_text = parts[1].strip()
                if supertype_en == 'pokemon':
                    if card_details.get('pokemon') is None: card_details['pokemon'] = {}
                    card_details['pokemon']['evolves'] = EVOLUTION_STAGE_MAP.get(detail_text, detail_text)

                    # Extract the name of the pokemon it evolves from
                    evolves_from_link = supertype_element.select_one('a')
                    if evolves_from_link:
                        evolves_from_name = evolves_from_link.get_text(strip=True)
                        card_details['pokemon']['evolvesFrom'] = evolves_from_name

                    card_details['subtype'] = pokemon_subtype

                    # --- Add Rule based on subtype ---
                    if pokemon_subtype in ['ex', 'V', 'VSTAR']:
                        card_details['addRule'] = f"当宝可梦{pokemon_subtype}昏厥时，对手将拿取2张奖赏卡。"
                    elif pokemon_subtype == 'VMAX':
                        card_details['addRule'] = f"当宝可梦VMAX昏厥时，对手将拿取3张奖赏卡。"

                    # --- Color, HP, Abilities, Attacks, Rules ---
                    _parse_pokemon_details_template_A(soup, card_details)
                
                elif supertype_en == 'trainer':
                    card_details['subtype'] = TRAINER_SUBTYPE_MAP.get(detail_text, detail_text)
                    
                    # --- Final logic for trainer text ---
                    paper_container = soup.select_one('div.mantine-Paper-root')
                    if paper_container:
                        first_divider = paper_container.select_one('div.mantine-Divider-root')
                        if first_divider:
                            text_container = first_divider.find_next_sibling('div')
                            if text_container:
                                trainer_text = _parse_text_with_icons(text_container, ENERGY_CHS_MAP)
                                if trainer_text:
                                    if 'trainer' not in card_details or card_details['trainer'] is None:
                                        card_details['trainer'] = {}
                                    # Normalize whitespace to a single space
                                    card_details['trainer']['text'] = ' '.join(trainer_text.split())

                elif supertype_en == 'energy':
                    subtype = ENERGY_SUBTYPE_MAP.get(detail_text, detail_text)
                    card_details['subtype'] = subtype

                    if subtype == 'basic energy':
                        card_details['energy'] = {}
                    elif subtype == 'special energy':
                        # --- Logic for special energy text ---
                        paper_container = soup.select_one('div.mantine-Paper-root')
                        if paper_container:
                            first_divider = paper_container.select_one('div.mantine-Divider-root')
                            if first_divider:
                                text_container = first_divider.find_next_sibling('div')
                                if text_container:
                                    energy_text = _parse_text_with_icons(text_container, ENERGY_CHS_MAP)
                                    if energy_text:
                                        if 'energy' not in card_details or card_details['energy'] is None:
                                            card_details['energy'] = {}
                                        # Normalize whitespace to a single space
                                        card_details['energy']['text'] = ' '.join(energy_text.split())

        # --- Rarity Extraction ---
        rarity_text_node = soup.find(string=re.compile(r'稀有度:'))
        if rarity_text_node:
            rarity_span = rarity_text_node.find_parent('span')
            if rarity_span:
                rarity_value_span = rarity_span.find('span')
                if rarity_value_span:
                    card_details['rarity'] = rarity_value_span.get_text(strip=True)
                
        return True
    except Exception as e:
        print(f"Error parsing template A: {e}", file=sys.stderr)
        return False

def _parse_pokemon_details_template_A(soup, card_details):
    """Helper to parse specific pokemon details for template A."""
    # Color
    color_element = soup.select_one('div.mantine-Paper-root p:nth-of-type(1) > span:nth-of-type(2)')
    if color_element:
        raw_color = color_element.get_text(strip=True).lower()
        card_details['pokemon']['color'] = [ENERGY_ICON_MAP.get(raw_color, raw_color)]

    # HP
    hp_element = soup.select_one('div.mantine-Paper-root p:nth-of-type(1) > span:nth-of-type(3)')
    if hp_element and 'HP' in hp_element.get_text(strip=True):
        try:
            card_details['pokemon']['hp'] = int(re.search(r'\d+', hp_element.get_text(strip=True)).group())
        except (ValueError, TypeError, AttributeError):
            pass # Ignore if HP is not a number

    all_stacks = soup.select('div.mantine-Paper-root div.mantine-Stack-root')

    # Abilities, Attacks are in the first stack
    if len(all_stacks) > 0:
        details_container = all_stacks[0]
        for item in details_container.find_all('div', recursive=False):
            text_content_raw = item.get_text(strip=True)
            
            if text_content_raw.startswith('太晶'):
                card_details['pokemon']['option'] = "Terastal"
            
            elif "特性:" in text_content_raw:
                if 'abilities' not in card_details['pokemon']:
                    card_details['pokemon']['abilities'] = []
                spans = item.find_all('span')
                if spans:
                    ability_name_raw = spans[0].get_text(strip=True)
                    ability_name = ability_name_raw.split(':', 1)[1].strip() if ':' in ability_name_raw else ability_name_raw
                    br = item.find('br')
                    ability_text = _parse_text_with_icons(br.next_sibling, ENERGY_CHS_MAP) if br else ''
                    card_details['pokemon']['abilities'].append({"name": ability_name, "text": ability_text.strip()})

            elif item.select('span[style*="font-family: ptcg-font-19"]'):
                if 'attacks' not in card_details['pokemon']:
                    card_details['pokemon']['attacks'] = []

                # Create a mini-soup of the content before the <br> to isolate cost icons
                br = item.find('br')
                cost_html_content = ""
                for content in item.contents:
                    if isinstance(content, Tag) and content.name == 'br':
                        break
                    cost_html_content += str(content)
                
                cost_soup = BeautifulSoup(cost_html_content, 'html.parser')
                cost_spans = cost_soup.select('span[style*="font-family: ptcg-font-19"]')
                cost = [ENERGY_ICON_MAP.get(s.get_text(strip=True).lower(), s.get_text(strip=True)) for s in cost_spans]

                # Use original logic for name and damage, which is generally reliable
                text_spans = item.select('span.mantine-Text-root')
                attack_name, damage = "", ""
                if len(text_spans) > 1:
                    # The first span is the cost container, the second should be the name
                    attack_name = text_spans[1].get_text(strip=True)
                    if len(text_spans) > 2:
                        damage = text_spans[2].get_text(strip=True)
                
                description = _parse_text_with_icons(br.next_sibling, ENERGY_CHS_MAP) if br else ''
                card_details['pokemon']['attacks'].append({"cost": cost, "name": attack_name, "damage": damage, "text": description.strip()})

    # --- Weakness, Resistance, Retreat Cost are in the second stack --- 
    if len(all_stacks) > 1:
        wrr_container = all_stacks[1]
        # Initialize with correct keys
        card_details['pokemon']['weaknesses'] = []
        card_details['pokemon']['resistances'] = []
        card_details['pokemon']['retreats'] = []

        for p_tag in wrr_container.find_all('p', recursive=False):
            text = p_tag.get_text(strip=True)
            
            if text.startswith("弱点"):
                icons = p_tag.select('span[style*="font-family: ptcg-font-19"]')
                if icons:
                    w_type_char = icons[0].get_text(strip=True)
                    w_type = ENERGY_ICON_MAP.get(w_type_char.lower(), w_type_char)
                    
                    value_str = text.replace("弱点:", "").replace(w_type_char, "").strip()
                    calc = None
                    value = ""
                    if '×' in value_str:
                        calc = "multiply"
                        value = value_str.replace('×', '').strip()
                    elif '-' in value_str:
                        calc = "minus"
                        value = value_str.replace('-', '').strip()
                    elif '+' in value_str:
                        calc = "plus"
                        value = value_str.replace('+', '').strip()
                    
                    if calc:
                        card_details['pokemon']['weaknesses'].append({"type": w_type, "calc": calc, "value": value})

            elif text.startswith("抗性"):
                icons = p_tag.select('span[style*="font-family: ptcg-font-19"]')
                if icons:
                    r_type_char = icons[0].get_text(strip=True)
                    r_type = ENERGY_ICON_MAP.get(r_type_char.lower(), r_type_char)

                    value_str = text.replace("抗性:", "").replace(r_type_char, "").strip()
                    calc = None
                    value = ""
                    if '×' in value_str:
                        calc = "multiply"
                        value = value_str.replace('×', '').strip()
                    elif '-' in value_str:
                        calc = "minus"
                        value = value_str.replace('-', '').strip()
                    elif '+' in value_str:
                        calc = "plus"
                        value = value_str.replace('+', '').strip()

                    if calc:
                        card_details['pokemon']['resistances'].append({"type": r_type, "calc": calc, "value": value})

            elif text.startswith("撤退"):
                icons = p_tag.select('span[style*="font-family: ptcg-font-19"]')
                if icons:
                    retreat_cost = [ENERGY_ICON_MAP.get(icon.get_text(strip=True).lower(), icon.get_text(strip=True)) for icon in icons]
                    card_details['pokemon']['retreats'] = retreat_cost
        
        # Clean up empty lists
        if not card_details['pokemon']['weaknesses']:
            del card_details['pokemon']['weaknesses']
        if not card_details['pokemon']['resistances']:
            del card_details['pokemon']['resistances']
        if not card_details['pokemon']['retreats']:
            del card_details['pokemon']['retreats']

def get_card_details(card_id, html_content=None):
    """
    Extracts detailed information from tcg.mik.moe.
    The card_id is expected in the format 'SET_CODE/CARD_NUMBER', e.g., 'CSV5C/019'.
    """
    if '/' not in card_id:
        print(f"Invalid card_id format for CHS: {card_id}. Expected 'SET/NUM'.", file=sys.stderr)
        return None

    set_code, card_number = card_id.split('/', 1)

    card_details = {
        "name": None, 
        "set_code": set_code, 
        "set_name": None, 
        "card_number": card_number,
        "image_url": None, 
        "supertype": None, 
        "subtype": None, 
        "pokemon": None,
        "trainer": None, 
        "energy": None, 
        "addRule": None, 
        "rarity": None, 
        "author": None
    }

    soup = None
    if html_content:
        soup = BeautifulSoup(html_content, 'html.parser')
    else:
        options = Options()
        options.add_argument('--headless')
        options.add_argument('--disable-gpu')
        driver = None
        detail_url = f"https://tcg.mik.moe/cards/{card_id}"
        try:
            driver = webdriver.Chrome(options=options)
            driver.get(detail_url)
            # IMPORTANT: The target site uses a skeleton loader while content is fetched dynamically.
            # We must wait for the skeleton to become *invisible* to ensure the page is fully loaded.
            # Waiting for a container element to be *present* can cause a race condition where we get the container
            # with the loading skeleton inside, leading to parsing failures.
            WebDriverWait(driver, 15).until(
                EC.invisibility_of_element_located((By.CSS_SELECTOR, "div.mantine-Skeleton-root[data-visible='true']"))
            )
            soup = BeautifulSoup(driver.page_source, 'html.parser')

        except Exception as e:
            print(f"Selenium request error for {detail_url}: {e}", file=sys.stderr)
            return None
        finally:
            if driver: driver.quit()

    if not soup:
        return None

    # --- Template Dispatcher ---
    # Template A (Mantine) has h2 titles, Template B (Semantic) has h1
    if soup.select_one("h2.mantine-Title-root"):
        if _parse_template_A(soup, card_details):
            return card_details
    # else:
        # Placeholder for Template B parser
        # if _parse_template_B(soup, card_details):
        #     return card_details

    return None # Return None if no suitable template was found or parsing failed

def download_card_image(card_id, image_url):
    """
    Downloads the card image for the CHS version.
    """
    if not image_url: return
    
    os.makedirs(CARD_IMG_DIR, exist_ok=True)
    
    # The card_id 'CSV5C/019' is not a valid filename. We need to replace '/'.
    safe_card_id = card_id.replace('/', '_')
    
    file_extension = os.path.splitext(image_url)[1] or '.jpg'
    image_path = os.path.join(CARD_IMG_DIR, f"{safe_card_id}{file_extension}")
    
    if not os.path.exists(image_path):
        try:
            response = requests.get(image_url, stream=True)
            response.raise_for_status()
            with open(image_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"Downloaded CHS card image: {os.path.basename(image_path)}", file=sys.stderr)
        except requests.exceptions.RequestException as e:
            print(f"Error downloading CHS card image {card_id}: {e}", file=sys.stderr)

def _core_process_card(card_id, card_database, overwrite=True, html_content=None):
    """
    Core processing logic for a single CHS card.
    """
    if not overwrite and card_id in card_database and card_database[card_id].get('name'):
        print(f"Card ID {card_id} already exists, skipping.", file=sys.stderr)
        return card_database[card_id], 'skipped'

    if card_id in card_database and not card_database[card_id].get('name'):
        print(f"Warning: Card ID {card_id} has corrupted data, forcing re-fetch...", file=sys.stderr)
    
    print(f"Processing CHS card ID {card_id}...", file=sys.stderr)
    card_info = get_card_details(card_id, html_content=html_content)
    
    if not card_info or not card_info.get('name'):
        print(f"Could not retrieve or parse information for CHS card ID {card_id}.", file=sys.stderr)
        return card_database.get(card_id), 'failed'

    download_card_image(card_id, card_info.get('image_url'))
    return card_info, 'updated'

def add_card_to_database(card_id, overwrite=True, html_content=None, db_path=None):
    """
    Adds a single CHS card to the database.
    """
    card_database = load_database(db_path=db_path)
    card_info, status = _core_process_card(card_id, card_database, overwrite, html_content)

    if status == 'updated':
        card_database[card_id] = card_info
        save_database(card_database, db_path=db_path)
        print(f"Card ID {card_id} has been added/updated in the CHS database.", file=sys.stderr)
        return card_info, True
    
    return card_info, False
