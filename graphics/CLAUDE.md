# graphics/
> L2 | 親: [../CLAUDE.md](../CLAUDE.md)

NodeCG の Replicant と通知を OBS 向けの 1920×1080 透明画面へ変換する。盤面の状態更新と演出通知は各 HTML が受け取り、スロット単位の描画は共通レンダラーへ渡す。

## メンバー

- main.html: メイン盤面。左右のバトル場 0・通常ベンチ 1–5 と選手情報・対局情報を同期する。画面全体の攻撃宣言、カメラ配置と main バッチの描画／演出 Promise を所有する。
- extra.html: 拡張ベンチ。左右のスロット 6–8 と表示可否を同期する。画面内の入替・遅延被弾動画・揺れも追跡し、extra バッチの完了を通知する。
- card.html: カード紹介。cardToShowL / cardToShowR と showPrizeCards / clearCard に応じて単一カード・サイドカード一覧・非表示を切り替え、設定に従って左右を反転する。
- slot-renderer.js: 依存を注入する共通描画器。window.SlotRenderer が HP・付属物・状態・入替の完了 Promise を返す。画像読込と滑入を同じ Promise に含め、描画世代で古い読込と消去を無効化する。退場／KO は DOM の個体 ID を照合し、新個体へ古い終了処理を書き込まない。
- animation-batch.js: main/extra 共通の完了収集器。Start から End までの Promise を独立したバッチへ集め、全終了後に `{batchId, graphic}` を一度通知する。初期描画、履歴の識別なし演出、取消済みバッチは ACK を出さない。

## 子モジュール

- [css/CLAUDE.md](css/CLAUDE.md): 3 画面共通の配置・演出とローカルフォント。各画面は設定に従って左右別のテーマ CSS を追加する。

[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
