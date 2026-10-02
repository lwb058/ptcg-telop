"""
Input: sys, os, re, json, time, tempfile, struct, zlib, import_diagnostics, requests
Output: request_json, fetch_card_packs, load_database, save_database, get_card_by_name, normalize_card_id, card_data_available, get_card_details, card_image_available, download_card_image
Pos: Application code

🔄 Self-reference: When this file changes, update this header
"""

# [INPUT]: 標準ライブラリ、requests、import_diagnostics、tcg.mik.moe API、パック名キャッシュと簡体字 DB・画像保存先に依存する。
# [OUTPUT]: API 変換、名称検索、資料／画像の可用性検証、原子的保存を提供し、画像検証例外も診断する。カード追加は情報と updated/skipped/stale/failed/save_failed、DB 保存と画像取得は成否を返す。
# [POS]: 簡体字取得処理の共通層。デッキ／単体 CLI 向けに SET/NUM を SET-NUM に正規化し、直接実行時はカードパック一覧を更新する。
# [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。

import sys, os, re, json, time, tempfile, struct, zlib
import import_diagnostics as diagnostics

# Get the absolute path of the directory where the script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
# Construct the absolute path to the 'libs' directory
libs_dir = os.path.join(script_dir, 'libs')

# Add the 'libs' directory to the Python path
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

import requests

# --- Constants and Paths ---
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
DATABASE_FILE = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'database_chs.json')
CARD_IMG_DIR = os.path.join(PROJECT_ROOT, 'nodecg', 'assets', 'ptcg-telop', 'card_img_chs')
CARD_PACKS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'card_packs.json')

# --- Cache ---
_SET_NAME_CACHE = None
API_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"

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
CHS_TO_JP_ENERGY_MAP = {
    "草": "草",
    "火": "炎",
    "水": "水",
    "雷": "雷",
    "超": "超",
    "斗": "闘",
    "恶": "悪",
    "钢": "鋼",
    "无": "無",
    "龙": "竜",
    "妖": "妖",
}

# --- Core Functions ---
def request_json(url, payload, stage, card_id=None):
    """HTTP と JSON の失敗地点を分けて記録し、例外は呼び出し元へ返す。"""
    since = diagnostics.started(stage + ".fetch", card_id=card_id,
                                sourceHost="tcg.mik.moe", timeoutSeconds=diagnostics.REQUEST_TIMEOUT)
    response = None
    try:
        response = requests.post(url, headers={"Content-Type": "application/json",
                                 "User-Agent": API_USER_AGENT}, json=payload,
                                 timeout=diagnostics.REQUEST_TIMEOUT)
        response.raise_for_status()
        diagnostics.completed(stage + ".fetch", since, card_id=card_id,
                              httpStatus=response.status_code)
    except Exception as error:
        diagnostics.failed(stage + ".fetch", error, card_id=card_id, since=since)
        if response is not None:
            response.close()
        raise
    since = diagnostics.started(stage + ".parse", card_id=card_id)
    try:
        response.encoding = "utf-8"
        value = response.json()
        if not isinstance(value, dict):
            raise ValueError("API response must be a JSON object")
        if value.get("code") != 200:
            # --- レスポンス本文全体を診断に取り込まない ---
            raise ValueError("API returned code " + str(value.get("code")) + ": " + str(value.get("msg", ""))[:500])
        if not isinstance(value.get("data"), dict):
            raise ValueError("API response data must be a JSON object")
        diagnostics.completed(stage + ".parse", since, card_id=card_id)
        return value
    except Exception as error:
        diagnostics.failed(stage + ".parse", error, card_id=card_id, since=since)
        raise
    finally:
        response.close()


