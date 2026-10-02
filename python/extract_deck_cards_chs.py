"""
Input: argparse, re, sys, time, import_diagnostics, card_utils_chs, card_utils_chs.(add_card_to_database, card_utils_chs.card_data_available, card_utils_chs.
Output: fetch_deck_by_code, fetch_deck_by_id, main
Pos: Application code

🔄 Self-reference: When this file changes, update this header
"""

# [INPUT]: CLI 引数、card_utils_chs の API・キャッシュ・原子的保存、import_diagnostics の stderr イベントに依存する。
# [OUTPUT]: デッキコード／数値 ID／URL と --overwrite/--keep を受け、cards・missingCards・missingImages・warnings・databaseSaved・status の単一 JSON を返す。
# [POS]: extension が起動する CHS デッキ入口。カード資料不足でも有効キャッシュは保存し、読み込み状態の確定は親側へ委ねる。
# [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。

import argparse
import re
import sys
import time

import import_diagnostics as diagnostics
from card_utils_chs import (add_card_to_database, card_data_available,
                            card_image_available, load_database, normalize_card_id,
                            request_json, save_database)


def _identifier_type(identifier):
    if identifier.startswith('http'):
        return 'url'
    if re.fullmatch(r'[0-9]+', identifier):
        return 'deckId'
    return 'deckCode'


def fetch_deck_by_code(deck_code):
    return _fetch_deck_data("https://tcg.mik.moe/api/v3/deck/export-miniapp",
                            {"deckCode": deck_code}, deck_code)


def fetch_deck_by_id(deck_id):
    return _fetch_deck_data("https://tcg.mik.moe/api/v3/deck/detail",
                            {"deckId": int(deck_id)}, deck_id)


def _fetch_deck_data(url, payload, identifier):
    try:
        response = request_json(url, payload, "deck")
        cards = response['data'].get('cards')
        if not isinstance(cards, list) or not cards:
            raise ValueError("Deck response contains no cards or an invalid card list")
        return cards
    except Exception as error:
        if not getattr(error, '_ptcg_recorded_stage', None):
            diagnostics.failed("deck.parse", error)
        return None


def _expected_cards(card_list):
    """繰り返し行は維持し、明示された枚数だけを展開する。"""
    expected = []
    for card in card_list:
        if not isinstance(card, dict) or not card.get('setCode') or not card.get('cardIndex'):
            raise ValueError("Deck entry is missing setCode or cardIndex")
        card_id = normalize_card_id(f"{card['setCode']}-{card['cardIndex']}")
        quantity = card.get('quantity', card.get('count', 1))
        if isinstance(quantity, bool) or str(quantity) != str(int(quantity)) or not 1 <= int(quantity) <= 1000:
            raise ValueError("Deck entry contains an invalid card quantity")
        expected.extend([card_id] * int(quantity))
        if len(expected) > 1000:
            raise ValueError("Deck response exceeds the supported card count")
    return expected


def main(identifier_arg=None, argv=None):
    parser = argparse.ArgumentParser(description="Extract deck data from tcg.mik.moe.")
    parser.add_argument("identifier", nargs='?', default=identifier_arg,
                        help="The deck code, deck ID, or URL.")
    parser.add_argument("--database-path", type=str, default=None,
                        help="Path to the database JSON file.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--overwrite", dest="overwrite", action="store_true")
    group.add_argument("--keep", dest="overwrite", action="store_false")
    parser.set_defaults(overwrite=True)
    args = parser.parse_args(argv)
    expected, missing_cards, missing_images = [], [], []
    diagnostics.emit("input", "started", input=args.identifier)
    stage = "input"
    try:
        if not args.identifier:
            raise ValueError("No deck code, deck ID, or URL provided")
        kind = _identifier_type(args.identifier)
        diagnostics.emit("input", "completed", inputType=kind)
        if kind == 'url':
            match = re.search(r'/decks/(\d+)', args.identifier)
            if not match:
                raise ValueError("Could not extract a valid deck ID from the URL")
            card_list = fetch_deck_by_id(match.group(1))
        elif kind == 'deckId':
            card_list = fetch_deck_by_id(args.identifier)
        else:
            card_list = fetch_deck_by_code(args.identifier)
        if card_list is None:
            return diagnostics.result(fatal=True)
        stage = "deck.parse"
        expected = _expected_cards(card_list)
    except Exception as error:
        diagnostics.failed(stage, error)
        return diagnostics.result(cards=expected, fatal=True)
    try:
        database = load_database(db_path=args.database_path)
    except Exception:
        return diagnostics.result(cards=expected, fatal=True)
    changed = False
    unique_cards = list(dict.fromkeys(expected))
    for index, card_id in enumerate(unique_cards):
        print(f"--- Processing card {index + 1}/{len(unique_cards)}: {card_id} ---", file=sys.stderr, flush=True)
        try:
            info, status = add_card_to_database(card_id, overwrite=args.overwrite, db_instance=database)
            changed = changed or status == 'updated'
            if not card_data_available(info):
                missing_cards.append(card_id)
            elif not card_image_available(card_id, info):
                missing_images.append(card_id)
        except Exception as error:
            diagnostics.failed("card.process", error, card_id=card_id)
            missing_cards.append(card_id)
        if index + 1 < len(unique_cards):
            time.sleep(0.5)
    saved = save_database(database, db_path=args.database_path) if changed else True
    return diagnostics.result(expected, missing_cards, missing_images, saved)


if __name__ == "__main__":
    diagnostics.run_cli(main)
