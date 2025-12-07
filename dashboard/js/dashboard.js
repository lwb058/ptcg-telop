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
 * Checks if a keyboard event matches a hotkey string (e.g., "Shift+S").
 * This is a pure function with no dependencies.
 */
function checkHotkey(e, hotkeyString) {
    if (!hotkeyString || typeof hotkeyString !== 'string') return false;
    if (hotkeyString.toLowerCase() === 'space' || hotkeyString === ' ') {
        return e.key === ' ';
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const parts = hotkeyString.toLowerCase().split('+').map(p => p.trim());
    const key = parts.pop();

    if (e.key.toLowerCase() !== key) return false;

    const configCtrl = parts.includes('ctrl');
    const configAlt = parts.includes('alt');
    const configMeta = parts.includes('meta') || parts.includes('win');
    const configShift = parts.includes('shift'); // Added

    if (isMac) {
        // Mac Mappings:
        // Config Ctrl -> Mac Command (metaKey)
        // Config Alt -> Mac Option (altKey)
        // Config Meta/Win -> Mac Control (ctrlKey)

        if (configCtrl !== e.metaKey) return false;
        if (configAlt !== e.altKey) return false;
        if (configMeta !== e.ctrlKey) return false;
        if (configShift !== e.shiftKey) return false; // Added
    } else {
        // Windows/Linux Mappings (Standard):
        // Config Ctrl -> Ctrl
        // Config Alt -> Alt
        // Config Meta/Win -> Meta (Windows Key)

        if (configCtrl !== e.ctrlKey) return false;
        if (configAlt !== e.altKey) return false;
        if (configMeta !== e.metaKey) return false;
        if (configShift !== e.shiftKey) return false; // Added
    }

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

/**
 * Manages hotkeys for the dashboard panels.
 * Handles keydown events, checks against configured hotkeys, and executes callbacks or sends messages.
 */
class HotkeyManager {
    constructor(nodecg, settingsReplicant) {
        this.nodecg = nodecg;
        this.settingsReplicant = settingsReplicant;
        this.hotkeys = {
            discard: 'Escape',
            apply: 'Shift+S',
            clearSelection: 'Delete',
            clearCard: 'Space',
            peekOpponent: 'Tab'
        };
        this.callbacks = {};
        this.eventListeners = {};
        this.peekOpponentActive = false;

        // Initialize hotkeys from settings
        this._updateHotkeys(this.settingsReplicant.value);

        // Listen for settings changes
        this.settingsReplicant.on('change', (newValue) => {
            this._updateHotkeys(newValue);
            this._emit('hotkeysChanged', this.hotkeys);
        });

        // Listen for keydown events
        document.addEventListener('keydown', (e) => this._handleKeydown(e));
        document.addEventListener('keyup', (e) => this._handleKeyup(e));

        // Listen for global hotkey messages (if this panel should respond to them)
        this.nodecg.listenFor('hotkeyFired', (command) => {
            this._executeCallback(command);
        });
    }

    /**
     * Registers a callback for a specific action or event.
     * Supported actions: 'discard', 'apply', 'clearSelection', 'clearCard'.
     * Supported events: 'hotkeysChanged'.
     */
    on(action, callback) {
        if (!this.callbacks[action]) {
            this.callbacks[action] = [];
        }
        this.callbacks[action].push(callback);
    }

    _updateHotkeys(settings) {
        if (settings && settings.hotkeys) {
            this.hotkeys.discard = settings.hotkeys.discard || 'Escape';
            this.hotkeys.apply = settings.hotkeys.apply || 'Shift+S';
            this.hotkeys.clearSelection = settings.hotkeys.clearSelection || 'Delete';
            this.hotkeys.clearCard = settings.hotkeys.clearCard || ' ';
            this.hotkeys.peekOpponent = settings.hotkeys.peekOpponent || 'Tab';
        } else {
            // Defaults
            this.hotkeys = {
                discard: 'Escape',
                apply: 'Shift+S',
                clearSelection: 'Delete',
                clearCard: 'Space',
                peekOpponent: 'Tab'
            };
        }
    }

    _handleKeydown(e) {
        // Ignore inputs
        if (document.activeElement.tagName === 'INPUT' ||
            document.activeElement.tagName === 'TEXTAREA' ||
            document.activeElement.tagName === 'SELECT') {
            return;
        }

        const autoApplyEnabled = this.settingsReplicant.value && this.settingsReplicant.value.autoApply;

        if (checkHotkey(e, this.hotkeys.discard)) {
            if (autoApplyEnabled) return; // Ignore if auto-apply is enabled
            e.preventDefault();
            this._triggerAction('discard');
        } else if (checkHotkey(e, this.hotkeys.apply)) {
            if (autoApplyEnabled) return; // Ignore if auto-apply is enabled
            e.preventDefault();
            this._triggerAction('apply');
        } else if (checkHotkey(e, this.hotkeys.clearSelection)) {
            e.preventDefault();
            this._triggerAction('clearSelection');
        } else if (checkHotkey(e, this.hotkeys.clearCard)) {
            e.preventDefault();
            this._triggerAction('clearCard');
        } else if (checkHotkey(e, this.hotkeys.peekOpponent)) {
            e.preventDefault();
            if (!this.peekOpponentActive) {
                this.peekOpponentActive = true;
                this._triggerAction('peekOpponent', true);
            }
        }
    }

    _handleKeyup(e) {
        if (checkHotkey(e, this.hotkeys.peekOpponent)) {
            if (this.peekOpponentActive) {
                this.peekOpponentActive = false;
                this._triggerAction('peekOpponent', false);
            }
        }
    }

    _triggerAction(action, data) {
        // If local callbacks exist, execute them.
        // For 'discard' and 'apply', if NO local callbacks exist, send a message to other panels.
        // For 'clearCard', if NO local callbacks exist, send the default _clearCard message.

        if (this.callbacks[action] && this.callbacks[action].length > 0) {
            this._executeCallback(action, data);
        } else {
            // Default behaviors if no local handler is defined
            if (action === 'discard' || action === 'apply' || action === 'clearSelection') {
                this.nodecg.sendMessage('hotkeyFired', action)
                    .catch(err => console.error(`Error sending ${action} hotkey signal`, err));
            } else if (action === 'clearCard') {
                this.nodecg.sendMessage('_clearCard')
                    .catch(err => console.error("Error sending clearCard signal", err));
            }
        }
    }

    _executeCallback(action, data) {
        if (this.callbacks[action]) {
            this.callbacks[action].forEach(cb => cb(data));
        }
    }

    _emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(cb => cb(data));
        }
    }
}

