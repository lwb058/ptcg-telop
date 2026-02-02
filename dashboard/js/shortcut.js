/**
 * Initializes the Shortcut Module logic.
 * Decouples logic from master_panel.html.
 * 
 * @param {Object} ctx - Dependency injection context
 * @param {Array} ctx.slots - Array of slot Replicants
 * @param {Object} ctx.selections - Selections Replicant
 * @param {Object} ctx.cardDatabase - Card Database Replicant
 * @param {Function} ctx.getI18nText - Function to get i18n text
 * @param {Function} ctx.queueOrUpdateOperation - Function to queue/update operations
 * @param {Function} ctx.queueOperation - Function to queue operations (KO, etc.)
 * @param {Function} ctx.getCardName - Function to get card name
 * @param {HTMLElement} ctx.selectRondoBtn - Button element for Rondo
 * @param {HTMLElement} ctx.selectMyriadBtn - Button element for Myriad Leaf Shower
 * @param {HTMLElement} ctx.btnSelectFreezingShroud - Button element for Freezing Shroud
 * @param {HTMLElement} ctx.damageInput - Damage input element
 * @returns {Object} Publicly exposed update functions { updateRondoButton, updateMyriadButton }
 */
window.initShortcutModule = function (ctx) {
    const {
        slots,
        selections,
        cardDatabase,
        getI18nText,
        queueOrUpdateOperation,
        queueOperation,
        getCardName,
        selectRondoBtn,
        selectMyriadBtn,
        btnSelectFreezingShroud,
        damageInput
    } = ctx;

    // --- Rondo Button Logic ---
    function updateRondoButton() {
        if (!selectRondoBtn) return;

        // Count all bench pokemon (indices 1-8 and 10-17)
        // slots 0-8 are L, 9-17 are R.
        // Bench L: 1-8, Bench R: 10-17

        let benchCount = 0;

        // Helper to check if a slot index is occupied
        const isOccupied = (index) => {
            const slot = slots[index];
            return slot && slot.value && slot.value.cardId;
        };

        // Check Left Bench (1-8)
        for (let i = 1; i <= 8; i++) {
            if (isOccupied(i)) benchCount++;
        }

        // Check Right Bench (10-17)
        for (let i = 10; i <= 17; i++) {
            if (isOccupied(i)) benchCount++;
        }

        const damage = 20 + (benchCount * 20);
        const name = getI18nText('rondo');
        selectRondoBtn.textContent = `${name}: ${damage}`;
        selectRondoBtn.dataset.damageValue = damage;
    }

    if (selectRondoBtn) {
        selectRondoBtn.addEventListener('click', () => {
            const damage = parseInt(selectRondoBtn.dataset.damageValue, 10);
            if (!isNaN(damage)) {
                damageInput.value = damage;
            }
        });
    }

    // --- Myriad Leaf Shower Button Logic ---
    function updateMyriadButton() {
        if (!selectMyriadBtn) return;

        const slotL0 = slots.find(s => s.name === 'draft_slotL0');
        const slotR0 = slots.find(s => s.name === 'draft_slotR0');

        const energyCountL = (slotL0 && slotL0.value && slotL0.value.attachedEnergy) ? slotL0.value.attachedEnergy.length : 0;
        const energyCountR = (slotR0 && slotR0.value && slotR0.value.attachedEnergy) ? slotR0.value.attachedEnergy.length : 0;

        const totalEnergy = energyCountL + energyCountR;
        const damage = 30 + (totalEnergy * 30);

        const name = getI18nText('myriad_leaf_shower');
        selectMyriadBtn.textContent = `${name}: ${damage}`;
        selectMyriadBtn.dataset.damageValue = damage;
    }

    if (selectMyriadBtn) {
        selectMyriadBtn.addEventListener('click', () => {
            const damage = parseInt(selectMyriadBtn.dataset.damageValue, 10);
            if (!isNaN(damage)) {
                damageInput.value = damage;
            }
        });
    }

    // --- Freezing Shroud / Frosty Mystery Logic ---
    if (btnSelectFreezingShroud) {
        btnSelectFreezingShroud.addEventListener('click', () => {
            const db = cardDatabase.value;
            if (!db) return;

            const froslassName = getI18nText('card_name_froslass');

            slots.forEach(slot => {
                if (slot.value && slot.value.cardId) {
                    const card = db[slot.value.cardId];
                    // Check: Not Froslass AND Has Ability
                    if (card && card.name !== froslassName && card.pokemon && card.pokemon.abilities && card.pokemon.abilities.length > 0) {
                        const targetId = slot.name.replace('draft_', '');
                        const currentDamage = slot.value.damage || 0;
                        queueOrUpdateOperation('SET_DAMAGE', {
                            target: targetId,
                            value: currentDamage + 10,
                            targetName: getCardName(targetId)
                        });
                    }
                }
            });
        });
    }

    return {
        updateRondoButton,
        updateMyriadButton
    };
};
