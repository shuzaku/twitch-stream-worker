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

  // ── Player URL ─────────────────────────────────────────────────────────────
  getPlayerUrl: () => ipcRenderer.invoke('player:getUrl'),

  // ── Events from main → renderer ────────────────────────────────────────────
  onStatusUpdate: (cb: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => cb(status)
    ipcRenderer.on('worker:statusUpdate', handler)
    return () => ipcRenderer.removeListener('worker:statusUpdate', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

// Type declaration for renderer TypeScript
export type ElectronAPI = typeof api
