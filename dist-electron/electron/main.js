"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
// Dynamically import electron-store (ESM default export wrapped in CJS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store').default;
const store = new ElectronStore({
    defaults: {
        auth: null,
        obsUrl: 'ws://localhost:4455',
        obsPassword: '',
        twitchChannel: '',
        twitchBotUsername: '',
        twitchBotToken: '',
        obsSetupDone: false,
    },
});
// ── Window references ─────────────────────────────────────────────────────────
let mainWindow = null;
let playerWindow = null;
const PLAYER_PORT = process.env.PLAYER_PORT || '3001';
const PLAYER_URL = `http://localhost:${PLAYER_PORT}/player`;
// FightersEdge web app (where the user gives consent) and API (where we
// exchange the device token for session info).
const FE_WEB_BASE = process.env.FE_WEB_BASE || 'https://www.fighters-edge.com';
const FE_API_BASE = process.env.API_BASE_URL || 'https://fightme-server.herokuapp.com';
const DEVICE_CALLBACK_PORT = 7777;
const DEVICE_CALLBACK_URI = `http://localhost:${DEVICE_CALLBACK_PORT}/callback`;
const isDev = !electron_1.app.isPackaged;
// ── App lifecycle ─────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(async () => {
    createMainWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createMainWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('before-quit', async () => {
    await shutdownWorker();
});
// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 460,
        height: 680,
        minWidth: 400,
        minHeight: 580,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#1a1d24',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path_1.default.join(__dirname, '../../src/overlay/icon.png'),
        show: false,
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // mainWindow.webContents.openDevTools()
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../../dist-renderer/index.html'));
    }
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Open external links in the real browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
}
// ── Player window (replaces Chrome spawn) ─────────────────────────────────────
function createPlayerWindow() {
    if (playerWindow)
        return;
    playerWindow = new electron_1.BrowserWindow({
        width: 1920,
        height: 1080,
        show: true,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Allow autoplay without user gesture
            additionalArguments: ['--autoplay-policy=no-user-gesture-required'],
        },
    });
    playerWindow.loadURL(PLAYER_URL);
    playerWindow.on('closed', () => {
        playerWindow = null;
    });
}
function destroyPlayerWindow() {
    if (playerWindow) {
        playerWindow.destroy();
        playerWindow = null;
    }
}
// ── Worker management ─────────────────────────────────────────────────────────
let workerModule = null;
let workerRunning = false;
async function startWorkerProcess() {
    if (workerRunning)
        return;
    // Lazy-load the worker module
    if (!workerModule) {
        workerModule = require('../src/index');
    }
    workerModule.setStatusChangeCallback((status) => {
        mainWindow?.webContents.send('worker:statusUpdate', status);
    });
    const auth = store.get('auth');
    const obsUrl = store.get('obsUrl');
    const obsPassword = store.get('obsPassword');
    const twitchChannel = store.get('twitchChannel');
    const twitchBotUsername = store.get('twitchBotUsername');
    const twitchBotToken = store.get('twitchBotToken');
    createPlayerWindow();
    workerRunning = true;
    workerModule.startWorker({
        playerId: auth?.linkedPlayerId || undefined,
        obsUrl,
        obsPassword,
        twitchChannel,
        twitchBotUsername,
        twitchBotToken,
    }).catch((err) => {
        console.error('[electron] Worker crashed:', err);
        workerRunning = false;
        mainWindow?.webContents.send('worker:statusUpdate', { running: false });
    });
}
async function shutdownWorker() {
    if (!workerRunning || !workerModule)
        return;
    await workerModule.stopWorker();
    workerRunning = false;
    destroyPlayerWindow();
}
// ── FightersEdge device auth ──────────────────────────────────────────────────
//
// We use a loopback "device authorisation" flow:
//   1. Spin up a tiny HTTP server on localhost:7777.
//   2. Open the FightersEdge web app's /device-auth page in the user's
//      browser, passing our loopback URL as redirect_uri.
//   3. User logs into FightersEdge (if not already) and clicks Authorize.
//   4. Web app redirects to http://localhost:7777/callback?token=<deviceToken>.
//   5. Our loopback server captures the token and hands it back here.
//   6. We call GET /auth/me with the token to fetch the session.
//
// This keeps everything FightersEdge-native and is platform-agnostic: the
// user can stream to any destination via OBS, we just identify them.
let callbackServer = null;
function startDeviceCallbackServer() {
    return new Promise((resolve, reject) => {
        const server = http_1.default.createServer((req, res) => {
            const url = new URL(req.url || '/', `http://localhost:${DEVICE_CALLBACK_PORT}`);
            if (url.pathname === '/callback') {
                const token = url.searchParams.get('token');
                const error = url.searchParams.get('error');
                // Always show the user something — success or failure — so they're
                // not staring at a blank page.
                res.writeHead(200, { 'Content-Type': 'text/html' });
                if (token) {
                    res.end(`<!DOCTYPE html>
<html><head><title>FightersEdge AutoStream</title>
<style>body{font-family:sans-serif;background:#1a1d24;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}div{max-width:360px}h1{color:#3eb489;margin:0 0 12px}</style>
</head><body><div><h1>Connected!</h1><p>You can close this tab and return to FightersEdge AutoStream.</p></div></body></html>`);
                    server.close();
                    callbackServer = null;
                    resolve({ token });
                }
                else {
                    res.end(`<!DOCTYPE html>
<html><head><title>FightersEdge AutoStream</title>
<style>body{font-family:sans-serif;background:#1a1d24;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}div{max-width:360px}h1{color:#ff6b6b;margin:0 0 12px}</style>
</head><body><div><h1>Authorization cancelled</h1><p>Return to FightersEdge AutoStream to try again.</p></div></body></html>`);
                    server.close();
                    callbackServer = null;
                    resolve({ error: error || 'denied' });
                }
                return;
            }
            res.writeHead(404);
            res.end();
        });
        server.listen(DEVICE_CALLBACK_PORT, () => {
            callbackServer = server;
        });
        server.on('error', reject);
        // Don't let a stuck browser tab hang us forever.
        setTimeout(() => {
            if (callbackServer === server) {
                server.close();
                callbackServer = null;
                reject(new Error('Login timed out. Please try again.'));
            }
        }, 5 * 60 * 1000); // 5 minutes
    });
}
async function doFightersEdgeLogin() {
    // If a previous attempt left the loopback server running, close it first.
    if (callbackServer) {
        try {
            callbackServer.close();
        }
        catch { /* ignore */ }
        callbackServer = null;
    }
    const tokenPromise = startDeviceCallbackServer();
    const consentUrl = `${FE_WEB_BASE}/device-auth` +
        `?redirect_uri=${encodeURIComponent(DEVICE_CALLBACK_URI)}` +
        `&device_name=${encodeURIComponent('FightersEdge AutoStream')}`;
    await electron_1.shell.openExternal(consentUrl);
    const result = await tokenPromise;
    if ('error' in result) {
        throw new Error(result.error === 'denied'
            ? 'Authorization was cancelled.'
            : `Login failed: ${result.error}`);
    }
    // Exchange the device token for the session — tells us who the user is
    // and which FightersEdge Player they're linked to (if any).
    const meRes = await fetch(`${FE_API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${result.token}` },
    });
    if (!meRes.ok) {
        throw new Error(`Session lookup failed (${meRes.status})`);
    }
    const me = (await meRes.json());
    const auth = {
        deviceToken: result.token,
        accountId: me.account.id,
        displayName: me.account.displayName || me.account.email || 'FightersEdge User',
        email: me.account.email || '',
        avatarUrl: '', // FE doesn't currently serve an avatar — Dashboard falls back gracefully
        linkedPlayerId: me.linkedPlayer?.id || '',
        linkedPlayerName: me.linkedPlayer?.name || '',
        linkedPlayerSlug: me.linkedPlayer?.slug || '',
        linkedPlayerImageUrl: me.linkedPlayer?.imageUrl || '',
    };
    store.set('auth', auth);
    return auth;
}
// ── IPC handlers ──────────────────────────────────────────────────────────────
electron_1.ipcMain.handle('auth:login', async () => {
    try {
        return { ok: true, auth: await doFightersEdgeLogin() };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
});
electron_1.ipcMain.handle('auth:logout', () => {
    store.set('auth', null);
    return { ok: true };
});
electron_1.ipcMain.handle('auth:getStored', () => {
    return store.get('auth');
});
electron_1.ipcMain.handle('worker:start', async () => {
    try {
        await startWorkerProcess();
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
});
electron_1.ipcMain.handle('worker:stop', async () => {
    try {
        await shutdownWorker();
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
});
electron_1.ipcMain.handle('worker:status', () => {
    return workerModule?.getStatus() ?? {
        running: false,
        obsConnected: false,
        botConnected: false,
        currentVideo: null,
        queueSize: 0,
    };
});
electron_1.ipcMain.handle('obs:test', async (_event, { url, password }) => {
    try {
        // Dynamically import OBSClient to test connection without starting the worker
        const { OBSClient } = require('../src/obs-client');
        const testClient = new OBSClient(url, password);
        await testClient.connect();
        testClient.disconnect();
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
});
electron_1.ipcMain.handle('obs:getConfig', () => ({
    url: store.get('obsUrl'),
    password: store.get('obsPassword'),
    setupDone: store.get('obsSetupDone'),
}));
electron_1.ipcMain.handle('obs:saveConfig', (_event, { url, password }) => {
    store.set('obsUrl', url);
    store.set('obsPassword', password);
    store.set('obsSetupDone', true);
    return { ok: true };
});
electron_1.ipcMain.handle('settings:get', () => ({
    obsUrl: store.get('obsUrl'),
    obsPassword: store.get('obsPassword'),
    twitchChannel: store.get('twitchChannel'),
    twitchBotUsername: store.get('twitchBotUsername'),
    twitchBotToken: store.get('twitchBotToken'),
    obsSetupDone: store.get('obsSetupDone'),
}));
electron_1.ipcMain.handle('settings:save', (_event, settings) => {
    if (settings.obsUrl !== undefined)
        store.set('obsUrl', settings.obsUrl);
    if (settings.obsPassword !== undefined)
        store.set('obsPassword', settings.obsPassword);
    if (settings.twitchChannel !== undefined)
        store.set('twitchChannel', settings.twitchChannel);
    if (settings.twitchBotUsername !== undefined)
        store.set('twitchBotUsername', settings.twitchBotUsername);
    if (settings.twitchBotToken !== undefined)
        store.set('twitchBotToken', settings.twitchBotToken);
    if (settings.obsSetupDone !== undefined)
        store.set('obsSetupDone', settings.obsSetupDone);
    return { ok: true };
});
electron_1.ipcMain.handle('player:getUrl', () => PLAYER_URL);
