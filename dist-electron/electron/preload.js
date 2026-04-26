"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// All IPC channels the renderer is allowed to use
const api = {
    // ── Auth ───────────────────────────────────────────────────────────────────
    // login() opens the FightersEdge web app in the user's browser, captures
    // the device token from a loopback redirect, and returns the session.
    login: () => electron_1.ipcRenderer.invoke('auth:login'),
    logout: () => electron_1.ipcRenderer.invoke('auth:logout'),
    getStoredAuth: () => electron_1.ipcRenderer.invoke('auth:getStored'),
    // ── Worker ─────────────────────────────────────────────────────────────────
    startStream: () => electron_1.ipcRenderer.invoke('worker:start'),
    stopStream: () => electron_1.ipcRenderer.invoke('worker:stop'),
    getStatus: () => electron_1.ipcRenderer.invoke('worker:status'),
    // ── OBS ────────────────────────────────────────────────────────────────────
    testOBSConnection: (url, password) => electron_1.ipcRenderer.invoke('obs:test', { url, password }),
    getOBSConfig: () => electron_1.ipcRenderer.invoke('obs:getConfig'),
    saveOBSConfig: (url, password) => electron_1.ipcRenderer.invoke('obs:saveConfig', { url, password }),
    // ── Settings ───────────────────────────────────────────────────────────────
    getSettings: () => electron_1.ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke('settings:save', settings),
    // ── Player URL ─────────────────────────────────────────────────────────────
    getPlayerUrl: () => electron_1.ipcRenderer.invoke('player:getUrl'),
    // ── Events from main → renderer ────────────────────────────────────────────
    onStatusUpdate: (cb) => {
        const handler = (_event, status) => cb(status);
        electron_1.ipcRenderer.on('worker:statusUpdate', handler);
        return () => electron_1.ipcRenderer.removeListener('worker:statusUpdate', handler);
    },
};
electron_1.contextBridge.exposeInMainWorld('api', api);
