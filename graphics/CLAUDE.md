# graphics/
> L2 | 親: [../CLAUDE.md](../CLAUDE.md)

NodeCG の Replicant と通知を OBS 向けの 1920×1080 透明画面へ変換する。盤面の状態更新と演出通知は各 HTML が受け取り、スロット単位の描画は共通レンダラーへ渡す。

## メンバー

- main.html: メイン盤面。左右のバトル場 0・通常ベンチ 1–5 と選手情報、サイド、ターン、スタジアム、ロストゾーンを同期し、カメラ表示への切替と演出完了通知を担当する。
- extra.html: 拡張ベンチ。左右のスロット 6–8 を描画し、extraBenchVisible で画面を出し入れする。攻撃・入替通知はこの画面内の対象へ絞る。
- card.html: カード紹介。cardToShowL / cardToShowR と showPrizeCards / clearCard に応じて単一カード・サイドカード一覧・非表示を切り替え、設定に従って左右を反転する。
- slot-renderer.js: main.html と extra.html が依存を注入する共通描画器。window.SlotRenderer を公開し、HP・エネルギー・どうぐ・状態異常の描画と入替演出を Promise で追跡する。

## 子モジュール

- [css/CLAUDE.md](css/CLAUDE.md): 3 画面共通の配置・演出とローカルフォント。各画面は設定に従って左右別のテーマ CSS を追加する。

[PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
