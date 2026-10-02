# i18n/
> L2 | 親: [../CLAUDE.md](../CLAUDE.md)

操作画面の翻訳辞書。[extension](../extension/CLAUDE.md) が JSON を読み込み、`i18nStrings` Replicant として配信する。共通表示は [dashboard.js](../dashboard/js/dashboard.js) の翻訳ヘルパー、設定と取り込み結果はそれぞれのアダプターが選択言語を解決する。日本語を共通の代替言語とする。

## メンバー

- strings.json: UI キーごとの jp/en/chs/cht 文字列。画面の `data-i18n` 属性と翻訳ヘルパーのキーを共有し、diagnostics_export_* は Settings のボタン名・ダウンロード状態、import_* は各言語の取り込み原因・警告・処理段階・診断番号を表す。全ランタイム Python の診断包をどの言語からも保存できる。JSON にはコメントを挿入せず、この地図で契約を管理する。

bench_attacks は借用ワザの出所見出しに使用する UI ラベル。カード特性の名前照合は表示言語と独立し、[attack_sources.js](../dashboard/js/attack_sources.js) の名称設定が所有する。

[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
