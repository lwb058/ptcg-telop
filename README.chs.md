# PTCG-Telop

`PTCG-Telop` 是一个基于 [NodeCG](https://www.nodecg.dev/) 框架的，用于宝可梦卡牌游戏直播的实时UI包装。

它可以实时管理玩家的场面信息（HP、伤害、能量、道具、异常状态等），并将其作为浮层显示在直播画面上。本工具将操作安全性放在首位，采用了一种将所有操作先存入“草稿”队列，确认后再统一应用到“线上”画面的工作流。

## 主要功能

-   **各玩家的详细场面管理**: 单独管理每个玩家的战斗场和备战区的宝可梦。
-   **通过主控制面板进行批量操作**: 高效执行为多个宝可梦附加能量或计算伤害等操作。
-   **安全的直播操作**: 通过“草稿”和“线上”两阶段更新系统，防止操作失误立即反映到正式画面上。
-   **通过Python脚本生成卡牌数据库**: 从卡组列表自动提取所需的卡牌信息，并构建数据库。
-   **灵活的状态管理**: 可以灵活设置伤害、额外HP、能量、道具、异常状态（中毒、烧伤、睡眠等）。

## 屏幕截图

<img width="1920" height="1080" alt="Screenshot 2025-09-02 14-36-42" src="https://github.com/user-attachments/assets/776332a4-29ee-46a7-bfb4-e97b4e49c82d" />

## 目录结构

这个项目设计为放置在 NodeCG 的`bundles`目录下。主要文件和目录的功能如下。

```
nodecg/
├── assets/
│   └── ptcg-telop/
│       ├── element/        (UI元素文件夹)
│       ├── icons/          (能量、异常状态等图标的文件夹)
│       ├── fx/             (特效视频文件夹)
│       ├── font/           (字体文件夹)
│       ├── card_img_*/     (自动创建的卡图文件夹)
│       └── database_*.json (自动创建的卡牌数据库文件)
├── bundles/
│   └── ptcg-telop/
│       ├── dashboard/      (后台管理面板)
│       ├── graphics/       (在直播中显示的画面)
│       ├── extension/      (服务器端逻辑)
│       ├── python/         (卡牌信息的爬虫脚本)
│       ├── i18n/           (多语言支持文件)
│       ├── package.json    (Bundle的配置文件)
│       └── 其他文件
└── ... (NodeCG的其他文件)
```

-   **`assets/ptcg-telop/`**: 用于放置直播中使用的背景图片、视频等素材。
-   **`dashboard/`**: 可通过 `http://localhost:9090` 访问的操作面板文件。
-   **`graphics/`**: 用于导入 OBS 等软件的直播用图形画面文件。
-   **`python/`**: 用于从卡组代码获取卡牌信息并生成数据库的脚本。

## 先决条件

要运行此 bundle，需要安装以下软件：

-   [Node.js](https://nodejs.org/) (已在 v22.19.0 LTS 测试)
-   [NodeCG](https://www.nodecg.dev/docs/installing) (包括 `nodecg-cli`)
-   [Python](https://www.python.org/) (已在 v3.13 测试)
-   [Git](https://git-scm.com/) (可选，用于项目更新)

## 安装方法

---
### 🔰 轻松上手（推荐）

如果您是初次使用，推荐使用包含所有必需文件的“懒人包”。

1.  访问本仓库的 [**Releases**](https://github.com/lwb058/ptcg-telop/releases) 页面。
2.  从最新版本的`Assets`中，下载`NodeCG_PTCG_vX.X.X.zip`并解压。
3.  (如果尚未安装) 请安装 [Node.js](https://nodejs.org/) 和 [Python](https://www.python.org/)。
4.  双击解压后文件夹中的`install.bat`来执行。所需的组件将会被自动安装。
5.  安装完成后，双击`start.bat`即可启动系统。

---
### 🚀 更新方法

已经在使用旧版本的用户，可以使用“更新补丁”来轻松升级。

1.  访问本仓库的 [**Releases**](https://github.com/lwb058/ptcg-telop/releases) 页面。
2.  从最新版本的`Assets`中，下载`patch_vX.X.X.zip`并解压。
3.  复制解压出来的`assets`和`bundles`这两个文件夹。
4.  将它们直接粘贴到您当前使用的`nodecg`文件夹中，并选择覆盖所有现有文件。

---
### 手动安装

适用于开发者或希望手动配置环境的用户。

1.  **设置 NodeCG** (如果尚未安装):
    ```bash
    # 在任意位置安装 NodeCG
    git clone https://github.com/nodecg/nodecg.git
    cd nodecg
    npm install
    ```

2.  **克隆 PTCG-Telop bundle**:
    将此仓库克隆到 NodeCG 根目录下的 `bundles` 文件夹中。
    ```bash
    cd bundles
    git clone https://github.com/lwb058/ptcg-telop.git
    ```

3.  **安装依赖**:
    返回 NodeCG 根目录，使用 `nodecg-cli` 安装 bundle 的依赖。
    ```bash
    cd ..
    nodecg-cli install ptcg-telop
    ```

4.  **放置资源文件（图像、视频素材）**:
    此 bundle 使用图像和视频文件来显示背景、进化动画等。这些文件不包含在仓库中，需要单独下载。
    1.  访问本仓库的 [**Releases**](https://github.com/lwb058/ptcg-telop/releases) 页面。
    2.  从最新的 release 下载资源包（例如 `assets_v1.0-beta.zip`）。
    3.  解压下载的文件，并将其中的所有文件放置到 `nodecg/assets/ptcg-telop/` 目录下。（如果 `assets/ptcg-telop` 目录不存在，请创建它）

5.  **设置 Python 环境**:
    进入 bundle 的 `python` 目录，并安装所需的库。
    ```bash
    cd bundles/ptcg-telop/python
    pip install -r requirements.txt
    ```
    *如果 `requirements.txt` 不存在，请手动安装 `card_utils_jp.py` 或 `extract_deck_cards_jp.py` 中导入的库（例如 `requests`, `beautifulsoup4` 等）。*

## 使用方法

1.  **启动 NodeCG**:
    在 NodeCG 根目录中执行以下命令。
    ```bash
    nodecg start
    ```

2.  **访问仪表板**:
    在网页浏览器中打开 `http://localhost:9090`。
    将显示名为 `ptcg-telop` 的选项卡，从中可以访问各种控制面板（Master Control, Player L/R 等）。

3.  **基本操作**:
    -   **在玩家面板中设置卡组**:
        1.  在 [宝可梦卡牌游戏官方网站的卡组构筑页面](https://www.pokemon-card.com/deck/) 等处，获取要使用的卡组的“卡组代码”。
        2.  在玩家面板的 `DeckID` 输入框中输入卡组代码，然后按“Set”按钮。
        3.  系统将自动获取卡牌信息，并构建/更新数据库。
        4.  之后，从下拉菜单中选择宝可梦，并将其放置到场上。
    -   **Master Control 面板**: 对选定的宝可梦执行批量操作，如计算伤害或附加能量。
    -   **操作流程**: 所有操作首先会作为草稿添加到队列中，按下 `Apply` 按钮后才会反映到线上画面。可以按 `Discard` 按钮放弃更改。

4.  **在直播软件中设置画面 (OBS 等)**:
    NodeCG 的图形由多个图层叠加而成。请将以下 URL 作为“浏览器源”添加到 OBS 等直播软件中。

    为获得最佳显示效果，建议在 OBS 的源列表中按以下顺序（顶部为最前层）排列：

    1.  **卡牌展示层**: `http://localhost:9090/bundles/ptcg-telop/graphics/card.html`
    2.  **扩展备战区层**: `http://localhost:9090/bundles/ptcg-telop/graphics/extra.html`
    3.  **主场面层**: `http://localhost:9090/bundles/ptcg-telop/graphics/main.html`

## 注意事项

-   **执行目录**: `nodecg` 命令必须在 NodeCG 的**根目录**下执行。
-   **数据库**: 数据库是通过在玩家面板中设置卡组代码自动生成的。无需手动操作。
-   **操作流程**: 此系统的基本操作流程是“在玩家面板设置个别状态”→“在主控面板选择并批量操作”→“在主控面板应用/放弃”。

## 许可证

该项目根据 MIT 许可证发布。

## 特别鸣谢

本系统的简体中文卡牌数据由 [tcg.mik.moe](https://tcg.mik.moe/) (开发者: [CrystM39](https://space.bilibili.com/1802522475/dynamic)) 提供支持。特此感谢！