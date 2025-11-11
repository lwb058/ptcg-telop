// --- Global Replicant Declarations ---
var playerName, deckId, draft_side, draft_lostZone, deck, cardDatabase, selections, 
    operationQueue, draft_currentTurn, draft_action_energy, draft_action_supporter, 
    draft_action_retreat, settingsRep, draft_vstar, deckLoadingStatus, i18nStrings, 
    language, assetPaths, cardToShowL, cardToShowR, draft_slot0;

function setupPlayerPanel(side) {
    const upperCaseSide = side.toUpperCase();
    const lowerCaseSide = side.toLowerCase();

    /**
     * This script manages the control panel for a player.
     * - Listens to 'draft_' Replicants to provide instant UI feedback.
     * - All actions generate commands sent to the backend queue.
     * - Binds two-way with the 'selections' Replicant.
     */
    NodeCG.waitForReplicants(
        nodecg.Replicant(`player${upperCaseSide}_name`),
        nodecg.Replicant(`deckId${upperCaseSide}`),
        nodecg.Replicant(`deck${upperCaseSide}`),
        nodecg.Replicant('cardDatabase'),
        nodecg.Replicant('selections'),
        nodecg.Replicant('operationQueue'),
        nodecg.Replicant('draft_currentTurn'),
        nodecg.Replicant(`draft_action_energy_${upperCaseSide}`),
        nodecg.Replicant(`draft_action_supporter_${upperCaseSide}`),
        nodecg.Replicant(`draft_action_retreat_${upperCaseSide}`),
        nodecg.Replicant(`draft_side${upperCaseSide}`),
        nodecg.Replicant(`draft_lostZone${upperCaseSide}`),
        nodecg.Replicant('ptcg-settings'),
        nodecg.Replicant(`draft_vstar_${upperCaseSide}`),
        nodecg.Replicant('deckLoadingStatus'),
        nodecg.Replicant('i18nStrings'),
        nodecg.Replicant('language'),
        nodecg.Replicant('assetPaths'),
        nodecg.Replicant('cardToShowL'),
        nodecg.Replicant('cardToShowR'),
        ...Array(9).fill(0).map((_, i) => nodecg.Replicant(`draft_slot${upperCaseSide}${i}`))
    ).then(() => {
        // --- Replicant Assignments ---
        playerName = nodecg.Replicant(`player${upperCaseSide}_name`);
        deckId = nodecg.Replicant(`deckId${upperCaseSide}`);
        draft_side = nodecg.Replicant(`draft_side${upperCaseSide}`);
        draft_lostZone = nodecg.Replicant(`draft_lostZone${upperCaseSide}`);
        deck = nodecg.Replicant(`deck${upperCaseSide}`);
        cardDatabase = nodecg.Replicant('cardDatabase');
        selections = nodecg.Replicant('selections');
        operationQueue = nodecg.Replicant('operationQueue');
        draft_currentTurn = nodecg.Replicant('draft_currentTurn');
        draft_action_energy = nodecg.Replicant(`draft_action_energy_${upperCaseSide}`);
        draft_action_supporter = nodecg.Replicant(`draft_action_supporter_${upperCaseSide}`);
        draft_action_retreat = nodecg.Replicant(`draft_action_retreat_${upperCaseSide}`);
        settingsRep = nodecg.Replicant('ptcg-settings');
        draft_vstar = nodecg.Replicant(`draft_vstar_${upperCaseSide}`);
        deckLoadingStatus = nodecg.Replicant('deckLoadingStatus');
        i18nStrings = nodecg.Replicant('i18nStrings');
        language = nodecg.Replicant('language');
        assetPaths = nodecg.Replicant('assetPaths');
        cardToShowL = nodecg.Replicant('cardToShowL');
        cardToShowR = nodecg.Replicant('cardToShowR');

        draft_slot0 = nodecg.Replicant(`draft_slot${upperCaseSide}0`);

        // --- DOM Elements ---
        const playerNameInput = document.getElementById(`player-name-${lowerCaseSide}`);
        const deckIdInput = document.getElementById(`deck-id-${lowerCaseSide}`);
        const setDeckBtn = document.getElementById(`set-deck-btn-${lowerCaseSide}`);
        const energyCheck = document.getElementById(`action-energy-${lowerCaseSide}`);
        const supporterCheck = document.getElementById(`action-supporter-${lowerCaseSide}`);
        const retreatCheck = document.getElementById(`action-retreat-${lowerCaseSide}`);
        const remainSideContainer = document.getElementById(`remain-side-${lowerCaseSide}-container`);
        const vstarContainer = document.getElementById(`vstar-container-${lowerCaseSide}`);
        const vstarCheckbox = document.getElementById(`vstar-used-${lowerCaseSide}`);
        const lostZoneInput = document.getElementById(`lost-zone-${lowerCaseSide}`);
        const pokemonSlotsContainer = document.getElementById(`pokemon-slots-container-${lowerCaseSide}`);
        const extraBenchContainer = document.getElementById(`extra-bench-container-${lowerCaseSide}`);
        const toggleExtraBenchBtn = document.getElementById(`toggle-extra-bench-${lowerCaseSide}`);

        // --- Deck Importer Setup ---
        setupDeckImporter({
            side: upperCaseSide,
            inputId: `deck-id-${lowerCaseSide}`,
            buttonId: `set-deck-btn-${lowerCaseSide}`,
            onDeckIdChange: (newDeckId) => {
                deckId.value = newDeckId;
            }
        });

        // --- Lost Zone Shortcut Buttons ---
        document.getElementById(`lost-zone-${lowerCaseSide}-plus1`).addEventListener('click', () => addLostZone(1));
        document.getElementById(`lost-zone-${lowerCaseSide}-plus2`).addEventListener('click', () => addLostZone(2));
        document.getElementById(`lost-zone-${lowerCaseSide}-plus3`).addEventListener('click', () => addLostZone(3));

        function addLostZone(amount) {
            const currentValue = parseInt(lostZoneInput.value, 10) || 0;
            lostZoneInput.value = currentValue + amount;
            lostZoneInput.dispatchEvent(new Event('change')); // Trigger change to update replicant
        }

        const extraBenchVisible = nodecg.Replicant('extraBenchVisible');
        const visibilityKey = lowerCaseSide === 'l' ? 'left' : 'right';

        // --- Extra Bench Toggle --- 
        extraBenchVisible.on('change', (newValue) => {
            const isVisible = newValue ? newValue[visibilityKey] : false;
            toggleExtraBenchBtn.textContent = isVisible ? 'Hide' : 'Show';
            toggleExtraBenchBtn.classList.toggle('btn-primary', isVisible);
        });

        toggleExtraBenchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentVisibility = extraBenchVisible.value || { left: false, right: false };
            extraBenchVisible.value = {
                ...currentVisibility,
                [visibilityKey]: !currentVisibility[visibilityKey]
            };
        });


        // --- Turn Highlight Logic ---
        function updateTurnHighlight(currentTurn) {
            document.body.classList.toggle('is-inactive', currentTurn !== upperCaseSide);
        }
        draft_currentTurn.on('change', updateTurnHighlight);
        updateTurnHighlight(draft_currentTurn.value); // Initial call

        // --- Side Area Management ---
        function renderSideButtons(remaining) {
            const label = remainSideContainer.querySelector('label');
            remainSideContainer.innerHTML = '';
            remainSideContainer.appendChild(label);

            for (let i = 6; i >= 0; i--) {
                const wrapper = document.createElement('label');
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = `remain-side-${lowerCaseSide}`;
                radio.value = i;
                if (i === remaining) {
                    radio.checked = true;
                }
                radio.addEventListener('change', () => {
                    queueOrUpdateOperation('SET_SIDES', { 
                        target: `side${upperCaseSide}`, 
                        value: parseInt(radio.value, 10) 
                    });
                });
                wrapper.appendChild(radio);
                wrapper.appendChild(document.createTextNode(` ${i}`));
                remainSideContainer.appendChild(wrapper);
            }
        }

        draft_side.on('change', (newValue) => {
            renderSideButtons(newValue);
        });

        draft_lostZone.on('change', (newValue) => {
            lostZoneInput.value = newValue;
        });

        // --- Player Name Management ---
        playerName.on('change', (newName) => {
            if (playerNameInput.value !== newName) {
                playerNameInput.value = newName || '';
            }
        });

        deckId.on('change', (newId) => {
            if (deckIdInput.value !== newId) {
                deckIdInput.value = newId || '';
            }
        });

        playerNameInput.addEventListener('change', () => {
            playerName.value = playerNameInput.value;
        });

        lostZoneInput.addEventListener('change', () => {
            queueOrUpdateOperation('SET_LOST_ZONE', { 
                target: `lostZone${upperCaseSide}`, 
                value: parseInt(lostZoneInput.value, 10) || 0 
            });
        });

        // --- VSTAR Management ---
        settingsRep.on('change', (newVal) => {
            const vstarContainer = document.getElementById(`vstar-container-${lowerCaseSide}`);
            if (newVal && newVal.vstarEnabled) {
                vstarContainer.classList.remove('hidden');
            } else {
                vstarContainer.classList.add('hidden');
            }

            const lostZoneContainer = document.getElementById(`lost-zone-${lowerCaseSide}`).parentElement;
            if (newVal && newVal.lostZoneEnabled) {
                lostZoneContainer.classList.remove('hidden');
            } else {
                lostZoneContainer.classList.add('hidden');
            }
        });

        draft_vstar.on('change', (newVal) => {
            vstarCheckbox.checked = newVal;
        });

        vstarCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            queueOrUpdateOperation('SET_VSTAR_STATUS', {
                target: `vstar_${upperCaseSide}`,
                used: isChecked
            });
        });


        // --- Action Status Management ---
        const createActionHandler = (actionType) => {
            return (event) => {
                const isChecked = event.target.checked;
                queueOrUpdateOperation('SET_ACTION_STATUS', { 
                    target: `action_${actionType}_${upperCaseSide}`,
                    status: isChecked 
                });
            };
        };

        draft_action_energy.on('change', (newVal) => { energyCheck.checked = newVal; });
        draft_action_supporter.on('change', (newVal) => { supporterCheck.checked = newVal; });
        draft_action_retreat.on('change', (newVal) => { retreatCheck.checked = newVal; });

        energyCheck.addEventListener('change', createActionHandler('energy'));
        supporterCheck.addEventListener('change', createActionHandler('supporter'));
        retreatCheck.addEventListener('change', createActionHandler('retreat'));

        function renderSlot(index, slotData, currentDeck, db) {
            const slotEl = document.getElementById(`slot-${upperCaseSide}${index}`);
            if (!slotEl) return;

            // Guard clause to prevent rendering if the database isn't ready.
            if (!db) {
                // console.log(`renderSlot(${index}): db not ready.`);
                return;
            }

            slotEl.style.backgroundColor = '';

            const pokemonView = slotEl.querySelector('.pokemon-view');
            const emptyView = slotEl.querySelector('.empty-view');

            if (!slotData || !slotData.cardId) {
                pokemonView.classList.add('hidden');
                emptyView.classList.remove('hidden');
                return;
            }

            emptyView.classList.add('hidden');
            pokemonView.classList.remove('hidden');

            const cardInfo = db[slotData.cardId];

            const swapBtn = pokemonView.querySelector('.swap-btn');
            if (swapBtn) {
                if (index === 0) {
                    swapBtn.textContent = getI18nText('retreat');
                    swapBtn.setAttribute('data-bs-toggle', 'dropdown');
                    swapBtn.classList.add('dropdown-toggle');
                    swapBtn.classList.remove('promote-btn');
                } else {
                    const battleSlotData = draft_slot0.value;
                    const isBattleSlotEmpty = !battleSlotData || !battleSlotData.cardId;
                    
                    if (isBattleSlotEmpty) {
                        swapBtn.textContent = getI18nText('promote');
                        swapBtn.removeAttribute('data-bs-toggle');
                        swapBtn.classList.remove('dropdown-toggle');
                        swapBtn.classList.add('promote-btn');
                    } else {
                        swapBtn.textContent = getI18nText('move');
                        swapBtn.setAttribute('data-bs-toggle', 'dropdown');
                        swapBtn.classList.add('dropdown-toggle');
                        swapBtn.classList.remove('promote-btn');
                    }
                }
            }
            const typeColorMap = settingsRep.value?.typeColorMap || {};

            if (cardInfo && cardInfo.pokemon && cardInfo.pokemon.color && cardInfo.pokemon.color.length > 0) {
                const primaryType = cardInfo.pokemon.color[0];
                const colorSetting = typeColorMap[primaryType];
                
                if (colorSetting) {
                    let finalColor = '';
                    if (typeof colorSetting === 'string') {
                        finalColor = hexToRgba(colorSetting, 1.0);
                    } else if (typeof colorSetting === 'object' && colorSetting.color) {
                        finalColor = hexToRgba(colorSetting.color, colorSetting.opacity);
                    }
                    
                    if (finalColor) {
                        slotEl.style.backgroundColor = finalColor;
                    }
                }
            }
            
            if (!cardInfo || !cardInfo.pokemon) {
                pokemonView.querySelector('.name').textContent = 'Error: Invalid Card Data';
                return;
            }

            pokemonView.querySelector('.name').textContent = cardInfo.name || 'Unknown Name';
            const baseHp = parseInt(cardInfo.pokemon.hp || 0, 10);
            const extraHp = parseInt(slotData.extraHp || 0, 10);
            const damage = parseInt(slotData.damage || 0, 10);
            const currentHp = (baseHp + extraHp) - damage;
            pokemonView.querySelector('.hp-remain').textContent = `HP: ${currentHp}`;

            const koCheckbox = pokemonView.querySelector('.ko-checkbox');
            koCheckbox.checked = slotData.isKO || false;

            const abilityCheckboxWrapper = pokemonView.querySelector('.ability-checkbox-wrapper');
            const hasAbility = cardInfo.pokemon.abilities && cardInfo.pokemon.abilities.length > 0;

            if (hasAbility) {
                abilityCheckboxWrapper.classList.remove('hidden');
                const supportedLangs = ['jp', 'en', 'chs', 'cht'];
                const currentLang = language.value;
                const langSuffix = (currentLang && supportedLangs.includes(currentLang)) ? `${currentLang}` : '';
                const abilityIconSrc = `/assets/ptcg-telop/element/ability_${langSuffix}.png`;
                abilityCheckboxWrapper.innerHTML = `<img src="${abilityIconSrc}" class="ability-icon ${slotData.abilityUsed ? 'used' : ''}" title="Toggle Ability Used">`;
            } else {
                abilityCheckboxWrapper.innerHTML = '';
                abilityCheckboxWrapper.classList.add('hidden');
            }
            
            pokemonView.querySelector('.damage-input').value = slotData.damage || 0;
            pokemonView.querySelector('.extrahp-input').value = slotData.extraHp || 0;
            
            const toolDisplay = pokemonView.querySelector('.tool-display');
            if (toolDisplay) {
                while (toolDisplay.firstChild) {
                    toolDisplay.removeChild(toolDisplay.firstChild);
                }

                const attachedTools = slotData.attachedToolIds || [];

                if (attachedTools.length > 0) {
                    attachedTools.forEach(toolId => {
                        if (db && db[toolId]) {
                            const toolData = db[toolId];
                            const toolIconDiv = document.createElement('div');
                            toolIconDiv.title = `[${toolData.name}] - Click to remove`;
                            toolIconDiv.className = 'tool-icon-image';
                            const imageUrl = toolData.image_url;
                            const extension = imageUrl ? imageUrl.substring(imageUrl.lastIndexOf('.')) : '.jpg';
                            toolIconDiv.style.backgroundImage = `url('/${assetPaths.value.cardImgPath}${toolId}${extension}')`;
                            toolIconDiv.dataset.toolId = toolId;
                            toolDisplay.appendChild(toolIconDiv);
                        }
                    });
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'tool-placeholder';
                    placeholder.textContent = 'Empty';
                    toolDisplay.appendChild(placeholder);
                }
            }

            const evolutionSelect = pokemonView.querySelector('.evolution-select');
            evolutionSelect.innerHTML = '<option value="">Select...</option>';

            if (currentDeck && currentDeck.cards && db && cardInfo.pokemon) {
                const currentCardName = cardInfo.name;
                const currentCardId = slotData.cardId;
                const currentCardEvolvesFrom = cardInfo.pokemon.evolvesFrom || [];

                const allPokemonInDeck = currentDeck.cards
                    .map(cardId => ({ id: cardId, data: db[cardId] }))
                    .filter(item => item.data && item.data.pokemon && item.data.pokemon.hp && item.id !== currentCardId);

                const evolutions = allPokemonInDeck.filter(item => item.data.pokemon.evolvesFrom?.includes(currentCardName));
                const devolutions = allPokemonInDeck.filter(item => currentCardEvolvesFrom.includes(item.data.name));
                
                const evolutionIds = evolutions.map(p => p.id);
                const devolutionIds = devolutions.map(p => p.id);
                const others = allPokemonInDeck.filter(item => !evolutionIds.includes(item.id) && !devolutionIds.includes(item.id));

                const addOptionsToSelect = (groupLabel, items, actionType) => {
                    if (items.length > 0) {
                        const optgroup = document.createElement('optgroup');
                        optgroup.label = groupLabel;
                        items.forEach(item => {
                            const option = document.createElement('option');
                            option.value = item.id;
                            option.textContent = item.data.name;
                            option.dataset.actionType = actionType;
                            optgroup.appendChild(option);
                        });
                        evolutionSelect.appendChild(optgroup);
                    }
                };

                addOptionsToSelect('-進化-', evolutions, 'Evolve');
                addOptionsToSelect('-退化-', devolutions, 'Devolve');
                addOptionsToSelect('-入替-', others, 'Replace');
            }

            const energyContainer = pokemonView.querySelector('.energy-container');
            energyContainer.innerHTML = '';
            if (slotData.attachedEnergy) {
                slotData.attachedEnergy.forEach((energy, energyIndex) => {
                    let energyEl;
                    if (energy.startsWith('special:')) {
                        const cardId = energy.substring(8);
                        const cardData = db[cardId];
                        energyEl = document.createElement('div');
                        energyEl.className = 'attached-special-energy-icon';
                        energyEl.style.backgroundImage = getCardImageUrl(cardId, true);
                        energyEl.title = cardData ? `Click to remove ${cardData.name}` : 'Click to remove Special Energy';
                    } else {
                        energyEl = document.createElement('img');
                        energyEl.src = `/assets/ptcg-telop/icons/${energy}.png`;
                        energyEl.classList.add('attached-energy-icon');
                        energyEl.title = `Click to remove ${energy}`;
                    }

                    energyEl.addEventListener('click', () => {
                        const currentEnergies = [...(slotData.attachedEnergy || [])];
                        currentEnergies.splice(energyIndex, 1);
                        queueOrUpdateOperation('SET_ENERGIES', { 
                            target: `slot${upperCaseSide}${index}`, 
                            energies: currentEnergies 
                        });
                    });
                    energyContainer.appendChild(energyEl);
                });
            }

            if (index === 0) {
                const ailmentIcons = pokemonView.querySelectorAll('.ailment-icon');
                const currentAilments = slotData.ailments || [];
                ailmentIcons.forEach(icon => {
                    const ailment = icon.dataset.ailment;
                    if (currentAilments.includes(ailment)) {
                        icon.classList.add('active');
                    } else {
                        icon.classList.remove('active');
                    }
                });
            }

            const selectionCheckbox = pokemonView.querySelector('.selection-checkbox');
            selectionCheckbox.checked = selections.value.includes(`slot${upperCaseSide}${index}`);
        }

        function setupSlotEventListeners(index) {
            const slotEl = document.getElementById(`slot-${upperCaseSide}${index}`);
            const slotId = `slot${upperCaseSide}${index}`;

            slotEl.querySelector('.empty-pokemon-select').addEventListener('change', (e) => {
                const newCardId = e.target.value;
                if (newCardId) {
                    queueOperation('SET_POKEMON', { target: slotId, cardId: newCardId });
                    e.target.value = "";
                }
            });

            const pokemonView = slotEl.querySelector('.pokemon-view');
            
            pokemonView.querySelector('.damage-input').addEventListener('change', (e) => {
                queueOrUpdateOperation('SET_DAMAGE', { target: slotId, value: parseInt(e.target.value, 10) || 0 });
            });

            pokemonView.querySelector('.extrahp-input').addEventListener('change', (e) => {
                queueOrUpdateOperation('SET_EXTRA_HP', { target: slotId, value: parseInt(e.target.value, 10) || 0 });
            });

            pokemonView.querySelector('.ability-checkbox-wrapper').addEventListener('click', (e) => {
                const abilityIcon = e.currentTarget.querySelector('.ability-icon');
                if (!abilityIcon) return;

                const currentStatus = abilityIcon.classList.contains('used');
                const newStatus = !currentStatus;

                queueOrUpdateOperation('SET_ABILITY_USED', { target: slotId, status: newStatus });
            });

            const toolDisplay = pokemonView.querySelector('.tool-display');
            if (toolDisplay) {
                toolDisplay.addEventListener('click', (e) => {
                    const clickedIcon = e.target.closest('.tool-icon-image');
                    if (clickedIcon) {
                        const toolIdToRemove = clickedIcon.dataset.toolId;
                        if (toolIdToRemove) {
                            const slotReplicant = nodecg.Replicant(`draft_${slotId}`);
                            const currentTools = slotReplicant.value.attachedToolIds || [];
                            const indexToRemove = currentTools.indexOf(toolIdToRemove);

                            if (indexToRemove > -1) {
                                const newTools = [...currentTools];
                                newTools.splice(indexToRemove, 1);
                                queueOrUpdateOperation('SET_TOOLS', { 
                                    target: slotId, 
                                    tools: newTools 
                                });
                            }
                        }
                    }
                });
            }

            pokemonView.querySelector('.evolution-select').addEventListener('change', (e) => {
                const select = e.target;
                const newCardId = select.value;
                if (newCardId) {
                    const selectedOption = select.options[select.selectedIndex];
                    const actionType = selectedOption.dataset.actionType;
                    
                    queueOperation('REPLACE_POKEMON', { 
                        target: slotId, 
                        cardId: newCardId,
                        actionType: actionType
                    });
                    
                    queueOrUpdateOperation('SET_ABILITY_USED', { target: slotId, status: false });
                    select.value = "";
                }
            });

            pokemonView.querySelector('.remove-btn').addEventListener('click', () => {
                const slotReplicant = nodecg.Replicant(`draft_${slotId}`);
                if (slotReplicant.value && slotReplicant.value.isKO) {
                    queueOperation('KO_POKEMON', { target: slotId });
                } else {
                    queueOperation('REMOVE_POKEMON', { target: slotId });
                }
            });

            const koCheckbox = pokemonView.querySelector('.ko-checkbox');
            koCheckbox.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                queueOrUpdateOperation('SET_KO_STATUS', { target: slotId, status: isChecked });
            });

            if (index > 0) {
                const swapBtn = pokemonView.querySelector('.swap-btn');
                if (swapBtn) {
                    swapBtn.addEventListener('click', (e) => {
                        if (swapBtn.getAttribute('data-bs-toggle') !== 'dropdown') {
                            e.preventDefault();
                            e.stopPropagation();
                            queueOperation('SWITCH_POKEMON', { source: slotId, target: `slot${upperCaseSide}0` });
                        }
                    }, true);
                }
            }

            if (index === 0) {
                const ailmentIcons = pokemonView.querySelectorAll('.ailment-icon');
                ailmentIcons.forEach(icon => {
                    icon.addEventListener('click', () => {
                        const slotReplicant = nodecg.Replicant(`draft_slot${upperCaseSide}${index}`);
                        const currentAilments = [...(slotReplicant.value.ailments || [])];
                        const ailment = icon.dataset.ailment;
                        const ailmentIndex = currentAilments.indexOf(ailment);

                        if (ailmentIndex > -1) {
                            currentAilments.splice(ailmentIndex, 1);
                        } else {
                            currentAilments.push(ailment);
                        }
                        queueOrUpdateOperation('SET_AILMENTS', { target: slotId, ailments: currentAilments });
                    });
                });
            }

            const selectionCheckbox = slotEl.querySelector('.selection-checkbox');
            selectionCheckbox.addEventListener('change', (e) => {
                const currentSelections = selections.value ? [...selections.value] : [];
                const isChecked = e.target.checked;
                const itemIndex = currentSelections.indexOf(slotId);
                if (isChecked && itemIndex === -1) {
                    currentSelections.push(slotId);
                } else if (!isChecked && itemIndex > -1) {
                    currentSelections.splice(itemIndex, 1);
                }
                selections.value = currentSelections;
            });
        }

        function updateAllEmptySlotDropdowns() {
            const currentDeck = deck.value;
            const db = cardDatabase.value;
            if (!currentDeck || !currentDeck.cards || !db || Object.keys(db).length === 0) return;

            const pokemonInDeck = currentDeck.cards
                .map(cardId => ({ id: cardId, data: db[cardId] }))
                .filter(item => item.data && item.data.pokemon && item.data.pokemon.hp);

            pokemonInDeck.sort((a, b) => {
                const isBasicA = a.data.pokemon.evolves === 'たね';
                const isBasicB = b.data.pokemon.evolves === 'たね';

                if (isBasicA && !isBasicB) return -1;
                if (!isBasicA && isBasicB) return 1;

                const hpA = parseInt(a.data.pokemon.hp, 10) || 0;
                const hpB = parseInt(b.data.pokemon.hp, 10) || 0;
                return hpA - hpB;
            });

            const basicPokemon = pokemonInDeck.filter(item => item.data.pokemon.evolves === 'たね');
            const evolvedPokemon = pokemonInDeck.filter(item => item.data.pokemon.evolves !== 'たね');

            document.querySelectorAll('.empty-pokemon-select').forEach(select => {
                const currentValue = select.value;
                select.innerHTML = '<option value="">Select Pokemon</option>';

                if (basicPokemon.length > 0) {
                    const basicOptgroup = document.createElement('optgroup');
                    basicOptgroup.label = '-たね-';
                    basicPokemon.forEach(item => {
                        const option = document.createElement('option');
                        option.value = item.id;
                        const name = item.data.name;
                        const hp = item.data.pokemon.hp;
                        const firstAttackName = item.data.pokemon.attacks && item.data.pokemon.attacks.length > 0
                            ? item.data.pokemon.attacks[0].name
                            : 'No Attack';
                        option.textContent = `${name} (HP${hp}) - ${firstAttackName}`;
                        basicOptgroup.appendChild(option);
                    });
                    select.appendChild(basicOptgroup);
                }

                if (evolvedPokemon.length > 0) {
                    const evolvedOptgroup = document.createElement('optgroup');
                    evolvedOptgroup.label = '-進化-';
                    evolvedPokemon.forEach(item => {
                        const option = document.createElement('option');
                        option.value = item.id;
                        const name = item.data.name;
                        const hp = item.data.pokemon.hp;
                        const firstAttackName = item.data.pokemon.attacks && item.data.pokemon.attacks.length > 0
                            ? item.data.pokemon.attacks[0].name
                            : 'No Attack';
                        option.textContent = `${name} (HP${hp}) - ${firstAttackName}`;
                        evolvedOptgroup.appendChild(option);
                    });
                    select.appendChild(evolvedOptgroup);
                }
                select.value = currentValue;
            });
        };

        function syncCheckboxesWithSelections() {
            const currentSelections = selections.value || [];
            for (let i = 0; i < 9; i++) {
                const slotEl = document.getElementById(`slot-${upperCaseSide}${i}`);
                if (slotEl) {
                    const checkbox = slotEl.querySelector('.selection-checkbox');
                    const isSelected = currentSelections.includes(`slot${upperCaseSide}${i}`);
                    if (checkbox) {
                        checkbox.checked = isSelected;
                    }
                    slotEl.classList.toggle('selected', isSelected);
                }
            }
        }

        draft_slot0.on('change', (newValue) => {
            for (let i = 1; i < 9; i++) {
                const slotReplicant = nodecg.Replicant(`draft_slot${upperCaseSide}${i}`);
                if (slotReplicant.value && slotReplicant.value.cardId) {
                     renderSlot(i, slotReplicant.value, deck.value, cardDatabase.value);
                }
            }
        });

        function populateSwapDropdown(event) {
            const swapButton = event.relatedTarget;
            const sourceSlotEl = swapButton.closest('.pokemon-slot');
            const sourceSlotId = sourceSlotEl.id.replace('-', '');
            const menuEl = sourceSlotEl.querySelector('.swap-menu');
            
            menuEl.innerHTML = '';

            const db = cardDatabase.value;
            if (!db) return;

            for (let i = 0; i < 9; i++) {
                const targetSlotId = `slot${upperCaseSide}${i}`;
                if (sourceSlotId === targetSlotId) continue;

                if (i === 6) {
                    const divider = document.createElement('li');
                    divider.innerHTML = '<hr class="dropdown-divider">';
                    menuEl.appendChild(divider);
                }

                const slotRep = nodecg.Replicant(`draft_${targetSlotId}`);
                const slotData = slotRep.value;
                
                let targetName = `////EMPTY////`;
                if (slotData && slotData.cardId && db[slotData.cardId]) {
                    targetName = db[slotData.cardId].name;
                }

                const li = document.createElement('li');
                const a = document.createElement('a');
                a.classList.add('dropdown-item');
                a.href = '#';
                a.dataset.sourceSlot = sourceSlotId;
                a.dataset.targetSlot = targetSlotId;
                
                let positionLabel = i === 0 ? 'Battle' : `Bench ${i}`;
                a.textContent = `${positionLabel}: ${targetName}`;
                
                li.appendChild(a);
                menuEl.appendChild(li);
            }
        }

        pokemonSlotsContainer.addEventListener('show.bs.dropdown', populateSwapDropdown);
        extraBenchContainer.addEventListener('show.bs.dropdown', populateSwapDropdown);

        const swapClickHandler = function(event) {
            if (event.target.matches('.swap-menu .dropdown-item')) {
                event.preventDefault();
                const source = event.target.dataset.sourceSlot;
                const target = event.target.dataset.targetSlot;
                
                if (source && target) {
                    queueOperation('SWITCH_POKEMON', { source, target });
                }
            }
        };
        pokemonSlotsContainer.addEventListener('click', swapClickHandler);
        extraBenchContainer.addEventListener('click', swapClickHandler);

        deck.on('change', updateAllEmptySlotDropdowns);
        cardDatabase.on('change', (newValue) => {
            updateAllEmptySlotDropdowns();
            if (newValue) { // Only render if the new value is not null/undefined
                for (let i = 0; i < 9; i++) {
                    const slotReplicant = nodecg.Replicant(`draft_slot${upperCaseSide}${i}`);
                    renderSlot(i, slotReplicant.value, deck.value, newValue);
                }
            }
        });
        selections.on('change', syncCheckboxesWithSelections);

        settingsRep.on('change', () => {
            for (let i = 0; i < 9; i++) {
                const slotReplicant = nodecg.Replicant(`draft_slot${upperCaseSide}${i}`);
                renderSlot(i, slotReplicant.value, deck.value, cardDatabase.value);
            }
        });

        for (let i = 0; i < 9; i++) {
            const slotReplicant = nodecg.Replicant(`draft_slot${upperCaseSide}${i}`);
            slotReplicant.on('change', (newValue) => {
                if (renderSlotDebounce[i]) {
                    clearTimeout(renderSlotDebounce[i]);
                }
                renderSlotDebounce[i] = setTimeout(() => {
                    renderSlot(i, newValue, deck.value, cardDatabase.value);
                }, 16);
            });
            renderSlot(i, slotReplicant.value, deck.value, cardDatabase.value);
            setupSlotEventListeners(i);
        }
        
        updateAllEmptySlotDropdowns();
        syncCheckboxesWithSelections();

        let hotkeys = { discard: 'Escape', apply: 'Control+S', clearSelection: 'Delete', clearCard: ' ' };

        settingsRep.on('change', (newValue) => {
            if (newValue && newValue.hotkeys) {
                hotkeys = newValue.hotkeys;
            } else {
                hotkeys = { discard: 'Escape', apply: 'Control+S', clearSelection: 'Delete', clearCard: ' ' };
            }
        });

        if (settingsRep.value && settingsRep.value.hotkeys) {
            hotkeys = settingsRep.value.hotkeys;
        }

        document.addEventListener('keydown', (e) => {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT') {
                return;
            }

            if (checkHotkey(e, hotkeys.discard)) {
                e.preventDefault();
                nodecg.sendMessage('hotkeyFired', 'discard').catch(err => console.error("Error sending discard hotkey signal", err));
            } else if (checkHotkey(e, hotkeys.apply)) {
                e.preventDefault();
                nodecg.sendMessage('hotkeyFired', 'apply').catch(err => console.error("Error sending apply hotkey signal", err));
            } else if (checkHotkey(e, hotkeys.clearSelection)) {
                e.preventDefault();
                selections.value = [];
            } else if (checkHotkey(e, hotkeys.clearCard)) {
                e.preventDefault();
                nodecg.sendMessage('_clearCard').catch(err => console.error("Error sending clearCard signal", err));
            }
        });
    });
}