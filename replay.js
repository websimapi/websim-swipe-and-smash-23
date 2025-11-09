import Board from './board.js';
import * as recorder from './recorder.js';
import { playSound, playBackgroundMusic } from './audio.js';

export default class Replay {
    constructor(game, config) {
        this.game = game;
        this.config = config;
        this.replayTimeouts = [];
        this.replayBgmControl = null;
        this.controlsTimeout = null;
        this.comboTimeout = null;
        this.state = {
            isPlaying: false,
            isPaused: false,
            pauseTime: 0,
            startTime: 0,
            actions: [],
            currentReplayBoard: null,
        };

        this.setupUI();
    }

    setupUI() {
        document.getElementById('clip-button').addEventListener('click', () => this.show());
        document.getElementById('close-replay-button').addEventListener('click', () => this.hide());
        document.getElementById('replay-container').addEventListener('click', () => this.handleContainerClick());
    }

    handleContainerClick() {
        if (!this.state.isPlaying) return;

        if (this.state.isPaused) {
            this.resume();
        } else {
            this.pause();
        }
    }

    showControls() {
        const playPauseButton = document.getElementById('play-pause-button');
        playPauseButton.classList.add('visible');
        clearTimeout(this.controlsTimeout);
        this.controlsTimeout = setTimeout(() => {
            playPauseButton.classList.remove('visible');
        }, 1000);
    }
    
    show() {
        this.game.pauseTimer();
        this.game.pauseMainBGM();
        if (this.game.isRecordingStarted) {
            recorder.pauseRecording();
        }
        const modal = document.getElementById('replay-modal');
        modal.classList.remove('hidden');
        this.play();
    }

    hide() {
        const modal = document.getElementById('replay-modal');
        modal.classList.add('hidden');
        this.stop(); // Use stop to properly clean up

        // Remove combo display if it exists
        const comboDisplay = document.getElementById('replay-combo-display');
        if (comboDisplay) {
            comboDisplay.remove();
        }

        // Force cleanup of any lingering replay candy elements
        const lingeringCandies = document.querySelectorAll('.replay-candy');
        lingeringCandies.forEach(candy => candy.remove());

        if (this.game.isRecordingStarted) {
            recorder.resumeRecording();
        }
        this.game.resumeMainBGM();
        this.game.resumeTimer();
    }

    async play() {
        const playPauseButton = document.getElementById('play-pause-button');

        const recording = recorder.getRecording();
        if (!recording || !recording.initialState) return;

        this.replayTimeouts.forEach(clearTimeout);
        this.replayTimeouts = [];

        const replayBoardElement = document.getElementById('replay-board');
        replayBoardElement.innerHTML = ''; // Clear previous replay

        const candyQueue = recording.actions.filter(a => a.type === 'newCandy').map(a => a.candyType);
        const replayTypeGenerator = () => {
            const nextType = candyQueue.shift();
            // Fallback, though it shouldn't be needed with proper recording.
            return nextType || this.config.candyTypes[0];
        };

        const replayBoard = new Board(this.config.boardSize, this.config.candyTypes, () => {}, replayTypeGenerator, () => this.state.isPaused);
        replayBoard.boardElement = replayBoardElement;
        replayBoard.setupBoard();

        // Override functions for replay board to tag candies
        replayBoard.createCandy = function(row, col, type, isInitializing = false) {
            return Board.prototype.createCandy.call(this, row, col, type, isInitializing, true);
        };
        replayBoard.fillBoard = function() {
            return Board.prototype.fillBoard.call(this, true);
        };

        replayBoard.initialize(recording.initialState);

        this.state.isPlaying = true;
        this.state.isPaused = false;
        this.state.startTime = performance.now();
        this.state.actions = [...recording.actions];
        this.state.currentReplayBoard = replayBoard; // Store for resume
        playPauseButton.innerHTML = '&#10074;&#10074;'; // Pause icon
        playPauseButton.classList.remove('visible');
        
        this.showControls(); // Show controls for 1 second at the start

        this.scheduleActions(replayBoard);
    }