def fetch_card_packs():
    try:
        value = request_json("https://tcg.mik.moe/api/v3/card/product-list", {}, "packs")
        pack_list = value["data"].get("list", [])
        if not isinstance(pack_list, list) or not pack_list:
            raise ValueError("Card pack list is empty or invalid")
        with open(CARD_PACKS_FILE, "w", encoding="utf-8") as target:
            json.dump(pack_list, target, ensure_ascii=False, indent=4)
        return True
    except Exception as error:
        if not getattr(error, '_ptcg_recorded_stage', None):
            diagnostics.failed("packs.cache", error)
        diagnostics.warning("packs.cache", "Card pack names unavailable; card data can still be used")
        return False


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
        except (ValueError, OSError, TypeError, KeyError) as e:
            diagnostics.failed("packs.cache", e)
            diagnostics.warning("packs.cache", "Card pack names could not be loaded")
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
    since = diagnostics.started("database.load")
    try:
        if not os.path.exists(target_path):
            value = {}
        else:
            with open(target_path, 'r', encoding='utf-8') as f:
                value = json.load(f)
            if not isinstance(value, dict):
                raise ValueError("Card database must be a JSON object")
        diagnostics.completed("database.load", since, cardCount=len(value))
        return value
    except Exception as error:
        diagnostics.failed("database.load", error, since=since)
        raise

def save_database(data, db_path=None):
    """
    Saves the card database to a local JSON file.
    """
    target_path = db_path if db_path else DATABASE_FILE
    since = diagnostics.started("database.save")
    target_path = os.path.abspath(target_path)
    temp_file_path = None
    try:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8',
                                         dir=os.path.dirname(target_path),
                                         prefix='.chs-db-', suffix='.tmp', delete=False) as f:
            temp_file_path = f.name
            json.dump(data, f, ensure_ascii=False, indent=4)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_file_path, target_path)
        diagnostics.completed("database.save", since, cardCount=len(data))
        return True
    except Exception as e:
        diagnostics.failed("database.save", e, since=since)
        print(f"ERROR: Failed to save database to {target_path}: {e}", file=sys.stderr)
        return False
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except OSError as error:
                diagnostics.failed("database.cleanup", error)

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

        # Rules for ex, V, VMAX, etc. and Prize Card Logic
        if card_details['subtype'] in ['ex', 'V', 'VSTAR', 'GX']:
            if card_details['pokemon'].get('option') == 'TAG TEAM':
                card_details['addRule'] = f"当TAG TEAM昏厥时，对手将拿取3张奖赏卡。"
                card_details['pokemon']['prize'] = 3
            elif card_details['pokemon'].get('option') == 'Mega':
                card_details['addRule'] = f"当超级进化宝可梦ex昏厥时，对手将拿取3张奖赏卡。"
                card_details['pokemon']['prize'] = 3
            else:
                card_details['addRule'] = f"当宝可梦{card_details['subtype']}昏厥时，对手将拿取2张奖赏卡。"
                card_details['pokemon']['prize'] = 2
        elif card_details['subtype'] == 'VMAX':
            card_details['addRule'] = f"当宝可梦VMAX昏厥时，对手将拿取3张奖赏卡。"
            card_details['pokemon']['prize'] = 3
        
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
                if pokemon_attr.get('stage') == 'Stage 2':
                    # If it's a Stage 2, we need to find the Basic Pokémon as well.
                    stage1_name = pokemon_attr.get('evolvesFrom')
                    if stage1_name:
                        print(f"  -> It's a Stage 2. Finding basic form for {stage1_name}...", file=sys.stderr)
                        # Use our working function to get the Stage 1 card details
                        stage1_details = get_card_by_name(stage1_name)
                        if (stage1_details and stage1_details.get('pokemon') and 
                            stage1_details['pokemon'].get('evolvesFrom')):
                            # We found the basic Pokémon's name
                            basic_name = stage1_details['pokemon']['evolvesFrom'][0]
                            print(f"  -> Found basic form: {basic_name}", file=sys.stderr)
                            # Append the basic name to the evolution chain
                            card_details['pokemon']['evolvesFrom'].append(basic_name)

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
        
        desc_raw = data.get('description', '')
        description_text = ' '.join(desc_raw.split()) if isinstance(desc_raw, str) else ' '.join(desc_raw)
        card_details['trainer'] = {'text': description_text}
        
        # Check if it's a "Technical Machine" card
        if "招式学习器" in card_details.get('name', ''):
            energy_chars = "".join(set(ENERGY_CHS_MAP.values()))
            attack_pattern = re.compile(
                r"((?:【(?:[" + energy_chars + r"])】)+)\s+"  # (Group 1: Costs) e.g.【无】【无】
                r"([^【\s]+)\s*"                            # (Group 2: Name) e.g. 临危一击
                r"(?:(\d+)\s*)?"                            # (Group 3: Damage - optional) e.g. 280
                r"(.*)"                                     # (Group 4: Text) e.g. 这个招式...
            )
            match = attack_pattern.search(description_text)
            
            if match:
                cost_str, name, damage, text = match.groups()
                
                costs_chs = re.findall(r"【(.+?)】", cost_str)
                costs_jp = [CHS_TO_JP_ENERGY_MAP.get(c, c) for c in costs_chs]

                new_attack = {
                    "name": name.strip(),
                    "cost": costs_jp,
                    "damage": damage.strip() if damage else "",
                    "text": text.strip()
                }
                
                if 'attacks' not in card_details['trainer']:
                    card_details['trainer']['attacks'] = []
                card_details['trainer']['attacks'].append(new_attack)

                # Remove attack string from main description
                card_details['trainer']['text'] = description_text.replace(match.group(0), '').strip()

        if supertype_api in ["Stadium", "Supporter", "Item", "Tool"]:
            card_details['subtype'] = supertype_api.lower()
        else:
            desc = description_text
            if "宝可梦道具" in desc: card_details['subtype'] = 'tool'
            elif "支援者" in desc: card_details['subtype'] = 'supporter'
            elif "竞技场" in desc: card_details['subtype'] = 'stadium'
            else: card_details['subtype'] = 'item'

    elif supertype_api in ["Energy", "Basic Energy", "Special Energy"]:
        card_details['supertype'] = 'energy'
        card_details['subtype'] = supertype_api.lower()
        if card_details['subtype'] == 'special energy':
            card_details['energy'] = {'text': ' '.join(data.get('description', '').split())}
        elif card_details['subtype'] == 'basic energy':
            # For basic energy, extract the type from the name and set it as a string.
            energy_type_chs = re.sub(r'基本|能量', '', card_details['name']).strip()
            energy_type_jp = CHS_TO_JP_ENERGY_MAP.get(energy_type_chs, energy_type_chs)
            card_details['energy'] = energy_type_jp
    
    else:
        card_details['supertype'] = supertype_api.lower() if supertype_api else None

