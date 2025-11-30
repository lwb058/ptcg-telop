'use strict';

module.exports = function (nodecg) {
    const matchTimer = nodecg.Replicant('matchTimer', {
        defaultValue: {
            startTime: null,
            pausedTime: 0,
            isRunning: false,
            offset: 0,
            mode: 'standby' // 'standby', 'live', or 'playback'
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

        // If in standby, switch to live (this is the Game Start moment)
        if (matchTimer.value.mode === 'standby') {
            matchTimer.value.mode = 'live';
            matchTimer.value.offset = 0; // Ensure offset is 0 on fresh start
        }

        // If starting from a fresh state or reset state
        if (!matchTimer.value.startTime) {
            matchTimer.value.startTime = Date.now();
            matchTimer.value.pausedTime = 0;
        } else {
            // Resuming from pause
            matchTimer.value.startTime = Date.now();
        }

        matchTimer.value.isRunning = true;
    }

    function stopTimer() {
        if (!matchTimer.value.isRunning) return;

        if (matchTimer.value.mode === 'live') {
            const now = Date.now();
            const currentRunDuration = now - matchTimer.value.startTime;
            matchTimer.value.offset += currentRunDuration;
            matchTimer.value.startTime = null;
        }
        // For playback mode, the offset is updated by the playback loop, so we just stop.

        matchTimer.value.isRunning = false;
    }

    function resetTimer() {
        matchTimer.value.startTime = null;
        matchTimer.value.offset = 0;
        matchTimer.value.isRunning = false;
        matchTimer.value.mode = 'standby'; // Reset to standby mode
    }

    function editTimer(newSeconds) {
        // Set the timer to a specific duration (in seconds)
        const newOffset = newSeconds * 1000;
        matchTimer.value.offset = newOffset;
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
};
