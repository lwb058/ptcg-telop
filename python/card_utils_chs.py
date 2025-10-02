import requests, re, json, os, time, sys

# --- Constants and Paths ---
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
DATABASE_FILE = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'database_chs.json')
CARD_IMG_DIR = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'card_img_chs')
CARD_PACKS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'card_packs.json')

# --- Cache ---
_SET_NAME_CACHE = None

# --- Mappings ---
EVOLUTION_STAGE_MAP = {
    "Basic": "たね",
    "Stage 1": "1 進化",
    "Stage 2": "2 進化",
    "VSTAR": "V進化",
    "VMAX": "V進化"
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

# --- Core Functions ---
def fetch_card_packs():
    """
    从 tcg.mik.moe API 获取卡包列表并保存到文件。
    """
    url = "https://tcg.mik.moe/api/v3/card/product-list"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    }
    data = {}

    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        response.encoding = 'utf-8'
        card_packs_data = response.json()

        if card_packs_data.get("code") == 200:
            pack_list = card_packs_data.get("data", {}).get("list", [])
            
            if pack_list:
                print(f"成功获取到 {len(pack_list)} 个卡包的信息。", file=sys.stderr)
                
                with open(CARD_PACKS_FILE, "w", encoding="utf-8") as f:
                    json.dump(pack_list, f, ensure_ascii=False, indent=4)
                print(f"数据已成功保存到 {CARD_PACKS_FILE} 文件。", file=sys.stderr)

            else:
                print("API返回成功，但卡包列表为空。", file=sys.stderr)

        else:
            print(f"API 返回错误: {card_packs_data.get('msg')}", file=sys.stderr)

    except requests.exceptions.RequestException as e:
        print(f"请求过程中发生网络错误: {e}", file=sys.stderr)
    except json.JSONDecodeError:
        print("解析返回的JSON数据失败，请检查API响应内容。", file=sys.stderr)
    except Exception as e:
        print(f"发生未知错误: {e}", file=sys.stderr)


def _get_set_name_map():
    """Lazy loads the set code to set name mapping, fetching if necessary."""
    global _SET_NAME_CACHE
    if _SET_NAME_CACHE is not None:
        return _SET_NAME_CACHE

    if not os.path.exists(CARD_PACKS_FILE):
        print("card_packs.json not found, fetching from API...", file=sys.stderr)
        fetch_card_packs() # This function from get_set_info_chs should create the file

    if os.path.exists(CARD_PACKS_FILE):
        try:
            with open(CARD_PACKS_FILE, 'r', encoding='utf-8') as f:
                set_list = json.load(f)
                _SET_NAME_CACHE = {item['setCode']: item['name'] for item in set_list}
                return _SET_NAME_CACHE
        except (json.JSONDecodeError, IOError) as e:
            print(f"Error reading or parsing card_packs.json: {e}", file=sys.stderr)
            _SET_NAME_CACHE = {}
            return _SET_NAME_CACHE
    else:
        print("Failed to create or find card_packs.json.", file=sys.stderr)
        _SET_NAME_CACHE = {}
        return _SET_NAME_CACHE

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

