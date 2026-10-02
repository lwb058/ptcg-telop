# dashboard/js/
> L2 | 親: [../CLAUDE.md](../CLAUDE.md)

HTML の script 要素から読み込むクラシックスクリプト群。共通ヘルパーには利用側のグローバル Replicant を参照するものがあるため、読込順と変数の公開範囲もパネル間の契約になる。

## メンバー
- [dashboard.js](dashboard.js): 共通基盤。翻訳、カード画像・名称、色変換、操作の追加／更新、HotkeyManager、操作要約を提供し、利用側の Replicant と NodeCG メッセージに接続する。
- [attack_sources.js](attack_sources.js): ワザ取得の単一入口。getAttackGroups が本体・道具・特性で借りるベンチ・進化前を表示順のグループとして返す。両デッキの同名版と進化鎖を探索し、本体→進化前→道具の同名優先順を維持する。ベンチは同名でも出所別に保持する。MEMORY_SPIRAL_ABILITY_NAMES の四言語設定は UI 言語と独立し、未入力名を除外する。
- [deck_importer.js](deck_importer.js): 取り込みアダプター。setupDeckImporter が入力欄を importDeckOrCard と進捗 Replicant に接続し、応答待ちの連打を抑止する。成功後にだけ ID 更新を通知し、各言語の原因・警告・影響カード・診断番号を設定／翻訳 Replicant で表示する。
- [diagnostic_export.js](diagnostic_export.js): Settings の診断ダウンロード境界。setupDiagnosticExport が exportImportDiagnostics を一度ずつ要求し、親ウィンドウの別 realm を含むバイナリ／Buffer 応答を ZIP Blob に変換して保存する。生成中はボタンを更新し、成功・空記録・失敗の結果を操作後にだけ表示する。updateLabels で言語変更を反映する。
- [player_panel.js](player_panel.js): 左右共通コントローラー。setupPlayerPanel(side) がプレイヤー HTML の DOM を draft_* と結び、選択・対戦操作・表示状態を更新する。取り込み成功コールバックは単カード応答を区別して既存のデッキ ID を保持する。
- [shortcut.js](shortcut.js): 個別カード用入力補助。master_panel.html のコンテキストから打点計算と一括ダメージを組み立て、window.initShortcutModule で更新関数を返す。

player_panel.js は dashboard.js と deck_importer.js の後に読み込む。shortcut.js の DOM と Replicant は master_panel.html から引き渡す。diagnostic_export.js は [setting.html](../setting.html) の初期化より先に読み込み、ページの翻訳関数と診断 DOM に接続する。診断の保存・匿名化・ZIP 作成は extension に委ね、ブラウザーは返却された ZIP だけを保存する。

attack_sources.js は master_panel.html のインライン初期化より先に読み込む。ワザの探索・特性判定・重複排除はこのファイルが所有し、パネルには own/tm/bench/preEvolution のグループを渡す。進化前は従来どおり特性で制限しない候補一覧。行の描画・折り畳み・選択・ダメージ算定と操作送信はパネルが所有する。

[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
