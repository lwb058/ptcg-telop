import requests, re, time, argparse, sys, json
from bs4 import BeautifulSoup
# Explicitly import path variables for consistency
from card_utils import load_database, save_database, _core_process_card, DATABASE_FILE, CARD_IMG_DIR

def extract_deck_cards(deck_id, overwrite=True):
    """
    Extracts all card IDs from a Pokémon deck page and batch updates the database.

    Args:
        deck_id (str): The ID of the Pokémon deck.
        overwrite (bool): Whether to overwrite existing entries in the database.

    Returns:
        list: A list of dictionaries containing all card information. Returns an empty list on failure.
    """
    url = f"https://www.pokemon-card.com/deck/result.html/deckID/{deck_id}/"
    deck_list_with_quantity = {}
    all_cards_details = []
    
    # 1. Load the database once
    card_database = load_database()
    db_was_updated = False

    try:
        print(f"Extracting card IDs from deck page: {url}...", file=sys.stderr)
        response = requests.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        input_area_form = soup.find('form', id='inputArea')
        if not input_area_form:
            print("Error: Could not find the form with id 'inputArea'.", file=sys.stderr)
            return []

        hidden_inputs = input_area_form.find_all('input', type='hidden')
        for input_tag in hidden_inputs:
            name = input_tag.get('name')
            value = input_tag.get('value')
            if name and value and name.startswith('deck_'):
                if value:
                    individual_cards = value.split('-')
                    for card_entry in individual_cards:
                        parts = card_entry.split('_')
                        if len(parts) >= 2:
                            card_id = parts[0]
                            quantity = int(parts[1])
                            deck_list_with_quantity[card_id] = quantity
        
        if not deck_list_with_quantity:
            print("Warning: No card IDs were found in this deck.", file=sys.stderr)
            return []

        print(f"Found {len(deck_list_with_quantity)} unique cards in the deck.", file=sys.stderr)

        # 2. Process all cards in memory
        for card_id, quantity in deck_list_with_quantity.items():
            card_info, status = _core_process_card(card_id, card_database, overwrite)
            
            if status == 'updated':
                card_database[card_id] = card_info
                db_was_updated = True

            if card_info and card_info.get('name'):
                # To avoid polluting the database, we only add ID and quantity to the list returned to the caller
                card_display_info = {**card_info, "id": card_id, "quantity": quantity}
                all_cards_details.append(card_display_info)
            else:
                print(f"Warning: Failed to process card ID {card_id}. It will not be included in the final list.", file=sys.stderr)
            
            time.sleep(0.3)

    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}", file=sys.stderr)
    except Exception as e:
        print(f"An unknown error occurred while extracting the deck: {e}", file=sys.stderr)

    # 3. Save the database once after all cards have been processed
    if db_was_updated:
        print("Writing updates to the database...", file=sys.stderr)
        save_database(card_database)
        print("Database saved successfully.", file=sys.stderr)

    return all_cards_details

def main(deck_id_arg=None):
    parser = argparse.ArgumentParser(description="Extract all card information from a Pokémon deck page and update the database.")
    parser.add_argument("deck_id", nargs='?', default=None, help="The Pokémon deck ID to fetch (prompts if not provided).")
    
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
    cards = extract_deck_cards(deck_id, args.overwrite)

    if cards:
        # Prepare a simplified list with only ID and quantity for machine parsing
        deck_for_json_output = [{"id": card['id'], "quantity": card['quantity']} for card in cards if 'id' in card and 'quantity' in card]
        # Print the simplified JSON data to stdout for Node.js to consume
        print(json.dumps(deck_for_json_output))
        
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
