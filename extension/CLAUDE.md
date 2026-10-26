# extension/
> L2 | 親: [../CLAUDE.md](../CLAUDE.md)

NodeCG サーバー側の対戦制御。`index.js` が現在の盤面と操作の適用方法を所有し、`timeline_manager.js` は注入された `gameLogic` を使って同じ盤面を記録・再構築する。

## メンバー

- `deck_state.js`: デッキ固有の枚数境界。JP/CHT の明示 counts と CHS の繰り返し ID を一意の ID 索引と正整数の枚数表に揃える。単カード追加は冪等で、旧デッキの不明枚数を推測せず既知枚数だけを維持する。
- `deck_counts.test.js`: 実 extension／timeline のメッセージ経路で三言語の枚数保存、左右独立、単カード追加、削除、再取得、リセットと不正数量の状態保護を検証する。
- `deck_viewer.test.js`: 実 Deck Viewer の HTML スクリプトで数量列・グリッド枚数・分類合計、旧状態、多言語と表示／ドラッグ操作を検証する。

- `index.js`: CommonJS の起動点と状態所有者。設定・資源・draft/live と操作キューを管理し、新規入場の UUID、初回 KO の自動サイド、演出前の個体 ID 検証を確定する。Apply の各演出段階は画面別の完了を待つ。実際の言語変更では Reset System と DB 再読込を行い、stateGeneration で旧取得の書込を拒否する。診断 ZIP は要求元だけに返す。
- `identity_guard.js`: 個体 ID の純粋な検証境界。各層の 18 スロットと操作後のコピーを検査し、重複 ID と所有スロットをエラーにする。実 Replicant と歴史の ID は書き換えない。
- `animation_batch.js`: 演出待機の寿命を所有する。UUID と main/extra ごとの一度だけの応答を検査し、期限と取消を同じ ID に結び付け、有効なバッチの終了だけを次の処理へ通知する。
- `animation_ack.test.js`: 実メッセージ経路で重複・遅延・不正 ACK、画面間の待機、timeout と reset/restart/seek による取消を検証する。
- `animation_graphics.test.js`: main/extra の実 HTML と SlotRenderer を VM で実行し、画像・CSS・被弾の完了、リロード、取消済み Promise と遅延描画からの保護を検証する。
- `language_state.test.js`: 言語別 DB と完全リセット、初期復元、壊れた DB、旧回放／録画取得の取消を実 extension で検証する。最終パックの完了と一時停止からの再開も保護する。
- `state.test.helpers.js`: 実 extension・timeline・dashboard を実行する隔離テスト環境。NodeCG、OS、通信、時計だけを置換し、メッセージと draft/live を観測する。実 NodeCG とディスクの検証は別途必要。
- `queue_state.test.js`: KO の一度だけの自動サイド生成、待機列編集・独立削除・手動補正・記録再構築の回帰。
- `instance_identity.test.js`: 復元・シーク後の新規入場、同カードの別個体、移動と進化、旧 ID と欠落 ID の互換、重複時の演出前停止と処理復帰を検証する。
- `chs_import.js`: 簡体字取得の調整器。試行を同じ診断番号と 10 分の期限で実行し、UTF-8 stderr と stdout／DB の完全性を検証する。注入された言語世代が失効すると再試行・確定・進捗更新を止め、旧要求の終了で新要求の所有権を解除しない。
- `legacy_import.js`: JP/CHT/EN の従来 CLI アダプター。既存の stdout・DB 更新・警告を維持し、タイムラインでは単カードへフォールバックしない。非同期復帰、キャッシュ追加、DB 再読込と確定の前に言語世代を検証し、失効した要求からの進捗と終了通知を破棄する。
- `python_process.js`: 全ランタイム Python の共通起動境界。実 ChildProcess を返し、起動障害・UTF-8 出力・構造化例外・終了コード・信号を信頼できるスクリプト名で記録する。巨大な行は先頭と末尾を保持して切り詰めを明示し、ZIP のバイナリ stdout は収集しない。
- `import_diagnostics.js`: 非公開 JSONL 診断ストア。実際の言語・操作・スクリプトを保持し、入力・例外を保存前に匿名化して 7 日／10 MiB に制限する。Python 版探測の障害は今回の不変スナップショットへ追加し、ZIP 生成障害は次回成功包へ残す。正常な内部ツールは保存活動を増やさず、保存障害は取得を妨げない。
- `chs_import.test.js`: 実 Python 子プロセスによる取得境界テスト。原因保持、UTF-8 分割、欠落資料、壊れた結果／DB、全体期限、並行要求と状態保護を通信なしで再現する。
- `import_diagnostics.test.js`: 実 ZIP 解凍による診断保存テスト。匿名化、期限・容量、再起動、書込障害、同一スナップショットと生成期限を検証する。
- `legacy_import.test.js`: 実 Python と ZIP による従来言語テスト。各言語の stderr 例外・stdout エラー・ゼロ終了警告、キャッシュと単カードの更新、デッキ専用経路を検証する。
- `python_process.test.js`: 共通起動境界の実子プロセステスト。構文／依存／未捕捉例外、UTF-8 と行末・巨大行、開始障害、信号、ZIP 非観測と壊れた保存器を検証する。
- `diagnostic_ui.test.js`: 実 dashboard スクリプトの VM/DOM テスト。ZIP バイナリ形式、ダウンロード状態、翻訳、警告・診断番号と成功後の ID 更新を検証する。
- `attack_list.test.js`: 統一ワザ取得と Master Panel の実処理を VM/DOM で検証する。両デッキの多段進化・同名版・循環・重複優先順と折り畳み、ベンチ 1–8 の共有、四言語名、即時更新、打点と攻撃者の維持を実対戦に触れずに確認する。
- `timeline_manager.js`: 対戦時計・二系統の記録・編集・シーク・再生・JSON 入出力を管理し、盤面操作は注入された gameLogic に委ねる。個体 ID と取得世代を検証し、resetRuntime が待機中の再生・時計・表示を取り消す。一時停止は残りの操作を保持し、自然終了は最終パックの完了を待つ。

