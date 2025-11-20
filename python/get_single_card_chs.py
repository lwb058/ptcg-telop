import os, sys, re, time, argparse, json, io

# Reconfigure stdout and stderr to use UTF-8 encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Get the absolute path of the directory where the script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
# Construct the absolute path to the 'libs' directory
libs_dir = os.path.join(script_dir, 'libs')

# Add the 'libs' directory to the Python path
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

from card_utils_chs import add_card_to_database, get_card_details, save_database, load_database

def main(card_id_arg=None):
    parser = argparse.ArgumentParser(description="Fetches detailed information for a single Simplified Chinese card and updates the database.")
    
    parser.add_argument("card_id", nargs='?', default=None, help="The ID of the card to fetch (e.g., 'CSV5C/075').")
    parser.add_argument("--database-path", type=str, default=None, help="Path to the CHS database JSON file.")
    
    parser.add_argument(
        "--file",
        type=str,
        help="Read card data from a local HTML file for testing instead of fetching from the web. Requires a file path."
    )

    overwrite_group = parser.add_mutually_exclusive_group()
    overwrite_group.add_argument("--overwrite", dest="overwrite", action="store_true", help="Force overwrite if the card exists (default).")
    overwrite_group.add_argument("--keep", dest="overwrite", action="store_false", help="Skip writing if the card exists.")
    
    parser.set_defaults(overwrite=True)
    args = parser.parse_args()

    card_info = None
    updated = False

    if args.file:
        if not os.path.exists(args.file):
            print(f"Error: File '{args.file}' does not exist.", file=sys.stderr)
            sys.exit(1)
        
        card_id = args.card_id if args.card_id else "local_test/" + os.path.basename(args.file).split('.')[0]

        print(f"Parsing card from local file '{args.file}' (ID: {card_id})...", file=sys.stderr)
        with open(args.file, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        card_info = get_card_details(card_id, html_content=html_content)
        
        if card_info:
            db = load_database(db_path=args.database_path)
            internal_card_id = card_id.replace('/', '-')
            existing_card = db.get(internal_card_id)
            
            if args.overwrite or not existing_card or not existing_card.get('name'):
                print("Updating database...", file=sys.stderr)
                db[internal_card_id] = card_info
                save_database(db, db_path=args.database_path)
                updated = True
            else:
                print("Card already exists and --keep is set, not updating.", file=sys.stderr)

    else:
        card_id = args.card_id or card_id_arg
        if not card_id:
            card_id = input("Please enter the Card ID (e.g., CSV5C/075): ")
            if not card_id:
                print("No Card ID provided. Exiting.", file=sys.stderr)
                sys.exit(1)
        
        card_info, updated = add_card_to_database(str(card_id), args.overwrite, db_path=args.database_path)

    if card_info:
        if updated:
            print("\nSuccessfully parsed and updated card information:")
        elif args.file:
             print("\nSuccessfully parsed card information from local file:")
        else:
            print("\nCard information already exists in the database (not overwritten):")
        
        print(json.dumps(card_info, indent=2, ensure_ascii=False))

    else:
        print(f"Failed to process the card.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
        main("CSV5C/075")