import sys, os, re, json, time

# Get the absolute path of the directory where the script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
# Construct the absolute path to the 'libs' directory
libs_dir = os.path.join(script_dir, 'libs')

# Add the 'libs' directory to the Python path
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

import requests
from bs4 import BeautifulSoup, Tag

# Calculate the absolute path of the project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

# Paths are now absolute paths built from the project root
DATABASE_FILE = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'database_cht.json')
CARD_IMG_DIR = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'card_img_cht')

ENERGY_ICON_MAP = {
    "Grass.png": "草",
    "Fire.png": "炎",
    "Water.png": "水",
    "Lightning.png": "雷",
    "Psychic.png": "超",
    "Fighting.png": "闘",
    "Darkness.png": "悪",
    "Metal.png": "鋼",
    "Dragon.png": "竜",
    "Fairy.png": "妖",
    "Colorless.png": "無",
}

RARITY_ICON_MAP = {
    # This map needs to be updated for the CHT website
}

EVOLVE_STAGE_MAP = {
    "基礎": "たね",
    "1階進化": "1 進化",
    "2階進化": "2 進化"
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
        return

    temp_file_path = target_path + '.tmp'
    print(f"DEBUG: Attempting to save to temporary file: {os.path.abspath(temp_file_path)}", file=sys.stderr)
    print(f"DEBUG: Target database file: {os.path.abspath(target_path)}", file=sys.stderr)

    try:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(temp_file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"DEBUG: Temporary file written. Size: {os.path.getsize(temp_file_path)} bytes.", file=sys.stderr)
        os.replace(temp_file_path, target_path)
        print(f"DEBUG: Successfully replaced {os.path.basename(temp_file_path)} with {os.path.basename(target_path)}", file=sys.stderr)
        time.sleep(1)
        reloaded_data = load_database(db_path=target_path)
        print(f"DEBUG: Reloaded database immediately after save. Keys count: {len(reloaded_data)}", file=sys.stderr)
    except Exception as e:
        print(f"ERROR: Failed to save database to {target_path}: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

def parse_energy_icons(element):
    """
    Parses energy icons in an HTML element and replaces them with text.
    Handles both text content and <img> tags for energy icons.
    """
    if not element:
        return ""
    text_parts = []
    for content in element.contents:
        if isinstance(content, str):
            text_parts.append(content.strip())
        elif isinstance(content, Tag) and content.name == 'img':
            src = os.path.basename(content.get('src', ''))
            energy_type = ENERGY_ICON_MAP.get(src)
            if energy_type:
                text_parts.append(f"【{energy_type}】")
    return "".join(text_parts).strip()

def get_evolution_chain_cht(soup):
    """
    Parses the HTML of a card detail page to extract its evolution chain,
    excluding the immediate parent.
    """
    evolves_from = []
    evolution_div = soup.find('div', class_='evolution')
    if not evolution_div:
        return []

    active_step = evolution_div.find('li', class_='active')
    if not active_step:
        return []

    # Find all ancestor <ul> tags
    ancestor_uls = active_step.find_parents('ul')

    for ul in ancestor_uls:
        # For each ancestor <ul>, find the <li> that is its direct child and has the pokemon name.
        # This li is the head of its evolution stage.
        head_of_stage_li = ul.find('li', class_='step', recursive=False)
        if head_of_stage_li:
            link = head_of_stage_li.find('a')
            if link and link.string:
                evolves_from.append(link.string.strip())

    # The list is now ['噴火龍', '火恐龍', '小火龍'] for Mega Charizard X.
    # Per user request, exclude the immediate parent (e.g., '噴火龍').
    if len(evolves_from) > 1:
        evolves_from = evolves_from[1:]
    
    # Reverse to get from base to pre-evolution
    evolves_from.reverse()
    
    return evolves_from

def get_card_details(card_id, html_content=None):
    """
    Extracts detailed information from the official Pokémon card website (Traditional Chinese)
    by parsing the HTML of the card detail page.
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
            detail_url = f"https://asia.pokemon-card.com/tw/card-search/detail/{card_id}/"
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
        card_name_element = soup.select_one('h1.pageHeader.cardDetail')
        if card_name_element:
            if card_name_element.contents:
                card_name = card_name_element.contents[-1].strip()
            else:
                card_name = card_name_element.get_text(strip=True)
            card_details['name'] = card_name

        image_element = soup.select_one('.cardImage img')
        if image_element and image_element.get('src'):
            card_details['image_url'] = image_element['src']

        # --- Set Information ---
        expansion_link = soup.select_one('.expansionLinkColumn a')
        if expansion_link:
            card_details['set_name'] = expansion_link.get_text(strip=True)

        collector_number_span = soup.select_one('.expansionColumn .collectorNumber')
        if collector_number_span:
            card_details['card_number'] = collector_number_span.get_text(strip=True)

        regulation_mark_span = soup.select_one('.expansionColumn .alpha')
        if regulation_mark_span:
            card_details['set_code'] = regulation_mark_span.get_text(strip=True)

        # --- Illustrator ---
        illustrator_link = soup.select_one('.illustrator a')
        if illustrator_link:
            card_details['author'] = illustrator_link.get_text(strip=True)

        # --- Supertype/Subtype Determination ---
        evolve_marker = soup.select_one('.evolveMarker')
        if evolve_marker:
            card_details['supertype'] = 'pokemon'
            for st in ['ex', 'VSTAR', 'VMAX', 'V']:
                if card_details.get('name', '').endswith(st):
                    card_details['subtype'] = st
                    break
        else:
            skill_header = soup.select_one('.skillInformation .commonHeader')
            if skill_header:
                header_text = skill_header.get_text(strip=True)
                if '基本能量卡' in header_text:
                    card_details['supertype'] = 'energy'
                    card_details['subtype'] = 'basic energy'
                    match = re.search(r'【(.+?)】', card_details.get('name', ''))
                    if match:
                        card_details['energy'] = match.group(1)
                    else:
                        card_details['energy'] = re.sub(r'基本|能量', '', card_details.get('name', '')).strip()
                elif '特殊能量卡' in header_text:
                    card_details['supertype'] = 'energy'
                    card_details['subtype'] = 'special energy'
                else:
                    card_details['supertype'] = 'trainer'
                    trainer_subtype_map = {'物品': 'item', '支援者': 'supporter', '競技場': 'stadium', '寶可夢道具': 'tool'}
                    for text, subtype in trainer_subtype_map.items():
                        if text in header_text:
                            card_details['subtype'] = subtype
                            break
            elif card_details.get('name', '').endswith('能量'):
                card_details['supertype'] = 'energy'
                card_details['subtype'] = 'special energy'
            else:
                card_details['supertype'] = 'trainer'

        # --- Pokémon-specific Information ---
        if card_details['supertype'] == 'pokemon':
            card_details['pokemon'] = {}

            # Add placeholder rule for all 'ex' cards (will be overwritten by more specific rules)
            if card_details.get('subtype') == 'ex':
                card_details['addRule'] = '寶可夢ex昏厥時，對手獲得2張獎賞卡。'

            # Check for Mega Evolution ex (will overwrite the 'ex' rule placeholder)
            card_name = card_details.get('name', '')
            if card_name.startswith('超級') and card_name.endswith('ex'):
                card_details['pokemon']['option'] = 'Mega'
                card_details['addRule'] = '超級進化寶可夢ex昏厥時，對手獲得3張獎賞卡。'

            hp_span = soup.select_one('.mainInfomation .number')
            if hp_span:
                card_details['pokemon']['hp'] = hp_span.get_text(strip=True)

            type_img = soup.select_one('.mainInfomation img')
            if type_img:
                type_filename = os.path.basename(type_img['src'])
                if type_filename in ENERGY_ICON_MAP:
                    card_details['pokemon']['color'] = [ENERGY_ICON_MAP[type_filename]]

            if evolve_marker:
                evolve_text = evolve_marker.get_text(strip=True)
                if evolve_text != '基礎':
                    card_details['pokemon']['evolves'] = EVOLVE_STAGE_MAP.get(evolve_text, evolve_text)

            # Special rule for VSTAR and VMAX
            card_name = card_details.get('name', '')
            if card_name.endswith('VSTAR') or card_name.endswith('VMAX'):
                card_details['pokemon']['evolves'] = 'V進化'

            evolves_from_list = get_evolution_chain_cht(soup)
            if evolves_from_list:
                card_details['pokemon']['evolvesFrom'] = evolves_from_list

            abilities_list = []
            attacks_list = []
            skills = soup.select('.skillInformation .skill')
            for skill in skills:
                name_span = skill.select_one('.skillName')
                cost_span = skill.select_one('.skillCost')
                damage_span = skill.select_one('.skillDamage')
                effect_p = skill.select_one('.skillEffect')

                name = name_span.get_text(strip=True) if name_span else ''
                costs = [os.path.basename(img['src']) for img in cost_span.select('img')] if cost_span else []
                costs_text = [ENERGY_ICON_MAP.get(c, '') for c in costs]
                damage = damage_span.get_text(strip=True) if damage_span else ''
                text = effect_p.get_text(separator=' ', strip=True) if effect_p else ''
                text = ' '.join(text.split())

                # Handle VSTAR Power
                is_vstar_power = False
                if '[VSTAR力量]' in name:
                    is_vstar_power = True
                    name = name.replace('[VSTAR力量]', '').strip()

                # Handle additional rules
                if name.startswith('[') and name.endswith('規則]'):
                    rule_text = text.replace('【', '').replace('】', '')
                    card_details['addRule'] = rule_text
                    continue

                if '[特性]' in name:
                    ability_data = {"name": name.replace('[特性]', '').strip(), "text": text}
                    if is_vstar_power:
                        ability_data['option'] = 'Vstar'
                    abilities_list.append(ability_data)
                elif ('[太晶]' in name or name.strip() == '太晶') and ''.join(text.split()) == '只要這隻寶可夢在備戰區，不會受到招式的傷害。': # Handle Terastal pseudo-attack
                    card_details['pokemon']['option'] = 'Terastal'
                else:
                    attack_data = {"name": name, "cost": costs_text, "damage": damage, "text": text}
                    if is_vstar_power:
                        attack_data['option'] = 'Vstar'
                    attacks_list.append(attack_data)

            if abilities_list:
                card_details['pokemon']['abilities'] = abilities_list
            if attacks_list:
                card_details['pokemon']['attacks'] = attacks_list

            sub_info_table = soup.select_one('.subInformation table')
            if sub_info_table:
                headers = [th.get_text(strip=True) for th in sub_info_table.select('th')]
                values = sub_info_table.select('td')
                if len(headers) == len(values):
                    info_map = dict(zip(headers, values))
                    if '弱點' in info_map:
                        w_td = info_map['弱點']
                        w_text = parse_energy_icons(w_td) + "".join([s.strip() for s in w_td.strings if s.strip()])
                        w_match = re.match(r'【(.+?)】×(\d+)', w_text)
                        if w_match:
                            card_details['pokemon']['weaknesses'] = [{"type": w_match.group(1), "calc": "multiply", "value": w_match.group(2)}]
                    if '抵抗力' in info_map:
                        r_td = info_map['抵抗力']
                        r_text = parse_energy_icons(r_td) + "".join([s.strip() for s in r_td.strings if s.strip()])
                        r_match = re.match(r'【(.+?)】－(\d+)', r_text)
                        if r_match:
                            card_details['pokemon']['resistances'] = [{"type": r_match.group(1), "calc": "minus", "value": r_match.group(2)}]
                    if '撤退' in info_map:
                        ret_td = info_map['撤退']
                        retreat_costs = [ENERGY_ICON_MAP.get(os.path.basename(img['src']), '') for img in ret_td.select('img')]
                        if retreat_costs:
                            card_details['pokemon']['retreats'] = retreat_costs

        elif card_details['supertype'] == 'trainer':
            card_details['trainer'] = {}
            effect_p = soup.select_one('.skillInformation .skillEffect')
            if effect_p:
                text = effect_p.get_text(separator=' ', strip=True)
                card_details['trainer']['text'] = ' '.join(text.split())

        elif card_details['supertype'] == 'energy' and card_details['subtype'] == 'special energy':
            card_details['energy'] = {}
            effect_p = soup.select_one('.skillInformation .skillEffect')
            if effect_p:
                text = effect_p.get_text(separator=' ', strip=True)
                card_details['energy']['text'] = ' '.join(text.split())

        return card_details

    except Exception as e:
        print(f"An unexpected error occurred while parsing card {card_id}: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return None

def download_card_image(card_id, image_url, language='cht'):
    if not image_url:
        return
    card_img_dir_name = f"card_img_{language}"
    target_dir = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', card_img_dir_name)
    os.makedirs(target_dir, exist_ok=True)
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

def _core_process_card(card_id, card_database, overwrite=True, html_content=None, language='cht'):
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

def add_card_to_database(card_id, overwrite=True, html_content=None, db_path=None, language='cht'):
    card_database = load_database(db_path=db_path)
    card_info, status = _core_process_card(card_id, card_database, overwrite, html_content, language=language)
    if status == 'updated':
        card_database[card_id] = card_info
        save_database(card_database, db_path=db_path)
        print(f"Card ID {card_id} has been added/updated in the database.", file=sys.stderr)
        return card_info, True
    return card_info, False