def get_card_by_name(name):
    """Fetches card data by name using the advance search API."""
    url = "https://tcg.mik.moe/api/v3/card/card-basic-search"
    payload = {
        "SearchText": name,
        "exact": True,
        "page": 1,
        "PageSize": 1
    }
    try:
        # Add a small delay to avoid spamming the API
        time.sleep(0.5)
        search_result = request_json(url, payload, "card.search")
        
        if search_result and search_result.get("code") == 200:
            card_list = search_result.get("data", {}).get("list", [])
            if card_list:
                first_card = card_list[0]
                set_code = first_card.get('setCode')
                card_index = first_card.get('cardIndex')
                
                if set_code and card_index:
                    card_id = f"{set_code}/{card_index}"
                    # Call get_card_details to get the full card info, maintaining the original pattern
                    card_details = get_card_details(card_id)
                    return card_details

    except Exception as e:
        if not getattr(e, '_ptcg_recorded_stage', None):
            diagnostics.failed("card.search", e)
        print(f"An unexpected error occurred in get_card_by_name for '{name}': {e}", file=sys.stderr)
        
    return None

def normalize_card_id(card_id):
    normalized = str(card_id).replace('/', '-')
    if not re.fullmatch(r'[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*-[A-Za-z0-9_]+', normalized):
        raise ValueError("Card ID must use SET/NUM or SET-NUM format")
    return normalized


