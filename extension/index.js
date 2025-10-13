'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os'); // Import os for platform detection
const { exec } = require('child_process'); // Import child_process

module.exports = function (nodecg) {
	nodecg.log.info('Bundle ptcg-telop starting up.');

	// Define projectRoot at the top level of the module to ensure it's available for all functions.
	// This path points to the absolute root of the project, "NodeCG_PTCG".
	const projectRoot = path.join(__dirname, '..', '..', '..', '..');

	// Read package.json for version info
	const pjson = require('../package.json');
	const bundleVersion = pjson.version;

	nodecg.listenFor('getBundleVersion', (data, callback) => {
		callback(null, bundleVersion);
	});

	// Centralized settings replicant
	const ptcgSettings = nodecg.Replicant('ptcg-settings', {
		defaultValue: {
			typeColorMap: {
				"草": { color: "#78c850", opacity: 0.2 },
				"炎": { color: "#ff2222", opacity: 0.2 },
				"水": { color: "#6890f0", opacity: 0.2 },
				"雷": { color: "#f8d030", opacity: 0.2 },
				"超": { color: "#7038f8", opacity: 0.2 },
				"闘": { color: "#c07928", opacity: 0.2 },
				"悪": { color: "#1f405a", opacity: 0.2 },
				"鋼": { color: "#b8b8d0", opacity: 0.2 },
				"妖": { color: "#ee99ac", opacity: 0.2 },
				"竜": { color: "#b4b432", opacity: 0.2 },
				"無": { color: "#b9b9b9", opacity: 0.2 }
			},
            hotkeys: {
				discard: 'Escape',
				apply: 'Control+S'
			},
            lostZoneEnabled: false,
			reverseCardDisplay: false,
            autoSideTake: true,
            autoRetreatToggle: true,
            showDeckEnergyOnly: true,
            autoCheckSupporter: true,
            autoTrashTM: true,
            weaknessDamage: true,
            toolLimit: 4,
			language: "jp"
		}
	});

	// Replicants can be declared outside the initialized block.
	const cardDatabase = nodecg.Replicant('cardDatabase', { defaultValue: {} });
	const assetPaths = nodecg.Replicant('assetPaths', { defaultValue: {} });
	const deckLoadingStatus = nodecg.Replicant('deckLoadingStatus', { defaultValue: { loading: false, side: null } });
	const deckLoadingProgress = nodecg.Replicant('deckLoadingProgress', { defaultValue: { side: null, percentage: 0, text: '' } });
	const playerL_name = nodecg.Replicant('playerL_name', { defaultValue: '' });
	const playerR_name = nodecg.Replicant('playerR_name', { defaultValue: '' });
	const matchInfo = nodecg.Replicant('matchInfo', { defaultValue: { round: '决赛' } });
	const operationQueue = nodecg.Replicant('operationQueue', { defaultValue: [] });
	const firstMove = nodecg.Replicant('firstMove', { defaultValue: '' });
	const cardToShowL = nodecg.Replicant('cardToShowL', { defaultValue: '' });
	const cardToShowR = nodecg.Replicant('cardToShowR', { defaultValue: '' });
	const i18nStrings = nodecg.Replicant('i18nStrings', { defaultValue: {} });

	const language = nodecg.Replicant('language', { defaultValue: 'jp' });

    const live_lostZoneL = nodecg.Replicant('live_lostZoneL', { defaultValue: 0 });
	const draft_lostZoneL = nodecg.Replicant('draft_lostZoneL', { defaultValue: 0 });
	const live_lostZoneR = nodecg.Replicant('live_lostZoneR', { defaultValue: 0 });
	const draft_lostZoneR = nodecg.Replicant('draft_lostZoneR', { defaultValue: 0 });
	live_lostZoneL.once('change', (newValue) => { if (newValue !== draft_lostZoneL.value) draft_lostZoneL.value = newValue; });
	live_lostZoneR.once('change', (newValue) => { if (newValue !== draft_lostZoneR.value) draft_lostZoneR.value = newValue; });

    ptcgSettings.on('change', (newValue, oldValue) => {

		const newLang = (newValue && newValue.language) || 'jp';
		const oldLang = (oldValue && oldValue.language); // No default for oldLang

        if (language.value !== newLang) {
            language.value = newLang;
        }

        if (!newValue.lostZoneEnabled) {
            if (live_lostZoneL.value !== 0) live_lostZoneL.value = 0;
            if (draft_lostZoneL.value !== 0) draft_lostZoneL.value = 0;
            if (live_lostZoneR.value !== 0) live_lostZoneR.value = 0;
            if (draft_lostZoneR.value !== 0) draft_lostZoneR.value = 0;
        }


		// Update asset path for card images
		const newCardImgPath = `assets/ptcg-telop/card_img_${newLang}/`;
		if (assetPaths.value.cardImgPath !== newCardImgPath) {
			assetPaths.value.cardImgPath = newCardImgPath;
			nodecg.log.info(`Asset path for card images updated to: ${newCardImgPath}`);
		}

		// On initial load (oldValue is undefined) or if lang has changed, reload the DB.
		if (!oldValue) {
			nodecg.log.info('Initial load detected. Loading card database and i18n strings...');
			loadCardDatabase();
			loadI18nStrings();
		}
    });

    // Stadium
    const live_stadium = nodecg.Replicant('live_stadium', { defaultValue: { cardId: null, used: false } });
    const draft_stadium = nodecg.Replicant('draft_stadium', { defaultValue: { cardId: null, used: false } });
    live_stadium.once('change', (newValue) => { if (JSON.stringify(newValue) !== JSON.stringify(draft_stadium.value)) draft_stadium.value = JSON.parse(JSON.stringify(newValue)); });

    // Side/Prize Card Replicants (Live vs Draft)
    const live_sideL = nodecg.Replicant('live_sideL', { defaultValue: 6 });
    const draft_sideL = nodecg.Replicant('draft_sideL', { defaultValue: 6 });
    const live_sideR = nodecg.Replicant('live_sideR', { defaultValue: 6 });
    const draft_sideR = nodecg.Replicant('draft_sideR', { defaultValue: 6 });
    live_sideL.once('change', (newValue) => { if (newValue !== draft_sideL.value) draft_sideL.value = newValue; });
    live_sideR.once('change', (newValue) => { if (newValue !== draft_sideR.value) draft_sideR.value = newValue; });

    // VSTAR Power Replicants (Live vs Draft)
    const live_vstar_L = nodecg.Replicant('live_vstar_L', { defaultValue: false });
    const draft_vstar_L = nodecg.Replicant('draft_vstar_L', { defaultValue: false });
    const live_vstar_R = nodecg.Replicant('live_vstar_R', { defaultValue: false });
    const draft_vstar_R = nodecg.Replicant('draft_vstar_R', { defaultValue: false });
    live_vstar_L.once('change', (newValue) => { if (newValue !== draft_vstar_L.value) draft_vstar_L.value = newValue; });
    live_vstar_R.once('change', (newValue) => { if (newValue !== draft_vstar_R.value) draft_vstar_R.value = newValue; });

    // Turn & Action Status Replicants (Live vs Draft)
    const live_currentTurn = nodecg.Replicant('live_currentTurn', { defaultValue: 'L' });
    const draft_currentTurn = nodecg.Replicant('draft_currentTurn', { defaultValue: 'L' });
    live_currentTurn.once('change', (newValue) => { if (newValue !== draft_currentTurn.value) draft_currentTurn.value = newValue; });

    // Create individual, independent replicants for each action status
    const actionTypes = ['energy', 'supporter', 'retreat'];
    ['L', 'R'].forEach(side => {
        actionTypes.forEach(action => {
            const liveRep = nodecg.Replicant(`live_action_${action}_${side}`, { defaultValue: false });
            const draftRep = nodecg.Replicant(`draft_action_${action}_${side}`, { defaultValue: false });
            // Ensure draft is in sync with live on startup
            liveRep.once('change', (newValue) => {
                if (newValue !== draftRep.value) {
                    draftRep.value = newValue;
                }
            });
        });
    });

	// == Player & Board State Replicants ==
	// Selections
	const selections = nodecg.Replicant('selections', { defaultValue: [] });
	const deckIdL = nodecg.Replicant('deckIdL', { defaultValue: '' });
	const deckIdR = nodecg.Replicant('deckIdR', { defaultValue: '' });
	const deckL = nodecg.Replicant('deckL', { defaultValue: { name: '', cards: [] } });
	const deckR = nodecg.Replicant('deckR', { defaultValue: { name: '', cards: [] } });

	// Player Slots (L0/R0 are Battle Slots)
	// LIVE DATA: Used by graphics
	// DRAFT DATA: Used by panels for immediate feedback
	for (let i = 0; i < 9; i++) { // Changed from 6 to 9 to include extra bench
		const slotDefault = {
			cardId: null,
			damage: 0,
			extraHp: 0,
			attachedEnergy: [],
			attachedToolIds: [],
			abilityUsed: false, // Add new property
			isKO: false, // Add new property for KO checkbox state
		};
		if (i === 0) {
			slotDefault.ailments = [];
		}
		// Declare both live and draft replicants
		const liveRep = nodecg.Replicant(`live_slotL${i}`, { defaultValue: slotDefault });
		const draftRep = nodecg.Replicant(`draft_slotL${i}`, { defaultValue: slotDefault });
		
		const liveRepR = nodecg.Replicant(`live_slotR${i}`, { defaultValue: slotDefault });
		const draftRepR = nodecg.Replicant(`draft_slotR${i}`, { defaultValue: slotDefault });

		// Ensure draft is in sync with live on startup
		liveRep.once('change', (newValue) => { if (JSON.stringify(newValue) !== JSON.stringify(draftRep.value)) draftRep.value = JSON.parse(JSON.stringify(newValue)); });
		liveRepR.once('change', (newValue) => { if (JSON.stringify(newValue) !== JSON.stringify(draftRepR.value)) draftRepR.value = JSON.parse(JSON.stringify(newValue)); });
	}
	// =====================================

	// --- DEBUG: Moved logic out of 'initialized' event ---
	nodecg.log.info('[DEBUG_LIFECYCLE] Running initialization logic directly.');



	function loadCardDatabase() {
		try {
			const lang = (ptcgSettings.value && ptcgSettings.value.language) || 'jp';
			const dbFileName = `database_${lang}.json`;
			const dbPath = path.join(projectRoot, 'nodecg', 'assets', 'ptcg-telop', dbFileName);
			nodecg.log.info(`[DB_DEBUG] Attempting to load database. Calculated path: ${dbPath}`);

			const dbDir = path.dirname(dbPath);
			if (!fs.existsSync(dbDir)) {
				nodecg.log.warn(`[DB_DEBUG] Database directory does not exist, creating: ${dbDir}`);
				fs.mkdirSync(dbDir, { recursive: true });
			}
			
			if (!fs.existsSync(dbPath)) {
				cardDatabase.value = {};
				nodecg.log.error(`[DB_DEBUG] CRITICAL_PATH_TEST: Card database file does not exist at path: ${dbPath}. Initialized empty.`);
				return;
			}

			const fileContent = fs.readFileSync(dbPath, 'utf8');
			if (!fileContent || fileContent.trim() === '') {
				nodecg.log.warn(`[DB_DEBUG] Database file is empty. Initializing empty.`);
				cardDatabase.value = {};
				return;
			}

			const dbData = JSON.parse(fileContent);
			cardDatabase.value = dbData;
			nodecg.log.info(`[DB_DEBUG] Successfully loaded and parsed database. Total entries: ${Object.keys(dbData).length}`);

		} catch (error) {
			nodecg.log.error('[DB_DEBUG] CRITICAL: Failed to load or parse card database.', error);
			cardDatabase.value = {};
		}
	}

	function loadI18nStrings() {
		try {
			const i18nPath = path.join(__dirname, '..', 'i18n', 'strings.json');
			if (fs.existsSync(i18nPath)) {
				const fileContent = fs.readFileSync(i18nPath, 'utf8');
				i18nStrings.value = JSON.parse(fileContent);
				nodecg.log.info('Successfully loaded i18n strings.');
			} else {
				nodecg.log.warn('i18n/strings.json not found.');
			}
		} catch (error) {
			nodecg.log.error('Failed to load i18n strings:', error);
		}
	}
	// Initial load of the database and asset paths is now handled by the ptcgSettings.on('change') listener.

	// Listen for messages to process deck codes
	nodecg.listenFor('setPlayerDeck', ({ side, deckCode }, callback) => {
		nodecg.log.info(`Received request to process deck code for Player ${side}: ${deckCode}`);
		deckLoadingStatus.value = { loading: true, side: side };

		const pythonDir = path.join(__dirname, '..', 'python');
		const lang = (ptcgSettings.value && ptcgSettings.value.language) || 'jp';

		const scriptMap = {
			jp: 'extract_deck_cards_jp.py',
			chs: 'extract_deck_cards_chs.py',
			cht: 'extract_deck_cards_cht.py',
			en: 'extract_deck_cards_en.py',
		};
		const pythonScriptFile = scriptMap[lang] || scriptMap.jp;
		const pythonScriptPath = path.join(pythonDir, pythonScriptFile);

		const dbFileName = `database_${lang}.json`;
		const absoluteDbPath = path.join(projectRoot, 'nodecg', 'assets', 'ptcg-telop', dbFileName);
		const cardImgDirName = `card_img_${lang}`;
		const absoluteCardImgPath = path.join(projectRoot, 'nodecg', 'assets', 'ptcg-telop', cardImgDirName);
		
		const pythonCommand = os.platform() === 'win32' ? 'python' : 'python3';
		const command = `${pythonCommand} "${pythonScriptPath}" "${deckCode}"`;

		const child = exec(command, { cwd: pythonDir }, (error, stdout, stderr) => {
			// Final state reset
			deckLoadingStatus.value = { loading: false, side: null, percentage: 0, text: '' };

			if (error) {
				nodecg.log.error(`exec error: ${error}`);
				nodecg.log.error(`Python stderr: ${stderr}`);
				if (callback) callback({ error: error.message, stderr: stderr });
				return;
			}
			
			try {
				const deckCards = JSON.parse(stdout);
				const deckReplicant = side === 'L' ? nodecg.Replicant('deckL') : nodecg.Replicant('deckR');
				nodecg.log.info(`Deck for Player ${side} processed. Reloading database before updating deck replicant.`);
                loadCardDatabase();
				deckReplicant.value = {
					name: deckCode, 
					cards: deckCards.cards
				};
				nodecg.log.info(`Database reloaded and deck for Player ${side} updated.`);
				if (callback) callback(null, `Deck for Player ${side} updated.`);
			} catch (parseError) {
				nodecg.log.error('Failed to parse python script output:', parseError);
				nodecg.log.error('Python stdout:', stdout);
				if (callback) callback({ error: 'Failed to parse script output.', stdout: stdout });
			}
		});

		const progressRegex = /--- Processing card (\d+)\/(\d+):/;
		child.stderr.on('data', (data) => {
			const match = data.toString().match(progressRegex);
			if (match) {
				const current = parseInt(match[1], 10);
				const total = parseInt(match[2], 10);
				const percentage = Math.round((current / total) * 100);
				const text = `${current}/${total}`;
				deckLoadingStatus.value = { loading: true, side: side, percentage: percentage, text: text };
			}
		});
	});

	nodecg.listenFor('addSingleCardToDeck', ({ side, cardId }, callback) => {
		// Sanitize the ID at the very beginning to ensure consistency.
		const sanitizedCardId = cardId.replace('/', '-');
		nodecg.log.info(`Request to add single card ${cardId} (sanitized to ${sanitizedCardId}) to Player ${side}'s deck.`);

		const deckReplicant = side === 'L' ? deckL : deckR;
		const db = cardDatabase.value;

		const addCardToDeck = (idToAdd) => {
			if (!Array.isArray(deckReplicant.value.cards)) {
				deckReplicant.value.cards = [];
			}
			if (!deckReplicant.value.cards.includes(idToAdd)) {
				deckReplicant.value.cards = [...deckReplicant.value.cards, idToAdd];
				nodecg.log.info(`Card ${idToAdd} added to Player ${side}'s deck.`);
			} else {
				nodecg.log.info(`Card ${idToAdd} is already in Player ${side}'s deck. No changes made.`);
			}
			if (callback) callback(null, 'Card added to deck.');
		};

		// Use the sanitized ID for all checks and operations.
		if (db && db[sanitizedCardId] && db[sanitizedCardId].name) {
			nodecg.log.info(`Card ${sanitizedCardId} found in database. Adding to deck.`);
			addCardToDeck(sanitizedCardId);
		} else {
			nodecg.log.info(`Card ${sanitizedCardId} not in database. Fetching with get_single_card.py...`);
			
			const pythonDir = path.join(__dirname, '..', 'python');
			const lang = (ptcgSettings.value && ptcgSettings.value.language) || 'jp';

			const scriptMap = {
				jp: 'get_single_card_jp.py',
				chs: 'get_single_card_chs.py',
				cht: 'get_single_card_cht.py',
				en: 'get_single_card_en.py',
			};
			const pythonScriptFile = scriptMap[lang] || scriptMap.jp;
			const pythonScriptPath = path.join(pythonDir, pythonScriptFile);

			const dbFileName = `database_${lang}.json`;
			const absoluteDbPath = path.join(projectRoot, 'nodecg', 'assets', 'ptcg-telop', dbFileName);

			const pythonCommand = os.platform() === 'win32' ? 'python' : 'python3';
			const command = `${pythonCommand} "${pythonScriptPath}" "${sanitizedCardId}" --database-path "${absoluteDbPath}"`;

			exec(command, { cwd: pythonDir }, (error, stdout, stderr) => {
				if (error) {
					nodecg.log.error(`exec error while fetching single card: ${error}`);
					nodecg.log.error(`Python stderr: ${stderr}`);
					if (callback) callback({ error: error.message, stderr: stderr });
					return;
				}

				nodecg.log.info(`Python script for ${sanitizedCardId} finished. Reloading database.`);
				loadCardDatabase();
				
				// CRITICAL FIX: Check for the sanitized ID and add the sanitized ID.
				if (cardDatabase.value && cardDatabase.value[sanitizedCardId] && cardDatabase.value[sanitizedCardId].name) {
					addCardToDeck(sanitizedCardId);
				} else {
					nodecg.log.error(`Failed to fetch card ${sanitizedCardId} with python script. It was not added to the database. Check python script output.`);
					if (callback) callback({ error: `Failed to fetch card ${sanitizedCardId}.` });
				}
			});
		}
	});

	nodecg.listenFor('removeCardFromDeck', ({ side, cardId }, callback) => {
		nodecg.log.info(`Request to remove card ${cardId} from Player ${side}'s deck.`);
	
		const deckReplicant = side === 'L' ? deckL : deckR;
		const currentCards = deckReplicant.value.cards;
	
		if (Array.isArray(currentCards)) {
			const initialLength = currentCards.length;
			const newCards = currentCards.filter(id => id !== cardId);

			if (newCards.length < initialLength) {
				deckReplicant.value.cards = newCards; // Update the replicant
				nodecg.log.info(`Card ${cardId} removed from Player ${side}'s deck.`);
				if (callback) callback(null, 'Card removed.');
			} else {
				const msg = `Card ${cardId} not found in Player ${side}'s deck.`;
				nodecg.log.warn(msg);
				if (callback) callback(new Error(msg));
			}
		} else {
			const msg = `Player ${side}'s deck.cards is not an array.`;
			nodecg.log.error(msg);
			if (callback) callback(new Error(msg));
		}
	});

	/**
	 * Applies a single operation object to a given replicant.
	 * This is a helper function used by both queueOperation and applyQueue.
	 * @param {object} replicant - The NodeCG replicant to modify.
	 * @param {object} op - The operation object.
	 */
	function applyOperationLogic(replicant, op, mode) {
		const { type, payload } = op;
		const { value, cardId, toolId, ailments, energyIndex } = payload;

		// Helper to select replicant prefix based on mode
		const prefix = mode === 'draft' ? 'draft_' : 'live_';

		// Ensure replicant.value is an object before modification, for slot-based operations.
		// This check is bypassed for simpler replicants or operations that manage their own replicants.
		if (type !== 'SET_POKEMON' && type !== 'SWITCH_POKEMON' && type !== 'SET_ACTION_STATUS' && type !== 'SET_TURN' && type !== 'SET_SIDES' && type !== 'ATTACK' && type !== 'SET_STADIUM' && type !== 'SET_STADIUM_USED' && type !== 'SET_ABILITY_USED' && type !== 'SET_VSTAR_STATUS' && type !== 'SET_LOST_ZONE' && type !== 'SET_KO_STATUS' && (!replicant || typeof replicant.value !== 'object' || replicant.value === null)) {
			// For PROMOTE, the logic handles its own replicants. For others, if the replicant is not ready, abort.
			if (type !== 'SWITCH_POKEMON') {
				nodecg.log.warn(`Operation ${type} aborted: replicant or its value is not a valid object.`);
				return;
			}
		}

		switch(type) {
			case 'SET_KO_STATUS':
				if (replicant && replicant.value) {
					replicant.value.isKO = payload.status;
				}
				break;
			case 'SET_VSTAR_STATUS':
				replicant.value = payload.used;
				break;
			case 'SET_ACTION_STATUS':
				replicant.value = payload.status;
				break;
			case 'SET_SIDES':
				replicant.value = payload.value;
				break;
			case 'SET_LOST_ZONE':
				replicant.value = payload.value;
				break;
			case 'SET_STADIUM':
				replicant.value = { cardId: payload.cardId, used: false }; // Reset used status when stadium changes
				break;
			case 'SET_STADIUM_USED':
				if (replicant.value) {
					replicant.value.used = payload.used;
				}
				break;
			case 'SET_ABILITY_USED':
				if (replicant && replicant.value) {
					replicant.value.abilityUsed = payload.status;
				}
				break;
			case 'SET_POKEMON':
				replicant.value = {
					cardId: cardId, damage: 0, extraHp: 0, attachedEnergy: [], attachedToolIds: [],
					ailments: (payload.target && payload.target.endsWith('0')) ? [] : undefined
				};
				// Clean up undefined properties
				if (replicant.value.ailments === undefined) delete replicant.value.ailments;
				break;
			case 'REPLACE_POKEMON':
				replicant.value.cardId = cardId;
				// Evolving or Devolving clears status conditions, but replacing does not.
				if (payload.actionType === 'Evolve' || payload.actionType === 'Devolve') {
					if (replicant.value.ailments) {
						replicant.value.ailments = [];
					}
				}
				// Add a unified evolutionSelect flag.
				replicant.value.evolutionSelect = true;
				break;
			case 'SET_DAMAGE':
				replicant.value.damage = value;
				const db = cardDatabase.value;
				if (replicant.value.cardId && db && db[replicant.value.cardId]) {
					const card = db[replicant.value.cardId];
					if (card && card.pokemon) {
						const baseHp = parseInt(card.pokemon.hp || 0, 10);
						const extraHp = parseInt(replicant.value.extraHp || 0, 10);
						const currentHp = (baseHp + extraHp) - replicant.value.damage;
						if (currentHp <= 0) {
							replicant.value.isKO = true;
						}
					}
				}
				break;
			case 'SET_EXTRA_HP':
				replicant.value.extraHp = value;
				break;
                                    case 'SET_TOOLS': {
                const toolLimit = (ptcgSettings.value && ptcgSettings.value.toolLimit) || 4;
                const currentTools = replicant.value.attachedToolIds || [];
                const newTools = payload.tools || [];

                // Check if this is an addition
                if (newTools.length > currentTools.length) {
                    // It's an addition, so we must respect the limit.
                    if (newTools.length <= toolLimit) {
                        replicant.value.attachedToolIds = [...newTools];
                        nodecg.log.info(`SET_TOOLS (add): target=${payload.target}, current=${JSON.stringify(replicant.value.attachedToolIds)}`);
                    } else {
                        nodecg.log.warn(`SET_TOOLS_FAILED (add): Limit of ${toolLimit} reached. Cannot add.`);
                    }
                } else {
                    // It's a removal or reorder, which should always be allowed.
                    replicant.value.attachedToolIds = [...newTools];
                    nodecg.log.info(`SET_TOOLS (remove/reorder): target=${payload.target}, current=${JSON.stringify(replicant.value.attachedToolIds)}`);
                }
                break;
            }
			case 'REMOVE_POKEMON': {
				// Reset the slot to its default empty state
				const isBattleSlot = replicant.name.endsWith('0');
				replicant.value = {
					cardId: null, damage: 0, extraHp: 0, attachedEnergy: [], attachedToolIds: [],
					...(isBattleSlot && { ailments: [] })
				};

				// Queue a simple exit animation for non-KO removal
				const slotId = replicant.name.replace(/^draft_/, '').replace(/^live_/, '');
				operationQueue.value.push({
					type: 'EXIT_POKEMON',
					payload: { target: slotId },
					id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
				});
				break;
			}
			case 'KO_POKEMON': {
				// First, save the cardId
				const prevCardId = replicant.value.cardId;
				// Reset the slot to its default empty state, preserving the structure
				const isBattleSlot = replicant.name.endsWith('0');
				replicant.value = {
					cardId: null, damage: 0, extraHp: 0, attachedEnergy: [], attachedToolIds: [],
					...(isBattleSlot && { ailments: [] })
				};
				// Auto-prize card logic
				const autoSideTake = ptcgSettings.value && ptcgSettings.value.autoSideTake;
				if (autoSideTake) {
					// Determine which side was KO'd
					const slotId = replicant.name.replace(/^draft_/, '').replace(/^live_/, '');
					const side = slotId.charAt(4); // "slotL3" -> "L" or "R"
					const isL = side === 'L';

					// As long as a Pokémon is knocked out, the opponent takes prize cards (turn check removed).
					let prizeCount = 1;
					if (prevCardId && cardDatabase.value[prevCardId] && cardDatabase.value[prevCardId].addRule) {
						const addRule = cardDatabase.value[prevCardId].addRule;
						const m = addRule.match(/がきぜつしたとき、相手はサイドを(\d+)枚とる/);
						if (m) {
							prizeCount = parseInt(m[1], 10);
						}
						// Compatible with Chinese/English/etc.
						else if (/2張|昏厥时，对手将拿取2张奖赏卡|2 Prize/i.test(addRule)) prizeCount = 2;
						else if (/3張|昏厥时，对手将拿取3张奖赏卡|3 Prize/i.test(addRule)) prizeCount = 3;
					}
					// draft_sideL/draft_sideR
					const draftSideRep = isL ? draft_sideR : draft_sideL;
					const sideKey = isL ? 'sideR' : 'sideL';
					const newValue = Math.max(0, (draftSideRep.value || 0) - prizeCount);

					// Assign immediately to ensure UI sync
					draftSideRep.value = newValue;

					// Automatically add operation to the queue
					operationQueue.value.push({
						type: 'SET_SIDES',
						payload: { target: sideKey, value: newValue },
						id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
					});
				}
				break;
			}
			case 'SET_AILMENTS':
				if (replicant.name.endsWith('0')) {
					replicant.value.ailments = [...ailments];
				}
				break;
			case 'SET_ENERGIES':
				replicant.value.attachedEnergy = [...payload.energies];
				break;
			case 'SWITCH_POKEMON': {
                const { source, target } = payload;
                if (!source || !target) {
                    nodecg.log.error('Invalid PROMOTE operation: source or target missing.', payload);
                    return;
                }

                const side = source.charAt(4); // "slotL1" -> "L"
                const sourceRep = nodecg.Replicant(`${prefix}${source}`);
                const targetRep = nodecg.Replicant(`${prefix}${target}`);

                // Directly get deep copies of the values
                const sourceVal = JSON.parse(JSON.stringify(sourceRep.value || {}));
                const targetVal = JSON.parse(JSON.stringify(targetRep.value || {}));

				// Force slide-in animation for both source and target
				sourceVal.forceSlideIn = true;
				targetVal.forceSlideIn = true;


                // Core logic: When a Pokémon moves into a battle slot (or swaps with it), its ailments are cleared.
                // Check if the target is a battle slot
                if (target.endsWith('0')) {
                    if (sourceVal.cardId) { // Ensure we're not moving an empty slot's "ghost"
                        sourceVal.ailments = [];
                    }
                }
                // Check if the source is a battle slot and the target is not
                if (source.endsWith('0') && !target.endsWith('0')) {
                     if (targetVal.cardId) {
                        targetVal.ailments = [];
                    }
                }

                // Perform the swap
                sourceRep.value = targetVal;
                targetRep.value = sourceVal;
				
				// --- Auto Retreat Logic ---
				const autoRetreat = ptcgSettings.value && ptcgSettings.value.autoRetreatToggle;
				if (autoRetreat) {
					// Check if it involves the Active Spot
					if (source === 'slotL0') {
						nodecg.Replicant('draft_action_retreat_L').value = true;
						operationQueue.value.push({
							type: 'SET_ACTION_STATUS',
							payload: { target: 'action_retreat_L', status: true },
							id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
						});
					}
					if (source === 'slotR0') {
						nodecg.Replicant('draft_action_retreat_R').value = true;
						operationQueue.value.push({
						type: 'SET_ACTION_STATUS',
						payload: { target: 'action_retreat_R', status: true },
						id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
					});
					}
				}
                break;
            }
            case 'ATTACK': {
                // This operation is not slot-specific in its call, so it doesn't use the 'replicant' parameter.
                // It constructs the replicant name itself based on the payload and mode.
                
                // Robustness: Handle both single target string and array of targets
                const targets = Array.isArray(payload.targets) ? payload.targets : [payload.target];

                targets.forEach(slotId => {
                    if (!slotId) return; // Skip if a target is invalid
                    const prefix = mode === 'draft' ? 'draft_' : 'live_';
                    const targetRep = nodecg.Replicant(slotId.replace('slot', prefix + 'slot'));
                    if (targetRep && targetRep.value) {
                        // Ensure damage is treated as a number
                        const currentDamage = Number(targetRep.value.damage) || 0;
                        const newDamage = Number(payload.damage) || 0;
                        targetRep.value.damage = currentDamage + newDamage;

                        // After applying damage, check if the Pokémon is knocked out.
                        const db = cardDatabase.value;
                        if (targetRep.value.cardId && db && db[targetRep.value.cardId]) {
                            const card = db[targetRep.value.cardId];
                            if (card && card.pokemon) {
                                const baseHp = parseInt(card.pokemon.hp || 0, 10);
                                const extraHp = parseInt(targetRep.value.extraHp || 0, 10);
                                const currentHp = (baseHp + extraHp) - targetRep.value.damage;
                                if (currentHp <= 0) {
                                    targetRep.value.isKO = true;
                                }
                            }
                        }
                    }
                });
                break;
            }
            
                        case 'SET_TURN': {
                const turnRep = nodecg.Replicant(`${prefix}currentTurn`);
                turnRep.value = payload.side;
                // When a turn ends, reset all individual action statuses for both players
                ['L', 'R'].forEach(side => {
                    actionTypes.forEach(action => {
                        nodecg.Replicant(`${prefix}action_${action}_${side}`).value = false;
                    });
                });
                // Also reset all ability used statuses
                for (let i = 0; i < 9; i++) {
                    nodecg.Replicant(`${prefix}slotL${i}`).value.abilityUsed = false;
                    nodecg.Replicant(`${prefix}slotR${i}`).value.abilityUsed = false;
                }
                // Reset stadium used status
                const stadiumRep = nodecg.Replicant(`${prefix}stadium`);
                if (stadiumRep.value) {
                    stadiumRep.value = { ...stadiumRep.value, used: false };
                }

                // Auto-trash Technical Machines if the setting is enabled
                if (ptcgSettings.value.autoTrashTM) {
                    const db = cardDatabase.value;
                    for (let i = 0; i < 9; i++) {
                        ['L', 'R'].forEach(side => {
                            const slotId = `slot${side}${i}`;
                            const slotRep = nodecg.Replicant(`${prefix}${slotId}`);
                            if (slotRep.value && slotRep.value.attachedToolIds && slotRep.value.attachedToolIds.length > 0) {
                                const initialTools = slotRep.value.attachedToolIds;
                                const toolsToKeep = initialTools.filter(toolId => {
                                    const cardData = db[toolId];
                                    return !(cardData && cardData.subtype === 'tool' && cardData.trainer?.attacks);
                                });

                                if (initialTools.length !== toolsToKeep.length) {
                                    // Use queueOperation directly to add a new, distinct operation
                                    nodecg.sendMessage('queueOperation', {
                                        type: 'SET_TOOLS',
                                        payload: {
                                            target: slotId,
                                            tools: toolsToKeep
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
                break;
            }
            case 'SET_ACTION_STATUS': {
                // The replicant is now found by its target name, e.g., "action_energy_L"
                const { status } = payload;
                replicant.value = status;
                break;
            }

			case 'EXIT_POKEMON':
				// This is an animation-only operation, no data logic needed.
				break;

			default:
				nodecg.log.warn(`Unknown operation type during logic application: ${type}`);
		}
	}

	/**
	 * Adds an operation to the queue AND applies it to the DRAFT state.
	 */
	nodecg.listenFor('queueOperation', (op, callback) => {
		if (!op || !op.type || !op.payload) {
			return callback(new Error('Invalid operation object.'));
		}

		// Apply the logic to the DRAFT state for immediate feedback
		if (op.type === 'SET_VSTAR_STATUS' || op.type === 'SET_ACTION_STATUS' || op.type === 'SET_SIDES' || op.type === 'SET_LOST_ZONE') {
			const draftRep = nodecg.Replicant(`draft_${op.payload.target}`);
			applyOperationLogic(draftRep, op, 'draft');
		} else if (op.type === 'SET_STADIUM' || op.type === 'SET_STADIUM_USED') {
			applyOperationLogic(draft_stadium, op, 'draft');
		} else if (op.payload.target && op.payload.target.startsWith('slot')) {
			const draftRep = nodecg.Replicant(op.payload.target.replace('slot', 'draft_slot'));
			applyOperationLogic(draftRep, op, 'draft');
		} else {
			// Handle other non-slot-based operations
			applyOperationLogic(null, op, 'draft');
		}

		// Add the operation to the queue
		op.id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
		operationQueue.value.push(op);
		nodecg.log.info(`Operation queued: ${op.type}`);

		// If auto-apply is on, try to process the queue.
		if (ptcgSettings.value && ptcgSettings.value.autoApply) {
			nodecg.sendMessage('applyQueue');
		}

		if (callback) callback(null, op.id);
	});

	/**
	 * Updates an existing operation in the queue and re-applies the entire queue to the DRAFT state.
	 */
	nodecg.listenFor('updateOperation', ({ index, payload }, callback) => {
		const queue = operationQueue.value;
		if (!queue || !queue[index]) {
			const errorMsg = `Invalid index for updateOperation: ${index}`;
			nodecg.log.error(errorMsg);
			if (callback) callback(new Error(errorMsg));
			return;
		}

		try {
			// 1. Create a new queue with the updated operation
            const newQueue = queue.map((op, i) => {
                if (i === index) {
                    return { ...op, payload: { ...op.payload, ...payload } };
                }
                return op;
            });
			operationQueue.value = newQueue;

			// 2. Identify all affected draft replicants
			const affectedSlots = new Set();
			newQueue.forEach(op => {
				if (op.payload.target && op.payload.target.startsWith('slot')) {
					affectedSlots.add(op.payload.target);
				}
				if (op.payload.targets) { // For multi-target ops like ATTACK
					op.payload.targets.forEach(t => affectedSlots.add(t));
				}
			});

			// 3. Reset all affected DRAFT states to their LIVE counterparts
			affectedSlots.forEach(slotId => {
				const liveRep = nodecg.Replicant(slotId.replace('slot', 'live_slot'));
				const draftRep = nodecg.Replicant(slotId.replace('slot', 'draft_slot'));
				draftRep.value = JSON.parse(JSON.stringify(liveRep.value));
			});
			// Also reset turn and action statuses to live state before re-applying queue
			draft_currentTurn.value = live_currentTurn.value;
			['L', 'R'].forEach(side => {
				actionTypes.forEach(action => {
					const liveRep = nodecg.Replicant(`live_action_${action}_${side}`);
					const draftRep = nodecg.Replicant(`draft_action_${action}_${side}`);
					draftRep.value = liveRep.value;
				});
                // Reset VSTAR status as well
                const liveVstarRep = nodecg.Replicant(`live_vstar_${side}`);
                const draftVstarRep = nodecg.Replicant(`draft_vstar_${side}`);
                draftVstarRep.value = liveVstarRep.value;
			});
            draft_sideL.value = live_sideL.value;
            draft_sideR.value = live_sideR.value;
            draft_lostZoneL.value = live_lostZoneL.value;
            draft_lostZoneR.value = live_lostZoneR.value;


			// 4. Re-apply the entire new queue to the DRAFT states
			newQueue.forEach(op => {
				// Skip PROMOTE operations as they should not affect the draft state until applied.
				if (op.type === 'SWITCH_POKEMON') return;

				if (op.type === 'SET_VSTAR_STATUS' || op.type === 'SET_ACTION_STATUS' || op.type === 'SET_SIDES' || op.type === 'SET_LOST_ZONE') {
					const draftRep = nodecg.Replicant(`draft_${op.payload.target}`);
					applyOperationLogic(draftRep, op, 'draft');
				} else if (op.type === 'SET_STADIUM' || op.type === 'SET_STADIUM_USED') {
					applyOperationLogic(draft_stadium, op, 'draft');
				} else if (op.payload.target && op.payload.target.startsWith('slot')) {
					const draftRep = nodecg.Replicant(op.payload.target.replace('slot', 'draft_slot'));
					applyOperationLogic(draftRep, op, 'draft');
				} else {
					applyOperationLogic(null, op, 'draft');
				}
			});

			nodecg.log.info(`Operation at index ${index} updated and queue re-applied to draft.`);
			if (callback) callback(null, `Operation at index ${index} updated.`);

		} catch (e) {
			nodecg.log.error(`Failed to update operation at index ${index}:`, e);
			if (callback) callback(e);
		}
	});

	/**
	 * Helper function to sync all LIVE replicant values to their DRAFT counterparts.
	 */
	function syncLiveToDraft() {
		for (let i = 0; i < 9; i++) { // Changed from 6 to 9
			['L', 'R'].forEach(side => {
				const liveRep = nodecg.Replicant(`live_slot${side}${i}`);
				const draftRep = nodecg.Replicant(`draft_slot${side}${i}`);
				draftRep.value = JSON.parse(JSON.stringify(liveRep.value));
			});
		}
		draft_currentTurn.value = live_currentTurn.value;
		['L', 'R'].forEach(side => {
			actionTypes.forEach(action => {
				const liveRep = nodecg.Replicant(`live_action_${action}_${side}`);
				const draftRep = nodecg.Replicant(`draft_action_${action}_${side}`);
				draftRep.value = liveRep.value;
			});
			// Sync VSTAR status
			const liveVstarRep = nodecg.Replicant(`live_vstar_${side}`);
			const draftVstarRep = nodecg.Replicant(`draft_vstar_${side}`);
			draftVstarRep.value = liveVstarRep.value;
		});
		draft_sideL.value = live_sideL.value;
		draft_sideR.value = live_sideR.value;
		draft_lostZoneL.value = live_lostZoneL.value;
		draft_lostZoneR.value = live_lostZoneR.value;
		// Critical fix: Must use a deep copy for objects to avoid Replicant ownership conflicts
		draft_stadium.value = JSON.parse(JSON.stringify(live_stadium.value));
	}

	/**
	 * Applies all operations in the queue to the LIVE state, with delays for animations.
	 * This function implements a locking and buffering mechanism to handle "auto-apply".
	 */
	let isApplyingQueue = false;
	nodecg.listenFor('applyQueue', (data, callback) => {
		// If the queue is already being processed, do nothing. The new operations will be handled in the next cycle.
		if (isApplyingQueue) {
			nodecg.log.info('Queue application is already in progress. New operations are buffered.');
			if (callback) callback(null, 'Queue application buffered.');
			return;
		}

		// If the queue is empty, do nothing.
		if (!operationQueue.value || operationQueue.value.length === 0) {
			if (callback) callback(null, 'Queue is empty.');
			return;
		}

		// 1. Lock the process and take a snapshot of the queue for processing.
		isApplyingQueue = true;
		const opsToProcess = [...operationQueue.value];
		operationQueue.value = []; // Clear the queue immediately.
		nodecg.log.info(`Applying queue with ${opsToProcess.length} operations.`);

		try {
			// 2. Sort queue by priority, then by time (implicit).
			const sortedQueue = opsToProcess.sort((a, b) => (a.payload.priority || 99) - (b.payload.priority || 99));

			// 3. Separate operations into animation groups.
			const attackOps = sortedQueue.filter(op => op.type === 'ATTACK');
			const nonAttackOps = sortedQueue.filter(op => op.type !== 'ATTACK');
			
			// Group attack operations (same as before)
			const attackGroups = new Map();
			attackOps.forEach(op => {
				const { attackerSlotId, attackName, damage, target, targets } = op.payload;
				const attacker = attackerSlotId;
				const move = attackName;
				const groupKey = `${attacker}_${move}`;
				if (!attacker || !move) return;
				if (!attackGroups.has(groupKey)) {
					attackGroups.set(groupKey, { attacker, moveName: move, attackerSide: attacker.charAt(4), targets: [] });
				}
				const group = attackGroups.get(groupKey);
				const actualTargets = Array.isArray(targets) ? targets : [target];
				actualTargets.forEach(targetId => {
					if (!targetId) return;
					group.targets.push({ targetId, targetSide: targetId.charAt(4), damage, isWeakness: op.payload.isWeakness });
				});
			});

			// --- 4. Trigger Animations ---
			attackGroups.forEach(group => {
				const attackerRep = nodecg.Replicant(`live_${group.attacker}`);
				if (attackerRep.value && attackerRep.value.cardId) {
					const cardData = cardDatabase.value[attackerRep.value.cardId];
					if (cardData) {
						group.attackerName = cardData.name;
						group.attackerType = (cardData.pokemon && cardData.pokemon.color && cardData.pokemon.color.length > 0) ? cardData.pokemon.color[0] : 'Colorless';
					}
				}
				nodecg.log.info(`Sending attack-fx for ${group.moveName}`);
				nodecg.sendMessage('attack-fx', group);
			});

			const promoteOps = nonAttackOps.filter(op => op.type === 'SWITCH_POKEMON');
			const removeOps = nonAttackOps.filter(op => op.type === 'REMOVE_POKEMON');
			const koOps = nonAttackOps.filter(op => op.type === 'KO_POKEMON');
			const replaceOps = nonAttackOps.filter(op => op.type === 'REPLACE_POKEMON');
			const otherOps = sortedQueue.filter(op => !promoteOps.includes(op) && !removeOps.includes(op) && !koOps.includes(op) && !replaceOps.includes(op));

			otherOps.forEach(op => {
				if (op.type === 'SET_POKEMON' && op.payload.target && op.payload.target.startsWith('slot')) {
					const liveRep = nodecg.Replicant(`live_${op.payload.target}`);
					if (liveRep.value && !liveRep.value.cardId) {
						nodecg.sendMessage('playAnimation', { type: 'ENTER_POKEMON', target: op.payload.target.replace('slot', 'slot-') });
					}
				}
			});
			promoteOps.forEach(op => nodecg.sendMessage('playAnimation', { type: 'SWITCH_POKEMON', source: op.payload.source.replace('slot', 'slot-'), target: op.payload.target.replace('slot', 'slot-') }));
			removeOps.forEach(op => nodecg.sendMessage('playAnimation', { type: 'EXIT_POKEMON', target: op.payload.target.replace('slot', 'slot-') }));
			koOps.forEach(op => nodecg.sendMessage('playAnimation', { type: 'KO_POKEMON', target: op.payload.target.replace('slot', 'slot-') }));
			replaceOps.forEach(op => {
				let animationType = 'REPLACE_POKEMON';
				if (op.payload.actionType === 'Evolve') animationType = 'EVOLVE_POKEMON';
				else if (op.payload.actionType === 'Devolve') animationType = 'DEVOLVE_POKEMON';
				nodecg.sendMessage('playAnimation', { type: animationType, target: op.payload.target.replace('slot', 'slot-'), cardId: op.payload.cardId });
			});

			// --- 5. Apply Data Changes ---
			otherOps.forEach(op => {
				if (op.type === 'SET_VSTAR_STATUS' || op.type === 'SET_ACTION_STATUS' || op.type === 'SET_SIDES' || op.type === 'SET_LOST_ZONE') {
					applyOperationLogic(nodecg.Replicant(`live_${op.payload.target}`), op, 'live');
				} else if (op.type === 'SET_STADIUM' || op.type === 'SET_STADIUM_USED') {
					applyOperationLogic(live_stadium, op, 'live');
				} else if (op.payload.target && op.payload.target.startsWith('slot')) {
					applyOperationLogic(nodecg.Replicant(op.payload.target.replace('slot', 'live_slot')), op, 'live');
				} else {
					applyOperationLogic(null, op, 'live');
				}
			});

			let maxDelay = 0;
			if (attackGroups.size > 0) maxDelay = Math.max(maxDelay, 2000);
			if (promoteOps.length > 0 || removeOps.length > 0 || replaceOps.length > 0) {
				const delay = 500;
				maxDelay = Math.max(maxDelay, delay);
				setTimeout(() => {
					promoteOps.forEach(op => applyOperationLogic(null, op, 'live'));
					removeOps.forEach(op => applyOperationLogic(nodecg.Replicant(op.payload.target.replace('slot', 'live_slot')), op, 'live'));
					replaceOps.forEach(op => applyOperationLogic(nodecg.Replicant(op.payload.target.replace('slot', 'live_slot')), op, 'live'));
				}, delay);
			}
			if (koOps.length > 0) {
				const delay = 1500;
				maxDelay = Math.max(maxDelay, delay);
				setTimeout(() => {
					koOps.forEach(op => applyOperationLogic(nodecg.Replicant(op.payload.target.replace('slot', 'live_slot')), op, 'live'));
				}, delay);
			}

			// 6. Schedule the process to end, release the lock, and chain to the next batch of operations.
			setTimeout(() => {
				nodecg.log.info('Queue batch applied.');
				isApplyingQueue = false; // Release the lock.
				if (callback) callback(null, 'Queue batch applied successfully.');

				// IMPORTANT: Check if new operations were buffered during the animation and start the next cycle.
				if (operationQueue.value.length > 0) {
					nodecg.log.info('Buffered operations found. Starting next apply cycle.');
					nodecg.sendMessage('applyQueue');
				}
			}, maxDelay);

		} catch (e) {
			nodecg.log.error('Failed to apply queue:', e);
			isApplyingQueue = false; // Ensure lock is released on error.
			if (callback) callback(e);
		}
	});

	/**
	 * Discards the queue and reverts DRAFT state to LIVE state.
	 */
	nodecg.listenFor('discardQueue', (data, callback) => {
		// 1. Clear the queue
		operationQueue.value = [];

		// 2. Revert draft state by copying live state over
		syncLiveToDraft();

		nodecg.log.info('Operation queue discarded and draft state reverted.');
		if (callback) callback(null, 'Queue discarded.');
	});

	// Listen for a message to reset the entire board state
	function executeResetSystem(callback) {
		nodecg.log.warn('!!! Executing system state reset !!!');

		try {
			// Reset Operation Queue
			operationQueue.value = [];

			// Reset Selections
			selections.value = [];

			// Reset Deck Loading Status
			deckLoadingStatus.value = { loading: false, side: null };

			// Reset Decks
			deckL.value = { name: '', cards: [] };
			deckR.value = { name: '', cards: [] };

			// Reset all player slots (both LIVE and DRAFT)
			for (let i = 0; i < 9; i++) {
				const slotDefault = {
					cardId: null, damage: 0, extraHp: 0, attachedEnergy: [], attachedToolIds: [], abilityUsed: false,
				};
				if (i === 0) {
					slotDefault.ailments = [];
				}
				nodecg.Replicant(`live_slotL${i}`).value = JSON.parse(JSON.stringify(slotDefault));
				nodecg.Replicant(`draft_slotL${i}`).value = JSON.parse(JSON.stringify(slotDefault));
				nodecg.Replicant(`live_slotR${i}`).value = JSON.parse(JSON.stringify(slotDefault));
				nodecg.Replicant(`draft_slotR${i}`).value = JSON.parse(JSON.stringify(slotDefault));
			}

			// Reset Turn and Action Status (both LIVE and DRAFT)
			live_currentTurn.value = 'L';
			draft_currentTurn.value = 'L';
			['L', 'R'].forEach(side => {
				actionTypes.forEach(action => {
					nodecg.Replicant(`live_action_${action}_${side}`).value = false;
					nodecg.Replicant(`draft_action_${action}_${side}`).value = false;
				});
				// Reset VSTAR status
				nodecg.Replicant(`live_vstar_${side}`).value = false;
				nodecg.Replicant(`draft_vstar_${side}`).value = false;
			});

			// Reset Side/Prize Replicants
			live_sideL.value = 6;
			draft_sideL.value = 6;
			live_sideR.value = 6;
			draft_sideR.value = 6;

			// Reset Lost Zone
			nodecg.Replicant('live_lostZoneL').value = 0;
			nodecg.Replicant('draft_lostZoneL').value = 0;
			nodecg.Replicant('live_lostZoneR').value = 0;
			nodecg.Replicant('draft_lostZoneR').value = 0;

			// Reset Stadium
			live_stadium.value = { cardId: null };
			draft_stadium.value = { cardId: null };
			
			nodecg.log.info('System state has been completely reset.');
			if (callback) callback(null, 'System reset successfully.');

		} catch (e) {
			nodecg.log.error('Failed to reset system state:', e);
			if (callback) callback(e.toString());
		}
	}

	nodecg.listenFor('resetSystem', (data, callback) => {
		executeResetSystem(callback);
	});

	// Helper function to handle the logic for auto-checking supporter action
	function handleCardToShowChange(cardUrl, side) {
		if (!ptcgSettings.value.autoCheckSupporter) return;
		if (!cardUrl) return;

		const match = cardUrl.match(/\/([^/]+)\.(jpg|png|jpeg|webp)$/i);
		if (!match) return;

		const cardId = match[1];
		const db = cardDatabase.value;
		const cardData = db[cardId];

		if (cardData && cardData.supertype === 'trainer' && cardData.subtype === 'supporter') {
			const currentTurn = draft_currentTurn.value;
			if (currentTurn === side) {
				const actionStatusTarget = `action_supporter_${side}`;
				// Use queueOrUpdateOperation to avoid duplicate operations
				nodecg.sendMessage('queueOperation', {
					type: 'SET_ACTION_STATUS',
					payload: {
						target: actionStatusTarget,
						status: true
					}
				});
				nodecg.log.info(`Auto-checked supporter for Player ${side} due to viewing card ${cardId}.`);
			}
		}
	}

	// Listen for changes on the card-to-show replicants
	cardToShowL.on('change', (newValue) => handleCardToShowChange(newValue, 'L'));
	cardToShowR.on('change', (newValue) => handleCardToShowChange(newValue, 'R'));

	nodecg.listenFor('clearDatabase', (data, callback) => {
		nodecg.log.warn('!!! Received request to clear database and card images !!!');
		try {
			const lang = (ptcgSettings.value && ptcgSettings.value.language) || 'jp';

			// 1. Clear card images
			const cardImgDirName = `card_img_${lang}`;
			const cardImgDir = path.join(projectRoot, 'nodecg', 'assets', 'ptcg-telop', cardImgDirName);
			if (fs.existsSync(cardImgDir)) {
				const files = fs.readdirSync(cardImgDir);
				for (const file of files) {
					fs.unlinkSync(path.join(cardImgDir, file));
				}
				nodecg.log.info(`All files in ${cardImgDirName} directory have been deleted.`);
			} else {
				nodecg.log.warn(`Card image directory for language '${lang}' not found. Skipping deletion.`);
			}

			// 2. Clear database file
			const dbFileName = `database_${lang}.json`;
			const dbPath = path.join(projectRoot, 'nodecg', 'assets', 'ptcg-telop', dbFileName);
			if (fs.existsSync(dbPath)) {
			    fs.writeFileSync(dbPath, '{}', 'utf8');
			    nodecg.log.info(`Database file at ${dbPath} has been cleared.`);
			} else {
			    nodecg.log.warn(`Database file for language '${lang}' not found. Skipping clear.`);
			}

			// 3. Reload in-memory database
			loadCardDatabase();

			// 4. Execute system reset
			executeResetSystem(); // This function handles its own logging.

			if (callback) callback(null, 'Database cleared and system reset successfully.');
		} catch (e) {
			nodecg.log.error('Failed to clear database and reset system:', e);
			if (callback) callback(e);
		}
	});

    };


// --- Helper Functions for Replicant Sync ---
function syncReplicant(nodecg, liveName, draftName, defaultValue) {
    const liveRep = nodecg.Replicant(liveName, { defaultValue });
    const draftRep = nodecg.Replicant(draftName, { defaultValue });
    liveRep.once('change', (newValue) => {
        if (JSON.stringify(newValue) !== JSON.stringify(draftRep.value)) {
            draftRep.value = JSON.parse(JSON.stringify(newValue));
        }
    });
}
