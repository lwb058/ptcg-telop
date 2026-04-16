/**
 * SlotRenderer — Shared bench/slot rendering logic for main.html and extra.html.
 * Extracted from main.html (ground truth) to eliminate code divergence.
 *
 * Usage:
 *   <script src="slot-renderer.js"></script>
 *   SlotRenderer.init({ cardDatabase, settingsRep, getCardImageUrl, resolveAssetPath });
 */
(function () {
    'use strict';

    // === Constants ===
    const ENERGY_MAP = {
        "草": "草", "炎": "炎", "水": "水", "雷": "雷", "超": "超", "闘": "闘",
        "悪": "悪", "鋼": "鋼", "無": "無", "全": "全", "竜": "竜", "妖": "妖"
    };
    const REPLACE_ANIMATION_HIDE_MS = 550;
    const REPLACE_ANIMATION_SHOW_MS = 700;

    // === Internal State ===
    const evolvingSlots = new Set();
    const koSlots = new Set();
    const removingSlots = new Set();
    const g_attackAnimationTargets = new Set();
    const activeAnimations = new Map();

    // === Dependencies (set via init) ===
    let _cardDatabase = null;
    let _settingsRep = null;
    let _getCardImageUrl = null;
    let _resolveAssetPath = null;

    function init({ cardDatabase, settingsRep, getCardImageUrl, resolveAssetPath }) {
        _cardDatabase = cardDatabase;
        _settingsRep = settingsRep;
        _getCardImageUrl = getCardImageUrl;
        _resolveAssetPath = resolveAssetPath;
    }

    // === Utility ===

    function getEnergyIcon(type) {
        return `<img class="energy-icon" src="/assets/ptcg-telop/icons/${ENERGY_MAP[type] || 'エネなし'}.png">`;
    }

    function sanitizeDamage(damage) {
        if (typeof damage !== 'string') return damage || '';
        return damage.replace(/＋/g, '+').replace(/－/g, '-').replace(/×/g, '×');
    }

    // === Rendering Functions ===

    function animateHp(element, startHp, endHp, startMaxHp, endMaxHp, duration) {
        return new Promise(resolve => {
            if (!element) return resolve();
            if (startHp === endHp && startMaxHp === endMaxHp) {
                element.textContent = `${endHp}/${endMaxHp}`;
                return resolve();
            }
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                const rawCurrentHp = progress * (endHp - startHp) + startHp;
                const rawCurrentMaxHp = progress * (endMaxHp - startMaxHp) + startMaxHp;
                let displayHp, displayMaxHp;
                if (progress < 1) {
                    displayHp = Math.round(rawCurrentHp / 10) * 10;
                    displayMaxHp = Math.round(rawCurrentMaxHp / 10) * 10;
                } else {
                    displayHp = endHp;
                    displayMaxHp = endMaxHp;
                }
                element.textContent = `${displayHp}/${displayMaxHp}`;
                if (progress < 1) {
                    window.requestAnimationFrame(step);
                } else {
                    resolve();
                }
            };
            window.requestAnimationFrame(step);
        });
    }

    function displayHpChangeNumber(targetSlotEl, hpChange) {
        return new Promise(resolve => {
            if (hpChange === 0) return resolve();
            const isHeal = hpChange > 0;
            const number = Math.abs(hpChange);
            const text = isHeal ? `+${number}` : `${-number}`;
            const isBattleSlot = targetSlotEl.classList.contains('active-slot');
            const numberTypeClass = isHeal ? 'heal-number' : 'damage-number';
            const cardImageSelector = '.card-image-area';
            const cardImageEl = targetSlotEl.querySelector(cardImageSelector);
            if (!cardImageEl) return resolve();

            requestAnimationFrame(() => {
                const imageRect = cardImageEl.getBoundingClientRect();
                const slotRect = targetSlotEl.getBoundingClientRect();
                if (imageRect.width === 0) return resolve();
                const numberEl = document.createElement('div');
                numberEl.className = numberTypeClass;
                numberEl.textContent = text;
                const relativeLeft = imageRect.left - slotRect.left + imageRect.width / 2;
                const relativeTop = imageRect.top - slotRect.top + imageRect.height / 2;
                numberEl.style.left = `${relativeLeft}px`;
                numberEl.style.top = `${relativeTop}px`;
                targetSlotEl.appendChild(numberEl);

                if (isBattleSlot && activeAnimations.has(targetSlotEl.id)) {
                    const animationData = activeAnimations.get(targetSlotEl.id);
                    if (animationData.isWeakness && _resolveAssetPath) {
                        const style = getComputedStyle(document.documentElement);
                        const weaknessFile = style.getPropertyValue('--asset-weakness').trim().replace(/['\"]/g, '');
                        const weaknessIconSrc = _resolveAssetPath(weaknessFile);

                        const weaknessIcon = new Image();
                        weaknessIcon.src = weaknessIconSrc;
                        weaknessIcon.className = 'weakness-icon-fx';

                        const appendAndAnimate = () => {
                            weaknessIcon.style.left = `${imageRect.left + imageRect.width / 2}px`;
                            weaknessIcon.style.top = `${imageRect.top + imageRect.height / 2}px`;
                            document.body.appendChild(weaknessIcon);
                            setTimeout(() => weaknessIcon.remove(), 1500);
                        };

                        if (weaknessIcon.complete) {
                            appendAndAnimate();
                        } else {
                            weaknessIcon.onload = appendAndAnimate;
                        }
                    }
                    activeAnimations.delete(targetSlotEl.id);
                }

                setTimeout(() => {
                    numberEl.remove();
                    resolve();
                }, 1500);
            });
        });
    }

    function renderAttachedEnergies(container, energies, iconFn) {
        if (!container || !energies) return;

        const getSpecialIconHtml = (cardId) => {
            const cardData = _cardDatabase.value[cardId];
            const title = cardData ? cardData.name : 'Special Energy';
            const bgImage = _getCardImageUrl(cardId, true);
            return `<div class="attached-special-energy-icon" style="background-image: ${bgImage}" title="${title}"></div>`;
        };

        const energyCounts = energies.reduce((acc, energy) => {
            acc[energy] = (acc[energy] || 0) + 1;
            return acc;
        }, {});

        const totalEnergyCount = energies.length;
        const maxSingleEnergyCount = Object.values(energyCounts).reduce((max, count) => Math.max(max, count), 0);
        const useTypeB = (maxSingleEnergyCount > 1 && totalEnergyCount >= 7) || maxSingleEnergyCount >= 5;

        let html = '';
        if (useTypeB) {
            for (const energy in energyCounts) {
                const count = energyCounts[energy];
                let iconHtml;
                if (energy.startsWith('special:')) {
                    const cardId = energy.substring(8);
                    iconHtml = getSpecialIconHtml(cardId);
                } else {
                    iconHtml = iconFn(energy);
                }
                html += `
                <div class="energy-count-group">
                    ${iconHtml}
                    <span class="energy-count-number">${count}</span>
                </div>
                `;
            }
        } else {
            html = energies.map(energy => {
                if (energy.startsWith('special:')) {
                    const cardId = energy.substring(8);
                    return getSpecialIconHtml(cardId);
                } else {
                    return iconFn(energy);
                }
            }).join('');
        }
        container.innerHTML = html;
    }

    function playToolAnimation(targetEl, isBattleSlot, isAttach) {
        if (!targetEl) return;

        const videoSrc = isAttach ? '/assets/ptcg-telop/fx/tool-attach.webm' : '/assets/ptcg-telop/fx/tool-remove.webm';

        const targetRect = targetEl.getBoundingClientRect();
        if (targetRect.width === 0 && targetRect.height === 0) return;

        const video = document.createElement('video');
        video.src = videoSrc;
        video.muted = true;
        video.autoplay = true;
        video.style.position = 'absolute';
        video.style.zIndex = '400';
        video.style.pointerEvents = 'none';

        const videoWidth = isBattleSlot ? 150 : 70;
        const videoHeight = isBattleSlot ? 120 : 56;
        video.style.width = `${videoWidth}px`;
        video.style.height = `${videoHeight}px`;

        const targetCenterX = targetRect.left + targetRect.width / 2;
        const targetCenterY = targetRect.top + targetRect.height / 2;
        video.style.left = `${targetCenterX - videoWidth / 2}px`;
        video.style.top = `${targetCenterY - videoHeight / 2}px`;

        document.body.appendChild(video);
        video.addEventListener('ended', () => video.remove());
    }

    function updateAttachedTools(slotEl, newToolIds, oldToolIds, isBattleSlot, forceRedraw) {
        if (forceRedraw === undefined) forceRedraw = false;
        return new Promise(resolve => {
            const db = _cardDatabase.value;
            const itemClass = 'attached-tool-item';
            const wrapperEl = slotEl.querySelector('.attached-tools-wrapper');
            if (!wrapperEl) return resolve();

            if (forceRedraw) {
                let html = '';
                newToolIds.forEach(id => {
                    if (db[id]) {
                        html += `<div class="${itemClass}" data-tool-id="${id}"><img src="${_getCardImageUrl(id)}"></div>`;
                    }
                });
                wrapperEl.innerHTML = html;
                resolve();
                return;
            }

            const animationPromises = [];

            const toolsToRemove = [];
            const toolsToAdd = [];
            const oldWithKept = oldToolIds.map(id => ({ id, kept: false }));
            const tempNewIdsForConsumption = [...newToolIds];

            oldWithKept.forEach(item => {
                const idxInNew = tempNewIdsForConsumption.indexOf(item.id);
                if (idxInNew > -1) {
                    item.kept = true;
                    tempNewIdsForConsumption.splice(idxInNew, 1);
                }
            });

            toolsToAdd.push(...tempNewIdsForConsumption);

            for (let i = oldWithKept.length - 1; i >= 0; i--) {
                if (!oldWithKept[i].kept) {
                    toolsToRemove.push({ id: oldWithKept[i].id, index: i });
                }
            }

            const hasRemovals = toolsToRemove.length > 0;
            const hasAdditions = toolsToAdd.length > 0;

            let reorderNeeded = false;
            if (hasRemovals) {
                let isPrefix = newToolIds.length <= oldToolIds.length;
                if (isPrefix) {
                    for (let i = 0; i < newToolIds.length; i++) {
                        if (newToolIds[i] !== oldToolIds[i]) {
                            isPrefix = false;
                            break;
                        }
                    }
                }
                if (!isPrefix) reorderNeeded = true;
            }

            if (hasRemovals) {
                if (reorderNeeded) {
                    const allElements = [...wrapperEl.querySelectorAll(`.${itemClass}`)];
                    toolsToRemove.forEach(item => {
                        const el = allElements[item.index];
                        if (el && !el.classList.contains('anim-tool-disappear')) {
                            const p = new Promise(res => el.addEventListener('animationend', res, { once: true }));
                            animationPromises.push(p);
                            el.classList.add('anim-tool-disappear');
                            playToolAnimation(el, isBattleSlot, false);
                        }
                    });

                    setTimeout(() => {
                        wrapperEl.innerHTML = '';
                        newToolIds.forEach(toolId => {
                            if (db[toolId]) {
                                const toolItem = document.createElement('div');
                                toolItem.className = itemClass;
                                toolItem.dataset.toolId = toolId;
                                const toolImg = document.createElement('img');
                                toolImg.src = _getCardImageUrl(toolId);
                                toolItem.appendChild(toolImg);
                                wrapperEl.appendChild(toolItem);
                            }
                        });
                        const p = new Promise(res => wrapperEl.addEventListener('animationend', res, { once: true }));
                        animationPromises.push(p);
                        wrapperEl.classList.add('tools-fade-in');
                        wrapperEl.addEventListener('animationend', () => wrapperEl.classList.remove('tools-fade-in'), { once: true });
                        Promise.all(animationPromises).then(() => resolve());
                    }, 300);
                } else {
                    const allElements = [...wrapperEl.querySelectorAll(`.${itemClass}`)];
                    toolsToRemove.forEach(item => {
                        const el = allElements[item.index];
                        if (el) {
                            const p = new Promise(res => el.addEventListener('animationend', res, { once: true }));
                            animationPromises.push(p);
                            el.classList.add('anim-tool-disappear');
                            playToolAnimation(el, isBattleSlot, false);
                            el.addEventListener('animationend', () => el.remove(), { once: true });
                        }
                    });
                }
            } else if (hasAdditions) {
                toolsToAdd.forEach(id => {
                    if (db[id]) {
                        const toolItem = document.createElement('div');
                        const p = new Promise(res => toolItem.addEventListener('animationend', res, { once: true }));
                        animationPromises.push(p);
                        toolItem.className = `${itemClass} anim-tool-appear`;
                        toolItem.dataset.toolId = id;
                        const toolImg = document.createElement('img');
                        toolImg.src = _getCardImageUrl(id);
                        toolItem.appendChild(toolImg);
                        wrapperEl.appendChild(toolItem);
                        toolItem.addEventListener('animationstart', () => playToolAnimation(toolItem, isBattleSlot, true), { once: true });
                        toolItem.addEventListener('animationend', () => toolItem.classList.remove('anim-tool-appear'), { once: true });
                    }
                });
            }

            if (animationPromises.length > 0) {
                if (!reorderNeeded) {
                    Promise.all(animationPromises).then(() => resolve());
                }
            } else {
                resolve();
            }
        });
    }

    function updateStatusAilments(containerEl, newAilments, oldAilments) {
        return new Promise(resolve => {
            if (!containerEl) return resolve();

            // Exclude icons currently playing the disappear animation — they are about to be
            // removed from the DOM and must not block re-adding an icon of the same name in the
            // very next render (see Bug_Summary: SET_AILMENTS A → SWITCH A↔B → SET_AILMENTS B
            // with the same status was lost because the stale icon hid the new one).
            const currentIcons = new Set(
                Array.from(containerEl.children)
                    .filter(el => !el.classList.contains('anim-status-disappear'))
                    .map(el => el.dataset.ailment)
            );
            const newIcons = new Set(newAilments);
            const oldIcons = new Set(oldAilments);
            const animationPromises = [];

            oldIcons.forEach(ailment => {
                if (!newIcons.has(ailment)) {
                    const iconEl = containerEl.querySelector(`[data-ailment="${ailment}"]`);
                    if (iconEl) {
                        const p = new Promise(res => iconEl.addEventListener('animationend', res, { once: true }));
                        animationPromises.push(p);
                        iconEl.classList.add('anim-status-disappear');
                        iconEl.addEventListener('animationend', () => iconEl.remove(), { once: true });
                    }
                }
            });

            newIcons.forEach(ailment => {
                if (!currentIcons.has(ailment)) {
                    const iconWrapper = document.createElement('div');
                    iconWrapper.className = 'status-icon-wrapper anim-status-appear';
                    iconWrapper.dataset.ailment = ailment;
                    const iconImg = document.createElement('img');
                    iconImg.src = `/assets/ptcg-telop/icons/${ailment}.png`;
                    iconImg.className = 'status-icon';
                    iconWrapper.appendChild(iconImg);
                    containerEl.appendChild(iconWrapper);

                    const p = new Promise(res => iconWrapper.addEventListener('animationend', res, { once: true }));
                    animationPromises.push(p);
                    iconWrapper.addEventListener('animationend', () => iconWrapper.classList.remove('anim-status-appear'), { once: true });
                }
            });

            if (animationPromises.length > 0) {
                Promise.all(animationPromises).then(() => resolve());
            } else {
                resolve();
            }
        });
    }

    function handleSlotSlideAnimation(slotEl, isNewCard, forceSlideIn, skipSlideIn) {
        return new Promise(resolve => {
            if (isNewCard && !skipSlideIn) {
                // The backend ensures that SLIDE_OUT animations are fully completed (via ACK)
                // before sending the SLIDE_IN batch. Thus, there is no need to wait here.
                const side = slotEl.id.includes('-L') ? 'L' : 'R';
                slotEl.classList.remove('anim-slide-out-L', 'anim-slide-out-R');
                slotEl.classList.add(`anim-slide-in-${side}`);

                let isResolved = false;
                const animationEndHandler = (event) => {
                    // animationend bubbles — ignore events from descendants (e.g. status-icon
                    // anim-status-appear), otherwise they prematurely strip anim-slide-in-${side}
                    // mid-animation and the slot snaps to its final position.
                    if (event && event.target !== slotEl) return;
                    if (isResolved) return;
                    isResolved = true;
                    slotEl.classList.remove(`anim-slide-out-${side}`, `anim-slide-in-${side}`);
                    slotEl.removeEventListener('animationend', animationEndHandler);
                    resolve();
                };
                slotEl.addEventListener('animationend', animationEndHandler);
                setTimeout(() => animationEndHandler(null), 1000); // safety fallback

            } else {
                if (isNewCard || skipSlideIn) {
                    slotEl.classList.remove('anim-slide-out-L', 'anim-slide-out-R', 'anim-slide-in-L', 'anim-slide-in-R');
                }
                resolve();
            }
        });
    }

    // === Main Render Function ===

    function renderSlot(side, index, slotData, oldSlotData) {
        const slotEl = document.getElementById(`slot-${side}${index}`);

        const doRender = () => {
            const promises = [];
            const db = _cardDatabase.value;
            const settings = _settingsRep.value || {};

            const hasCard = slotData && slotData.cardId;
            const forceSlideIn = slotData && slotData.forceSlideIn;
            const skipSlideIn = slotData && slotData.evolutionSelect;
            const isNewCard = hasCard && (!oldSlotData || slotData.instanceId !== oldSlotData.instanceId);
            const isCardChanged = !oldSlotData || (slotData && (oldSlotData.instanceId !== slotData.instanceId || oldSlotData.cardId !== slotData.cardId));

            if (!slotEl || !slotData || !slotData.cardId || !db || !db[slotData.cardId]) {
                if (slotEl && (koSlots.has(slotEl.id) || removingSlots.has(slotEl.id))) {
                    return Promise.resolve();
                }

                if (!slotEl) return Promise.resolve();

                const isSlidingOut = slotEl.classList.contains('anim-slide-out-L') || slotEl.classList.contains('anim-slide-out-R');
                const clearSlot = () => {
                    const activeWrapper = slotEl.querySelector('.active-pokemon-wrapper');
                    const benchWrapper = slotEl.querySelector('.bench-pokemon-wrapper');

                    if (activeWrapper) {
                        activeWrapper.classList.add('hidden');
                        const toolsWrapper = activeWrapper.querySelector('.battle-attached-tools-wrapper');
                        if (toolsWrapper) toolsWrapper.innerHTML = '';
                        const energyWrapper = activeWrapper.querySelector('.battle-attached-energies');
                        if (energyWrapper) energyWrapper.innerHTML = '';
                        const ailmentsWrapper = activeWrapper.querySelector('.status-ailment');
                        if (ailmentsWrapper) ailmentsWrapper.innerHTML = '';
                        const hpBar = activeWrapper.querySelector('.hp-bar');
                        if (hpBar) { hpBar.style.transition = 'none'; hpBar.style.width = '100%'; hpBar.offsetHeight; hpBar.style.transition = ''; }
                        const hpText = activeWrapper.querySelector('.hp-text');
                        if (hpText) hpText.textContent = '';
                    }
                    if (benchWrapper) {
                        benchWrapper.remove();
                    }

                    slotEl.dataset.instanceId = '';
                    slotEl.classList.add('is-empty');
                    slotEl.classList.remove('anim-slide-out-L', 'anim-slide-out-R', 'anim-slide-in-L', 'anim-slide-in-R');
                };
                if (isSlidingOut) {
                    setTimeout(clearSlot, 500);
                } else {
                    clearSlot();
                }
                return Promise.resolve();
            }
            slotEl.classList.remove('is-empty');

            const isUnderAttack = g_attackAnimationTargets.has(slotEl.id);
            const cardData = db[slotData.cardId];

            slotEl.style.borderColor = 'var(--stroke-color)';
            slotEl.style.backgroundColor = 'var(--main-color)';

            const oldToolIds = oldSlotData ? (oldSlotData.attachedToolIds || []) : [];
            const newToolIds = slotData ? (slotData.attachedToolIds || []) : [];
            const ailmentsBeforeChange = oldSlotData ? (oldSlotData.ailments || []) : [];
            const newAilments = slotData ? (slotData.ailments || []) : [];

            const isNoLongerActive = index !== 0 && oldSlotData && oldSlotData.active;

            if (isCardChanged || isNoLongerActive) {
                oldSlotData = null;
            }

            if (!cardData || !cardData.pokemon) return Promise.resolve();
            const baseHp = parseInt(cardData.pokemon.hp || 0, 10);
            const extraHp = parseInt(slotData.extraHp || 0, 10);
            const damage = parseInt(slotData.damage || 0, 10);
            const maxHp = baseHp + extraHp;
            const currentHp = Math.max(0, maxHp - damage);

            let hpChangeToShow = 0;
            if (oldSlotData) {
                const oldDamage = parseInt(oldSlotData.damage || 0, 10);
                const oldExtraHp = parseInt(oldSlotData.extraHp || 0, 10);
                const oldMaxHp = baseHp + oldExtraHp;
                const oldHp = Math.max(0, oldMaxHp - oldDamage);
                const damageDiff = damage - oldDamage;
                if (damageDiff > 0) { hpChangeToShow = -damageDiff; }
                else if (damageDiff < 0) { hpChangeToShow = -damageDiff; }
                else if (extraHp !== oldExtraHp) { hpChangeToShow = currentHp - oldHp; }
            }

            let startHp = currentHp, startMaxHp = maxHp;
            if (oldSlotData) {
                const oldExtraHp = parseInt(oldSlotData.extraHp || 0, 10);
                const oldDamage = parseInt(oldSlotData.damage || 0, 10);
                startMaxHp = baseHp + oldExtraHp;
                startHp = Math.max(0, startMaxHp - oldDamage);
            }

            const hpPercent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0;
            let hpColor = 'var(--hp-high)';
            if (hpPercent <= 25) hpColor = 'var(--hp-low)';
            else if (hpPercent <= 50) hpColor = 'var(--hp-medium)';

            if (index === 0) {
                // === ACTIVE (BATTLE) SLOT ===
                const wrapper = slotEl.querySelector('.active-pokemon-wrapper');
                wrapper.classList.remove('hidden');
                wrapper.querySelector('.pokemon-name').textContent = cardData.name;
                const img = wrapper.querySelector('.pokemon-image');

                if (isNewCard) {
                    const slotSide = slotEl.id.includes('-L') ? 'L' : 'R';
                    const offScreenTransform = slotSide === 'L' ? 'translateX(-120%)' : 'translateX(120%)';
                    slotEl.style.transform = offScreenTransform;
                    slotEl.style.opacity = '0';

                    img.style.visibility = 'hidden';
                    img.onload = () => {
                        img.style.visibility = 'visible';
                        slotEl.style.transform = '';
                        slotEl.style.opacity = '';
                        promises.push(handleSlotSlideAnimation(slotEl, isNewCard, forceSlideIn, skipSlideIn));
                        img.onload = null;
                    };
                } else {
                    promises.push(handleSlotSlideAnimation(slotEl, isNewCard, forceSlideIn, skipSlideIn));
                }
                img.src = _getCardImageUrl(slotData.cardId);
                img.classList.toggle('is-v', cardData.pokemon && cardData.subtype === 'V');

                const hpUpdatePromise = new Promise(resolve => {
                    const hpUpdate = () => {
                        const hpPromises = [];
                        const hpTextEl = wrapper.querySelector('.hp-text');
                        hpPromises.push(animateHp(hpTextEl, startHp, currentHp, startMaxHp, maxHp, 500));
                        const hpBar = wrapper.querySelector('.hp-bar');
                        hpBar.style.width = `${hpPercent}%`;
                        hpBar.style.backgroundColor = hpColor;
                        if (hpChangeToShow !== 0) {
                            hpPromises.push(displayHpChangeNumber(slotEl, hpChangeToShow));
                        }
                        Promise.all(hpPromises).then(resolve);
                    };

                    if (isUnderAttack) {
                        setTimeout(hpUpdate, 1100);
                    } else {
                        hpUpdate();
                    }
                });
                promises.push(hpUpdatePromise);

                promises.push(updateAttachedTools(slotEl, newToolIds, oldToolIds, true, isCardChanged));

                const energyContainer = wrapper.querySelector('.attached-energies');
                renderAttachedEnergies(energyContainer, slotData.attachedEnergy, getEnergyIcon);

                promises.push(updateStatusAilments(wrapper.querySelector('.status-ailment'), newAilments, ailmentsBeforeChange));

                const skillsContainer = wrapper.querySelector('.skills-container');
                skillsContainer.innerHTML = '';
                const allSkills = [...(cardData.pokemon.abilities || []), ...(cardData.pokemon.attacks || [])];
                allSkills.slice(0, 2).forEach(skill => {
                    const isAbility = !!skill.text && !skill.cost;
                    const abilityUsedClass = (isAbility && slotData.abilityUsed) ? 'used' : '';
                    let tagHtml = '';
                    if (isAbility) {
                        const style = getComputedStyle(document.documentElement);
                        const abilityFile = style.getPropertyValue('--asset-ability').trim().replace(/['\"]/g, '');
                        const abilityIconSrc = _resolveAssetPath(abilityFile, true);
                        tagHtml = `<img src="${abilityIconSrc}" class="skill-ability-tag ${abilityUsedClass}" alt="Ability">`;
                    } else {
                        const cost = skill.cost || [];
                        const iconsToRender = cost.length > 0 ? cost : [null];
                        const iconsHtml = iconsToRender.map(getEnergyIcon).join('');
                        tagHtml = `<div class="energy-cost-container">${iconsHtml}</div>`;
                    }
                    skillsContainer.innerHTML += `
                    <div class="skill-row-wrapper">
                        ${tagHtml}
                        <div class="skill">
                            <div class="skill-name-wrapper">
                                <span class="skill-name ${isAbility ? 'is-ability' : ''} ${abilityUsedClass}">${skill.name}</span>
                            </div>
                            <div class="skill-damage">${sanitizeDamage(skill.damage)}</div>
                        </div>
                    </div>
                    `;
                });
            } else {
                // === BENCH SLOT ===
                let wrapper = slotEl.querySelector('.bench-pokemon-wrapper');
                const forceRedraw = !oldSlotData || !wrapper || slotEl.dataset.instanceId !== slotData.instanceId || slotData.cardId !== oldSlotData.cardId;

                if (forceRedraw) {
                    const newWrapperHtml = `
                    <div class="bench-pokemon-wrapper">
                        <div class="card-image-area">
                            <img class="pokemon-image">
                            <div class="attached-energies"></div>
                            <div class="attached-tools-wrapper"></div>
                        </div>
                        <div class="bench-info-area">
                            <div class="pokemon-name">${cardData.name}</div>
                            <div class="hp-gauge">
                                <div class="hp-bar-container">
                                    <div class="hp-text"></div>
                                    <div class="hp-bar"></div>
                                </div>
                            </div>
                            <div class="skills-container"></div>
                        </div>
                    </div>`;
                    if (wrapper) {
                        wrapper.outerHTML = newWrapperHtml;
                    } else {
                        slotEl.insertAdjacentHTML('beforeend', newWrapperHtml);
                    }
                    wrapper = slotEl.querySelector('.bench-pokemon-wrapper');
                    slotEl.dataset.instanceId = slotData.instanceId;

                    const mainImg = wrapper.querySelector('.pokemon-image');

                    if (isNewCard) {
                        const slotSide = slotEl.id.includes('-L') ? 'L' : 'R';
                        const offScreenTransform = slotSide === 'L' ? 'translateX(-120%)' : 'translateX(120%)';
                        slotEl.style.transform = offScreenTransform;
                        slotEl.style.opacity = '0';
                    }

                    mainImg.style.visibility = 'hidden';
                    mainImg.onload = () => {
                        mainImg.style.visibility = 'visible';
                        if (isNewCard) {
                            slotEl.style.transform = '';
                            slotEl.style.opacity = '';
                        }
                        promises.push(handleSlotSlideAnimation(slotEl, isNewCard, forceSlideIn, skipSlideIn));
                        mainImg.onload = null;
                    };
                    mainImg.src = _getCardImageUrl(slotData.cardId);
                    mainImg.classList.toggle('is-v', cardData.pokemon && cardData.subtype === 'V');
                } else {
                    promises.push(handleSlotSlideAnimation(slotEl, isNewCard, forceSlideIn, skipSlideIn));
                }
                wrapper.classList.remove('hidden');
                const skillsContainer = wrapper.querySelector('.skills-container');
                const allSkills = [...(cardData.pokemon.abilities || []), ...(cardData.pokemon.attacks || [])];
                let skillsHtml = '';
                allSkills.slice(0, 2).forEach(skill => {
                    const isAbility = !!skill.text && !skill.cost;
                    const abilityUsedClass = (isAbility && slotData.abilityUsed) ? 'used' : '';
                    let tagHtml = '';
                    if (isAbility) {
                        const style = getComputedStyle(document.documentElement);
                        const abilityFile = style.getPropertyValue('--asset-ability').trim().replace(/['\"]/g, '');
                        const abilityIconSrc = _resolveAssetPath(abilityFile, true);
                        tagHtml = `<img src="${abilityIconSrc}" class="skill-ability-tag ${abilityUsedClass}" alt="Ability">`;
                    } else {
                        const cost = skill.cost || [];
                        const iconsToRender = cost.length > 0 ? cost : [null];
                        const iconsHtml = iconsToRender.map(getEnergyIcon).join('');
                        tagHtml = `<div class="energy-cost-container">${iconsHtml}</div>`;
                    }
                    skillsHtml += `
                    <div class="skill-row-wrapper">
                        ${tagHtml}
                        <div class="skill">
                            <div class="skill-name-wrapper"><span class="skill-name ${isAbility ? 'is-ability' : ''} ${abilityUsedClass}">${skill.name}</span></div>
                            <div class="skill-damage">${sanitizeDamage(skill.damage)}</div>
                        </div>
                    </div>`;
                });
                skillsContainer.innerHTML = skillsHtml;

                promises.push(updateAttachedTools(slotEl, newToolIds, oldToolIds, false, forceRedraw));

                const hpUpdatePromise = new Promise(resolve => {
                    const hpUpdate = () => {
                        const hpPromises = [];
                        const hpTextEl = wrapper.querySelector('.hp-text');
                        const hpBarEl = wrapper.querySelector('.hp-bar');
                        hpPromises.push(animateHp(hpTextEl, startHp, currentHp, startMaxHp, maxHp, 500));
                        hpBarEl.style.width = `${hpPercent}%`;
                        hpBarEl.style.backgroundColor = hpColor;
                        if (hpChangeToShow !== 0) {
                            hpPromises.push(displayHpChangeNumber(slotEl, hpChangeToShow));
                        }
                        Promise.all(hpPromises).then(resolve);
                    };
                    if (isUnderAttack) { setTimeout(hpUpdate, 1100); } else { hpUpdate(); }
                });
                promises.push(hpUpdatePromise);

                const energyContainer = wrapper.querySelector('.attached-energies');
                renderAttachedEnergies(energyContainer, slotData.attachedEnergy, getEnergyIcon);
            }
            if (slotData && slotData.evolutionSelect) {
                delete slotData.evolutionSelect;
            }
            if (slotData && slotData.forceSlideIn) {
                delete slotData.forceSlideIn;
            }
            return Promise.all(promises);
        };

        const isEvolving = evolvingSlots.has(slotEl.id);
        if (isEvolving) {
            evolvingSlots.delete(slotEl.id);
            return new Promise(resolve => {
                setTimeout(() => {
                    doRender().then(resolve);
                }, 500);
            });
        } else {
            return doRender();
        }
    }

    // === Video on Slot ===

    function playVideoOnSlot(targetId, videoSrc) {
        return new Promise(resolve => {
            const targetEl = document.getElementById(targetId);
            if (!targetEl) return resolve();

            const imageSelector = '.pokemon-image';
            const cardImage = targetEl.querySelector(imageSelector);

            const video = document.createElement('video');
            video.src = videoSrc;
            video.muted = true;
            video.style.position = 'absolute';
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.left = '0';
            video.style.top = '0';
            video.style.zIndex = '300';
            video.style.objectFit = 'cover';

            targetEl.appendChild(video);
            video.play();

            setTimeout(() => { if (cardImage) cardImage.style.visibility = 'hidden'; }, REPLACE_ANIMATION_HIDE_MS);
            setTimeout(() => { if (cardImage) cardImage.style.visibility = 'visible'; }, REPLACE_ANIMATION_SHOW_MS);

            video.addEventListener('ended', () => {
                video.remove();
                resolve();
            });
        });
    }

    // === Animation Handlers ===

    function handleSwitchAnimation(animation) {
        return new Promise(resolve => {
            let slotsToAnimate = [];
            if (animation.involvedSlots) {
                slotsToAnimate = animation.involvedSlots;
            } else if (animation.source && animation.target) {
                slotsToAnimate = [animation.source, animation.target];
            } else {
                console.error('Invalid SWITCH_POKEMON animation data:', animation);
                return resolve();
            }

            const promises = [];
            slotsToAnimate.forEach(slotId => {
                const el = document.getElementById(slotId);
                if (el && !el.classList.contains('is-empty')) {
                    const side = slotId.includes('-L') ? 'L' : 'R';
                    const p = new Promise(res => {
                        let isResolved = false;
                        const done = () => { if (!isResolved) { isResolved = true; el.removeEventListener('animationend', done); res(); } };
                        el.addEventListener('animationend', done, { once: true });
                        setTimeout(done, 1000);
                    });
                    promises.push(p);
                    el.classList.add(`anim-slide-out-${side}`);
                }
            });

            if (promises.length > 0) {
                Promise.all(promises).then(resolve);
            } else {
                resolve();
            }
        });
    }

    function handleEvolveAnimation(animation) {
        evolvingSlots.add(animation.target);
        const db = _cardDatabase.value;
        const isBattleSlot = animation.target.endsWith('0');
        let videoSrc = isBattleSlot ? '/assets/ptcg-telop/fx/active-evolve.webm' : '/assets/ptcg-telop/fx/bench-evolve.webm';

        if (animation.cardId && db && db[animation.cardId]) {
            const cardData = db[animation.cardId];
            if (cardData.pokemon && cardData.pokemon.option) {
                const option = cardData.pokemon.option.toLowerCase();
                if (option === 'mega') {
                    videoSrc = isBattleSlot ? '/assets/ptcg-telop/fx/active-mega-evolve.webm' : '/assets/ptcg-telop/fx/bench-mega-evolve.webm';
                } else if (option === 'terastal') {
                    videoSrc = isBattleSlot ? '/assets/ptcg-telop/fx/active-tera-evolve.webm' : '/assets/ptcg-telop/fx/bench-tera-evolve.webm';
                }
            }
        }
        return playVideoOnSlot(animation.target, videoSrc);
    }

    function handleKoAnimation(animation) {
        return new Promise(resolve => {
            const targetEl = document.getElementById(animation.target);
            if (!targetEl) return resolve();

            koSlots.add(animation.target);

            const side = animation.target.includes('-L') ? 'L' : 'R';
            const isBattleSlot = animation.target.endsWith('0');
            const videoSrc = isBattleSlot ? '/assets/ptcg-telop/fx/active_ko.webm' : '/assets/ptcg-telop/fx/bench_ko.webm';
            const imageSelector = '.pokemon-image';

            const koVideo = document.createElement('video');
            koVideo.src = videoSrc;
            koVideo.muted = true;
            koVideo.style.position = 'absolute';
            koVideo.style.width = '100%';
            koVideo.style.height = '100%';
            koVideo.style.left = isBattleSlot ? '0' : '-4px';
            koVideo.style.top = '0';
            koVideo.style.zIndex = '200';
            targetEl.appendChild(koVideo);
            koVideo.play();

            setTimeout(() => {
                const cardImage = targetEl.querySelector(imageSelector);
                if (cardImage) cardImage.style.visibility = 'hidden';
            }, 85);

            koVideo.addEventListener('ended', () => {
                koVideo.remove();
                targetEl.classList.add(`anim-slide-out-${side}`);
                targetEl.addEventListener('animationend', () => {
                    if (isBattleSlot) {
                        const ailmentsWrapper = targetEl.querySelector('.status-ailment');
                        if (ailmentsWrapper) ailmentsWrapper.innerHTML = '';
                    }
                    koSlots.delete(animation.target);
                    resolve();
                }, { once: true });
            });
        });
    }

    function handleExitAnimation(animation) {
        return new Promise(resolve => {
            const targetEl = document.getElementById(animation.target);
            if (!targetEl) return resolve();

            removingSlots.add(animation.target);

            const side = animation.target.includes('-L') ? 'L' : 'R';
            targetEl.classList.add(`anim-slide-out-${side}`);

            let isResolved = false;
            const animationEndHandler = () => {
                if (isResolved) return;
                isResolved = true;
                const activeWrapper = targetEl.querySelector('.active-pokemon-wrapper');
                const benchWrapper = targetEl.querySelector('.bench-pokemon-wrapper');
                if (activeWrapper) {
                    activeWrapper.classList.add('hidden');
                    const ailmentsWrapper = activeWrapper.querySelector('.status-ailment');
                    if (ailmentsWrapper) ailmentsWrapper.innerHTML = '';
                }
                if (benchWrapper) { benchWrapper.remove(); }
                targetEl.dataset.instanceId = '';
                targetEl.classList.add('is-empty');

                removingSlots.delete(animation.target);
                targetEl.removeEventListener('animationend', animationEndHandler);
                resolve();
            };
            targetEl.addEventListener('animationend', animationEndHandler, { once: true });
            setTimeout(animationEndHandler, 1000);
        });
    }

    function handleEnterAnimation(animation) {
        return new Promise(resolve => {
            const targetEl = document.getElementById(animation.target);
            if (!targetEl) return resolve();
            targetEl.classList.remove('anim-slide-out-L', 'anim-slide-out-R');
            const side = animation.target.includes('-L') ? 'L' : 'R';
            const animationClass = `anim-slide-in-${side}`;
            targetEl.classList.add(animationClass);
            let isResolved = false;
            const animationEndHandler = () => {
                if (isResolved) return;
                isResolved = true;
                targetEl.classList.remove(animationClass);
                targetEl.removeEventListener('animationend', animationEndHandler);
                resolve();
            };
            targetEl.addEventListener('animationend', animationEndHandler, { once: true });
            setTimeout(animationEndHandler, 1000);
        });
    }

    // === Animation Dispatcher ===

    function handleAnimation(animation) {
        if (!animation || !animation.type) {
            console.error('Invalid animation data received:', animation);
            return Promise.resolve();
        }

        switch (animation.type) {
            case 'SWITCH_POKEMON':
                return handleSwitchAnimation(animation);
            case 'EVOLVE_POKEMON':
                return handleEvolveAnimation(animation);
            case 'DEVOLVE_POKEMON': {
                evolvingSlots.add(animation.target);
                const isBattleSlot = animation.target.endsWith('0');
                const videoSrc = isBattleSlot ? '/assets/ptcg-telop/fx/active-devolve.webm' : '/assets/ptcg-telop/fx/bench-devolve.webm';
                return playVideoOnSlot(animation.target, videoSrc);
            }
            case 'REPLACE_POKEMON': {
                evolvingSlots.add(animation.target);
                const isBattleSlot = animation.target.endsWith('0');
                const videoSrc = isBattleSlot ? '/assets/ptcg-telop/fx/active-replace.webm' : '/assets/ptcg-telop/fx/bench-replace.webm';
                return playVideoOnSlot(animation.target, videoSrc);
            }
            case 'KO_POKEMON':
                return handleKoAnimation(animation);
            case 'EXIT_POKEMON':
                return handleExitAnimation(animation);
            case 'ENTER_POKEMON':
                return handleEnterAnimation(animation);
            default:
                console.warn('Unknown animation type:', animation.type);
                return Promise.resolve();
        }
    }

    // === Public API ===

    window.SlotRenderer = {
        init,
        renderSlot,
        handleAnimation,
        // Expose for attack-fx handlers in HTML files
        g_attackAnimationTargets,
        activeAnimations,
        // Expose for preload lists
        ENERGY_MAP,
    };
})();
