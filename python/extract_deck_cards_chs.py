import sys, json, re, os, time, argparse

# Get the absolute path of the directory where the script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
# Construct the absolute path to the 'libs' directory
libs_dir = os.path.join(script_dir, 'libs')

# Add the 'libs' directory to the Python path
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

# -*- coding: utf-8 -*-
import requests
from card_utils_chs import add_card_to_database, load_database, save_database

def _identifier_type(identifier):
    """Determines if the identifier is a deckCode, deckId, or a URL."""
    if identifier.startswith('http'):
        return 'url'
    if re.match(r'^[0-9]+$', identifier):
        return 'deckId'
    if re.match(r'^[a-zA-Z0-9]+$', identifier) and len(identifier) > 10: # Simple heuristic for deck codes
        return 'deckCode'
    return 'unknown'

def fetch_deck_by_code(deck_code):
    """
    Fetches a deck list from the tcg.mik.moe API using a deck code.
    """
    print(f"Fetching deck with code: {deck_code}...", file=sys.stderr)
    url = "https://tcg.mik.moe/api/v3/deck/export-miniapp"
    payload = {"deckCode": deck_code}
    return _fetch_deck_data(url, payload, deck_code)

def fetch_deck_by_id(deck_id):
    """
    Fetches a deck list from the tcg.mik.moe API using a numeric deck ID.
    """
    print(f"Fetching deck with ID: {deck_id}...", file=sys.stderr)
    url = "https://tcg.mik.moe/api/v3/deck/detail"
    payload = {"deckId": int(deck_id)}
    return _fetch_deck_data(url, payload, deck_id)

def _fetch_deck_data(url, payload, identifier):
    """Generic function to fetch deck data from a given API endpoint."""
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    }
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        response.encoding = 'utf-8'
        api_response = response.json()

        if api_response and api_response.get("code") == 200:
            card_list = api_response.get("data", {}).get("cards", [])
            if card_list:
                print(f"Successfully fetched {len(card_list)} unique cards from the deck.", file=sys.stderr)
                return card_list
            else:
                print("API response successful, but the deck contains no cards.", file=sys.stderr)
                return []
        else:
            print(f"API returned an error: {api_response.get('msg')}", file=sys.stderr)
            return None

    except requests.exceptions.RequestException as e:
        print(f"API request error for identifier {identifier}: {e}", file=sys.stderr)
        return None
    except json.JSONDecodeError:
        print(f"Failed to decode JSON from API response for identifier {identifier}.", file=sys.stderr)
        return None

def main(identifier_arg=None):
    """
    Main function to run the script.
    """
    parser = argparse.ArgumentParser(description="Extract deck data from tcg.mik.moe.")
    parser.add_argument("identifier", nargs='?', default=identifier_arg, help="The deck code, deck ID, or URL.")
    parser.add_argument("--overwrite", action="store_true", help="Force overwrite if card exists in the database.")
    
    args = parser.parse_args()

    identifier = args.identifier
    if not identifier:
        if identifier_arg:
            identifier = identifier_arg
        else:
            print("Usage: python extract_deck_cards_chs.py <deck_code|deck_id|url> [--overwrite]", file=sys.stderr)
            sys.exit(1)

    overwrite = args.overwrite
    
    id_type = _identifier_type(identifier)
    card_list_from_api = None

    if id_type == 'url':
        match = re.search(r'/decks/(\d+)', identifier)
        if match:
            deck_id = match.group(1)
            card_list_from_api = fetch_deck_by_id(deck_id)
        else:
            print(f"Could not extract a valid deck ID from the URL: {identifier}", file=sys.stderr)
    elif id_type == 'deckId':
        card_list_from_api = fetch_deck_by_id(identifier)
    elif id_type == 'deckCode':
        card_list_from_api = fetch_deck_by_code(identifier)
    else:
        print(f"Unknown identifier format: {identifier}", file=sys.stderr)

    if card_list_from_api is None:
        print("Could not fetch deck data. Exiting.", file=sys.stderr)
        sys.exit(1)

    if not card_list_from_api:
        print("No cards to process. Exiting.", file=sys.stderr)
        sys.exit(1)

    # --- Database Update Logic ---
    card_database = load_database()
    db_changed = False
    for i, card in enumerate(card_list_from_api):
        set_code = card.get('setCode')
        card_index = card.get('cardIndex')
        
        if not set_code or not card_index:
            print(f"Skipping a card due to missing setCode or cardIndex: {card}", file=sys.stderr)
            continue

        card_id = f"{set_code}-{card_index}"
        print(f"--- Processing card {i+1}/{len(card_list_from_api)}: {card_id} ---", file=sys.stderr)

        card_info, status = add_card_to_database(card_id, overwrite=overwrite, db_instance=card_database)
        
        if status == 'updated':
            db_changed = True
        
        time.sleep(0.5)

    if db_changed:
        print("\nSaving updated database to file...", file=sys.stderr)
        save_database(card_database)
        print("Database save complete.", file=sys.stderr)
    else:
        print("\nNo changes to the database were made.", file=sys.stderr)

    # --- Deck Data JSON Output Logic ---
    final_deck_card_ids = [
        f"{card.get('setCode')}-{card.get('cardIndex')}"
        for card in card_list_from_api
        if card.get('setCode') and card.get('cardIndex')
    ]
    deck_output = {"cards": final_deck_card_ids}
    
    # Print the final JSON object to stdout for Node.js to capture
    print(json.dumps(deck_output, ensure_ascii=False))

if __name__ == "__main__":
    main()
