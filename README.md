# PTCG-Telop

PTCG-Telopは、[NodeCG](https://www.nodecg.dev/)フレームワークをベースにした、ポケモンカードゲームの生放送・配信用のリアルタイムグラフィックパッケージです。

プレイヤーの盤面情報（HP、ダメージ、エネルギー、どうぐ、状態異常など）をリアルタイムで管理し、配信画面にオーバーレイ表示することができます。操作の安全性を最優先に設計されており、全ての操作を一度「ドラフト（下書き）」としてキューに格納し、確認後に一括で「ライブ（本番）」画面に適用するワークフローを採用しています。

## 主な機能

-   **プレイヤーごとの詳細な盤面管理**: 各プレイヤーのバトル場・ベンチのポケモンを個別に管理。
-   **マスターコントロールパネルによる一括操作**: 複数のポケモンへのエネルギー追加やダメージ計算などを効率的に実行。
-   **安全な放送運用**: 「ドラフト」と「ライブ」の2段階更新システムにより、操作ミスが本番画面に即時反映されるのを防ぎます。
-   **Pythonスクリプトによるカードデータベース生成**: デッキリストから必要なカード情報を自動で抽出し、データベースを構築します。
-   **柔軟な状態管理**: ダメージ、追加HP、エネルギー、どうぐ、状態異常（どく・やけど・ねむり等）を柔軟に設定可能。

## スクリーンショット

<img width="1920" height="1080" alt="Screenshot 2025-09-02 14-36-42" src="https://github.com/user-attachments/assets/776332a4-29ee-46a7-bfb4-e97b4e49c82d" />

## ディレクトリ構造

このプロジェクトは、NodeCGの`bundles`ディレクトリ内に配置されることを前提としています。主要なファイルとディレクトリの役割は以下の通りです。

```
nodecg/
├── assets/
│   └── ptcg-telop/
│       ├── element/        (UI要素のフォルダ)
│       ├── icons/          (エネルギーや異常状態アイコンなどのフォルダ)
│       ├── fx/             (エフェクト動画のフォルダ)
│       ├── font/           (フォントのフォルダ)
│       ├── card_img_*/       (自動作成、カード画像のフォルダ)
│       └── database_*.json   (自動作成、カードデータベースのファイル)
├── bundles/
│   └── ptcg-telop/
│       ├── dashboard/      (管理画面のパネル)
│       ├── graphics/       (配信に表示される画面)
│       ├── extension/      (サーバーサイドのロジック)
│       ├── python/         (カード情報取得用スクリプト)
│       ├── i18n/           (多言語対応用ファイル)
│       ├── package.json    (バンドルの設定ファイル)
│       └── その他のファイル
└── ... (NodeCGのその他ファイル)
```

-   **`assets/ptcg-telop/`**: 配信で使う背景画像や動画などを配置する場所です。
-   **`dashboard/`**: `http://localhost:9090`でアクセスする操作パネルのファイル群です。
-   **`graphics/`**: OBSなどに取り込むための、配信用グラフィック画面のファイル群です。
-   **`python/`**: デッキコードからカード情報を取得し、データベースを生成するためのスクリプト群です。

## 前提条件

このバンドルを動作させるには、以下のソフトウェアがインストールされている必要があります。

-   [Node.js](https://nodejs.org/) (v22.19.0 LTSでテスト済み)
-   [NodeCG](https://www.nodecg.dev/docs/installing) (`nodecg-cli`を含む)
-   [Python](https://www.python.org/) (v3.13でテスト済み)
-   [Git](https://git-scm.com/) (任意。プロジェクトの更新に使用します)

## インストール方法

1.  **NodeCGのセットアップ** (未導入の場合):
    ```bash
    # 任意の場所にNodeCGをインストール
    git clone https://github.com/nodecg/nodecg.git
    cd nodecg
    npm install
    ```

2.  **PTCG-Telopバンドルのクローン**:
    NodeCGのルートディレクトリにある`bundles`フォルダに、このリポジトリをクローンします。
    ```bash
    cd bundles
    git clone https://github.com/lwb058/ptcg-telop.git
    ```

3.  **依存関係のインストール**:
    NodeCGのルートディレクトリに戻り、`nodecg-cli`を使ってバンドルの依存関係をインストールします。
    ```bash
    cd ..
    nodecg-cli install ptcg-telop
    ```

4.  **アセット（画像・動画素材）の配置**:
    このバンドルは、背景画像や進化動画などの表示に画像・動画ファイルを使用します。これらはリポジトリに含まれていないため、別途ダウンロードが必要です。
    1.  本リポジトリの [**Releases**](https://github.com/lwb058/ptcg-telop/releases) ページにアクセスします。
    2.  最新のリリースから、アセットパッケージ（例: `assets_v1.0-beta.zip`）をダウンロードします。
    3.  ダウンロードしたファイルを解凍し、中のファイルをすべて `nodecg/assets/ptcg-telop/` ディレクトリに配置します。（もし `assets/ptcg-telop` ディレクトリが存在しない場合は、作成してください）

5.  **Python環境のセットアップ**:
    バンドルの`python`ディレクトリに移動し、必要なライブラリをインストールします。
    ```bash
    cd bundles/ptcg-telop/python
    pip install -r requirements.txt
    ```
    *もし`requirements.txt`がなければ、`card_utils_jp.py`や`extract_deck_cards_jp.py`でimportしているライブラリ（例: `requests`, `beautifulsoup4`など）を手動でインストールしてください。*

## 使用方法

1.  **NodeCGの起動**:
    NodeCGのルートディレクトリで、以下のコマンドを実行します。
    ```bash
    nodecg start
    ```

2.  **ダッシュボードへのアクセス**:
    Webブラウザで `http://localhost:9090` を開きます。
    `ptcg-telop`という名前のタブが表示され、各種コントロールパネル（Master Control, Player L/Rなど）にアクセスできます。

3.  **基本操作**:
    -   **Playerパネルでのデッキ設定**:
        1.  [ポケモンカードゲーム公式ホームページのデッキ構築ページ](https://www.pokemon-card.com/deck/)等で、使用したいデッキの「デッキコード」を取得します。
        2.  Playerパネル内の`DeckID`入力欄にデッキコードを入力し、「Set」ボタンを押します。
        3.  システムが自動でカード情報を取得し、データベースを構築・更新します。
        4.  その後、ドロップダウンメニューからポケモンを選択し、盤面に配置します。
    -   **Master Controlパネル**: 選択したポケモンに対して、ダメージ計算やエネルギー付付などの一括操作を行います。
    -   **操作フロー**: 全ての操作は、まずドラフトとしてキューに追加され、`Apply`ボタンを押すとライブ画面に反映されます。`Discard`ボタンで破棄できます。

4.  **配信ソフトでの画面設定 (OBS等)**:
    NodeCGのグラフィックは、複数のレイヤー（層）を重ねて一つの画面を構成しています。OBS等の配信ソフトに以下のURLを「ブラウザソース」として追加してください。

    最適な表示を得るために、OBSのソースリストで以下の順序（上が最前面）で配置することを推奨します。

    1.  **カード展示レイヤー**: `http://localhost:9090/bundles/ptcg-telop/graphics/card.html`
    2.  **拡張ベンチレイヤー**: `http://localhost:9090/bundles/ptcg-telop/graphics/extra.html`
    3.  **メイン盤面レイヤー**: `http://localhost:9090/bundles/ptcg-telop/graphics/main.html`

## 注意点

-   **実行ディレクトリ**: `nodecg`コマンドは、必ずNodeCGの**ルートディレクトリ**で実行してください。
-   **データベース**: データベースはPlayerパネルからデッキコードをセットすることで自動生成されます。手動での操作は不要です。
-   **操作フロー**: このシステムの操作は「Playerパネルで個別の状態を設定」→「Masterパネルで選択・一括操作」→「MasterパネルでApply/Discard」という流れが基本です。

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## Special Thanks

本システムの簡体字中国語カードデータベースは、[tcg.mik.moe](https://tcg.mik.moe/)（開発者: [CrystM39](https://x.com/CrystM39)）様より提供されています。心より感謝申し上げます。

本系统的简体中文卡牌数据由 [tcg.mik.moe](https://tcg.mik.moe/) (开发者: [CrystM39](https://space.bilibili.com/1802522475/dynamic)) 提供支持。特此感谢！