def _transform_api_data(api_data, card_details, set_name_map):
    """Transforms the JSON data from the API into the desired card_details format."""
    data = api_data.get('data', {})
    if not data:
        return

    set_code = data.get('setCode')
    card_details['name'] = data.get('name')
    card_details['rarity'] = data.get('rarity')
    card_details['author'] = data.get('artist')
    card_details['set_name'] = set_name_map.get(set_code)
    
    card_index = data.get('cardIndex')
    if set_code and card_index:
        card_details['image_url'] = f"https://tcg.mik.moe/static/img/{set_code}/{card_index}.png"

    supertype_api = data.get('cardType')

    if supertype_api == "Pokemon":
        pokemon_attr = data.get('pokemonAttr', {})
        is_basic = pokemon_attr.get('stage') == "Basic"

        card_details['supertype'] = 'pokemon'
        card_details['pokemon'] = {}
        # Determine subtype with priority based on the 'stage' attribute
        pokemon_stage = pokemon_attr.get('stage')
        if pokemon_stage == 'VMAX':
            card_details['subtype'] = 'VMAX'
        elif pokemon_stage == 'VSTAR':
            card_details['subtype'] = 'VSTAR'
        else:
            # Fallback to the general mechanic for V, ex, etc.
            card_details['subtype'] = data.get('mechanic')

        # options for TAG TEAM, Terastal, Mega, etc.
        if data.get('label'):
            card_details['pokemon']['option'] = data.get('label')[0]
        elif pokemon_attr.get('ancientTrait') == 'Tera':
            card_details['pokemon']['option'] = "Terastal"

        # Rules for ex, V, VMAX, etc.
        if card_details['subtype'] in ['ex', 'V', 'VSTAR', 'GX']:
            if card_details['pokemon'].get('option') == 'TAG TEAM':
                card_details['addRule'] = f"当TAG TEAM昏厥时，对手将拿取3张奖赏卡。"
            elif card_details['pokemon'].get('option') == 'Mega':
                card_details['addRule'] = f"当超级进化宝可梦ex昏厥时，对手将拿取3张奖赏卡。"
            else:
                card_details['addRule'] = f"当宝可梦{card_details['subtype']}昏厥时，对手将拿取2张奖赏卡。"
        elif card_details['subtype'] == 'VMAX':
            card_details['addRule'] = f"当宝可梦VMAX昏厥时，对手将拿取3张奖赏卡。"
        
        # Rule for Radiant Pokémon
        elif card_details['name'] and card_details['name'].startswith("光辉") and is_basic:
            card_details['addRule'] = "1副卡组中只能放入1张光辉宝可梦卡。"


        if pokemon_attr:
            card_details['pokemon']['hp'] = str(pokemon_attr.get('hp'))
            if pokemon_attr.get('energyType'):
                card_details['pokemon']['color'] = [ENERGY_ICON_MAP.get(pokemon_attr['energyType'].lower())]

            card_details['pokemon']['evolves'] = EVOLUTION_STAGE_MAP.get(pokemon_attr.get('stage'))
            if not is_basic:
                card_details['pokemon']['evolvesFrom'] = [pokemon_attr.get('evolvesFrom')]

            # Abilities
            if pokemon_attr.get('ability'):
                card_details['pokemon']['abilities'] = []
                for ability in pokemon_attr['ability']:
                    new_ability = {
                        "name": ability.get('name'),
                        "text": ability.get('text', '').strip()
                    }
                    if ability.get('isVStarPower'):
                        new_ability['option'] = 'Vstar'
                    card_details['pokemon']['abilities'].append(new_ability)

            # Attacks
            if pokemon_attr.get('attack'):
                card_details['pokemon']['attacks'] = []
                for attack in pokemon_attr['attack']:
                    cost = [ENERGY_ICON_MAP.get(c.lower()) for c in attack.get('cost', '')]
                    new_attack = {
                        "cost": cost,
                        "name": attack.get('name'),
                        "damage": attack.get('damage'),
                        "text": attack.get('text', '').strip()
                    }
                    if attack.get('isVStarPower'):
                        new_attack['option'] = 'Vstar'
                    card_details['pokemon']['attacks'].append(new_attack)

            # Weakness, Resistance, Retreat
            if pokemon_attr.get('weakness'):
                w = pokemon_attr['weakness']
                value = w.get('value', '').replace('×', '').strip()
                card_details['pokemon']['weaknesses'] = [{"type": ENERGY_ICON_MAP.get(w.get('energy').lower()), "calc": "multiply", "value": value}]
            
            if pokemon_attr.get('resistance'):
                r = pokemon_attr['resistance']
                value = r.get('value', '').replace('-', '').strip()
                card_details['pokemon']['resistances'] = [{"type": ENERGY_ICON_MAP.get(r.get('energy').lower()), "calc": "minus", "value": value}]

            if pokemon_attr.get('retreatCost') is not None:
                card_details['pokemon']['retreats'] = [ENERGY_ICON_MAP.get('c')] * pokemon_attr['retreatCost']

    elif supertype_api in ["Trainer", "Stadium", "Supporter", "Item", "Tool"]:
        card_details['supertype'] = 'trainer'
        card_details['trainer'] = {'text': ' '.join(data.get('description', '').split())}
        
        if supertype_api in ["Stadium", "Supporter", "Item", "Tool"]:
            card_details['subtype'] = supertype_api.lower()
        else:
            desc = data.get('description', '')
            if "宝可梦道具" in desc: card_details['subtype'] = 'tool'
            elif "支援者" in desc: card_details['subtype'] = 'supporter'
            elif "竞技场" in desc: card_details['subtype'] = 'stadium'
            else: card_details['subtype'] = 'item'

    elif supertype_api in ["Energy", "Basic Energy", "Special Energy"]:
        card_details['supertype'] = 'energy'
        card_details['subtype'] = supertype_api.lower()
        if card_details['subtype'] == 'special energy':
            card_details['energy'] = {'text': ' '.join(data.get('description', '').split())}
        else:
            card_details['energy'] = {}
    
    else:
        card_details['supertype'] = supertype_api.lower() if supertype_api else None

