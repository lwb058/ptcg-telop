# PTCG-Telop

`PTCG-Telop` is a real-time graphics package for Pokémon TCG live streams, based on the [NodeCG](https://www.nodecg.dev/) framework.

It allows for real-time management of player board states (HP, damage, energy, tools, special conditions, etc.) and displays them as an overlay on the stream. Designed with operational safety as a top priority, it uses a workflow where all operations are first queued as a "draft" and then applied to the "live" screen in a batch after confirmation.

## Main Features

-   **Detailed Board Management for Each Player**: Individually manage each player's Active and Benched Pokémon.
-   **Batch Operations via Master Control Panel**: Efficiently perform actions like attaching energy or calculating damage for multiple Pokémon.
-   **Safe Broadcasting**: A two-step "draft" and "live" update system prevents operational mistakes from being immediately reflected on the live broadcast.
-   **Card Database Generation via Python Scripts**: Automatically extracts necessary card information from deck lists to build a database.
-   **Flexible State Management**: Flexibly set damage, extra HP, energy, tools, and special conditions (like Poison, Burn, Sleep, etc.).

## Screenshots

<img width="1920" height="1080" alt="Screenshot 2025-09-02 14-36-42" src="https://github.com/user-attachments/assets/776332a4-29ee-46a7-bfb4-e97b4e49c82d" />

## Prerequisites

The following software must be installed to run this bundle.

-   [Node.js](https://nodejs.org/) (Tested on v22.19.0 LTS)
-   [Python](https://www.python.org/) (Tested on v3.13)
-   [Git](https://git-scm.com/) (Optional. Used for project updates)

## Installation

---
### 🐳 Docker Deployment (Recommended / Easiest)

This is the easiest way to launch and run without any environment setup.

1. Install and run [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Download `Docker_Deploy.zip` from the [Releases](https://github.com/lwb058/ptcg-telop/releases) page and unzip it into an empty folder.
3. Double-click `start_docker.bat` (Windows) or `start_docker.command` (Mac) inside the folder to run it.
4. Once started, access `http://localhost:9090` in your browser.

---
### 🔰 Direct Install (Without Docker)

This method sets up Node.js and Python environments directly on your PC.

1.  Go to the [**Releases**](https://github.com/lwb058/ptcg-telop/releases) page of this repository.
2.  From the `Assets` section of the latest release, download `NodeCG_PTCG_vX.X.X.zip` and unzip it.
3.  (If you haven't already) Install [Node.js](https://nodejs.org/) and [Python](https://www.python.org/). **[Important] When installing Python, make sure to check the `Add Python to PATH` checkbox on the first screen of the installer.**
4.  Double-click `install.bat` inside the unzipped folder to run it. This will automatically install all necessary components.
5.  After the installation is complete, double-click `start.bat` to launch the system.

---
### 🚀 How to Update

> **[Important]**
> Due to fundamental changes in the data logic, users updating from a version prior to v1.5.0 must delete the existing database to avoid compatibility issues and unexpected bugs.
> After updating, please go to the **SETTINGS panel** and click the "**Clear Database**" button to do so.

If you are already using an older version, you can easily update using the "Patch File".

1.  Go to the [**Releases**](https://github.com/lwb058/ptcg-telop/releases) page of this repository.
2.  From the `Assets` section of the latest release, download `patch_vX.X.X.zip` and unzip it.
3.  Copy the `assets` and `bundles` folders from inside.
4.  Paste them directly into your current `nodecg` folder, overwriting all existing files.

---
### Manual Installation

For developers or those who prefer to set up the environment manually.

1.  **Create Host Directory and Install NodeCG**:
    Create a host directory in a location of your choice and install NodeCG as an npm dependency.
    ```bash
    mkdir nodecg && cd nodecg
    npm init -y
    npm install nodecg@2.6.4
    ```

2.  **Clone the PTCG-Telop Bundle**:
    Create a `bundles` folder inside the host directory and clone this repository.
    ```bash
    mkdir bundles && cd bundles
    git clone https://github.com/lwb058/ptcg-telop.git
    ```

3.  **Install Bundle Dependencies**:
    Install dependencies inside the bundle directory.
    ```bash
    cd ptcg-telop
    npm install
    ```

4.  **Place Assets (Image/Video Files)**:
    This bundle uses image and video files for backgrounds, evolution animations, etc. These are not included in the repository and must be downloaded separately.
    1.  Go to the [**Releases**](https://github.com/lwb058/ptcg-telop/releases) page of this repository.
    2.  Download the asset package (e.g., `assets_v1.0-beta.zip`) from the latest release.
    3.  Unzip the downloaded file and place all its contents into the `assets/ptcg-telop/` directory under the host directory. (If the `assets/ptcg-telop` directory does not exist, please create it).

5.  **Set up Python Environment**:
    Navigate to the bundle's `python` directory and install the required libraries.
    ```bash
    cd bundles/ptcg-telop/python
    pip install -r requirements.txt
    ```
    *If `requirements.txt` does not exist, please manually install the libraries imported in `card_utils_jp.py` or `extract_deck_cards_jp.py` (e.g., `requests`, `beautifulsoup4`).*

## Directory Structure

This project is intended to be placed within NodeCG's `bundles` directory. The roles of the main files and directories are as follows.

```
nodecg/                            (Host runtime directory)
├── package.json                   (Host package.json)
├── node_modules/
│   └── nodecg/                    (NodeCG core, installed via npm)
├── assets/
│   └── ptcg-telop/
│       ├── element/               (Folder for UI elements)
│       ├── icons/                 (Folder for energy, condition icons, etc.)
│       ├── fx/                    (Folder for effect videos)
│       ├── font/                  (Folder for fonts)
│       ├── card_img_*/            (Auto-created folder for card images)
│       └── database_*.json        (Auto-created file for the card database)
├── bundles/
│   └── ptcg-telop/
│       ├── dashboard/             (Panels for the dashboard)
│       ├── graphics/              (Graphics to be displayed on stream)
│       ├── extension/             (Server-side logic)
│       ├── python/                (Scripts for fetching card information)
│       ├── i18n/                  (Files for multi-language support)
│       ├── package.json           (Bundle configuration file)
│       └── Other files
├── cfg/                           (Configuration files)
├── db/                            (Database)
└── logs/                          (Log files)
```

-   **`assets/ptcg-telop/`**: A place to put background images, videos, etc., used in the stream.
-   **`dashboard/`**: The files for the control panels accessed at `http://localhost:9090`.
-   **`graphics/`**: The graphic screen files to be imported into software like OBS.
-   **`python/`**: Scripts for fetching card information from deck codes and generating the database.

## Usage

1.  **Start the System**:
    -   **For Easy Install Package Users**: Double-click `start.bat` to launch.
    -   **For Manual Installers**: Run the following command in the host directory.
    ```bash
    node node_modules/nodecg/index.js
    ```

2.  **Access the Dashboard**:
    Open `http://localhost:9090` in a web browser.
    A tab named `ptcg-telop` will appear, giving you access to the various control panels (Master Control, Player L/R, etc.).

3.  **Basic Operation**:
    -   **Set Deck in Player Panel**:
        1.  Obtain a "Deck Code" for the deck you want to use from a site like the [official Pokémon TCG Deck Construction page](https://www.pokemon-card.com/deck/).
        2.  Enter the deck code into the `DeckID` input field in the Player Panel and press the "Set" button.
        3.  The system will automatically fetch the card information and build/update the database.
        4.  You can then select Pokémon from the drop-down menus to place them on the board.
    -   **Master Control Panel**: Perform batch operations like damage calculation or energy attachment on selected Pokémon.
    -   **Operational Flow**: All operations are first added to a draft queue. They are reflected on the live screen only when the `Apply` button is pressed. They can be discarded with the `Discard` button.

4.  **Stream Software Setup (OBS, etc.)**:
    NodeCG's graphics are composed of multiple layers. Please add the following URLs as "Browser Sources" in your streaming software (like OBS).

    For optimal display, it is recommended to arrange the sources in the following order in your OBS source list (top is frontmost):

    1.  **Card Display Layer**: `http://localhost:9090/bundles/ptcg-telop/graphics/card.html`
    2.  **Extra Bench Layer**: `http://localhost:9090/bundles/ptcg-telop/graphics/extra.html`
    3.  **Main Board Layer**: `http://localhost:9090/bundles/ptcg-telop/graphics/main.html`

## Notes

-   **Execution Directory**: The start command must be run from the NodeCG **host directory** (the directory containing `package.json`).
-   **Database**: The database is generated automatically by setting a deck code in the Player Panel. No manual operation is needed.
-   **Operational Flow**: The basic workflow of this system is: "Set individual states in the Player Panel" -> "Select and perform batch operations in the Master Panel" -> "Apply/Discard in the Master Panel".

## License

This project is released under the MIT License.

## Special Thanks

The Simplified Chinese card database for this system is provided by [tcg.mik.moe](https://tcg.mik.moe/) (Developer: [CrystM39](https://x.com/CrystM39)). We extend our heartfelt thanks.