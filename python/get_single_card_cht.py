import sys, os, argparse

# Get the absolute path of the directory where the script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
# Construct the absolute path to the 'libs' directory
libs_dir = os.path.join(script_dir, 'libs')

# Add the 'libs' directory to the Python path
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

from card_utils_cht import add_card_to_database, get_card_details, save_database, load_database

def main(card_id_arg=None):
    parser = argparse.ArgumentParser(description="Fetches detailed information for a single card and updates the database.")
    
    parser.add_argument("card_id", nargs='?', default=None, help="The ID of the card to fetch.")
    parser.add_argument("--database-path", type=str, default=None, help="Path to the database JSON file.")
    
    parser.add_argument(
        "--file",
        type=str,
        help="Read card data from a local HTML file for testing instead of fetching from the web. Requires a file path."
    )

    overwrite_group = parser.add_mutually_exclusive_group()
    overwrite_group.add_argument(
        "--overwrite",
        dest="overwrite",
        action="store_true",
        help="Force overwrite if the card exists in the database (default behavior).",
    )
    overwrite_group.add_argument(
        "--keep",
        dest="overwrite",
        action="store_false",
        help="Skip writing if the card exists in the database.",
    )
    
    parser.set_defaults(overwrite=True)
    args = parser.parse_args()

    card_info = None
    updated = False

    if args.file:
        if not os.path.exists(args.file):
            print(f"Error: File '{args.file}' does not exist.")
            sys.exit(1)
        
        card_id = os.path.basename(args.file).split('_')[0].split('.')[0]
        if not card_id.isdigit():
            card_id = "local_test_" + os.path.basename(args.file).split('.')[0]

        print(f"Parsing card from local file '{args.file}' (ID: {card_id})...")
        with open(args.file, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        card_info = get_card_details(card_id, html_content=html_content)
        
        if card_info:
            db = load_database(db_path=args.database_path)
            existing_card = db.get(card_id)
            
            if args.overwrite or not existing_card or not existing_card.get('name'):
                print("Updating database...")
                db[card_id] = card_info
                save_database(db, db_path=args.database_path)
                updated = True
            else:
                print("Card already exists in the database and --keep is set, not updating.")

    else:
        card_id = args.card_id or str(card_id_arg) if card_id_arg is not None else args.card_id
        if not card_id:
            card_id = input("Please enter the Card ID: ")
            if not card_id:
                print("No Card ID entered, exiting.")
                sys.exit(1)
        
        card_info, updated = add_card_to_database(card_id, args.overwrite, db_path=args.database_path, language='cht')

    if card_info:
        if updated:
            print("\nSuccessfully parsed and updated card information:")
        elif args.file:
             print("\nSuccessfully parsed card information from local file:")
        else:
            print("\nCard information already exists in the database (not overwritten):")
        
        import json
        print(json.dumps(card_info, indent=2, ensure_ascii=False))

    else:
        print(f"Failed to process the card.")
        sys.exit(1)

if __name__ == "__main__":
    main()