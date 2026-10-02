# python/
> L2 | 親: [../CLAUDE.md](../CLAUDE.md)

言語別のカード／デッキ取得層。[extension/index.js](../extension/index.js) が CLI を子プロセスとして起動し、共通層が外部データを画面側のカード形式に揃えて NodeCG の assets 領域へ保存する。

## メンバー

- `card_utils_chs.py`: tcg.mik.moe の requests アダプター。接続 10 秒／読取 30 秒、段階別例外、画像の検証・原子的保存を担当する。資料キャッシュと画像の可用性を分離し、共有 DB の保存は CLI に委ねる。
- `card_utils_cht.py`: requests と BeautifulSoup による台湾公式カード HTML アダプター。共通カード形式へ変換し、繁体字 DB と画像を管理する。捕捉した要求・解析・DB・画像例外も段階とカード ID を添えて共通診断へ渡す。
- `card_utils_jp.py`: requests と BeautifulSoup による日本語公式カード HTML アダプター。共通カード形式へ変換し、日本語 DB と画像を管理する。捕捉した要求・解析・DB・画像例外も段階とカード ID を添えて共通診断へ渡す。
- `extract_deck_cards_chs.py`: 簡体字デッキ CLI。コード・数値 ID・URL から期待カード一覧を確定し、有効な取得分を原子的に保存する。資料不足は失敗、画像不足は警告として共通結果 JSON を返す。
- `extract_deck_cards_cht.py`: 繁体字デッキ CLI と `extract_deck_cards`。台湾公式レシピ HTML から ID／枚数を抽出し、共通層で取得したカードをまとめて保存して ID 一覧 JSON を返す。
- `extract_deck_cards_en.py`: 英語デッキ取得の予約ファイル。コメントのみで、取得処理・JSON 出力・DB 更新は未実装。
- `extract_deck_cards_jp.py`: 日本語デッキ CLI と `extract_deck_cards`。公式デッキページのフォームから ID／枚数を抽出し、共通層で取得したカードをまとめて保存して ID 一覧 JSON を返す。
- `get_single_card_chs.py`: 簡体字単体カード CLI。カード ID を正規化し、--keep でも画像を検証して共通結果 JSON を返す。--file はローカル API 応答 JSON を読み込む。
- `import_diagnostics.py`: 全言語の共通 stderr イベントと例外フック。親から番号・試行・言語・スクリプト名を受け、捕捉／未捕捉例外の段階・カード・スタックを記録する。CHS だけが警告集計と単一 stdout JSON 境界を使い、永続化と匿名化は extension に委ねる。
- `export_diagnostics.py`: 診断 ZIP 専用 CLI。stdin の固定三文書だけを UTF-8 で格納し、ZIP バイトを stdout へ返す。生成失敗は stderr に実例外とスタックを残し、任意パスや実ファイルは読み込まない。
- `test_import_diagnostics.py`: 標準 unittest による CHS 障害注入テスト。要求期限、例外、JSON、欠落資料、画像キャッシュ、中断ダウンロード、保存障害と CLI 終了結果を通信なしで検証する。
- `test_runtime_diagnostics.py`: 全言語の標準 unittest 回帰。捕捉例外、部分デッキ、DB 保存失敗のゼロ終了、入力欠落と ZIP 障害を実 CLI／一時 DB で検証し、stdout と終了意味の互換性を確認する。
- `get_single_card_cht.py`: 繁体字単体カード CLI。カード ID または `--file` のローカル HTML を共通層に渡し、`--overwrite/--keep` に従って DB を更新する。
- `get_single_card_en.py`: 英語単体カード取得の予約ファイル。コメントのみで、取得処理・DB 更新は未実装。
- `get_single_card_jp.py`: 日本語単体カード CLI。カード ID または `--file` のローカル HTML を共通層に渡し、`--overwrite/--keep` に従って DB を更新する。

## 呼び出し契約と管理範囲

- JP/CHT は公式 HTML、CHS は tcg.mik.moe の JSON API を利用する。取得済み DB と画像は NodeCG の `assets/ptcg-telop` 領域に保存し、CLI の `--database-path` は DB 保存先を上書きする。
- CHS の二つの CLI は stdout を `{cards, missingCards, missingImages, warnings, databaseSaved, status}` の単一 JSON に限定し、診断・進捗は stderr に出す。欠落資料と保存障害は非ゼロ終了、画像不足や有効な旧資料の使用は警告付きのゼロ終了となる。JP/CHT のデッキ JSON・単体情報出力は従来の契約を保つ。
- `card_utils_jp.py` と `card_utils_cht.py` の `add_card_to_database` はカード情報と更新有無を返す。CHS 版は情報と `updated/skipped/stale/failed/save_failed` を返し、`save_database` と `download_card_image` は成否を返す。SET/NUM は SET-NUM に正規化し、小数点を含む実在のセットコードも保持する。
- `libs/` は同梱依存ライブラリ、`__pycache__/` は実行時キャッシュであり、いずれも自作コードの GEB 初期化対象から除外する。既存の取得処理は `libs/` を Python の探索パス先頭に追加する。
- `card_packs.json` は Git 管理対象外の生成キャッシュ。独立クローンには存在しない場合があり、`card_utils_chs.py` が必要時に API から取得して `setCode` とパック名の対応に利用する。
- 英語用 CLI のファイル名は extension に登録されているが、現時点では取得処理を提供しない。
- JP/CHT の caught exception は戻り値と終了コードを変えず `PTCG_DIAG ` stderr へ記録する。空資料や部分デッキの警告も診断に残すため、ゼロ終了だけで障害証拠を捨てない。Python の構文・依存・開始以前の障害は extension の共通起動境界が原出力で補完する。

[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