    scheduleActions(replayBoard, resumeFromTime = 0) {
        this.replayTimeouts.forEach(clearTimeout);
        this.replayTimeouts = [];

        this.state.actions.forEach(action => {
            if (action.timestamp < resumeFromTime) {
                return; // Skip actions that have already passed
            }

            const delay = action.timestamp - resumeFromTime;

            const timeoutId = setTimeout(async () => {
                if (this.state.isPaused) return;

                if (action.type === 'swap') {
                    const candy1 = replayBoard.grid[action.from.r][action.from.c];
                    const candy2 = replayBoard.grid[action.to.r][action.to.c];
                    if(candy1 && candy2) {
                        await replayBoard.swapCandies(candy1, candy2);
                        const isValid = await replayBoard.processMatches(false, [candy1, candy2]);
                        if(!isValid) {
                             await replayBoard.swapCandies(candy1, candy2);
                        }
                    }
                } else if (action.type === 'activateRainbow') {
                    const rainbowCandy = replayBoard.grid[action.rainbowCandy.r][action.rainbowCandy.c];
                    const otherCandy = replayBoard.grid[action.otherCandy.r][action.otherCandy.c];
                    if (rainbowCandy && otherCandy) {
                        await replayBoard.activateRainbowPowerup(rainbowCandy, otherCandy);
                    }
                } else if (action.type === 'smash') {
                    const candiesToSmash = action.smashed
                        .map(coords => (replayBoard.grid[coords.r] ? replayBoard.grid[coords.r][coords.c] : null))
                        .filter(Boolean);
                    if (candiesToSmash.length > 0) {
                        await replayBoard.smashCandies(candiesToSmash);
                    }
                } else if (action.type === 'initialCascade') {
                    await replayBoard.processMatches(false, null);
                } else if (action.type === 'sound') {
                    playSound(action.name);
                } else if (action.type === 'startRainbow') {
                    document.getElementById('replay-board').parentElement.classList.add('rainbow-mode');
                } else if (action.type === 'endRainbow') {
                    document.getElementById('replay-board').parentElement.classList.remove('rainbow-mode');
                } else if (action.type === 'comboUpdate') {
                    this.updateReplayCombo(action.count);
                } else if (action.type === 'startBGM' && !this.replayBgmControl) {
                    this.replayBgmControl = await playBackgroundMusic(true);
                }
            }, delay);

            this.replayTimeouts.push(timeoutId);
        });

        const recordingDuration = this.state.actions.length > 0 ? this.state.actions[this.state.actions.length - 1].timestamp : 0;
        const endTimeout = setTimeout(() => {
            if (!this.state.isPaused) {
                this.hide(); // Hide modal when replay finishes
            }
        }, recordingDuration - resumeFromTime + 2000); // 2 seconds after last action
        this.replayTimeouts.push(endTimeout);
    }

    togglePlayback() {
        if (this.state.isPlaying) {
            if (this.state.isPaused) {
                this.resume();
            } else {
                this.pause();
            }
        }
    }

    pause() {
        if (!this.state.isPlaying || this.state.isPaused) return;

        this.replayTimeouts.forEach(clearTimeout);
        this.replayTimeouts = [];
        this.state.isPaused = true;
        this.state.pauseTime = performance.now() - this.state.startTime;
        if (this.replayBgmControl && this.replayBgmControl.pause) {
            this.replayBgmControl.pause();
        }
        clearTimeout(this.controlsTimeout);

        const playPauseButton = document.getElementById('play-pause-button');
        playPauseButton.innerHTML = '&#9658;'; // Play icon
        playPauseButton.classList.add('visible');
    }

    resume() {
        if (!this.state.isPaused) return;

        this.state.isPaused = false;
        this.state.startTime = performance.now() - this.state.pauseTime;

        if (this.replayBgmControl && this.replayBgmControl.resume) {
            this.replayBgmControl.resume();
        }
        
        this.scheduleActions(this.state.currentReplayBoard, this.state.pauseTime);

        const playPauseButton = document.getElementById('play-pause-button');
        playPauseButton.innerHTML = '&#10074;&#10074;'; // Pause icon
        playPauseButton.classList.remove('visible');
    }

    updateReplayCombo(count) {
        let comboDisplay = document.getElementById('replay-combo-display');
        if (!comboDisplay) {
            comboDisplay = document.createElement('div');
            comboDisplay.id = 'replay-combo-display';
            // Mimic styles from CSS for consistency
            comboDisplay.className = 'combo-display-base';
            document.getElementById('replay-container').appendChild(comboDisplay);
        }

        clearTimeout(this.comboTimeout);

        if (count < 2) {
            comboDisplay.classList.remove('visible', 'rainbow');
            return;
        }
        
        const isRainbow = document.getElementById('replay-container').classList.contains('rainbow-mode');

        comboDisplay.textContent = `Combo x${count}`;
        comboDisplay.classList.add('visible');

        if (isRainbow) {
            comboDisplay.classList.add('rainbow');
        } else {
            comboDisplay.classList.remove('rainbow');
        }

        if (!isRainbow) {
            this.comboTimeout = setTimeout(() => {
                comboDisplay.classList.remove('visible');
            }, 1500);
        }
    }

    stop() {
        this.replayTimeouts.forEach(clearTimeout);
        this.replayTimeouts = [];
        if (this.replayBgmControl) {
            this.replayBgmControl.stop();
            this.replayBgmControl = null;
        }
        clearTimeout(this.controlsTimeout);
        clearTimeout(this.comboTimeout);
        this.state = { isPlaying: false, isPaused: false, pauseTime: 0, startTime: 0, actions: [], currentReplayBoard: null };

        const playPauseButton = document.getElementById('play-pause-button');
        playPauseButton.innerHTML = '&#9658;'; // Play icon
        playPauseButton.classList.remove('visible');
    }
}