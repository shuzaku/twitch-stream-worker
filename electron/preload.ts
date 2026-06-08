import { contextBridge, ipcRenderer } from 'electron'

// All IPC channels the renderer is allowed to use
const api = {
  // ── Auth ───────────────────────────────────────────────────────────────────
  // login() opens the FightersEdge web app in the user's browser, captures
  // the device token from a loopback redirect, and returns the session.
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getStoredAuth: () => ipcRenderer.invoke('auth:getStored'),

  // ── Worker ─────────────────────────────────────────────────────────────────
  startStream: () => ipcRenderer.invoke('worker:start'),
  stopStream: () => ipcRenderer.invoke('worker:stop'),
  getStatus: () => ipcRenderer.invoke('worker:status'),

  // ── OBS ────────────────────────────────────────────────────────────────────
  testOBSConnection: (url: string, password: string) =>
    ipcRenderer.invoke('obs:test', { url, password }),
  getOBSConfig: () => ipcRenderer.invoke('obs:getConfig'),
  saveOBSConfig: (url: string, password: string) =>
    ipcRenderer.invoke('obs:saveConfig', { url, password }),

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('settings:save', settings),

  // ── Games ──────────────────────────────────────────────────────────────────
  getAvailableGames: () => ipcRenderer.invoke('games:getAvailable'),

  // ── Twitch chat bot (optional, separate from FE identity) ─────────────────
  connectTwitchBot: () => ipcRenderer.invoke('bot:connectTwitch'),
  disconnectTwitchBot: () => ipcRenderer.invoke('bot:disconnectTwitch'),

  // ── Player URL + volume + skip ────────────────────────────────────────────
  getPlayerUrl: () => ipcRenderer.invoke('player:getUrl'),
  getPlayerVolume: () => ipcRenderer.invoke('player:getVolume'),
  setPlayerVolume: (volume: number) => ipcRenderer.invoke('player:setVolume', volume),
  skipVideo: () => ipcRenderer.invoke('player:skip'),

  // ── Window controls ────────────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow:    () => ipcRenderer.send('window:close'),

  // ── Events from main → renderer ────────────────────────────────────────────
  onStatusUpdate: (cb: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => cb(status)
    ipcRenderer.on('worker:statusUpdate', handler)
    return () => ipcRenderer.removeListener('worker:statusUpdate', handler)
  },

  onTimeUpdate: (cb: (currentTime: number, duration: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { currentTime: number; duration: number }) =>
      cb(payload.currentTime, payload.duration)
    ipcRenderer.on('player:timeUpdate', handler)
    return () => ipcRenderer.removeListener('player:timeUpdate', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

// Type declaration for renderer TypeScript
export type ElectronAPI = typeof api
