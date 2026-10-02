# extension/
> L2 | 親: [../CLAUDE.md](../CLAUDE.md)

NodeCG サーバー側の対戦制御。`index.js` が現在の盤面と操作の適用方法を所有し、`timeline_manager.js` は注入された `gameLogic` を使って同じ盤面を記録・再構築する。

## メンバー

- `index.js`: CommonJS のバンドル起動点と状態所有者。設定・資源・draft/live 盤面と操作キューを管理し、CHS の検証済み候補をカード DB・デッキ・ID・サイドへ確定する。診断 ZIP は NodeCG メッセージの要求元だけに返す。
- `chs_import.js`: 簡体字取得の調整器。デッキ／単体の試行を同じ診断番号と 10 分の期限で実行し、UTF-8 stderr のイベント・例外・進捗を収集する。stdout 結果と再読込 DB の全カードを検証してから状態確定を依頼する。
- `legacy_import.js`: JP/CHT/EN の従来 CLI アダプター。デッキと単カードの原因を同じ番号で保持し、stdout のエラーとゼロ終了時の内部例外も警告にする。既存の DB 再読込・デッキ／単カード更新規則を維持し、タイムラインではフォールバックを行わない。
- `python_process.js`: 全ランタイム Python の共通起動境界。実 ChildProcess を返し、起動障害・UTF-8 出力・構造化例外・終了コード・信号を信頼できるスクリプト名で記録する。巨大な行は先頭と末尾を保持して切り詰めを明示し、ZIP のバイナリ stdout は収集しない。
- `import_diagnostics.js`: 非公開 JSONL 診断ストア。実際の言語・操作・スクリプトを保持し、入力・例外を保存前に匿名化して 7 日／10 MiB に制限する。Python 版探測の障害は今回の不変スナップショットへ追加し、ZIP 生成障害は次回成功包へ残す。正常な内部ツールは保存活動を増やさず、保存障害は取得を妨げない。
- `chs_import.test.js`: 実 Python 子プロセスによる取得境界テスト。原因保持、UTF-8 分割、欠落資料、壊れた結果／DB、全体期限、並行要求と状態保護を通信なしで再現する。
- `import_diagnostics.test.js`: 実 ZIP 解凍による診断保存テスト。匿名化、期限・容量、再起動、書込障害、同一スナップショットと生成期限を検証する。
- `legacy_import.test.js`: 実 Python と ZIP による従来言語テスト。各言語の stderr 例外・stdout エラー・ゼロ終了警告、キャッシュと単カードの更新、デッキ専用経路を検証する。
- `python_process.test.js`: 共通起動境界の実子プロセステスト。構文／依存／未捕捉例外、UTF-8 と行末・巨大行、開始障害、信号、ZIP 非観測と壊れた保存器を検証する。
- `diagnostic_ui.test.js`: 実 dashboard スクリプトの VM/DOM テスト。ZIP バイナリ形式、ダウンロード状態、翻訳、警告・診断番号と成功後の ID 更新を検証する。
- `attack_list.test.js`: 統一ワザ取得と Master Panel の実処理を VM/DOM で検証する。両デッキの多段進化・同名版・循環・重複優先順と折り畳み、ベンチ 1–8 の共有、四言語名、即時更新、打点と攻撃者の維持を実対戦に触れずに確認する。
- `timeline_manager.js`: CommonJS の時系列管理初期化関数。NodeCG と `gameLogic` を受け取り、対戦時計・対戦操作／表示操作の二系統タイムライン・再生位置を管理する。編集、削除／復元、シーク、JSON 入出力をメッセージとして提供する。

## 境界とデータの流れ

- [dashboard](../dashboard/CLAUDE.md) はメッセージで操作を依頼し、draft の結果を確認する。適用後の live 状態と表示用メッセージを [graphics](../graphics/CLAUDE.md) が描画し、`animationBatchComplete` でキュー処理に応答する。
- CHS は [python](../python/CLAUDE.md) の単一 stdout JSON と `PTCG_DIAG ` stderr イベントを別々に取り込む。カード資料不足・DB 保存／再読込の失敗では既存の状態を保持し、画像不足だけなら警告付きで確定する。JP/CHT は既存の終了コードと DB 更新経路を維持し、部分取得と内部例外は従来の更新結果に警告を付ける。
- 各言語の取得・タイムライン再取得・版探測・ZIP ツールは `python_process` を通り、ホストの `logs/ptcg-telop-diagnostics` に証拠を保存する。公開 assets・設定全体・対戦録画を含めず、Settings の `exportImportDiagnostics` ACK が固定三文書の ZIP を要求元へ渡す。開発者が端末で直接動かす Python はこのランタイム境界の対象外。
- カード DB・カード画像・追加テーマは NodeCG のバンドル用 assets 領域に置く。翻訳文字列はバンドル内の `i18n/strings.json` から読み込み、画面へ Replicant で配信する。
- タイムラインのシークでは `gameLogic` のリセットと操作適用を使って live を再構築し、draft に同期する。盤面ルールの実装は `index.js` に置き、時間管理側はその呼び出しを担当する。

[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
