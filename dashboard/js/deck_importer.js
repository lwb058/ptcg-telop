/**
 * Shared module for handling deck/card imports.
 * It sets up event listeners for an input field and a button,
 * sends an import message to the backend, and handles loading status UI updates.
 */
function setupDeckImporter({ side, inputId, buttonId, onDeckIdChange }) {
    const upperCaseSide = side.toUpperCase();
    const inputEl = document.getElementById(inputId);
    const buttonEl = document.getElementById(buttonId);

    if (!inputEl || !buttonEl) {
        console.error(`Deck importer setup failed for side ${side}: Elements not found.`);
        return;
    }

    const deckLoadingStatus = nodecg.Replicant('deckLoadingStatus');

    // Function to handle the import logic
    function handleImport() {
        const code = inputEl.value.trim();
        if (!code) {
            alert('Please enter a Deck ID or Card ID.');
            return;
        }

        // Optional callback for when the deck ID is set, used by player panels.
        if (onDeckIdChange) {
            onDeckIdChange(code);
        }

        nodecg.sendMessage('importDeckOrCard', { side: upperCaseSide, code: code })
            .then(() => {
                // Clear input only on success if it's not a player panel
                if (!onDeckIdChange) {
                    inputEl.value = '';
                }
            })
            .catch(err => {
                console.error(`Import failed for side ${upperCaseSide}:`, err);
                alert(`Failed to import: ${err.error || err.message || 'Unknown error'}`);
            });
    }

    // Attach event listeners
    buttonEl.addEventListener('click', handleImport);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleImport();
        }
    });

    // Listen for loading status changes
    deckLoadingStatus.on('change', (newStatus) => {
        const isLoading = newStatus.loading;
        const statusSide = newStatus.side; // The side that is currently loading

        // In deck_viewer, we might disable both. In player_panel, only one side exists.
        const isThisPanelLoading = isLoading && statusSide === upperCaseSide;
        const isAnotherPanelLoading = isLoading && statusSide !== upperCaseSide;

        buttonEl.disabled = isLoading;
        inputEl.disabled = isLoading;

        if (isThisPanelLoading) {
            const percentage = newStatus.percentage || 0;
            buttonEl.textContent = `${percentage.toFixed(0)}%`;
        } else if (isAnotherPanelLoading) {
            buttonEl.textContent = 'Loading...';
        } else {
            buttonEl.textContent = 'Import';
        }
    });
}
