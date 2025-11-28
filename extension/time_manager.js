'use strict';

module.exports = function (nodecg) {
    const matchTimer = nodecg.Replicant('matchTimer', {
        defaultValue: {
            startTime: null,
            pausedTime: 0,
            isRunning: false,
            offset: 0
        }
    });

    const gameTimeSettings = nodecg.Replicant('gameTimeSettings', {
        defaultValue: {
            limit: 1500, // 25 minutes in seconds
            useCountdown: true
        }
    });

    function startTimer() {
        if (matchTimer.value.isRunning) return;

        // If starting from a fresh state or reset state
        if (!matchTimer.value.startTime) {
            matchTimer.value.startTime = Date.now();
            matchTimer.value.pausedTime = 0;
        } else {
            // Resuming from pause
            // Calculate how long we were paused and adjust startTime effectively
            // Current Time = Date.now() - startTime - pausedTime
            // To resume, we just need to update the state. The pausedTime accumulation happens on stop.
            // Wait, actually:
            // When running: Elapsed = Date.now() - startTime - totalPausedDuration
            // When paused: Elapsed = pauseStart - startTime - totalPausedDuration

            // Simpler model:
            // startTime: The timestamp when the timer was *first* started.
            // offset: The total duration (in ms) to SUBTRACT from the elapsed time (accumulated pause time).

            // When resuming, we need to adjust the offset so that the elapsed time remains continuous.
            // Let's stick to the structure: { startTime, pausedTime, isRunning, offset }
            // But let's refine the logic.

            // Alternative Logic (Standard):
            // Elapsed = (Date.now() - startTime)
            // When pausing, we save the current Elapsed.
            // When resuming, we set startTime = Date.now() - SavedElapsed.

            // Let's use the "offset" field as "accumulated elapsed time before current run".
            // When stopped: offset = current elapsed time. startTime = null.
            // When started: startTime = Date.now().
            // Current Elapsed = offset + (Date.now() - startTime).

            matchTimer.value.startTime = Date.now();
        }

        matchTimer.value.isRunning = true;
    }

    function stopTimer() {
        if (!matchTimer.value.isRunning) return;

        const now = Date.now();
        const currentRunDuration = now - matchTimer.value.startTime;
        matchTimer.value.offset += currentRunDuration;
        matchTimer.value.startTime = null;
        matchTimer.value.isRunning = false;
    }

    function resetTimer() {
        matchTimer.value.startTime = null;
        matchTimer.value.offset = 0;
        matchTimer.value.isRunning = false;
    }

    function editTimer(newSeconds) {
        // Set the timer to a specific duration (in seconds)
        const newOffset = newSeconds * 1000;
        matchTimer.value.offset = newOffset;
        if (matchTimer.value.isRunning) {
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
};
