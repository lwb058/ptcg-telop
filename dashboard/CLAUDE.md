# dashboard/
> L2 | 親: [../CLAUDE.md](../CLAUDE.md)

NodeCG の操作パネル。対戦編集は draft_* の表示から操作キューへの送信へ進み、適用処理は [extension](../extension/CLAUDE.md) が担当する。名前・設定・表示状態には直接 Replicant を更新する経路もある。

## メンバー
- [master_panel.html](master_panel.html): 盤面編集の中心。インライン処理が左右のカード、ワザ、ダメージ、エネルギー、どうぐ、スタジアムを扱い、共有ヘルパーで操作をキューへ送る。attack_sources.js から本体・道具・ベンチ・進化前のグループを受け取り、共通の行描画・折り畳み・選択で表示する。打点は選択したワザから算定し、借用時も実際の攻撃者を維持する。
- [director_panel.html](director_panel.html): 進行管理。操作キューの適用・破棄、先攻、カメラ、試合リセット、時計を操作し、processorStatus で適用ボタンの可否を決める。
- [player_l_panel.html](player_l_panel.html): 左プレイヤーの DOM と読込順を定義する入口。Bootstrap と共有スクリプトを読み、setupPlayerPanel('L') に制御を渡す。
- [player_r_panel.html](player_r_panel.html): 右プレイヤーの DOM と読込順を定義する入口。Bootstrap と共有スクリプトを読み、setupPlayerPanel('R') に制御を渡す。
- [deck_viewer.html](deck_viewer.html): デッキ閲覧と表示操作。左右の一覧・サイドカードを管理し、共有インポーター、カード表示 Replicant、表示履歴の記録をつなぐ。
- [record.html](record.html): 記録編集。対戦操作と表示操作の二系統の履歴、時刻編集、シーク・再生、JSON 入出力を extension のメッセージ処理へ接続する。
- [setting.html](setting.html): 設定編集。表示・対戦補助・言語・テーマ・ホットキー・時計設定を保存し、DB 初期化と更新通知を扱う。支援ボタンに隣接する診断ボタンを js/diagnostic_export.js に接続し、生成中の表示と操作後の結果を多言語で表示する。

## 下位モジュール
- [js/CLAUDE.md](js/CLAUDE.md): 操作・表示ヘルパー、左右共通パネル制御、取り込み、診断 ZIP のダウンロードと個別カードのショートカット。
- [css/CLAUDE.md](css/CLAUDE.md): 7 パネルが共有するレイアウトと状態表示。

左右のプレイヤーページは共有コントローラーを起動する。他の 5 ページは固有の制御を HTML 内に持ち、Settings の診断ダウンロードは専用アダプターへ委譲する。画面の変更時は HTML と対応する共有モジュールの両方を確認する。

簡体字の取り込みは共有インポーターが警告・失敗原因と診断番号を表示する。成功済みデッキ ID は応答後に更新し、単カード追加では保持する。診断記録の作成・匿名化・保管は extension が所有し、Settings は要求元に返された ZIP を直接保存する。

[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
