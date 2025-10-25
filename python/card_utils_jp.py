import sys, os, re, json,time, sys

# Get the absolute path of the directory where the script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
# Construct the absolute path to the 'libs' directory
libs_dir = os.path.join(script_dir, 'libs')

# Add the 'libs' directory to the Python path
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

import requests
from bs4 import BeautifulSoup

# Calculate the absolute path of the project root
# __file__ is the path of the current script, e.g., /path/to/project/python/card_utils_jp.py
# os.path.dirname(__file__) is .../ptcg-telop/python
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

# Paths are now absolute paths built from the project root
DATABASE_FILE = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'database_jp.json')
CARD_IMG_DIR = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'card_img_jp')

# Mapping from energy icons to text
ENERGY_ICON_MAP = {
    "icon-grass": "草",
    "icon-fire": "炎",
    "icon-water": "水",
    "icon-lightning": "雷",
    "icon-electric": "雷",
    "icon-psychic": "超",
    "icon-fighting": "闘",
    "icon-dark": "悪",
    "icon-metal": "鋼",
    "icon-steel": "鋼",
    "icon-dragon": "竜",
    "icon-colorless": "無",
    "icon-none": "無",
    "icon-fairy": "妖",
}

# Mapping from rarity icon filenames to text
RARITY_ICON_MAP = {
    "ic_rare_c.gif": "C",
    "ic_rare_u.gif": "U",
    "ic_rare_u_c.gif": "U",
    "ic_rare_r.gif": "R",
    "ic_rare_rr.gif": "RR",
    "ic_rare_sr.gif": "SR",
    "ic_rare_hr.gif": "HR",
    "ic_rare_ur.gif": "UR",
    "ic_rare_ar.gif": "AR",
    "ic_rare_sar.gif": "SAR",
    "ic_rare_k.gif": "K", # K is a special rarity for Radiant Pokémon, now out of rotation
    "ic_rare_ace.gif": "ACE", # Special rarity for ACE SPEC
    # More rarity icons can be added as needed
}

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
    print(f"DEBUG: save_database called. Data keys count: {len(data)}", file=sys.stderr)
    if not data:
        print("DEBUG: Data to be saved is empty!", file=sys.stderr)
        return # Avoid writing an empty file if data is unexpectedly empty

    # Use a temporary file for atomic writing
    temp_file_path = target_path + '.tmp'
    print(f"DEBUG: Attempting to save to temporary file: {os.path.abspath(temp_file_path)}", file=sys.stderr)
    print(f"DEBUG: Target database file: {os.path.abspath(target_path)}", file=sys.stderr)

    try:
        # Ensure the directory exists
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        
        with open(temp_file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        
        print(f"DEBUG: Temporary file written. Size: {os.path.getsize(temp_file_path)} bytes.", file=sys.stderr)

        # After successful writing, rename the temporary file to the target file
        os.replace(temp_file_path, target_path)
        print(f"DEBUG: Successfully replaced {os.path.basename(temp_file_path)} with {os.path.basename(target_path)}", file=sys.stderr)
        
        # Immediately try to reload the database to verify the write
        time.sleep(1) # Give OS a moment to sync
        reloaded_data = load_database(db_path=target_path)
        print(f"DEBUG: Reloaded database immediately after save. Keys count: {len(reloaded_data)}", file=sys.stderr)

    except Exception as e:
        print(f"ERROR: Failed to save database to {target_path}: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    finally:
        # Ensure the temporary file is deleted, even if an error occurs
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


def parse_energy_icons(element):
    """
    Parses energy icons in an HTML element and replaces them with text.
    """
    if not element: return ""
    text_parts = []
    for content in element.contents:
        if isinstance(content, str):
            text_parts.append(content.strip())
        elif content.name == 'span' and 'icon' in content.get('class', []):
            for cls in content.get('class', []):
                if cls.startswith('icon-'):
                    energy_type = ENERGY_ICON_MAP.get(cls, '')
                    if energy_type:
                        text_parts.append(f"【{energy_type}】")
                    break
    return "".join(text_parts).strip()

def get_pokemon_evolution_chain(soup, card_name):
    """
    Accurately extracts the evolution chain based on HTML structure and evolution arrows.
    """
    evolves_from = []
    evolves_to = []

    evolution_section = soup.select_one(".RightBox-inner")
    if not evolution_section:
        return [], []

    all_evo_divs = evolution_section.select(":scope > div.evolution")
    
    current_card_index = -1
    # Prioritize locating via the ev_on class
    for i, div in enumerate(all_evo_divs):
        # The ev_on class might be on the parent div of the <a> tag, or on a more outer div
        if 'ev_on' in div.get('class', []) or div.select_one('.ev_on'):
            current_card_index = i
            break
    
    # Use the card name as a fallback if not found by class
    if current_card_index == -1:
        for i, div in enumerate(all_evo_divs):
            anchors = div.select('a')
            for anchor in anchors:
                if anchor.text.strip() == card_name:
                    current_card_index = i
                    break
            if current_card_index != -1:
                break
    
    if current_card_index == -1:
        return [], []

    # --- Determine evolves_to ---
    # The evolution target is the element before the current card,
    # but only if the current card's div contains an arrow indicating it can evolve.
    if current_card_index > 0:
        current_div = all_evo_divs[current_card_index]
        if current_div.select_one('.arrow_on, .arrow_off'):
            to_div = all_evo_divs[current_card_index - 1]
            to_anchors = to_div.select('a')
            for anchor in to_anchors:
                evo_name = anchor.text.strip()
                if evo_name:
                    evolves_to.append(evo_name)

    # --- Determine evolves_from ---
    # The pre-evolution is the next element in the list that contains an "arrow"
    for i in range(current_card_index + 1, len(all_evo_divs)):
        from_div = all_evo_divs[i]
        # Key: Only divs containing an arrow are part of the actual evolution path
        if from_div.select_one('.arrow_on, .arrow_off'):
            from_anchor = from_div.select_one('a')
            if from_anchor and from_anchor.text:
                evolves_from.append(from_anchor.text.strip())

    return evolves_from, evolves_to

def get_card_details(card_id, html_content=None):
    """
    Extracts detailed information from the official Pokémon card website or local HTML detail page.
    """
    card_details = {
        "name": None,
        "set_code": None,
        "set_name": None,
        "card_number": None,
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
        try:
            detail_url = f"https://www.pokemon-card.com/card-search/details.php/card/{card_id}"
            response = requests.get(detail_url)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
        except requests.exceptions.RequestException as e:
            print(f"Request error: {e}", file=sys.stderr)
            return None

    if not soup:
        return None

    try:
        # --- Basic Information ---
        card_name_element = soup.find('h1', class_='Heading1')
        card_name = card_name_element.get_text(strip=True).strip("' ") if card_name_element else ''
        card_details['name'] = card_name

        image_element = soup.find('img', class_='fit')
        if image_element and image_element.get('src'):
            card_details['image_url'] = "https://www.pokemon-card.com" + image_element['src']

        subtext_div = soup.find('div', class_='subtext')
        if subtext_div:
            set_code_element = subtext_div.find('img', class_='img-regulation')
            if set_code_element and set_code_element.get('alt'):
                card_details['set_code'] = set_code_element.get('alt')
            
            card_number_text = subtext_div.get_text(strip=True)
            match = re.search(r'(\d+\s*/\s*\d+)', card_number_text)
            if match:
                card_details['card_number'] = match.group(1).replace(" ", "").replace("\xa0", "")

        set_name_element = soup.find('a', class_='Link Link-arrow')
        if set_name_element:
            card_details['set_name'] = set_name_element.get_text(strip=True)

        author_link = soup.find('div', class_='author').find('a')
        if author_link:
            card_details['author'] = author_link.get_text(strip=True)

        # --- Card Type Determination ---
        top_info = soup.find('div', class_='TopInfo')
        if top_info and top_info.find('span', class_='type'):
            card_details['supertype'] = 'pokemon'
        else:
            trainer_subtype_map = {'グッズ': 'item', 'サポート': 'supporter', 'スタジアム': 'stadium', 'ポケモンのどうぐ': 'tool'}
            found_trainer = False
            for h2_text, subtype in trainer_subtype_map.items():
                if soup.find('h2', class_='mt20', string=h2_text):
                    card_details['supertype'] = 'trainer'
                    card_details['subtype'] = subtype
                    found_trainer = True
                    break
            if not found_trainer:
                card_details['supertype'] = 'energy'
                card_details['subtype'] = 'special energy' if '基本' not in card_name else 'basic energy'

        # --- Pokémon Information ---
        # Key fix: Pre-create pokemon object for non-Pokémon cards with HP, like fossils
        hp_num = top_info.find('span', class_='hp-num') if top_info else None
        if hp_num:
            if 'pokemon' not in card_details or not card_details['pokemon']:
                card_details['pokemon'] = {}
            card_details['pokemon']['hp'] = hp_num.get_text(strip=True)

        # --- Unified Ability and Attack Parsing (placed before weaknesses) ---
        abilities_list = []
        attacks_list = []
        right_box = soup.select_one(".RightBox-inner")

        if right_box:
            abilities_heading = right_box.find('h2', string='特性')
            if abilities_heading:
                current_element = abilities_heading.next_sibling
                while current_element and current_element.name != 'h2':
                    if current_element.name == 'h4':
                        name = current_element.get_text(strip=True)
                        text = parse_energy_icons(current_element.find_next_sibling('p'))
                        abilities_list.append({"name": name, "text": text})
                    current_element = current_element.next_sibling
            
            attacks_heading = right_box.find('h2', string='ワザ')
            if attacks_heading:
                current_element = attacks_heading.next_sibling
                while current_element and current_element.name != 'h2':
                    if current_element.name == 'h4':
                        costs = [ENERGY_ICON_MAP.get(cls, '') for icon in current_element.select('span.icon') for cls in icon['class'] if cls.startswith('icon-')]
                        damage_span = current_element.find('span', class_='f_right')
                        damage = damage_span.get_text(strip=True) if damage_span else ""
                        name_parts = [c.strip() for c in current_element.contents if isinstance(c, str)]
                        name = "".join(name_parts).strip()
                        text = parse_energy_icons(current_element.find_next_sibling('p'))
                        attacks_list.append({"name": name, "cost": costs, "damage": damage, "text": text})
                    current_element = current_element.next_sibling
        
        # --- Smart Attribute Assignment ---
        if card_details.get('pokemon'): # Applies to Pokémon and Fossil cards
            if abilities_list:
                card_details['pokemon']['abilities'] = abilities_list

        if card_details['supertype'] == 'pokemon':
            if not card_details.get('pokemon'): card_details['pokemon'] = {} # Safety check
            
            for st in ['ex', 'VSTAR', 'VMAX', 'V-UNION', 'V', 'GX', 'EX', 'BREAK']:
                if card_name.endswith(st):
                    card_details['subtype'] = st
                    break

            evolves_text_span = top_info.find('span', class_='type')
            if evolves_text_span:
                card_details['pokemon']['evolves'] = evolves_text_span.get_text(strip=True).replace("\xa0", " ")

            if card_details.get('subtype') == 'ex':
                if soup.find('p', class_='mt20', string='このポケモンは、ベンチにいるかぎり、ワザのダメージを受けない。'):
                    card_details['pokemon']['option'] = 'Terastal'
            
            # Robustly find the Mega Evolution rule
            special_rule_heading = soup.find('h2', string='特別なルール')
            if special_rule_heading:
                next_p = special_rule_heading.find_next_sibling('p')
                while next_p and not next_p.get_text(strip=True):
                    next_p = next_p.find_next_sibling('p') # Skip empty p tags
                if next_p and 'メガシンカexがきぜつしたとき' in next_p.get_text():
                    card_details['pokemon']['option'] = 'Mega'

            evolves_from, evolves_to = get_pokemon_evolution_chain(soup, card_name)
            if evolves_from:
                card_details['pokemon']['evolvesFrom'] = evolves_from
            if evolves_to:
                card_details['pokemon']['evolvesTo'] = evolves_to

            type_icon = top_info.find('span', class_=re.compile(r'^icon-'))
            if type_icon:
                for cls in type_icon.get('class', []):
                    if cls.startswith('icon-'):
                        card_details['pokemon']['color'] = [ENERGY_ICON_MAP.get(cls, '')]
                        break
            
            if attacks_list:
                card_details['pokemon']['attacks'] = attacks_list

            table = soup.find('th', string='弱点')
            if table:
                data_row = table.find_parent('tr').find_next_sibling('tr')
                tds = data_row.find_all('td')
                if len(tds) == 3:
                    w_text = parse_energy_icons(tds[0])
                    w_match = re.match(r'【(.+?)】×(\d+)', w_text)
                    if w_match: card_details['pokemon']['weaknesses'] = [{"type": w_match.group(1), "calc":"multiply", "value": w_match.group(2)}]
                    
                    r_text = parse_energy_icons(tds[1])
                    r_match = re.match(r'【(.+?)】－\s*(\d+)', r_text)
                    if r_match: card_details['pokemon']['resistances'] = [{"type": r_match.group(1), "calc":"minus", "value": r_match.group(2)}]

                    retreat_costs = re.findall(r'【(.+?)】', parse_energy_icons(tds[2]))
                    if retreat_costs: card_details['pokemon']['retreats'] = retreat_costs

        elif card_details['supertype'] == 'trainer':
            card_details['trainer'] = {}
            text_p = right_box.find('p', recursive=False)
            if text_p: card_details['trainer']['text'] = parse_energy_icons(text_p)
            if attacks_list: # Applies to Technical Machines
                card_details['trainer']['attacks'] = attacks_list
        
        elif card_details['supertype'] == 'energy':
            if card_details['subtype'] == 'basic energy':
                # For basic energy, extract the type from the name and set it as a string.
                # Use regex to remove "基本" and "エネルギー" to get the energy type.
                card_details['energy'] = re.sub(r'基本|エネルギー', '', card_name).strip()
            else: # For special energy
                card_details['energy'] = {}
                text_p = right_box.find('p', recursive=False)
                if text_p: card_details['energy']['text'] = parse_energy_icons(text_p)

        # --- Additional Rules & Rarity ---
        add_rule_heading = soup.find('h2', string='特別なルール')
        if add_rule_heading:
            card_details['addRule'] = add_rule_heading.find_next_sibling('p').get_text(strip=True)

        rarity_img = soup.find('img', src=re.compile(r'ic_rare_.*\.gif'))
        if rarity_img:
            rarity_filename = os.path.basename(rarity_img.get('src', ''))
            card_details['rarity'] = RARITY_ICON_MAP.get(rarity_filename, '')
        elif 'ACE SPEC' in (card_details.get('addRule') or ''):
            card_details['rarity'] = 'ACE'

        return card_details

    except Exception as e:
        print(f"An unexpected error occurred while parsing card {card_id}: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return None

def download_card_image(card_id, image_url, language='jp'):
    if not image_url: return
    # Construct the language-specific directory name
    card_img_dir_name = f"card_img_{language}"
    target_dir = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', card_img_dir_name)

    os.makedirs(target_dir, exist_ok=True)
    # Infer image format from server URL, default to .jpg as it's most common
    file_extension = os.path.splitext(image_url)[1] or '.jpg'
    image_path = os.path.join(target_dir, f"{card_id}{file_extension}")
    if not os.path.exists(image_path):
        try:
            response = requests.get(image_url, stream=True)
            response.raise_for_status()
            with open(image_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"Downloaded card image: {os.path.basename(image_path)}", file=sys.stderr)
        except requests.exceptions.RequestException as e:
            print(f"Error downloading card image {card_id}: {e}", file=sys.stderr)

def _core_process_card(card_id, card_database, overwrite=True, html_content=None, language='jp'):
    if not overwrite and card_id in card_database and card_database[card_id].get('name'):
        print(f"Card ID {card_id} already exists, skipping.", file=sys.stderr)
        return card_database[card_id], 'skipped'

    if card_id in card_database and not card_database[card_id].get('name'):
        print(f"Warning: Card ID {card_id} has corrupted data, forcing re-fetch...", file=sys.stderr)
    
    print(f"Processing card ID {card_id}...", file=sys.stderr)
    card_info = get_card_details(card_id, html_content=html_content)
    
    if not card_info or not card_info.get('name'):
        print(f"Could not retrieve or parse information for card ID {card_id}.", file=sys.stderr)
        return card_database.get(card_id), 'failed'

    download_card_image(card_id, card_info.get('image_url'), language=language)
    return card_info, 'updated'

def add_card_to_database(card_id, overwrite=True, html_content=None, db_path=None, language='jp'):
    card_database = load_database(db_path=db_path)
    card_info, status = _core_process_card(card_id, card_database, overwrite, html_content, language=language)

    if status == 'updated':
        card_database[card_id] = card_info
        save_database(card_database, db_path=db_path)
        print(f"Card ID {card_id} has been added/updated in the database.", file=sys.stderr)
        return card_info, True
    
    return card_info, False