def card_data_available(info):
    return isinstance(info, dict) and isinstance(info.get('name'), str) and bool(info['name'].strip())


def get_card_details(card_id, html_content=None):
    """API と変換の例外を現場で記録し、取得不能時は None を返す。"""
    try:
        normalized_id = normalize_card_id(card_id)
        set_code, card_number = normalized_id.split('-', 1)
    except ValueError as error:
        diagnostics.failed("input", error, card_id=card_id)
        return None
    card_details = {"name": None, "set_code": set_code, "set_name": None,
                    "card_number": card_number, "image_url": None,
                    "supertype": None, "subtype": None, "pokemon": None,
                    "trainer": None, "energy": None, "addRule": None,
                    "rarity": None, "author": None}
    stage = "card.parse" if html_content is not None else "card.fetch"
    try:
        if html_content is not None:
            api_response = json.loads(html_content)
            if not isinstance(api_response, dict) or api_response.get("code") != 200:
                raise ValueError("Local card JSON must contain a successful API response")
        else:
            api_response = request_json("https://tcg.mik.moe/api/v3/card/card-detail",
                                        {"setCode": set_code, "cardIndex": card_number},
                                        "card", card_id=normalized_id)
        stage = "card.transform"
        since = diagnostics.started(stage, card_id=normalized_id)
        _transform_api_data(api_response, card_details, _get_set_name_map())
        if not card_data_available(card_details):
            raise ValueError("Card response does not contain a usable name")
        diagnostics.completed(stage, since, card_id=normalized_id)
        return card_details
    except Exception as error:
        if not getattr(error, '_ptcg_recorded_stage', None):
            diagnostics.failed(stage, error, card_id=normalized_id)
        return None


def _image_path(card_id, image_url=None):
    extension = os.path.splitext((image_url or '').split('?', 1)[0])[1].lower()
    if extension not in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
        extension = '.png'
    return os.path.join(CARD_IMG_DIR, normalize_card_id(card_id) + extension)


def _valid_image(path, card_id=None):
    """空ファイル、HTML、途中で切れた PNG をキャッシュ成功にしない。"""
    try:
        with open(path, 'rb') as source:
            data = source.read()
        if data.startswith(b'\x89PNG\r\n\x1a\n'):
            offset, image_data, header_seen = 8, False, False
            while offset + 12 <= len(data):
                size = struct.unpack('>I', data[offset:offset + 4])[0]
                end = offset + 12 + size
                if end > len(data):
                    return False
                kind = data[offset + 4:offset + 8]
                chunk = data[offset + 4:offset + 8 + size]
                crc = struct.unpack('>I', data[offset + 8 + size:end])[0]
                if zlib.crc32(chunk) & 0xffffffff != crc:
                    return False
                if not header_seen:
                    if kind != b'IHDR' or size != 13:
                        return False
                    width, height = struct.unpack('>II', data[offset + 8:offset + 16])
                    header_seen = bool(width and height)
                    if not header_seen:
                        return False
                if kind == b'IDAT' and size:
                    image_data = True
                if kind == b'IEND':
                    return size == 0 and image_data and end == len(data)
                offset = end
            return False
        if data.startswith(b'\xff\xd8'):
            return len(data) > 4 and data.endswith(b'\xff\xd9')
        if data.startswith((b'GIF87a', b'GIF89a')):
            return len(data) > 13 and data.endswith(b';')
        if data.startswith(b'RIFF') and data[8:12] == b'WEBP':
            return len(data) > 12 and struct.unpack('<I', data[4:8])[0] + 8 == len(data)
        return False
    except FileNotFoundError:
        return False
    except (OSError, ValueError, struct.error) as error:
        diagnostics.failed("image.check", error, card_id=card_id)
        return False


