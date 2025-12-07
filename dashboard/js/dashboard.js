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
 * Gets the card name for a given slot ID.
 * Relies on `cardDatabase` replicant and slot replicants being in scope.
 * @param {string} slotId - The slot ID (e.g., "slotL0")
 * @returns {string} The card name or 'Pokemon' as fallback
 */
function getCardName(slotId) {
    const db = cardDatabase.value;
    const slotRep = nodecg.Replicant(`draft_${slotId}`);
    if (slotRep && slotRep.value && slotRep.value.cardId && db && db[slotRep.value.cardId]) {
        return db[slotRep.value.cardId].name;
    }
    return 'Pokemon';
}

/**
 * Converts energy identifiers to readable names with grouping by type.
 * Relies on `cardDatabase` and `language` replicants being in scope.
 * @param {Array} energies - Array of energy identifiers
 * @returns {Array} Array of formatted energy names with counts (e.g., ["水 × 2", "悪 × 1"])
 */
function getEnergyNames(energies) {
    if (!energies || energies.length === 0) return [];
    const db = cardDatabase.value;
    const lang = language.value || 'jp';

    // Energy type localization map
    const energyI18n = {
        '草': { jp: '草', en: 'Grass', chs: '草', cht: '草' },
        '炎': { jp: '炎', en: 'Fire', chs: '火', cht: '火' },
        '水': { jp: '水', en: 'Water', chs: '水', cht: '水' },
        '雷': { jp: '雷', en: 'Lightning', chs: '雷', cht: '雷' },
        '超': { jp: '超', en: 'Psychic', chs: '超', cht: '超' },
        '闘': { jp: '闘', en: 'Fighting', chs: '斗', cht: '鬥' },
        '悪': { jp: '悪', en: 'Darkness', chs: '恶', cht: '惡' },
        '鋼': { jp: '鋼', en: 'Metal', chs: '钢', cht: '鋼' },
        '竜': { jp: '竜', en: 'Dragon', chs: '龙', cht: '龍' },
        '無': { jp: '無', en: 'Colorless', chs: '无', cht: '無' }
    };

    // Count energies by type
    const energyCounts = {};
    energies.forEach(energy => {
        let displayName;
        if (energy.startsWith('special:')) {
            const cardId = energy.substring(8);
            displayName = (db && db[cardId]) ? db[cardId].name : 'Special';
        } else {
            // Basic energy - use localized name
            displayName = energyI18n[energy] ? energyI18n[energy][lang] || energy : energy;
        }
        energyCounts[displayName] = (energyCounts[displayName] || 0) + 1;
    });

    // Format as "Type × Count"
    return Object.entries(energyCounts).map(([type, count]) =>
        count > 1 ? `${type} × ${count}` : type
    );
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
 * @param {object} cardDb - The card database object (e.g. cardDatabase.value).
 * @returns {string} The formatted string.
 */
function formatOperation(op, cardDb) {
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


    // Helper to get card name from payload (if enriched) or fallback to looking up cardId
    const getName = (nameInPayload, cardIdFallback) => {
        if (nameInPayload) return nameInPayload;
        if (cardIdFallback && cardDb && cardDb[cardIdFallback]) {
            return cardDb[cardIdFallback].name;
        }
        return cardIdFallback || 'Card';
    };

    switch (type) {
        case 'REMOVE_POKEMON':
            // Old REMOVE ops might not have cardName or cardId.
            return `${side} Remove: ${getName(payload.cardName) === 'Card' ? 'Pokemon' : getName(payload.cardName)} (${getSlotName(payload.target)})`;

        case 'KO_POKEMON':
            // Old KO ops might not have cardName.
            return `${side} KO: ${getName(payload.cardName) === 'Card' ? 'Pokemon' : getName(payload.cardName)} (${getSlotName(payload.target)})`;

        case 'REPLACE_POKEMON':
            const action = payload.actionType || 'Replace';
            // REPLACE usually has cardId in payload even in old versions? 
            // Checking master_panel: queueOperation('REPLACE_POKEMON', { ... cardId: ... })
            return `${side} ${action}: ${getName(payload.targetName, payload.targetCardId)} -> ${getName(payload.cardName, payload.cardId)}`;

        case 'SWITCH_POKEMON':
        case 'APPLY_SWITCH':
            // If enriched, use payload names, else fallback to slot names.
            const sSlot = getSlotName(payload.source);
            const tSlot = getSlotName(payload.target);
            const sNameStr = payload.sourceName ? `${payload.sourceName} (${sSlot})` : sSlot;
            const tNameStr = payload.targetName ? `${payload.targetName} (${tSlot})` : tSlot;

            return `${side} Switch: ${sNameStr} <-> ${tNameStr}`;

        case 'SLIDE_OUT':
            // Usually we don't want to show SLIDE_OUT if we show APPLY_SWITCH, 
            // but if we must, keep it simple.
            return null;

        case 'SET_POKEMON':
            return `${side} Set: ${getName(payload.cardName, payload.cardId)} (${getSlotName(payload.target)})`;

        case 'SET_TOOLS':
            // master_panel: payload.tools (array of IDs).
            let toolDisplay = '';
            if (payload.toolNames) {
                toolDisplay = `(${payload.toolNames.join(', ')})`;
            } else if (payload.tools && Array.isArray(payload.tools)) {
                // Backward compat: lookup IDs
                if (cardDb) {
                    const names = payload.tools.map(id => cardDb[id]?.name || id);
                    toolDisplay = `(${names.join(', ')})`;
                } else {
                    toolDisplay = `(${payload.tools.length} tools)`;
                }
            }
            return `${side} Attach Tools: ${getName(payload.targetName)} ${toolDisplay}`;

        case 'SET_ENERGIES':
            // payload.energies is an array of types/IDs. 
            // We might want to format this nicely if enriched, otherwise just show count/raw.
            // If payload.energyNames exists (enriched), use it.
            let energyDisplay = '';
            if (payload.energyNames) {
                energyDisplay = `(${payload.energyNames.join(', ')})`;
            } else if (payload.energies) {
                // Try to prettify if possible, or just count
                energyDisplay = `(${payload.energies.length} energies)`;
            }
            return `${side} Set Energy: ${getName(payload.targetName)} ${energyDisplay}`;

        case 'SET_DAMAGE':
            return `${side} Damage: ${getName(payload.targetName) || getSlotName(payload.target)} = ${payload.value}`;

        case 'SET_EXTRA_HP':
            return `${side} Extra HP: ${getName(payload.targetName) || getSlotName(payload.target)} = ${payload.value}`;

        case 'SET_AILMENTS':
            return `${side} Ailments: ${getName(payload.targetName) || getSlotName(payload.target)} = [${(payload.ailments || []).join(', ')}]`;

        case 'SET_ABILITY_USED':
            return `${side} Ability Used: ${getName(payload.targetName) || getSlotName(payload.target)} = ${payload.status}`;

        case 'ATTACK':
            const attacker = payload.attackerName || getName(null, payload.attackerCardId) || getSlotName(payload.attackerSlotId);
            const targets = payload.targetNames ? payload.targetNames.join(', ') : 'Opponent';
            let desc = `${side} Attack: ${attacker} uses ${payload.attackName}`;
            if (targets) desc += ` on ${targets}`;
            if (payload.damage > 0) desc += ` for ${payload.damage}`;
            return desc;

        case 'SET_TURN':
            return `${payload.playerName || payload.side}'s Turn`;

        case 'SET_ACTION_STATUS':
            // Extract action type from target (e.g., "action_energy_L" -> "energy")
            const actionMatch = payload.target.match(/action_(\w+)_([LR])/);
            if (actionMatch) {
                const actionType = actionMatch[1]; // energy, supporter, retreat
                const playerSide = actionMatch[2]; // L or R
                const status = payload.status;

                // Get player name if available
                const playerName = payload.playerName || `[${playerSide}]`;

                // Action descriptions
                const actionDescriptions = {
                    energy: status ? 'Manually Attached Energy' : 'Manually Attach Available',
                    supporter: status ? 'Played Supporter' : 'Supporter Available',
                    retreat: status ? 'Retreated Pokemon' : 'Retreat Available'
                };

                const actionDesc = actionDescriptions[actionType] || `${actionType} = ${status}`;
                return `${playerName}: ${actionDesc}`;
            }
            // Fallback for old format
            return `${side} Status: ${payload.target.replace('_', ' ')} = ${payload.status}`;

        case 'SET_SIDES':
            return `${side} Prize Cards: Remaining ${payload.value}`;

        case 'SET_STADIUM':
            return `Stadium: Set to ${payload.cardName || getName(null, payload.cardId) || 'None'}`;

        case 'SET_STADIUM_USED':
            return `Stadium: Used = ${payload.used}`;

        case 'SET_LOST_ZONE':
            return `${side} Lost Zone: ${payload.value}`;

        case 'SET_VSTAR_STATUS':
            return `${side} ${payload.used ? 'Use VSTAR Power' : ' VSTAR Power Available'}`;

        default:
            return `${side} ${type}: ${JSON.stringify(payload)}`;
    }
}

// Make it globally available
window.formatOperation = formatOperation;