/**
 * Formats an operation object into a human-readable string for display.
 * @param {object} op - The operation object.
 * @param {object} context - Context object containing cardDatabase (optional).
 * @returns {string} The formatted string.
 */
function formatOperation(op) {
    const { type, payload } = op;
    if (!payload) return type;

    const side = payload.target && payload.target.includes('L') ? '[L]' :
        payload.target && payload.target.includes('R') ? '[R]' :
            payload.source && payload.source.includes('L') ? '[L]' :
                payload.source && payload.source.includes('R') ? '[R]' :
                    payload.attackerSlotId && payload.attackerSlotId.includes('L') ? '[L]' :
                        payload.attackerSlotId && payload.attackerSlotId.includes('R') ? '[R]' :
                            payload.side === 'L' ? '[L]' :
                                payload.side === 'R' ? '[R]' : '';

    const getSlotName = (slotId) => {
        if (!slotId) return '';
        const isBattle = slotId.endsWith('0');
        const num = slotId.slice(-1);
        return isBattle ? 'Active' : `Bench ${num}`;
    };

    // Helper to get card name from payload (if enriched) or fallback
    const getName = (nameInPayload) => nameInPayload || 'Unknown Card';

    switch (type) {
        case 'REMOVE_POKEMON':
            return `${side} Remove: ${getName(payload.cardName)} (${getSlotName(payload.target)})`;

        case 'KO_POKEMON':
            return `${side} KO: ${getName(payload.cardName)} (${getSlotName(payload.target)})`;

        case 'REPLACE_POKEMON':
            const action = payload.actionType || 'Replace';
            return `${side} ${action}: ${getName(payload.targetName)} -> ${getName(payload.cardName)}`;

        case 'SWITCH_POKEMON':
        case 'APPLY_SWITCH':
            // Logic to display switch. If enriched, use payload names.
            // If not enriched (old ops), fallback to slot names.
            const sName = payload.sourceName || getSlotName(payload.source);
            const tName = payload.targetName || getSlotName(payload.target);
            return `${side} Switch: ${sName} <-> ${tName}`;

        case 'SLIDE_OUT':
            // Usually we don't want to show SLIDE_OUT if we show APPLY_SWITCH, 
            // but if we must, keep it simple.
            return null; // Return null to indicate it should be skipped/hidden if possible

        case 'SET_POKEMON':
            return `${side} Set: ${getName(payload.cardName)} (${getSlotName(payload.target)})`;

        case 'SET_TOOLS':
            const toolNames = payload.toolNames ? `(${payload.toolNames.join(', ')})` : '';
            return `${side} Attach Tools: ${getName(payload.targetName)} ${toolNames}`;

        case 'SET_ENERGIES':
            // payload.energies is an array of types/IDs. 
            // We might want to format this nicely if enriched, otherwise just show count/raw.
            // If payload.energyNames exists (enriched), use it.
            const energyDisplay = payload.energyNames ? `(${payload.energyNames.join(', ')})` :
                (payload.energies ? `(${payload.energies.length} energies)` : '');
            return `${side} Set Energy: ${getName(payload.targetName)} ${energyDisplay}`;

        case 'SET_DAMAGE':
            return `${side} Damage: ${getName(payload.targetName) || payload.target} = ${payload.value}`;

        case 'SET_EXTRA_HP':
            return `${side} Extra HP: ${getName(payload.targetName) || payload.target} = ${payload.value}`;

        case 'SET_AILMENTS':
            return `${side} Ailments: ${getName(payload.targetName) || payload.target} = [${(payload.ailments || []).join(', ')}]`;

        case 'SET_ABILITY_USED':
            return `${side} Ability Used: ${getName(payload.targetName) || payload.target} = ${payload.status}`;

        case 'ATTACK':
            const attacker = payload.attackerName || getSlotName(payload.attackerSlotId);
            const targets = payload.targetNames ? payload.targetNames.join(', ') : 'Opponent';
            let desc = `${side} Attack: ${attacker} uses ${payload.attackName}`;
            if (targets) desc += ` on ${targets}`;
            if (payload.damage > 0) desc += ` for ${payload.damage}`;
            return desc;

        case 'SET_TURN':
            return `Turn: ${payload.playerName || payload.side}`;

        case 'SET_ACTION_STATUS':
            return `${side} Status: ${payload.target.replace('_', ' ')} = ${payload.status}`;

        case 'SET_SIDES':
            return `${side} Prize Cards: Remaining = ${payload.value}`;

        case 'SET_STADIUM':
            return `Stadium: Set to ${payload.cardName || 'None'}`;

        case 'SET_STADIUM_USED':
            return `Stadium: Used = ${payload.used}`;

        default:
            return `${side} ${type}: ${JSON.stringify(payload)}`;
    }
}

// Make it globally available
window.formatOperation = formatOperation;