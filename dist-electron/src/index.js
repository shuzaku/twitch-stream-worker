"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatus = getStatus;
exports.setStatusChangeCallback = setStatusChangeCallback;
exports.startWorker = startWorker;
exports.stopWorker = stopWorker;
require("dotenv/config");
const api_1 = require("./api");
const player_server_1 = require("./player-server");
const obs_client_1 = require("./obs-client");
const twitch_bot_1 = require("./twitch-bot");
const QUEUE_SIZE = parseInt(process.env.QUEUE_SIZE || '10', 10);
const RETRY_DELAY_MS = 5000;
const MAX_CONSECUTIVE_ERRORS = 5;
// ── Worker state ──────────────────────────────────────────────────────────────
let obs = null;
let bot = null;
let running = false;
let stopRequested = false;
// Current status — read by Electron main via IPC
let _status = {
    running: false,
    obsConnected: false,
    botConnected: false,
    currentVideo: null,
    queueSize: 0,
};
function getStatus() {
    return { ..._status };
}
// Callback fired whenever status changes (Electron main subscribes to this)
let onStatusChange = null;
function setStatusChangeCallback(cb) {
    onStatusChange = cb;
}
function updateStatus(patch) {
    _status = { ..._status, ...patch };
    onStatusChange?.(_status);
}
// ── Start / Stop ──────────────────────────────────────────────────────────────
async function startWorker(options) {
    if (running) {
        console.warn('[worker] Already running');
        return;
    }
    running = true;
    stopRequested = false;
    // Override env vars from options if provided (Electron passes these from electron-store)
    if (options?.obsUrl)
        process.env.OBS_WS_URL = options.obsUrl;
    if (options?.obsPassword)
        process.env.OBS_WS_PASSWORD = options.obsPassword;
    if (options?.twitchChannel)
        process.env.TWITCH_CHANNEL = options.twitchChannel;
    if (options?.twitchBotUsername)
        process.env.TWITCH_BOT_USERNAME = options.twitchBotUsername;
    if (options?.twitchBotToken)
        process.env.TWITCH_BOT_TOKEN = options.twitchBotToken;
    console.log('[worker] FightersEdge Twitch Stream Worker starting...');
    await (0, player_server_1.startPlayerServer)();
    obs = new obs_client_1.OBSClient();
    bot = new twitch_bot_1.TwitchBot();
    let initialPlaylist = [];
    await Promise.all([
        (0, api_1.buildPlaylist)(QUEUE_SIZE, options?.playerId)
            .then((videos) => { initialPlaylist = videos; })
            .catch((err) => console.error('[worker] Failed to pre-fetch playlist:', err)),
        obs.connect().then(async () => {
            await obs.startStream();
            updateStatus({ obsConnected: true });
        }),
        bot.connect().then(() => {
            updateStatus({ botConnected: true });
        }),
        (0, player_server_1.waitForBrowser)().then(() => console.log('[worker] Browser ready')),
    ]);
    updateStatus({ running: true, queueSize: initialPlaylist.length });
    console.log('[worker] All systems ready — starting playback');
    // ── Infinite playlist loop ──────────────────────────────────────────────────
    let playlist = initialPlaylist;
    let playlistIndex = 0;
    let consecutiveErrors = 0;
    while (!stopRequested) {
        if (playlistIndex >= playlist.length) {
            console.log('[worker] Fetching new playlist batch...');
            try {
                playlist = await (0, api_1.buildPlaylist)(QUEUE_SIZE, options?.playerId);
                playlistIndex = 0;
                console.log(`[worker] Loaded ${playlist.length} videos into queue`);
                updateStatus({ queueSize: playlist.length - playlistIndex });
            }
            catch (err) {
                console.error('[worker] Failed to fetch playlist:', err);
                await sleep(RETRY_DELAY_MS * 2);
                continue;
            }
        }
        if (stopRequested)
            break;
        if (playlist.length === 0) {
            console.warn('[worker] No videos returned from API. Retrying in 30s...');
            await sleep(30000);
            continue;
        }
        const video = playlist[playlistIndex++];
        console.log(`[worker] Now playing: ${video.Title || video.Url}`);
        updateStatus({ currentVideo: video, queueSize: playlist.length - playlistIndex });
        await bot?.announceVideo(video);
        try {
            await (0, player_server_1.playVideo)(video);
            consecutiveErrors = 0;
            console.log(`[worker] Finished: ${video.Title || video.Url}`);
        }
        catch (err) {
            if (stopRequested)
                break;
            consecutiveErrors++;
            console.error(`[worker] Playback failed (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err instanceof Error ? err.message : err);
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error('[worker] Too many consecutive errors — waiting 60s...');
                consecutiveErrors = 0;
                await sleep(60000);
            }
            else {
                await sleep(RETRY_DELAY_MS);
            }
        }
    }
    await _shutdown();
}
async function stopWorker() {
    if (!running)
        return;
    stopRequested = true;
    console.log('[worker] Stop requested');
    await _shutdown();
}
async function _shutdown() {
    running = false;
    stopRequested = true;
    updateStatus({ running: false, currentVideo: null, obsConnected: false, botConnected: false });
    try {
        await obs?.stopStream();
        obs?.disconnect();
    }
    catch { /* best-effort */ }
    try {
        bot?.disconnect();
    }
    catch { /* best-effort */ }
    try {
        await (0, player_server_1.stopPlayerServer)();
    }
    catch { /* best-effort */ }
    obs = null;
    bot = null;
    console.log('[worker] Shutdown complete');
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ── Standalone CLI mode (npm run dev / npm start) ────────────────────────────
// Only auto-run when this file is executed directly (not imported by Electron)
if (require.main === module) {
    // In CLI mode, spawn Chrome ourselves since Electron isn't managing it
    const { spawn } = require('child_process');
    const PLAYER_PORT = process.env.PLAYER_PORT || process.env.OVERLAY_PORT || '3001';
    const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const playerUrl = `http://localhost:${PLAYER_PORT}/player`;
    const chrome = spawn(CHROME_PATH, [
        `--app=${playerUrl}`,
        '--window-size=1920,1080',
        '--disable-infobars',
        '--autoplay-policy=no-user-gesture-required',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
    ], { detached: false, stdio: 'ignore' });
    chrome.on('error', (err) => {
        console.error(`[main] Failed to launch Chrome: ${err.message}`);
    });
    const handleExit = async () => {
        await stopWorker();
        chrome.kill();
        process.exit(0);
    };
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
    startWorker().catch((err) => {
        console.error('[main] Fatal error:', err);
        process.exit(1);
    });
}
