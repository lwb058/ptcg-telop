"""
Input: argparse, os, import_diagnostics, card_utils_chs, card_utils_chs.(add_card_to_database, card_utils_chs.card_data_available, card_utils_chs.
Output: main
Pos: Application code

🔄 Self-reference: When this file changes, update this header
"""

# [INPUT]: CLI のカード ID・--file・保存先、card_utils_chs の資料／画像検証と保存、import_diagnostics に依存する。
# [OUTPUT]: 既存 CLI 引数を受け、cards・missingCards・missingImages・warnings・databaseSaved・status の単一 JSON を返す。資料不足と保存失敗は非ゼロ終了となる。
# [POS]: extension が起動する CHS 単体カード入口。カード ID を正規化し、診断と説明は stderr、業務結果は stdout に分離する。
# [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。

import argparse
import os

import import_diagnostics as diagnostics
from card_utils_chs import (add_card_to_database, card_data_available,
                            card_image_available, load_database,
                            normalize_card_id, save_database)


def main(card_id_arg=None, argv=None):
    parser = argparse.ArgumentParser(description="Fetch a Simplified Chinese card and update the database.")
    parser.add_argument("card_id", nargs='?', default=card_id_arg,
                        help="Card ID, e.g. CSV5C/075 or CSV5C-075.")
    parser.add_argument("--database-path", type=str, default=None)
    parser.add_argument("--file", type=str, help="Read a local API response JSON file.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--overwrite", dest="overwrite", action="store_true")
    group.add_argument("--keep", dest="overwrite", action="store_false")
    parser.set_defaults(overwrite=True)
    args = parser.parse_args(argv)
    identifier = args.card_id
    if args.file and not identifier:
        identifier = "local_test/" + os.path.basename(args.file).split('.')[0]
    diagnostics.emit("input", "started", input=identifier)
    try:
        if not identifier:
            raise ValueError("No card ID provided")
        card_id = normalize_card_id(identifier)
        diagnostics.emit("input", "completed", card_id=card_id)
    except Exception as error:
        diagnostics.failed("input", error, card_id=identifier)
        return diagnostics.result(fatal=True)
    try:
        content = None
        if args.file:
            with open(args.file, 'r', encoding='utf-8') as source:
                content = source.read()
        database = load_database(db_path=args.database_path)
        info, status = add_card_to_database(card_id, overwrite=args.overwrite,
                                            html_content=content, db_instance=database)
    except Exception as error:
        if not getattr(error, '_ptcg_recorded_stage', None):
            diagnostics.failed("card.process", error, card_id=card_id)
        return diagnostics.result(cards=[card_id], missing_cards=[card_id], fatal=True)
    saved = save_database(database, db_path=args.database_path) if status == 'updated' else True
    missing_cards = [] if card_data_available(info) else [card_id]
    missing_images = [card_id] if not missing_cards and not card_image_available(card_id, info) else []
    return diagnostics.result([card_id], missing_cards, missing_images, saved)


if __name__ == "__main__":
    diagnostics.run_cli(main)
