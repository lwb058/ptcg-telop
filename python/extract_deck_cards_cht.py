import os, re, time, argparse, sys, json

# Get the absolute path of the directory where the script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
# Construct the absolute path to the 'libs' directory
libs_dir = os.path.join(script_dir, 'libs')

# Add the 'libs' directory to the Python path
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

import requests
from bs4 import BeautifulSoup
# Explicitly import from the CHT utils
from card_utils_cht import load_database, save_database, _core_process_card

def extract_deck_cards(deck_id, overwrite=True, db_path=None, language='cht'):
    """
    Extracts all card IDs from a Pokémon deck page (Traditional Chinese) and batch updates the database.
    """
    url = f"https://asia.pokemon-card.com/tw/deck-build/recipe/{deck_id}/"
    deck_list_with_quantity = {}
    all_cards_details = []
    
    # 1. Load the database once
    card_database = load_database(db_path=db_path)
    db_was_updated = False

    try:
        print(f"Extracting card IDs from deck page: {url}...", file=sys.stderr)
        response = requests.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        # Find all card links within the visual list
        card_elements = soup.select('.graphicList .card a')
        if not card_elements:
            print("Error: Could not find any card elements on the deck page.", file=sys.stderr)
            return []

        for card_link in card_elements:
            href = card_link.get('href')
            # Ensure it's a link to a card detail page
            if href and '/detail/' in href:
                count_p = card_link.find('p', class_='count')
                if not count_p:
                    continue # Skip if there's no count element

                match = re.search(r'/detail/(\d+)/', href)
                if match:
                    card_id = match.group(1)
                    quantity = int(count_p.get_text(strip=True))
                    deck_list_with_quantity[card_id] = quantity

        if not deck_list_with_quantity:
            print("Warning: No card IDs were found in this deck.", file=sys.stderr)
            return []

        print(f"Found {len(deck_list_with_quantity)} unique cards in the deck.", file=sys.stderr)

        # 2. Process all cards in memory
        card_list_items = list(deck_list_with_quantity.items())
        total_cards = len(card_list_items)
        for i, (card_id, quantity) in enumerate(card_list_items):
            print(f"--- Processing card {i+1}/{total_cards}: {card_id} ---", file=sys.stderr)
            card_info, status = _core_process_card(card_id, card_database, overwrite, language=language)
            
            if status == 'updated':
                card_database[card_id] = card_info
                db_was_updated = True

            if card_info and card_info.get('name'):
                card_display_info = {**card_info, "id": card_id, "quantity": quantity}
                all_cards_details.append(card_display_info)
            else:
                print(f"Warning: Failed to process card ID {card_id}. It will not be included in the final list.", file=sys.stderr)
            
            time.sleep(0.3) # Be polite to the server

    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}", file=sys.stderr)
    except Exception as e:
        print(f"An unknown error occurred while extracting the deck: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)

    # 3. Save the database once after all cards have been processed
    if db_was_updated:
        print("Writing updates to the database...", file=sys.stderr)
        save_database(card_database, db_path=db_path)
        print("Database saved successfully.", file=sys.stderr)

    return all_cards_details

def main(deck_id_arg=None):
    parser = argparse.ArgumentParser(description="Extract all card information from a Pokémon deck page and update the database.")
    parser.add_argument("deck_id", nargs='?', default=None, help="The Pokémon deck ID to fetch (prompts if not provided).")
    parser.add_argument("--database-path", type=str, default=None, help="Path to the database JSON file.")
    parser.add_argument("--card-img-path", type=str, default=None, help="Path to the card image directory.")
    
    overwrite_group = parser.add_mutually_exclusive_group()
    overwrite_group.add_argument("--overwrite", dest="overwrite", action="store_true", help="Force overwrite if card exists in the database (default behavior).")
    overwrite_group.add_argument("--keep", dest="overwrite", action="store_false", help="Skip writing if card exists in the database.")
    parser.set_defaults(overwrite=True)
    
    args = parser.parse_args()

    deck_id = args.deck_id or deck_id_arg
    if not deck_id:
        deck_id = input("Please enter the Deck ID: ")
        if not deck_id:
            print("No Deck ID entered, exiting.", file=sys.stderr)
            sys.exit(1)

    print(f"Extracting all cards for deck ID '{deck_id}' from the website...", file=sys.stderr)
    cards = extract_deck_cards(deck_id, args.overwrite, db_path=args.database_path)

    if cards:
        # The user now wants a unique list of card IDs.
        card_ids_only = [card['id'] for card in cards if 'id' in card]
        
        # To be consistent with other scripts, wrap the list in an object with a "cards" key.
        print(json.dumps({"cards": card_ids_only}))
        
        print("Extracted cards:", file=sys.stderr)
        total_cards = 0
        for card in cards:
            # Add an extra safety check just in case
            if 'name' in card and 'id' in card and 'quantity' in card:
                print(f"  ID: {card['id']}, Name: {card['name']}, Quantity: {card['quantity']}", file=sys.stderr)
                total_cards += card['quantity']
            else:
                print(f"  Incomplete card data detected, skipping display.", file=sys.stderr)
        print(f"A total of {total_cards} cards were extracted.", file=sys.stderr)
    else:
        print("No cards were extracted or an error occurred.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()