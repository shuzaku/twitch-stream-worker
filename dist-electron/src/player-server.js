"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForBrowser = waitForBrowser;
exports.playVideo = playVideo;
exports.startPlayerServer = startPlayerServer;
exports.stopPlayerServer = stopPlayerServer;
exports.getPlayerUrl = getPlayerUrl;
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const PORT = parseInt(process.env.PLAYER_PORT || process.env.OVERLAY_PORT || '3001', 10);
// Resolve overlay path relative to project root regardless of whether we are
// running from src/ (ts-node) or dist-electron/src/ (compiled).
function overlayDir() {
    // Walk up from __dirname until we find src/overlay
    const candidates = [
        path_1.default.join(__dirname, 'overlay'), // ts-node: src/overlay
        path_1.default.join(__dirname, '..', 'src', 'overlay'), // dist-electron/src → project root
        path_1.default.join(__dirname, '..', '..', 'src', 'overlay'), // extra level just in case
    ];
    const fs = require('fs');
    for (const p of candidates) {
        if (fs.existsSync(path_1.default.join(p, 'player.html')))
            return p;
    }
    return candidates[0];
}
const OVERLAY_DIR = overlayDir();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(express_1.default.static(OVERLAY_DIR));
app.get('/player', (_req, res) => {
    res.sendFile(path_1.default.join(OVERLAY_DIR, 'player.html'));
});
// Legacy preview endpoint — still useful for monitoring
app.get('/api/now-playing', (_req, res) => {
    res.json(currentVideo);
});
let currentVideo = null;
let browserSocket = null;
// Pending playback promise — resolved/rejected when the browser reports ended/error
let pendingResolve = null;
let pendingReject = null;
// Resolves once the browser sends { type: 'ready' } (YouTube player fully initialised)
let browserReadyResolve = null;
const browserReadyPromise = new Promise((resolve) => {
    browserReadyResolve = resolve;
});
function waitForBrowser() {
    return browserReadyPromise;
}
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
wss.on('connection', (ws) => {
    console.log('[player] Browser connected');
    browserSocket = ws;
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        }
        catch {
            return;
        }
        if (msg.type === 'ready') {
            console.log('[player] YouTube player ready');
            browserReadyResolve?.();
            browserReadyResolve = null;
        }
        else if (msg.type === 'ended') {
            console.log(`[player] Video ended: ${currentVideo?.Url}`);
            pendingResolve?.();
            pendingResolve = null;
            pendingReject = null;
        }
        else if (msg.type === 'error') {
            const err = new Error(`YouTube player error (code ${msg.code}) for ${currentVideo?.Url}`);
            console.error(`[player] ${err.message}`);
            pendingReject?.(err);
            pendingResolve = null;
            pendingReject = null;
        }
    });
    ws.on('close', () => {
        console.warn('[player] Browser disconnected');
        if (browserSocket === ws)
            browserSocket = null;
        // If a video was playing, reject so the main loop can handle it
        pendingReject?.(new Error('Browser disconnected during playback'));
        pendingResolve = null;
        pendingReject = null;
    });
});
function playVideo(video) {
    return new Promise((resolve, reject) => {
        if (!browserSocket || browserSocket.readyState !== ws_1.WebSocket.OPEN) {
            return reject(new Error('No browser connected to player server'));
        }
        // Cancel any previous pending promise
        pendingResolve?.();
        pendingResolve = null;
        pendingReject = null;
        currentVideo = video;
        pendingResolve = resolve;
        pendingReject = reject;
        browserSocket.send(JSON.stringify({
            type: 'play',
            videoId: video.Url,
            title: video.Title || null,
            game: video.Game || null,
            player1: video.players?.[0]?.name || null,
            player2: video.players?.[1]?.name || null,
        }));
    });
}
function startPlayerServer() {
    return new Promise((resolve) => {
        server.listen(PORT, () => {
            console.log(`[player] Server running at http://localhost:${PORT}/player`);
            resolve();
        });
    });
}
function stopPlayerServer() {
    return new Promise((resolve) => {
        wss.close();
        server.close(() => resolve());
    });
}
function getPlayerUrl() {
    return `http://localhost:${PORT}/player`;
}