def card_image_available(card_id, info=None):
    try:
        return _valid_image(_image_path(card_id, (info or {}).get('image_url')), card_id=card_id)
    except (ValueError, TypeError, AttributeError) as error:
        diagnostics.failed("image.check", error, card_id=card_id)
        return False


def download_card_image(card_id, image_url):
    since = diagnostics.started("image.check", card_id=card_id)
    try:
        image_path = _image_path(card_id, image_url)
        if _valid_image(image_path, card_id=card_id):
            diagnostics.completed("image.check", since, card_id=card_id, cached=True)
            return True
        diagnostics.completed("image.check", since, card_id=card_id, cached=False)
    except Exception as error:
        diagnostics.failed("image.check", error, card_id=card_id, since=since)
        return False
    since = diagnostics.started("image.download", card_id=card_id,
                                timeoutSeconds=diagnostics.REQUEST_TIMEOUT)
    temp_path, response = None, None
    try:
        if not image_url:
            raise ValueError("Card image URL is unavailable")
        os.makedirs(CARD_IMG_DIR, exist_ok=True)
        response = requests.get(image_url, stream=True, timeout=diagnostics.REQUEST_TIMEOUT)
        response.raise_for_status()
        with tempfile.NamedTemporaryFile(mode='wb', dir=CARD_IMG_DIR,
                                         prefix='.chs-image-', suffix='.tmp', delete=False) as target:
            temp_path = target.name
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        if not _valid_image(temp_path, card_id=card_id):
            raise ValueError("Downloaded image is empty, invalid, or incomplete")
        os.replace(temp_path, image_path)
        diagnostics.completed("image.download", since, card_id=card_id,
                              httpStatus=response.status_code)
        return True
    except Exception as error:
        diagnostics.failed("image.download", error, card_id=card_id, since=since)
        return False
    finally:
        if response is not None:
            response.close()
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError as error:
                diagnostics.failed("image.cleanup", error, card_id=card_id)


def _core_process_card(card_id, card_database, overwrite=True, html_content=None):
    internal_card_id = normalize_card_id(card_id)
    previous = card_database.get(internal_card_id)
    if not overwrite and card_data_available(previous):
        diagnostics.emit("card.cache", "completed", card_id=internal_card_id, cached=True)
        if not download_card_image(internal_card_id, previous.get('image_url')):
            diagnostics.warning("image.download", "Card image is unavailable", card_id=internal_card_id)
        return previous, 'skipped'
    print(f"Processing CHS card ID {card_id}...", file=sys.stderr)
    card_info = get_card_details(card_id, html_content=html_content)
    if not card_data_available(card_info):
        if card_data_available(previous):
            diagnostics.warning("card.refresh", "Card refresh failed; using valid cached data", card_id=internal_card_id)
            if not download_card_image(internal_card_id, previous.get('image_url')):
                diagnostics.warning("image.download", "Card image is unavailable", card_id=internal_card_id)
            return previous, 'stale'
        return previous, 'failed'
    if not download_card_image(internal_card_id, card_info.get('image_url')):
        diagnostics.warning("image.download", "Card image is unavailable", card_id=internal_card_id)
    return card_info, 'updated'


def add_card_to_database(card_id, overwrite=True, html_content=None, db_path=None, db_instance=None):
    """共有 DB 指定時は保存を呼び出し元に委ね、有効キャッシュを保護する。"""
    card_database = db_instance if db_instance is not None else load_database(db_path=db_path)
    card_info, status = _core_process_card(card_id, card_database, overwrite, html_content)
    if status == 'updated':
        normalized_id = normalize_card_id(card_id)
        card_database[normalized_id] = card_info
        if db_instance is None and not save_database(card_database, db_path=db_path):
            return card_info, 'save_failed'
    return card_info, status


if __name__ == "__main__":
    diagnostics.configure_streams()
    fetch_card_packs()