## 境界とデータの流れ

- デッキの `cards` は一意の ID 索引、`counts` は左右独立の構築枚数。JP/CHT の stdout 枚数表と CHS の繰り返し ID を deck_state で揃え、共有カード DB に数量を書かない。単カード追加は既存枚数を維持し、新規 ID だけ 1 にする。削除は数量も除き、Reset System は一緒に清空する。旧デッキの一意 ID は枚数不明のまま維持する。

- [dashboard](../dashboard/CLAUDE.md) はメッセージで操作を依頼し、draft を確認する。Apply の演出段階ごとに Start → live の Replicant 更新 → End を送り、[graphics](../graphics/CLAUDE.md) は `{batchId, graphic}` の animationBatchComplete を返す。同じ画面種別の複数ウィンドウは最初の有効応答を採用し、該当画面の不在は既存 timeout で進める。履歴再生は既存の固定待機を使う。
- 言語変更は現在の対局を完全に終え、新言語の DB と画像パスを公開する。起動時の復元・同言語の保存・他設定の変更では対局を消さない。取得の `{language, generation}` は Reset/Restart で失効するが、元言語のディスクキャッシュは保持する。
- CHS は [python](../python/CLAUDE.md) の単一 stdout JSON と `PTCG_DIAG ` stderr イベントを別々に取り込む。カード資料不足・DB 保存／再読込の失敗では既存の状態を保持し、画像不足だけなら警告付きで確定する。JP/CHT は既存の終了コードと DB 更新経路を維持し、部分取得と内部例外は従来の更新結果に警告を付ける。
- 各言語の取得・タイムライン再取得・版探測・ZIP ツールは `python_process` を通り、ホストの `logs/ptcg-telop-diagnostics` に証拠を保存する。公開 assets・設定全体・対戦録画を含めず、Settings の `exportImportDiagnostics` ACK が固定三文書の ZIP を要求元へ渡す。開発者が端末で直接動かす Python はこのランタイム境界の対象外。
- カード DB・カード画像・追加テーマは NodeCG のバンドル用 assets 領域に置く。翻訳文字列はバンドル内の `i18n/strings.json` から読み込み、画面へ Replicant で配信する。
- タイムラインのシークでは `gameLogic` のリセットと操作適用を使って live を再構築し、draft に同期する。盤面ルールの実装は `index.js` に置き、時間管理側はその呼び出しを担当する。

[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
