# PTCG-Telop — ポケモンカード対戦を操作・記録し、配信画面へ同期する NodeCG バンドル

PTCG-Telop 1.7.1 + NodeCG ^2.0.0（package.json の互換範囲）+ JavaScript（ブラウザー / CommonJS）+ HTML/CSS + Python（requests / beautifulsoup4、バージョン指定なし）

<directory>

- [dashboard/](dashboard/CLAUDE.md) — 操作パネルと draft 状態の編集（2 子ディレクトリ: js/、css/）。
- [extension/](extension/CLAUDE.md) — Replicant、操作キュー、取得処理の起動と記録・再生（0 子ディレクトリ）。
- [graphics/](graphics/CLAUDE.md) — OBS 向け主盤面、拡張ベンチ、カード紹介と共通描画器（1 子ディレクトリ: css/）。
- [i18n/](i18n/CLAUDE.md) — UI 翻訳辞書（0 子ディレクトリ）。
- [python/](python/CLAUDE.md) — 言語別カード／デッキ取得 CLI とデータ変換（管理対象の子ディレクトリ 0、libs/・__pycache__/ は生成／依存領域）。

</directory>

<config>

- package.json — バージョン、NodeCG 互換範囲、extension 起動点、7 パネル・3 グラフィックとアセット種別の登録。
- requirements.txt — Python 取得処理の依存宣言。requests と beautifulsoup4 のバージョンは固定されていない。
- .gitignore — Python キャッシュ、同梱依存とカードパックキャッシュの除外。
- [AGENTS.md](AGENTS.md) — 開発エージェントの文書参照順と管理言語。
- [README.md](README.md) — 日本語の導入・更新・操作案内。
- [README.en.md](README.en.md) — 英語利用案内。
- [README.chs.md](README.chs.md) — 簡体字中国語利用案内。
- [README.cht.md](README.cht.md) — 繁体字中国語利用案内。
- [LICENSE](LICENSE) — 配布物のライセンス本文。

</config>

## 制御と保存の境界

Dashboard の対戦操作を extension が受け付け、draft に反映する。Apply は待機キューのスナップショットを優先度／紀元ごとに live へ適用し、graphics の演出完了通知で進行する。名前・設定・カード紹介など、キューを通さない直接更新もある。タイムラインは同じ対戦ロジックを使って記録と再構築を行う。

カード DB、画像、テーマ、NodeCG の永続化データはホスト側の資源であり、この Git リポジトリの外に配置する。Python CLI は取得結果をホストの assets 領域へ保存し、extension が再読込する。全ランタイム Python は共通起動境界から例外・出力・終了の証拠を非公開 logs に 7 日／10 MiB 保持する。Settings は支援ボタンの隣から診断 ZIP をダウンロードする。CHS は全資料を検証してから状態を確定し、JP/CHT は既存の stdout／DB 更新契約を維持して警告を返す。英語 CLI は引き続きプレースホルダーだが空結果の失敗も診断する。

## 文書の保守

このルートは独立リポジトリの L1。下位の CLAUDE.md を L2、ソース先頭の `[INPUT]` / `[OUTPUT]` / `[POS]` / `[PROTOCOL]` を L3 とする。ファイルの依存・公開能力・責務を変えたら L3、ファイルやインターフェースを増減したら L2、トップレベル構造を変えたら L1 まで反映する。

管理文書と新しい L3 の説明は日本語を基本とする。構造マーカーは保持し、プロトコルの説明文は日本語で「[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。」と記載する。HTML は DOCTYPE、Python は shebang・エンコーディング指定を維持し、JSON やバイナリにはコメントを加えず L2 で管理する。リンクは独立クローン内で解決できる相対パスを使う。

## 検証の入口

`npm test` は Node の全言語子プロセス・内部 Python ツール・診断 ZIP・dashboard スクリプトのテストを実行し、`npm run test:python` は CHS と JP/CHT の標準 unittest を実行する（Python 3 と requirements.txt が必要。Linux で python がない場合は python3 を使う）。Node 子プロセステストの Python は `PTCG_TEST_PYTHON` で指定できる。JS の `node --check`、HTML スクリプトの構文解析、Python の compile で構文も確認する。表示と配布境界は隔離した NodeCG／Docker とブラウザーで対象経路を確認する。
