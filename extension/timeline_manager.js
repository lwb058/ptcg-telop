'use strict';

module.exports = function (nodecg, gameLogic) { // Modified to accept gameLogic
	// --- Replicants ---
	const matchTimer = nodecg.Replicant('matchTimer', {
		defaultValue: {
			startTime: null,
			pausedTime: 0,
			isRunning: false,
			offset: 0,
			mode: 'standby',
			elapsed: 0
		}
	});

	const gameTimeSettings = nodecg.Replicant('gameTimeSettings', {
		defaultValue: {
			limit: 1500,
			useCountdown: true
		}
	});

	// --- Migrated Replicants ---
	const timelineGameplay = nodecg.Replicant('timelineGameplay', { defaultValue: [] });
	const timelineDisplay = nodecg.Replicant('timelineDisplay', { defaultValue: [] });
	const playbackConfig = nodecg.Replicant('playbackConfig', { defaultValue: { gameplay: true, display: true } });
	const gameSetup = nodecg.Replicant('gameSetup', { defaultValue: null }); // Stores initial state
	const playbackStatus = nodecg.Replicant('playbackStatus', {
		defaultValue: {
			isPlaying: false,
			playbackTimeMs: 0,
			currentIndexGameplay: 0,
			currentIndexDisplay: 0,
			currentTime: "00:00"
		}
	});

	// --- Replicants from index.js needed here ---
	const ptcgSettings = nodecg.Replicant('ptcg-settings');
	const prizeCardsL = nodecg.Replicant('prizeCardsL');
	const prizeCardsR = nodecg.Replicant('prizeCardsR');
	const cardToShowL = nodecg.Replicant('cardToShowL');
	const cardToShowR = nodecg.Replicant('cardToShowR');
	const live_stadium = nodecg.Replicant('live_stadium');
	const firstMove = nodecg.Replicant('firstMove');
	const deckL = nodecg.Replicant('deckL');
	const deckR = nodecg.Replicant('deckR');
	const turnCount = nodecg.Replicant('turnCount');
	const cardDatabase = nodecg.Replicant('cardDatabase');
	const operationQueue = nodecg.Replicant('operationQueue');
	const bundleVersion = nodecg.Replicant('bundleVersion');

	// --- Server-side Timer Update Interval ---
	let timerUpdateInterval = null;

	function updateElapsedTime() {
		if (!matchTimer.value) return;

		let elapsed = matchTimer.value.offset;
		if (matchTimer.value.isRunning && matchTimer.value.startTime && matchTimer.value.mode === 'live') {
			elapsed += (Date.now() - matchTimer.value.startTime);
		}

		// Only update if changed to avoid unnecessary replicant updates
		if (matchTimer.value.elapsed !== elapsed) {
			matchTimer.value.elapsed = elapsed;
		}
	}

	// Start the timer update interval
	timerUpdateInterval = setInterval(updateElapsedTime, 100);

	// --- Timer Logic (from original time_manager.js) ---
	function startTimer() {
		if (matchTimer.value.isRunning) return;

		// Prepare the new timer state
		const newTimerState = { ...matchTimer.value };

		if (newTimerState.mode === 'standby') {
			newTimerState.mode = 'live';
			newTimerState.offset = 0;
		}

		// Set startTime to current time
		newTimerState.startTime = Date.now();
		newTimerState.isRunning = true;

		// Calculate initial elapsed time
		newTimerState.elapsed = newTimerState.offset;

		// Apply all changes at once to avoid race conditions
		matchTimer.value = newTimerState;
	}

	function stopTimer() {
		if (!matchTimer.value.isRunning) return;
		if (matchTimer.value.mode === 'live') {
			const now = Date.now();
			const currentRunDuration = now - matchTimer.value.startTime;
			matchTimer.value.offset += currentRunDuration;
			matchTimer.value.startTime = null;
			matchTimer.value.elapsed = matchTimer.value.offset;
		}
		matchTimer.value.isRunning = false;
	}

	function resetTimer() {
		matchTimer.value.startTime = null;
		matchTimer.value.offset = 0;
		matchTimer.value.isRunning = false;
		matchTimer.value.mode = 'standby';
		matchTimer.value.elapsed = 0;
	}

	function editTimer(newSeconds) {
		const newOffset = newSeconds * 1000;
		matchTimer.value.offset = newOffset;
		matchTimer.value.elapsed = newOffset;
		if (matchTimer.value.isRunning && matchTimer.value.mode === 'live') {
			matchTimer.value.startTime = Date.now();
		} else {
			matchTimer.value.startTime = null;
		}
	}

	nodecg.listenFor('timerControl', (data) => {
		switch (data.action) {
			case 'start':
				startTimer();
				break;
			case 'stop':
				stopTimer();
				break;
			case 'reset':
				resetTimer();
				break;
			case 'edit':
				if (typeof data.seconds === 'number') {
					editTimer(data.seconds);
				}
				break;
			case 'setLimit':
				if (typeof data.limit === 'number') {
					gameTimeSettings.value.limit = data.limit;
				}
				break;
		}
	});

	// --- Migrated Timeline Logic from index.js ---

	// Listen for Timer Start to save Game Setup
	matchTimer.on('change', (newVal, oldVal) => {
		if (oldVal && oldVal.mode === 'standby' && newVal.mode === 'live') {
			nodecg.log.info('Game Started from Standby. Saving Game Setup...');
			gameSetup.value = {
				prizeCardsL: JSON.parse(JSON.stringify(nodecg.Replicant('prizeCardsL').value)),
				prizeCardsR: JSON.parse(JSON.stringify(nodecg.Replicant('prizeCardsR').value)),
				firstMove: firstMove.value
			};
		}
	});

	// Helper to get current match time string (mm:ss)
	function getCurrentMatchTime() {
		if (!matchTimer.value) return "00:00";
		let elapsed = matchTimer.value.offset;
		if (matchTimer.value.isRunning && matchTimer.value.startTime) {
			elapsed += (Date.now() - matchTimer.value.startTime);
		}
		const totalSeconds = Math.floor(elapsed / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}

	// Helper to parse "mm:ss" to milliseconds
	function parseTime(timeStr) {
		const [mm, ss] = timeStr.split(':').map(Number);
		return (mm * 60 + ss) * 1000;
	}

	// Helper to construct card image URL (server-side version of getCardImageUrl)
	function getCardImageUrl(cardId) {
		if (!cardId) return '';
		const settings = ptcgSettings.value || {};
		const lang = settings.language || 'jp';
		// Hardcode the base path to ensure it's absolute and correct
		const basePath = `/assets/ptcg-telop/card_img_${lang}/`;

		// If cardId is already a path (contains /), return it as is (legacy support)
		if (cardId.includes('/')) return cardId;

		// Check if it's a special energy (starts with special:) - though usually handled before calling this
		if (cardId.startsWith('special:')) return '';

		// Extract extension from database (matching client-side behavior)
		const db = cardDatabase.value;
		const cardData = db ? db[cardId] : null;
		const imageUrl = cardData ? cardData.image_url : null;
		const extension = imageUrl ? imageUrl.substring(imageUrl.lastIndexOf('.')) : '.jpg'; // Fallback to .jpg

		return `${basePath}${cardId}${extension}`;
	}

	nodecg.listenFor('applyOpsPack', (data, callback) => {
		// 1. Bundle operationQueue into OpsPack
		if (!operationQueue.value || operationQueue.value.length === 0) {
			if (callback) callback(new Error('Operation queue is empty.'));
			return;
		}

		const opsPack = {
			id: `pack-${Date.now()}`,
			timestamp: getCurrentMatchTime(),
			round: turnCount.value,
			ops: JSON.parse(JSON.stringify(operationQueue.value)) // Deep copy
		};

		// Check Insert Mode setting (default to true if not set)
		const insertMode = ptcgSettings.value && typeof ptcgSettings.value.insertMode === 'boolean'
			? ptcgSettings.value.insertMode
			: true;

		if (insertMode) {
			if (matchTimer.value.mode === 'standby') {
				nodecg.log.info(`OpsPack ${opsPack.id} NOT recorded (Standby Mode).`);
			} else {
				const existingIndex = timelineGameplay.value.findIndex(
					pack => pack.timestamp === opsPack.timestamp
				);

				if (existingIndex !== -1) {
					const newTimeline = [...timelineGameplay.value];
					const existingPack = newTimeline[existingIndex];

					// Only mark as 'inserted' when in playback mode, not in live mode
					const insertedOps = matchTimer.value.mode === 'playback'
						? opsPack.ops.map(op => ({
							...op,
							source: 'inserted',
							insertedAt: Date.now()
						}))
						: opsPack.ops; // In live mode, keep operations as native

					const mergedOps = [...existingPack.ops, ...insertedOps];

					newTimeline[existingIndex] = {
						...existingPack,
						ops: mergedOps
					};

					timelineGameplay.value = newTimeline;

					nodecg.log.info(
						`${insertedOps.length} operations appended to existing OpsPack at ${opsPack.timestamp}. ` +
						`Total: ${mergedOps.length} ops (${mergedOps.filter(op => op.source === 'inserted').length} inserted)`
					);

					nodecg.sendMessage('opsPackMerged', {
						index: existingIndex,
						timestamp: opsPack.timestamp,
						totalOps: mergedOps.length,
						newOpsCount: insertedOps.length
					});
				} else {
					// Only mark as 'inserted' when in playback mode, not in live mode
					const shouldMarkInserted = matchTimer.value.mode === 'playback';

					const newOpsPack = shouldMarkInserted ? {
						...opsPack,
						ops: opsPack.ops.map(op => ({
							...op,
							source: 'inserted',
							insertedAt: Date.now()
						}))
					} : opsPack;

					const newTimeline = [...timelineGameplay.value, newOpsPack];
					newTimeline.sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));
					timelineGameplay.value = newTimeline;

					if (shouldMarkInserted) {
						nodecg.log.info(`OpsPack ${opsPack.id} created at ${opsPack.timestamp} with ${opsPack.ops.length} inserted operations (Insert Mode).`);
					} else {
						nodecg.log.info(`OpsPack ${opsPack.id} created at ${opsPack.timestamp} with ${opsPack.ops.length} native operations (Insert Mode - Live).`);
					}
				}
			}
		} else {
			// Overwrite Mode: Delete all future OpsPacks, then add
			const currentTime = parseTime(opsPack.timestamp);
			const beforeCount = timelineGameplay.value.length;
			timelineGameplay.value = timelineGameplay.value.filter(pack => parseTime(pack.timestamp) < currentTime);
			const deletedCount = beforeCount - timelineGameplay.value.length;

			timelineGameplay.value.push(opsPack);
			nodecg.log.warn(`OpsPack ${opsPack.id} recorded at ${opsPack.timestamp}. Overwrite Mode: deleted ${deletedCount} future OpsPacks.`);

			// In Overwrite Mode, treat this as a new timeline branch - switch back to live recording
			if (matchTimer.value.mode === 'playback') {
				matchTimer.value.mode = 'live';
				matchTimer.value.isRunning = true;
				matchTimer.value.startTime = Date.now();
				// offset stays at current time
				nodecg.log.info('Switched to live recording mode (Overwrite Mode).');
			}
		}

		nodecg.sendMessage('timelineRefreshed');

		// Trigger existing apply logic
		gameLogic.processQueue((err) => {
			if (err) {
				if (callback) callback(err);
			} else {
				if (callback) callback(null, 'OpsPack applied and recorded.');
			}
		});
	});

	nodecg.listenFor('recordDisplayOp', (data, callback) => {
		try {
			const { type, payload } = data;
			const timestamp = getCurrentMatchTime();

			const op = {
				type,
				payload,
				timestamp,
				id: `disp-${Date.now()}`
			};

			// Check if we are in Standby mode
			if (matchTimer.value.mode === 'standby') {
				nodecg.log.info(`Display Op recording skipped (Standby Mode): ${type}`);
				if (callback) callback(null, 'Display Op skipped (Standby Mode).');
				return;
			}

			// Check if Display Timeline is enabled
			if (playbackConfig.value && !playbackConfig.value.display) {
				nodecg.log.info(`Display Op recording skipped (Display Timeline disabled): ${type}`);
				if (callback) callback(null, 'Display Op skipped (timeline disabled).');
				return;
			}

			// Check Insert Mode setting (default to true if not set)
			const insertMode = ptcgSettings.value && typeof ptcgSettings.value.insertMode === 'boolean'
				? ptcgSettings.value.insertMode
				: true;

			if (insertMode) {
				// Insert Mode: Add and sort into correct position
				const newTimeline = [...timelineDisplay.value, op];
				newTimeline.sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));
				timelineDisplay.value = newTimeline;
				nodecg.log.info(`Recorded Display Op: ${type} at ${timestamp} (Insert Mode)`);
			} else {
				// Overwrite Mode: Delete all future Display Ops, then add
				const currentTime = parseTime(timestamp);
				const beforeCount = timelineDisplay.value.length;
				timelineDisplay.value = timelineDisplay.value.filter(displayOp => parseTime(displayOp.timestamp) < currentTime);
				const deletedCount = beforeCount - timelineDisplay.value.length;

				timelineDisplay.value.push(op);
				nodecg.log.warn(`Recorded Display Op: ${type} at ${timestamp}. Overwrite Mode: deleted ${deletedCount} future Display Ops.`);

				// In Overwrite Mode, treat this as a new timeline branch - switch back to live recording
				if (matchTimer.value.mode === 'playback') {
					matchTimer.value.mode = 'live';
					matchTimer.value.isRunning = true;
					matchTimer.value.startTime = Date.now();
					// offset stays at current time
					nodecg.log.info('Switched to live recording mode (Overwrite Mode - Display Op).');
				}
			}

			nodecg.sendMessage('timelineRefreshed');

			if (callback) callback(null, 'Display Op recorded.');
		} catch (e) {
			nodecg.log.error('recordDisplayOp error:', e);
			if (callback) callback(e);
		}
	});

	// Route messages from dashboard to graphics
	nodecg.listenFor('_showPrizeCards', (data) => {
		nodecg.log.info(`Broadcasting showPrizeCards for side: ${data.side}`);
		nodecg.sendMessage('showPrizeCards', data);

		// Check if Display Timeline is enabled before recording
		if (playbackConfig.value && !playbackConfig.value.display) {
			nodecg.log.info('Display Op recording skipped (Display Timeline disabled): SHOW_PRIZE');
			return;
		}

		// Record operation
		if (matchTimer.value.mode === 'standby') {
			nodecg.log.info('Display Op recording skipped (Standby Mode): SHOW_PRIZE');
			return;
		}
		const timestamp = getCurrentMatchTime();
		const op = {
			type: `SHOW_PRIZE_${data.side}`,
			payload: { side: data.side },
			timestamp,
			id: `disp-${Date.now()}`
		};
		// Insert Mode logic for display ops (simplified: always append and sort)
		const newTimeline = [...timelineDisplay.value, op];
		newTimeline.sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));
		timelineDisplay.value = newTimeline;
		nodecg.sendMessage('timelineRefreshed');
	});

	nodecg.listenFor('_clearCard', () => {
		nodecg.log.info('Broadcasting clearCard and clearing cardToShow replicants');
		cardToShowL.value = '';
		cardToShowR.value = '';
		nodecg.sendMessage('clearCard');

		// Check if Display Timeline is enabled before recording
		if (playbackConfig.value && !playbackConfig.value.display) {
			nodecg.log.info('Display Op recording skipped (Display Timeline disabled): HIDE_DISPLAY');
			return;
		}

		// Record operation
		if (matchTimer.value.mode === 'standby') {
			nodecg.log.info('Display Op recording skipped (Standby Mode): HIDE_DISPLAY');
			return;
		}
		const timestamp = getCurrentMatchTime();
		const op = {
			type: 'HIDE_DISPLAY',
			payload: {},
			timestamp,
			id: `disp-${Date.now()}`
		};
		const newTimeline = [...timelineDisplay.value, op];
		newTimeline.sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));
		timelineDisplay.value = newTimeline;
		nodecg.sendMessage('timelineRefreshed');
	});

	// --- Timer-Driven Playback Logic ---

	let playbackInterval = null;
	const PLAYBACK_TICK_RATE = 100;
	let playbackQueue = [];
	let isPlaybackProcessing = false;

	function stopPlaybackInterval() {
		if (playbackInterval) {
			clearInterval(playbackInterval);
			playbackInterval = null;
		}
		playbackQueue = [];
		isPlaybackProcessing = false;
	}

	function formatTimeMs(ms) {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}

	function triggerVisualsForOps(ops) {
		// Separate attack operations to build attack-fx message
		const attackOps = ops.filter(op => op.type === 'ATTACK');
		if (attackOps.length > 0) {
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
		}

		// Send animation messages
		ops.forEach(op => {
			switch (op.type) {
				case 'SLIDE_OUT': // New operation for switch animation
					nodecg.sendMessage('playAnimation', { type: 'SWITCH_POKEMON', source: op.payload.source.replace('slot', 'slot-'), target: op.payload.target.replace('slot', 'slot-') });
					break;
				case 'REMOVE_POKEMON':
					nodecg.sendMessage('playAnimation', { type: 'EXIT_POKEMON', target: op.payload.target.replace('slot', 'slot-') });
					break;
				case 'KO_POKEMON':
					nodecg.sendMessage('playAnimation', { type: 'KO_POKEMON', target: op.payload.target.replace('slot', 'slot-') });
					break;
				case 'REPLACE_POKEMON':
					let animationType = 'REPLACE_POKEMON';
					if (op.payload.actionType === 'Evolve') animationType = 'EVOLVE_POKEMON';
					else if (op.payload.actionType === 'Devolve') animationType = 'DEVOLVE_POKEMON';
					nodecg.sendMessage('playAnimation', { type: animationType, target: op.payload.target.replace('slot', 'slot-'), cardId: op.payload.cardId });
					break;
			}
		});
	}



	// Helper function to clear all display elements
	function clearDisplay() {
		cardToShowL.value = '';
		cardToShowR.value = '';
		nodecg.sendMessage('clearCard');
		nodecg.log.info('Display cleared');
	}

	// Helper to apply a single display operation
	function applyDisplayOp(op) {
		const { type, payload } = op;
		if (type === 'SHOW_CARD_L') nodecg.Replicant('cardToShowL').value = getCardImageUrl(payload.cardId);
		else if (type === 'SHOW_CARD_R') nodecg.Replicant('cardToShowR').value = getCardImageUrl(payload.cardId);
		else if (type === 'SHOW_PRIZE_L') {
			const cards = prizeCardsL.value;
			nodecg.sendMessage('showPrizeCards', { side: 'L', cards });
		}
		else if (type === 'SHOW_PRIZE_R') {
			const cards = prizeCardsR.value;
			nodecg.sendMessage('showPrizeCards', { side: 'R', cards });
		}
		else if (type === 'HIDE_DISPLAY') {
			clearDisplay();
		} else if (type === 'TOGGLE_EXTRA_BENCH') {
			const extraBenchVisible = nodecg.Replicant('extraBenchVisible');
			const currentVisibility = extraBenchVisible.value || { left: false, right: false };
			const visibilityKey = payload.side.toLowerCase() === 'l' ? 'left' : 'right';
			extraBenchVisible.value = {
				...currentVisibility,
				[visibilityKey]: payload.visible
			};
		} else if (type === 'TOGGLE_PRIZE_TAKEN') {
			const prizeRep = payload.side === 'L' ? prizeCardsL : prizeCardsR;
			const newPrizes = JSON.parse(JSON.stringify(prizeRep.value));
			if (newPrizes[payload.index]) {
				newPrizes[payload.index].isTaken = payload.isTaken;
				prizeRep.value = newPrizes;
			}
		} else if (type === 'SET_PRIZE_CARD') {
			const prizeRep = payload.side === 'L' ? prizeCardsL : prizeCardsR;
			const newPrizes = JSON.parse(JSON.stringify(prizeRep.value));
			if (newPrizes[payload.index]) {
				newPrizes[payload.index].cardId = payload.cardId;
				newPrizes[payload.index].isTaken = payload.isTaken;
				prizeRep.value = newPrizes;
			}
		} else if (type === 'CLEAR_PRIZE_CARDS') {
			const prizeRep = payload.side === 'L' ? prizeCardsL : prizeCardsR;
			prizeRep.value = Array.from({ length: 6 }, () => ({ cardId: null, isTaken: false }));
		}
	}

	// Helper to reconstruct display state up to a target time
	function reconstructDisplayState(targetTime) {
		// 1. Clear Display first
		clearDisplay();

		// 2. Find the last HIDE_DISPLAY index
		let lastHideIndex = -1;
		let displayIndex = 0;
		while (displayIndex < timelineDisplay.value.length) {
			const op = timelineDisplay.value[displayIndex];
			if (parseTime(op.timestamp) > targetTime) break;
			if (op.type === 'HIDE_DISPLAY') {
				lastHideIndex = displayIndex;
			}
			displayIndex++;
		}

		// 3. Replay operations with filtering
		for (let i = 0; i < displayIndex; i++) {
			const op = timelineDisplay.value[i];
			const isPersistent = op.type === 'TOGGLE_PRIZE_TAKEN' ||
				op.type === 'TOGGLE_EXTRA_BENCH' ||
				op.type === 'SET_PRIZE_CARD' ||
				op.type === 'CLEAR_PRIZE_CARDS';

			if (isPersistent || i > lastHideIndex) {
				applyDisplayOp(op);
			}
		}
		return displayIndex;
	}

	// Async function to process the playback queue with delays
	async function processPlaybackQueue() {
		if (isPlaybackProcessing) return;
		isPlaybackProcessing = true;

		while (playbackQueue.length > 0) {
			const pack = playbackQueue.shift();

			// Sort ops by priority
			const sortedOps = [...pack.ops].sort((a, b) => a.priority - b.priority);

			// Group by priority
			const opsByPriority = new Map();
			sortedOps.forEach(op => {
				if (!opsByPriority.has(op.priority)) {
					opsByPriority.set(op.priority, []);
				}
				opsByPriority.get(op.priority).push(op);
			});

			// Process each priority group sequentially
			const priorities = Array.from(opsByPriority.keys()).sort((a, b) => a - b);

			for (const priority of priorities) {
				const batch = opsByPriority.get(priority);

				nodecg.log.info(`Playback: Processing batch priority ${priority} (${batch.length} ops)`);

				// 1. Trigger Visuals
				triggerVisualsForOps(batch);

				// 2. Apply Data
				const activeOps = batch.filter(op => !op.deleted);

				activeOps.forEach(op => {
					if (op.type === 'SET_VSTAR_STATUS' || op.type === 'SET_ACTION_STATUS' || op.type === 'SET_SIDES' || op.type === 'SET_LOST_ZONE') {
						gameLogic.applyOperationLogic(nodecg.Replicant(`live_${op.payload.target}`), op, 'live');
					} else if (op.type === 'SET_STADIUM' || op.type === 'SET_STADIUM_USED') {
						gameLogic.applyOperationLogic(live_stadium, op, 'live');
					} else if (op.payload.target && op.payload.target.startsWith('slot')) {
						gameLogic.applyOperationLogic(nodecg.Replicant(op.payload.target.replace('slot', 'live_slot')), op, 'live');
					} else {
						gameLogic.applyOperationLogic(null, op, 'live');
					}
				}); gameLogic.syncLiveToDraft();

				// 3. Wait if needed
				if (gameLogic.doesBatchRequireAck(batch)) {
					const delay = gameLogic.getTimeoutForPriority(priority);
					nodecg.log.info(`Playback: Waiting ${delay}ms for animation...`);
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		}
		isPlaybackProcessing = false;
	}

	function startPlaybackInterval() {
		if (playbackInterval) return;

		// Set Timer mode to playback
		matchTimer.value.mode = 'playback';
		matchTimer.value.isRunning = true;
		matchTimer.value.startTime = Date.now();

		playbackInterval = setInterval(() => {
			// Update simulated time
			matchTimer.value.offset += PLAYBACK_TICK_RATE;

			const currentTimeMs = matchTimer.value.offset;
			playbackStatus.value.currentTime = formatTimeMs(currentTimeMs);
			playbackStatus.value.playbackTimeMs = currentTimeMs;

			// --- Gameplay Track ---
			if (playbackConfig.value.gameplay) {
				let nextPack = timelineGameplay.value[playbackStatus.value.currentIndexGameplay];
				while (nextPack && parseTime(nextPack.timestamp) <= currentTimeMs) {
					playbackQueue.push(nextPack);
					playbackStatus.value.currentIndexGameplay++;
					nextPack = timelineGameplay.value[playbackStatus.value.currentIndexGameplay];
				}

				processPlaybackQueue();
			}

			// --- Display Track ---
			if (playbackConfig.value.display) {
				let nextDisplayOp = timelineDisplay.value[playbackStatus.value.currentIndexDisplay];
				while (nextDisplayOp && parseTime(nextDisplayOp.timestamp) <= currentTimeMs) {
					// Apply display op immediately
					nodecg.log.info(`Playback: Applying Display Op ${nextDisplayOp.type}`);
					applyDisplayOp(nextDisplayOp);

					playbackStatus.value.currentIndexDisplay++;
					nextDisplayOp = timelineDisplay.value[playbackStatus.value.currentIndexDisplay];
				}
			}

			// Calculate end time: max of last OpsPack or last DisplayOp + 3 seconds
			const lastPack = timelineGameplay.value[timelineGameplay.value.length - 1];
			const lastDisplayOp = timelineDisplay.value[timelineDisplay.value.length - 1];

			const lastPackTime = lastPack ? parseTime(lastPack.timestamp) : 0;
			const lastDisplayTime = lastDisplayOp ? parseTime(lastDisplayOp.timestamp) : 0;
			const endTime = Math.max(lastPackTime, lastDisplayTime) + 3000;

			// Stop condition
			const gameplayDone = playbackStatus.value.currentIndexGameplay >= timelineGameplay.value.length;
			const displayDone = playbackStatus.value.currentIndexDisplay >= timelineDisplay.value.length;

			if (gameplayDone && displayDone && currentTimeMs >= endTime) {
				stopPlaybackInterval();
				playbackStatus.value.isPlaying = false;
				matchTimer.value.isRunning = false;
			}

		}, PLAYBACK_TICK_RATE);
	}

	nodecg.listenFor('playTimeline', async (data, callback) => {
		try {
			// 1. Preserve Prize Cards
			const savedPrizeL = JSON.parse(JSON.stringify(prizeCardsL.value));
			const savedPrizeR = JSON.parse(JSON.stringify(prizeCardsR.value));

			// 2. Reset Board
			gameLogic.resetBoardState();

			// 3. Restore Prize Cards
			nodecg.Replicant('prizeCardsL').value = savedPrizeL;
			nodecg.Replicant('prizeCardsR').value = savedPrizeR;

			// 4. Reset Prize Cards to Initial State (Untaken) for Playback
			const resetPrizes = (prizes) => prizes.map(p => ({ ...p, isTaken: false }));
			prizeCardsL.value = resetPrizes(prizeCardsL.value);
			prizeCardsR.value = resetPrizes(prizeCardsR.value);
			clearDisplay();

			// 5. Reset Playback Status
			playbackStatus.value = {
				isPlaying: true,
				playbackTimeMs: 0,
				currentIndexGameplay: 0,
				currentIndexDisplay: 0,
				currentTime: "00:00"
			};

			matchTimer.value.mode = 'playback';
			matchTimer.value.isRunning = true;
			matchTimer.value.startTime = Date.now();
			matchTimer.value.offset = 0;

			// 6. Start Interval
			startPlaybackInterval();

			if (callback) callback(null, 'Playback started.');
		} catch (e) {
			if (callback) callback(e);
		}
	});

	nodecg.listenFor('pauseTimeline', (data, callback) => {
		if (playbackStatus.value.isPlaying) {
			playbackStatus.value.isPlaying = false;
			stopPlaybackInterval();
			if (callback) callback(null, 'Playback paused.');
		}
	});

	nodecg.listenFor('resumeTimeline', (data, callback) => {
		if (!playbackStatus.value.isPlaying) {
			playbackStatus.value.isPlaying = true;
			startPlaybackInterval();
			if (callback) callback(null, 'Playback resumed.');
		}
	});

	nodecg.listenFor('seekTimeline', async (index, callback) => {
		try {
			// 1. Pause Playback
			playbackStatus.value.isPlaying = false;
			stopPlaybackInterval();

			// 2. Preserve Prize Cards
			const savedPrizeL = JSON.parse(JSON.stringify(prizeCardsL.value));
			const savedPrizeR = JSON.parse(JSON.stringify(prizeCardsR.value));

			// 3. Reset Board
			gameLogic.resetBoardState();

			// 4. Restore Prize Cards (Reset to untaken first, then replay ops)
			const resetPrizes = (prizes) => prizes.map(p => ({ ...p, isTaken: false }));
			prizeCardsL.value = resetPrizes(savedPrizeL);
			prizeCardsR.value = resetPrizes(savedPrizeR);

			// 5. Apply OpsPacks up to index (Gameplay Track)
			const packsToApply = timelineGameplay.value.slice(0, index + 1);
			for (const pack of packsToApply) {
				const activeOps = pack.ops.filter(op => !op.deleted);
				activeOps.forEach(op => {
					if (op.type === 'SET_VSTAR_STATUS' || op.type === 'SET_ACTION_STATUS' || op.type === 'SET_SIDES' || op.type === 'SET_LOST_ZONE') {
						gameLogic.applyOperationLogic(nodecg.Replicant(`live_${op.payload.target}`), op, 'live');
					} else if (op.type === 'SET_STADIUM' || op.type === 'SET_STADIUM_USED') {
						gameLogic.applyOperationLogic(live_stadium, op, 'live');
					} else if (op.payload.target && op.payload.target.startsWith('slot')) {
						gameLogic.applyOperationLogic(nodecg.Replicant(op.payload.target.replace('slot', 'live_slot')), op, 'live');
					} else {
						gameLogic.applyOperationLogic(null, op, 'live');
					}
				});
			}
			gameLogic.syncLiveToDraft();

			// 6. Reconstruct Display State (Display Track)
			const targetPack = timelineGameplay.value[index];
			const targetTime = targetPack ? parseTime(targetPack.timestamp) : 0;
			const displayIndex = reconstructDisplayState(targetTime);

			// 7. Update Status
			playbackStatus.value.isPlaying = false;
			playbackStatus.value.currentIndexGameplay = index + 1;
			playbackStatus.value.currentIndexDisplay = displayIndex;
			playbackStatus.value.playbackTimeMs = targetTime;
			playbackStatus.value.currentTime = formatTimeMs(targetTime);

			// Set Timer for Seek
			matchTimer.value.mode = 'playback';
			matchTimer.value.isRunning = false;
			matchTimer.value.startTime = null;
			matchTimer.value.offset = targetTime;

			if (callback) callback(null, `Seeked to index ${index}.`);
		} catch (e) {
			if (callback) callback(e);
		}
	});

	nodecg.listenFor('seekToTimestamp', async (timestamp, callback) => {
		try {
			// 1. Pause Playback
			playbackStatus.value.isPlaying = false;
			stopPlaybackInterval();

			// 2. Clear Display (always clear before reconstruction)
			clearDisplay();

			// 3. Preserve Prize Cards
			const savedPrizeL = JSON.parse(JSON.stringify(prizeCardsL.value));
			const savedPrizeR = JSON.parse(JSON.stringify(prizeCardsR.value));

			// 4. Reset Board
			gameLogic.resetBoardState();

			// 5. Restore Prize Cards (Reset to untaken first, then replay ops)
			const resetPrizes = (prizes) => prizes.map(p => ({ ...p, isTaken: false }));
			prizeCardsL.value = resetPrizes(savedPrizeL);
			prizeCardsR.value = resetPrizes(savedPrizeR);

			// 6. Parse target timestamp
			const targetTime = parseTime(timestamp);

			// 7. Apply all Gameplay OpsPacks up to target time
			let lastGameplayIndex = -1;
			for (let i = 0; i < timelineGameplay.value.length; i++) {
				const pack = timelineGameplay.value[i];
				if (parseTime(pack.timestamp) <= targetTime) {
					const activeOps = pack.ops.filter(op => !op.deleted);

					activeOps.forEach(op => {
						if (op.type === 'SET_VSTAR_STATUS' || op.type === 'SET_ACTION_STATUS' || op.type === 'SET_SIDES' || op.type === 'SET_LOST_ZONE') {
							gameLogic.applyOperationLogic(nodecg.Replicant(`live_${op.payload.target}`), op, 'live');
						} else if (op.type === 'SET_STADIUM' || op.type === 'SET_STADIUM_USED') {
							gameLogic.applyOperationLogic(live_stadium, op, 'live');
						} else if (op.payload.target && op.payload.target.startsWith('slot')) {
							gameLogic.applyOperationLogic(nodecg.Replicant(op.payload.target.replace('slot', 'live_slot')), op, 'live');
						} else {
							gameLogic.applyOperationLogic(null, op, 'live');
						}
					}); lastGameplayIndex = i;
				} else {
					break;
				}
			}
			gameLogic.syncLiveToDraft();
			const displayIndex = reconstructDisplayState(targetTime);

			// 8. Update Status
			playbackStatus.value.isPlaying = false;
			playbackStatus.value.currentIndexGameplay = lastGameplayIndex + 1;
			playbackStatus.value.currentIndexDisplay = displayIndex;
			playbackStatus.value.playbackTimeMs = targetTime;
			playbackStatus.value.currentTime = formatTimeMs(targetTime);

			// Set Timer for Seek
			matchTimer.value.mode = 'playback';
			matchTimer.value.isRunning = false;
			matchTimer.value.startTime = null;
			matchTimer.value.offset = targetTime;

			if (callback) callback(null, `Seeked to timestamp ${timestamp}.`);
		} catch (e) {
			if (callback) callback(e);
		}
	});

	nodecg.listenFor('editOpsPack', (data, callback) => {
		try {
			const { index, newTimestamp } = data;

			if (index < 0 || index >= timelineGameplay.value.length) {
				throw new Error('Invalid index');
			}

			// Validate: new timestamp must not be earlier than previous OpsPack
			if (index > 0) {
				const prevPack = timelineGameplay.value[index - 1];
				const prevTime = parseTime(prevPack.timestamp);
				const newTime = parseTime(newTimestamp);

				if (newTime < prevTime) {
					throw new Error(`New timestamp (${newTimestamp}) cannot be earlier than previous OpsPack (${prevPack.timestamp})`);
				}
			}

			// Update the timestamp
			const newTimeline = [...timelineGameplay.value];
			newTimeline[index].timestamp = newTimestamp;
			newTimeline.sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));

			// Update replicant
			timelineGameplay.value = newTimeline;

			nodecg.log.info(`OpsPack at index ${index} updated to timestamp ${newTimestamp}`);

			nodecg.sendMessage('timelineRefreshed');
			if (callback) callback(null, 'OpsPack updated successfully.');
		} catch (e) {
			nodecg.log.error('editOpsPack error:', e);
			if (callback) callback(e);
		}
	});

	nodecg.listenFor('deleteOpsPack', (index, callback) => {
		try {
			if (index < 0 || index >= timelineGameplay.value.length) {
				throw new Error('Invalid index');
			}

			const targetPack = timelineGameplay.value[index];
			const newTimeline = [...timelineGameplay.value];
			const newOps = [...targetPack.ops];

			// Process each operation: soft delete native, hard delete inserted
			let hasNativeOps = false;
			const opsToRemove = [];

			for (let i = newOps.length - 1; i >= 0; i--) {
				const op = newOps[i];
				const isNative = !op.source || op.source === 'native';

				if (isNative) {
					// Soft delete
					newOps[i] = {
						...op,
						deleted: true,
						deletedAt: Date.now()
					};
					hasNativeOps = true;
				} else {
					// Hard delete
					opsToRemove.push(i);
				}
			}

			// Remove inserted operations (iterate backwards to maintain indices)
			opsToRemove.forEach(i => newOps.splice(i, 1));

			// Check if OpsPack should be deleted
			const activeOps = newOps.filter(op => !op.deleted);

			if (activeOps.length === 0 && newOps.length === 0) {
				// All operations were inserted and removed - delete the OpsPack
				newTimeline.splice(index, 1);
				nodecg.log.info(`OpsPack at ${targetPack.timestamp} completely deleted (all operations removed).`);
			} else {
				// Keep the OpsPack with updated operations
				newTimeline[index] = {
					...targetPack,
					ops: newOps
				};
				const nativeCount = newOps.filter(op => !op.source && op.deleted).length;
				const insertedRemoved = opsToRemove.length;
				nodecg.log.info(`OpsPack at ${targetPack.timestamp} operations deleted: ${nativeCount} native marked, ${insertedRemoved} inserted removed. Remaining: ${newOps.length} ops (${activeOps.length} active).`);
			}

			timelineGameplay.value = newTimeline;
			nodecg.sendMessage('timelineRefreshed');
			if (callback) callback(null, 'OpsPack operations deleted successfully.');
		} catch (e) {
			nodecg.log.error('deleteOpsPack error:', e);
			if (callback) callback(e.message);
		}
	});

	nodecg.listenFor('deleteDisplayOp', (index, callback) => {
		try {
			if (index < 0 || index >= timelineDisplay.value.length) {
				throw new Error('Invalid index');
			}
			const newTimeline = [...timelineDisplay.value];
			newTimeline.splice(index, 1);
			timelineDisplay.value = newTimeline;
			nodecg.log.info(`Display Op at index ${index} deleted.`);
			nodecg.sendMessage('timelineRefreshed');
			if (callback) callback(null, 'Display Op deleted.');
		} catch (e) {
			nodecg.log.error('deleteDisplayOp error:', e);
			if (callback) callback(e.message);
		}
	});

	nodecg.listenFor('editDisplayOp', (data, callback) => {
		try {
			const { index, newTimestamp } = data;
			if (index < 0 || index >= timelineDisplay.value.length) {
				throw new Error('Invalid index');
			}
			// Update timestamp
			const newTimeline = [...timelineDisplay.value];
			newTimeline[index].timestamp = newTimestamp;
			// Re-sort
			newTimeline.sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));
			timelineDisplay.value = newTimeline;
			nodecg.log.info(`Display Op at index ${index} updated to ${newTimestamp}`);
			nodecg.sendMessage('timelineRefreshed');
			if (callback) callback(null, 'Display Op updated.');
		} catch (e) {
			nodecg.log.error('editDisplayOp error:', e);
			if (callback) callback(e.message);
		}
	});

	nodecg.listenFor('importTimeline', (jsonString, callback) => {
		try {
			const data = JSON.parse(jsonString);

			// Check Language
			const currentLang = (ptcgSettings.value && ptcgSettings.value.language) || 'jp';
			if (data.language && data.language !== currentLang) {
				throw new Error(`Language mismatch! Import: ${data.language}, Current: ${currentLang}. Import aborted.`);
			}

			if (Array.isArray(data)) {
				// Legacy format (just timeline)
				timelineGameplay.value = data;
				if (callback) callback(null, 'Timeline imported.');
			} else if (data.timeline && Array.isArray(data.timeline)) {
				// New format (timeline + decks + display + prizes)
				// Execute sequentially to allow deckLoadingStatus to update correctly for each deck
				const processImports = async () => {
					let totalDecks = 0;
					if (data.deckL && data.deckL.name) totalDecks++;
					if (data.deckR && data.deckR.name) totalDecks++;

					const scale = totalDecks > 0 ? 1 / totalDecks : 1;
					let currentDeckIndex = 0;

					if (data.deckL && data.deckL.name) {
						await new Promise((resolve) => {
							const offset = currentDeckIndex * scale * 100;
							gameLogic.processDeckImport('L', data.deckL.name, (err) => {
								if (err) nodecg.log.warn(`Failed to re-import Deck L: ${err.message}`);
								resolve(); // Resolve anyway to continue
							}, { scale, offset });
						});
						currentDeckIndex++;
					}

					if (data.deckR && data.deckR.name) {
						await new Promise((resolve) => {
							const offset = currentDeckIndex * scale * 100;
							gameLogic.processDeckImport('R', data.deckR.name, (err) => {
								if (err) nodecg.log.warn(`Failed to re-import Deck R: ${err.message}`);
								resolve(); // Resolve anyway to continue
							}, { scale, offset });
						});
						currentDeckIndex++;
					}

					timelineGameplay.value = data.timeline;

					if (data.timelineDisplay) {
						timelineDisplay.value = data.timelineDisplay;
					} else {
						timelineDisplay.value = [];
					}

					if (data.firstMove) {
						firstMove.value = data.firstMove;
					}

					if (data.prizeCardsL) {
						nodecg.Replicant('prizeCardsL').value = data.prizeCardsL;
					}
					if (data.prizeCardsR) {
						nodecg.Replicant('prizeCardsR').value = data.prizeCardsR;
					}
					if (data.gameSetup) {
						gameSetup.value = data.gameSetup;
					}

					if (callback) callback(null, 'Timeline, Decks, and Display imported.');
				};

				processImports();

			} else {
				throw new Error('Invalid JSON format');
			}
		} catch (e) {
			if (callback) callback(e.message);
		}
	});

	// Delete single operation from OpsPack (soft/hard delete based on source)
	nodecg.listenFor('deleteOperation', (data, callback) => {
		try {
			const { opsPackIndex, operationIndex } = data;

			if (opsPackIndex < 0 || opsPackIndex >= timelineGameplay.value.length) {
				throw new Error('Invalid OpsPack index');
			}

			const targetPack = timelineGameplay.value[opsPackIndex];

			if (operationIndex < 0 || operationIndex >= targetPack.ops.length) {
				throw new Error('Invalid operation index');
			}

			const targetOp = targetPack.ops[operationIndex];
			const isNative = !targetOp.source || targetOp.source === 'native';
			const newTimeline = [...timelineGameplay.value];
			const newOps = [...targetPack.ops];

			if (isNative) {
				// Soft delete
				newOps[operationIndex] = {
					...targetOp,
					deleted: true,
					deletedAt: Date.now()
				};

				newTimeline[opsPackIndex] = {
					...targetPack,
					ops: newOps
				};

				nodecg.log.info(`Operation ${targetOp.type} soft-deleted (marked) from OpsPack at ${targetPack.timestamp}.`);
			} else {
				// Hard Delete
				newOps.splice(operationIndex, 1);

				const activeOps = newOps.filter(op => !op.deleted);

				if (activeOps.length === 0) {
					newTimeline.splice(opsPackIndex, 1);
					nodecg.log.warn(`OpsPack at ${targetPack.timestamp} deleted (no active operations remaining).`);
				} else {
					newTimeline[opsPackIndex] = {
						...targetPack,
						ops: newOps
					};
					nodecg.log.info(`Operation ${targetOp.type} hard-deleted (removed) from OpsPack at ${targetPack.timestamp}. Remaining: ${newOps.length} ops (${activeOps.length} active).`);
				}
			}

			timelineGameplay.value = newTimeline;
			nodecg.sendMessage('timelineRefreshed');

			if (callback) callback(null, 'Operation deleted successfully.');
		} catch (e) {
			nodecg.log.error('deleteOperation error:', e);
			if (callback) callback(e);
		}
	});

	// Restore single operation from OpsPack
	nodecg.listenFor('restoreOperation', (data, callback) => {
		try {
			const { opsPackIndex, operationIndex } = data;

			if (opsPackIndex < 0 || opsPackIndex >= timelineGameplay.value.length) {
				throw new Error('Invalid OpsPack index');
			}

			const targetPack = timelineGameplay.value[opsPackIndex];

			if (operationIndex < 0 || operationIndex >= targetPack.ops.length) {
				throw new Error('Invalid operation index');
			}

			const newTimeline = [...timelineGameplay.value];
			const newOps = [...targetPack.ops];
			const targetOp = newOps[operationIndex];

			// Restore Delete
			const { deleted, deletedAt, ...restoredOp } = targetOp;

			newOps[operationIndex] = restoredOp;

			newTimeline[opsPackIndex] = {
				...targetPack,
				ops: newOps
			};

			timelineGameplay.value = newTimeline;
			nodecg.log.info(`Operation ${targetOp.type} restored in OpsPack at ${targetPack.timestamp}.`);
			nodecg.sendMessage('timelineRefreshed');

			if (callback) callback(null, 'Operation restored successfully.');
		} catch (e) {
			nodecg.log.error('restoreOperation error:', e);
			if (callback) callback(e);
		}
	});

	nodecg.listenFor('exportTimeline', (data, callback) => {
		try {
			const exportData = {
				version: bundleVersion.value || "1919.810",
				language: (ptcgSettings.value && ptcgSettings.value.language) || 'jp',
				timestamp: new Date().toISOString(),
				firstMove: firstMove.value,
				deckL: {
					name: deckL.value.name,
				},
				deckR: {
					name: deckR.value.name,
				},
				timeline: timelineGameplay.value,
				timelineDisplay: timelineDisplay.value,
				prizeCardsL: prizeCardsL.value,
				prizeCardsR: prizeCardsR.value,
				gameSetup: gameSetup.value
			};
			const jsonString = JSON.stringify(exportData, null, 2);
			if (callback) callback(null, jsonString);
		} catch (e) {
			if (callback) callback(e.message);
		}
	});

	nodecg.listenFor('reStart', (data, callback) => {
		nodecg.log.warn('!!! Executing Game Restart !!!');
		gameLogic.executeRestart(callback);
		nodecg.log.info('Game state has been completely restart.');
	});

};