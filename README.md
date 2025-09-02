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


## 前提条件

このバンドルを動作させるには、以下のソフトウェアがインストールされている必要があります。

-   [Node.js](https://nodejs.org/) (v22.19.0 LTSでテスト済み)
-   [NodeCG](https://www.nodecg.dev/docs/installing) (`nodecg-cli`を含む)
-   [Python](https://www.python.org/) (v3.13でテスト済み)
-   [Git](https://git-scm.com/)

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

4.  **Python環境のセットアップ**:
    バンドルの`python`ディレクトリに移動し、必要なライブラリをインストールします。
    ```bash
    cd bundles/ptcg-telop/python
    pip install -r requirements.txt
    ```
    *もし`requirements.txt`がなければ、`card_utils.py`や`extract_deck_cards.py`でimportしているライブラリ（例: `requests`, `beautifulsoup4`など）を手動でインストールしてください。*

5.  **カードデータベースの生成**:
    配信で使用するデッキ情報（デッキコードなど）を使って、カードデータベースを生成します。
    ```bash
    python extract_deck_cards.py
    ```
    これにより、バンドルのルートに`database.json`ファイルが生成されます。

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
    -   **Playerパネル**: 各プレイヤーのデッキIDを設定し、盤面にポケモンを配置・管理します。
    -   **Master Controlパネル**: 選択したポケモンに対して、ダメージ計算やエネルギー付与などの一括操作を行います。
    -   全ての操作は、まずドラフトとしてキューに追加されます。
    -   `Apply`ボタンを押すと、キュー内の全操作がライブ画面に反映されます。
    -   `Discard`ボタンを押すと、キュー内の全操作が破棄されます。

## 注意点

-   **実行ディレクトリ**: `nodecg`コマンドは、必ずNodeCGの**ルートディレクトリ**で実行してください。
-   **データベース生成**: 配信前には、必ず`extract_deck_cards.py`を実行して、使用するカードの`database.json`を最新の状態にしてください。
-   **操作フロー**: このシステムの操作は「Playerパネルで個別の状態を設定」→「Masterパネルで選択・一括操作」→「MasterパネルでApply/Discard」という流れが基本です。

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。