def get_card_details(card_id, html_content=None):
    """Extracts detailed information by calling the tcg.mik.moe API."""
    # Normalize the ID to use a hyphen, making it consistent internally.
    normalized_id = card_id.replace('/', '-')
    
    try:
        set_code, card_number = normalized_id.split('-', 1)
    except ValueError:
        print(f"Invalid card_id format: {card_id}. Expected 'SET/NUM' or 'SET-NUM'.", file=sys.stderr)
        return None

    card_details = {
        "name": None, 
        "set_code": set_code, 
        "set_name": None, # API does not provide this, can be added later if needed
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

    # If html_content is provided, it means we are in a testing/mocking context.
    # We will parse it as JSON instead of making a live request.
    if html_content:
        try: api_response = json.loads(html_content)
        except json.JSONDecodeError:
            print(f"Error: Provided html_content is not valid JSON.", file=sys.stderr)
            return None
    else:
        url = "https://tcg.mik.moe/api/v3/card/card-detail"
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
        }
        payload = {"setCode": set_code, "cardIndex": card_number}
        
        try:
            response = requests.post(url, headers=headers, json=payload)
            response.raise_for_status()
            response.encoding = 'utf-8'
            api_response = response.json()
        except requests.exceptions.RequestException as e:
            print(f"API request error for {card_id}: {e}", file=sys.stderr)
            return None
        except json.JSONDecodeError:
            print(f"Failed to decode JSON from API response for {card_id}.", file=sys.stderr)
            return None

    if api_response and api_response.get("code") == 200:
        set_name_map = _get_set_name_map()
        _transform_api_data(api_response, card_details, set_name_map)
        return card_details
    else:
        print(f"API returned an error for {card_id}: {api_response.get('msg')}", file=sys.stderr)
        return None

def download_card_image(card_id, image_url):
    """
    Downloads the card image for the CHS version.
    """
    if not image_url or not card_id: return
    
    os.makedirs(CARD_IMG_DIR, exist_ok=True)
    # The card_id passed in should be the internal format 'SET-NUM'
    internal_card_id = card_id
    file_extension = os.path.splitext(image_url)[1] or '.png'
    if '?' in file_extension: file_extension = file_extension.split('?')[0]

    image_path = os.path.join(CARD_IMG_DIR, f"{internal_card_id}{file_extension}")
    
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
    # Convert external 'SET/NUM' to internal 'SET-NUM' for database operations
    internal_card_id = card_id.replace('/', '-')

    if not overwrite and internal_card_id in card_database and card_database[internal_card_id].get('name'):
        print(f"Card ID {card_id} already exists, skipping.", file=sys.stderr)
        return card_database[internal_card_id], 'skipped'

    if internal_card_id in card_database and not card_database[internal_card_id].get('name'):
        print(f"Warning: Card ID {card_id} has corrupted data, forcing re-fetch...", file=sys.stderr)
    
    print(f"Processing CHS card ID {card_id}...", file=sys.stderr)
    # get_card_details still uses the original 'SET/NUM' format for the API call
    card_info = get_card_details(card_id, html_content=html_content)
    
    if not card_info or not card_info.get('name'):
        print(f"Could not retrieve or parse information for CHS card ID {card_id}.", file=sys.stderr)
        return card_database.get(internal_card_id), 'failed'

    # Use the internal ID for downloading the image
    download_card_image(internal_card_id, card_info.get('image_url'))
    return card_info, 'updated'

def add_card_to_database(card_id, overwrite=True, html_content=None, db_path=None, db_instance=None):
    """Adds a single CHS card to the database."""
    # If a database instance is passed, use it; otherwise, load from file.
    card_database = db_instance if db_instance is not None else load_database(db_path=db_path)
    
    # The core processing function now handles normalization
    card_info, status = _core_process_card(card_id, card_database, overwrite, html_content)

    if status == 'updated':
        # Use the normalized ID for the database key
        normalized_id = card_id.replace('/', '-')
        card_database[normalized_id] = card_info
        # If we are working with an in-memory instance, we do not save here.
        # The calling script is responsible for the final save.
        if db_instance is None:
            save_database(card_database, db_path=db_path)
        print(f"Card ID {normalized_id} has been added/updated in the CHS database.", file=sys.stderr)
    
    return card_info, status

if __name__ == "__main__":
    print("Fetching latest CHS card pack information...", file=sys.stderr)
    fetch_card_packs()
