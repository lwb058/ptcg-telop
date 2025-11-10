// dashboard/js/dashboard.js

/**
 * This file contains common utility functions for the ptcg-telop dashboard panels.
 * It should be included in the HTML of a panel before any panel-specific scripts.
 * 
 * These functions often rely on replicant variables (e.g., `database`, `i18nStrings`)
 * being declared in the scope of the script that calls them.
 */

/**
 * Gets the internationalized text for a given key.
 * Relies on `i18nStrings` and `language` replicants being in scope.
 */
function getI18nText(key) {
    if (!i18nStrings.value || !i18nStrings.value[key] || !language.value) {
        return key; // Fallback to key name if not found
    }
    return i18nStrings.value[key][language.value] || i18nStrings.value[key]['jp'] || key;
};

/**
 * Constructs the full URL for a card image.
 * Relies on `assetPaths` and `database` replicants being in scope.
 */
const getCardImageUrl = (cardId, isBgImage = false) => {
    if (!cardId || !assetPaths.value || !assetPaths.value.cardImgPath) {
        const defaultPath = '/assets/ptcg-telop/element/default.jpg';
        return isBgImage ? `url(${defaultPath})` : defaultPath;
    }
    const db = cardDatabase.value;
    const cardData = db ? db[cardId] : null;
    const imageUrl = cardData ? cardData.image_url : null;
    const extension = imageUrl ? imageUrl.substring(imageUrl.lastIndexOf('.')) : '.jpg'; // Fallback to .jpg
    const path = `/${assetPaths.value.cardImgPath}${cardId}${extension}`;
    return isBgImage ? `url(${path})` : path;
};

/**
 * Sends an operation to the backend to be added to the queue.
 */
function queueOperation(type, payload) {
    nodecg.sendMessage('queueOperation', { type, payload })
        .catch(e => console.error(`Failed to queue operation ${type}`, e));
}

/**
 * Updates an existing operation in the queue or adds a new one if it doesn't exist.
 * Relies on the `operationQueue` replicant being in scope.
 */
function queueOrUpdateOperation(type, payload) {
    const queue = operationQueue.value;
    if (Array.isArray(queue)) {
        const existingOpIndex = queue.findIndex(op =>
            op.type === type &&
            op.payload.target === payload.target
        );

        if (existingOpIndex > -1) {
            nodecg.sendMessage('updateOperation', { index: existingOpIndex, payload })
                .catch(e => console.error(`Failed to update operation ${type}`, e));
            return;
        }
    }
    queueOperation(type, payload);
}

/**
 * Checks if a keyboard event matches a hotkey string (e.g., "Control+S").
 * This is a pure function with no dependencies.
 */
function checkHotkey(e, hotkeyString) {
    if (!hotkeyString || typeof hotkeyString !== 'string') return false;
    if (hotkeyString.toLowerCase() === 'space' || hotkeyString === ' ') {
        return e.key === ' ';
    }
    const parts = hotkeyString.toLowerCase().split('+').map(p => p.trim());
    const key = parts.pop();
    if (e.key.toLowerCase() !== key) return false;
    if (parts.includes('ctrl') !== e.ctrlKey) return false;
    if (parts.includes('alt') !== e.altKey) return false;
    if (parts.includes('shift') !== e.shiftKey) return false;
    if (parts.includes('meta') !== e.metaKey) return false;
    return true;
}

/**
 * Converts a hex color string to an rgba string.
 */
function hexToRgba(hex, opacity) {
    let c;
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        c = hex.substring(1).split('');
        if (c.length === 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c = '0x' + c.join('');
        return `rgba(${[(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',')},${opacity})`;
    }
    // Return a default color or throw an error if the hex is invalid
    console.error('Bad Hex:', hex);
    return `rgba(255,255,255,${opacity})`; // Fallback to white
}