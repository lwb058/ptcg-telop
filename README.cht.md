# PTCG-Telop

PTCG-Telop是基於[NodeCG](https://www.nodecg.dev/)框架開發的，專為寶可夢集換式卡牌遊戲直播設計的即時圖形套件。

本系統可以即時管理玩家的場面資訊（HP、傷害、能量、道具、特殊狀態等），並以覆蓋層(Overlay)的形式顯示在直播畫面上。系統設計以操作的安全性為最優先考量，採用了將所有操作先存入「草稿(Draft)」佇列，待確認後再一併套用至「線上(Live)」畫面的工作流程。

## 主要功能

-   **玩家盤面的詳細管理**: 可分別管理各玩家的戰鬥場與備戰區的寶可夢。
-   **透過主控台進行統一操作**: 高效率地對多隻寶可夢執行能量附加、傷害計算等操作。
-   **安全的直播運作**: 透過「草稿」與「線上」的兩階段更新系統，防止操作失誤即時反映到正式畫面上。
-   **Python腳本產生卡牌資料庫**: 從牌組列表中自動擷取必要的卡牌資訊，建立資料庫。
-   **靈活的狀態管理**: 可靈活設定傷害、額外HP、能量、道具、特殊狀態（中毒、灼傷、睡眠等）。

## 螢幕截圖

<img width="1920" height="1080" alt="Screenshot 2025-09-02 14-36-42" src="https://github.com/user-attachments/assets/776332a4-29ee-46a7-bfb4-e97b4e49c82d" />

## 環境需求

要執行此套件，您需要先安裝以下軟體：

-   [Node.js](https://nodejs.org/) (已在 v22.19.0 LTS 版本測試通過)
-   [NodeCG](https://www.nodecg.dev/docs/installing) (包含 `nodecg-cli`)
-   [Python](https://www.python.org/) (已在 v3.13 版本測試通過)
-   [Git](https://git-scm.com/) (非必要，用於更新專案)

## 安裝方式

---
### 🔰 簡易安裝（推薦）

對於初次使用的用戶，最簡單的方式是使用包含所有必要檔案的「懒人包」。

1.  前往本專案的 [**Releases**](https://github.com/lwb058/ptcg-telop/releases) 頁面。
2.  從最新版本的`Assets`區塊下載 `NodeCG_PTCG_vX.X.X.zip` 並解壓縮。
3.  （若尚未安裝）請安裝 [Node.js](https://nodejs.org/) 和 [Python](https://www.python.org/)。**【重要】安裝Python時，請務必在安裝程式的第一個畫面勾選`Add Python to PATH`核取方塊。**
4.  在解壓縮後的資料夾中，雙擊執行 `install.bat`。腳本將會自動安裝所有必要的元件。
5.  安裝完成後，雙擊 `start.bat` 即可啟動系統。

---
### 🚀 更新方式

若您正在使用舊版本，可以使用「更新修正檔」輕鬆升級。

1.  前往本專案的 [**Releases**](https://github.com/lwb058/ptcg-telop/releases) 頁面。
2.  從最新版本的`Assets`區塊下載 `patch_vX.X.X.zip` 並解壓縮。
3.  複製其中的 `assets` 和 `bundles` 兩個資料夾。
4.  將它們直接貼到您目前使用的 `nodecg` 資料夾中，並選擇覆蓋所有現有檔案。

---
### 手動安裝

此為針對開發者或希望手動建構環境的用戶的步驟。

1.  **設定NodeCG** (若尚未安裝):
    ```bash
    # 在任意位置安裝NodeCG
    git clone https://github.com/nodecg/nodecg.git
    cd nodecg
    npm install
    ```

2.  **複製PTCG-Telop套件**:
    在NodeCG根目錄下的`bundles`資料夾中，複製此儲存庫。
    ```bash
    cd bundles
    git clone https://github.com/lwb058/ptcg-telop.git
    ```

3.  **安裝相依套件**:
    回到NodeCG的根目錄，使用`nodecg-cli`安裝套件的相依項目。
    ```bash
    cd ..
    nodecg-cli install ptcg-telop
    ```

4.  **配置素材檔案（圖片、影片）**:
    此套件需要使用圖片和影片檔案來顯示背景或進化動畫等，這些檔案未包含在儲存庫中，需要另外下載。
    1.  前往本專案的 [**Releases**](https://github.com/lwb058/ptcg-telop/releases) 頁面。
    2.  從最新版本下載素材包（例如: `assets_v1.0-beta.zip`）。
    3.  解壓縮下載的檔案，並將其中所有內容放置到 `nodecg/assets/ptcg-telop/` 目錄下。（如果 `assets/ptcg-telop` 目錄不存在，請手動建立）

5.  **設定Python環境**:
    移動到套件的`python`目錄，並安裝所需的函式庫。
    ```bash
    cd bundles/ptcg-telop/python
    pip install -r requirements.txt
    ```
    *如果`requirements.txt`不存在，請手動安裝`card_utils_jp.py`或`extract_deck_cards_jp.py`中import的函式庫（例如: `requests`, `beautifulsoup4`等）。*

## 目錄結構

此專案預設放置於NodeCG的`bundles`目錄內。主要檔案與目錄的功能如下：

```
nodecg/
├── assets/
│   └── ptcg-telop/
│       ├── element/        (UI元素資料夾)
│       ├── icons/          (能量、特殊狀態等圖示資料夾)
│       ├── fx/             (特效影片資料夾)
│       ├── font/           (字型資料夾)
│       ├── card_img_*/     (自動建立，卡牌圖片資料夾)
│       └── database_*.json (自動建立，卡牌資料庫檔案)
├── bundles/
│   └── ptcg-telop/
│       ├── dashboard/      (控制台面板)
│       ├── graphics/       (直播畫面上顯示的圖形)
│       ├── extension/      (伺服器端邏輯)
│       ├── python/         (用於擷取卡牌資訊的腳本)
│       ├── i18n/           (多國語言檔案)
│       ├── package.json    (套件設定檔)
│       └── 其他檔案
└── ... (NodeCG的其他檔案)
```

-   **`assets/ptcg-telop/`**: 放置直播中使用的背景圖片、影片等素材的地方。
-   **`dashboard/`**: 透過 `http://localhost:9090` 存取的操作面板檔案。
-   **`graphics/`**: 供OBS等軟體擷取的直播用圖形畫面檔案。
-   **`python/`**: 用於從牌組代碼擷取卡牌資訊並產生資料庫的腳本。

## 使用方法

1.  **啟動系統**:
    -   **簡易安裝包用戶**: 雙擊 `start.bat` 啟動。
    -   **手動安裝用戶**: 在NodeCG的根目錄執行以下指令。
    ```bash
    nodecg start
    ```

2.  **進入儀表板**:
    在網頁瀏覽器中開啟 `http://localhost:9090`。
    您會看到名為 `ptcg-telop` 的分頁，可在此存取各種控制面板（Master Control, Player L/R等）。

3.  **基本操作**:
    -   **在玩家面板設定牌組**:
        1.  從[寶可夢集換式卡牌遊戲官方網站的牌組構築頁面](https://www.pokemon-card.com/deck/confirm.html/deckID/...)等處，取得您想使用的牌組的「牌組代碼」。
        2.  在玩家面板的`DeckID`輸入框中輸入牌組代碼，然後點擊「Set」按鈕。
        3.  系統將自動擷取卡牌資訊，並建立或更新資料庫。
        4.  之後，即可從下拉式選單中選擇寶可夢，將其配置到場面上。
    -   **主控台 (Master Control)**: 對選擇的寶可夢執行傷害計算、能量附加等統一操作。
    -   **操作流程**: 所有操作會先作為草稿新增至佇列中，點擊`Apply`按鈕後才會反映到線上畫面。點擊`Discard`按鈕可放棄所有變更。

4.  **在直播軟體中設定畫面 (以OBS為例)**:
    NodeCG的圖形是由多個圖層疊加構成一個畫面的。請將以下URL作為「瀏覽器來源」新增至OBS等直播軟體中。

    為獲得最佳顯示效果，建議在OBS的來源列表中依照以下順序（上方為最前層）排列：

    1.  **卡牌展示圖層**: `http://localhost:9090/bundles/ptcg-telop/graphics/card.html`
    2.  **擴充備戰區圖層**: `http://localhost:9090/bundles/ptcg-telop/graphics/extra.html`
    3.  **主盤面圖層**: `http://localhost:9090/bundles/ptcg-telop/graphics/main.html`

## 注意事項

-   **執行目錄**: `nodecg`指令必須在NodeCG的**根目錄**下執行。
-   **資料庫**: 資料庫是透過在玩家面板設定牌組代碼自動產生的，無需手動操作。
-   **操作流程**: 本系統的基本操作流程為：「在玩家面板設定個別狀態」→「在主控台選擇並進行統一操作」→「在主控台點擊Apply/Discard」。

## 授權條款

此專案依據MIT授權條款釋出。

## 特別感謝

本系統的繁體中文的翻譯由 [サイ/ TSAI](https://x.com/pokeca_tsai) 協助校正。謹此致上誠摯的感謝。
