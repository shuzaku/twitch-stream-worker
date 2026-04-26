import 'dotenv/config'
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  protocol,
  session,
} from 'electron'
import path from 'path'
import http from 'http'

// Dynamically import electron-store (ESM default export wrapped in CJS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store').default as typeof import('electron-store').default

// ── Persistent store ──────────────────────────────────────────────────────────

// Shape of the credentials we keep for the logged-in user. Platform-agnostic:
// the Electron app holds a FightersEdge-issued device token. Streaming
// destinations (Twitch, YouTube, etc.) are configured separately in OBS and
// aren't part of identity.
export interface AuthUser {
  deviceToken: string
  accountId: string
  accountType: string
  displayName: string
  email: string
  avatarUrl: string
  linkedPlayerId: string
  linkedPlayerName: string
  linkedPlayerSlug: string
  linkedPlayerImageUrl: string
}

interface StoreSchema {
  auth: AuthUser | null
  obsUrl: string
  obsPassword: string
  twitchChannel: string
  twitchBotUsername: string
  twitchBotToken: string
  obsSetupDone: boolean
}

const store = new ElectronStore<StoreSchema>({
  defaults: {
    auth: null,
    obsUrl: 'ws://localhost:4455',
    obsPassword: '',
    twitchChannel: '',
    twitchBotUsername: '',
    twitchBotToken: '',
    obsSetupDone: false,
  },
})

// ── Window references ─────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let playerWindow: BrowserWindow | null = null

const PLAYER_PORT = process.env.PLAYER_PORT || '3001'
const PLAYER_URL  = `http://localhost:${PLAYER_PORT}/player`

// FightersEdge web app (where the user gives consent) and API (where we
// exchange the device token for session info).
const FE_WEB_BASE = process.env.FE_WEB_BASE || 'https://www.fighters-edge.com'
const FE_API_BASE = process.env.API_BASE_URL || 'https://fightmeserver.fly.dev'
const DEVICE_CALLBACK_PORT = 7777
const DEVICE_CALLBACK_URI  = `http://localhost:${DEVICE_CALLBACK_PORT}/callback`

const isDev = !app.isPackaged

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await shutdownWorker()
})

// ── Main window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 400,
    minHeight: 580,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1d24',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../../src/overlay/icon.png'),
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open external links in the real browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── Player window (replaces Chrome spawn) ─────────────────────────────────────

function createPlayerWindow() {
  if (playerWindow) return

  playerWindow = new BrowserWindow({
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
  })

  playerWindow.loadURL(PLAYER_URL)

  playerWindow.on('closed', () => {
    playerWindow = null
  })
}

function destroyPlayerWindow() {
  if (playerWindow) {
    playerWindow.destroy()
    playerWindow = null
  }
}

// ── Worker management ─────────────────────────────────────────────────────────

let workerModule: typeof import('../src/index') | null = null
let workerRunning = false

function isAdminAuth(auth: AuthUser | null | undefined): boolean {
  const accountType = auth?.accountType?.trim().toLowerCase()
  return accountType === 'admin' || accountType === 'administrator'
}

async function startWorkerProcess() {
  if (workerRunning) return

  const auth = store.get('auth')
  if (!auth) {
    throw new Error('Log in with a FightersEdge admin account to start AutoStream.')
  }
  if (!isAdminAuth(auth)) {
    throw new Error('Only FightersEdge admin accounts can start AutoStream.')
  }

  // Lazy-load the worker module
  if (!workerModule) {
    workerModule = require('../src/index') as typeof import('../src/index')
  }

  workerModule.setStatusChangeCallback((status) => {
    mainWindow?.webContents.send('worker:statusUpdate', status)
  })

  const obsUrl = store.get('obsUrl') as string
  const obsPassword = store.get('obsPassword') as string
  const twitchChannel = store.get('twitchChannel') as string
  const twitchBotUsername = store.get('twitchBotUsername') as string
  const twitchBotToken = store.get('twitchBotToken') as string

  createPlayerWindow()

  workerRunning = true
  workerModule.startWorker({
    obsUrl,
    obsPassword,
    twitchChannel,
    twitchBotUsername,
    twitchBotToken,
  }).catch((err) => {
    console.error('[electron] Worker crashed:', err)
    workerRunning = false
    mainWindow?.webContents.send('worker:statusUpdate', { running: false })
  })
}

async function shutdownWorker() {
  if (!workerRunning || !workerModule) return
  await workerModule.stopWorker()
  workerRunning = false
  destroyPlayerWindow()
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

let callbackServer: http.Server | null = null

function startDeviceCallbackServer(): Promise<{ token: string } | { error: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${DEVICE_CALLBACK_PORT}`)

      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token')
        const error = url.searchParams.get('error')

        // Always show the user something — success or failure — so they're
        // not staring at a blank page.
        res.writeHead(200, { 'Content-Type': 'text/html' })
        if (token) {
          res.end(`<!DOCTYPE html>
<html><head><title>FightersEdge AutoStream</title>
<style>body{font-family:sans-serif;background:#1a1d24;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}div{max-width:360px}h1{color:#3eb489;margin:0 0 12px}</style>
</head><body><div><h1>Connected!</h1><p>You can close this tab and return to FightersEdge AutoStream.</p></div></body></html>`)
          server.close()
          callbackServer = null
          resolve({ token })
        } else {
          res.end(`<!DOCTYPE html>
<html><head><title>FightersEdge AutoStream</title>
<style>body{font-family:sans-serif;background:#1a1d24;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}div{max-width:360px}h1{color:#ff6b6b;margin:0 0 12px}</style>
</head><body><div><h1>Authorization cancelled</h1><p>Return to FightersEdge AutoStream to try again.</p></div></body></html>`)
          server.close()
          callbackServer = null
          resolve({ error: error || 'denied' })
        }
        return
      }

      res.writeHead(404)
      res.end()
    })

    server.listen(DEVICE_CALLBACK_PORT, () => {
      callbackServer = server
    })
    server.on('error', reject)

    // Don't let a stuck browser tab hang us forever.
    setTimeout(() => {
      if (callbackServer === server) {
        server.close()
        callbackServer = null
        reject(new Error('Login timed out. Please try again.'))
      }
    }, 5 * 60 * 1000) // 5 minutes
  })
}

async function doFightersEdgeLogin(): Promise<AuthUser> {
  // If a previous attempt left the loopback server running, close it first.
  if (callbackServer) {
    try { callbackServer.close() } catch { /* ignore */ }
    callbackServer = null
  }

  const tokenPromise = startDeviceCallbackServer()

  const consentUrl =
    `${FE_WEB_BASE}/device-auth` +
    `?redirect_uri=${encodeURIComponent(DEVICE_CALLBACK_URI)}` +
    `&device_name=${encodeURIComponent('FightersEdge AutoStream')}`

  await shell.openExternal(consentUrl)

  const result = await tokenPromise
  if ('error' in result) {
    throw new Error(
      result.error === 'denied'
        ? 'Authorization was cancelled.'
        : `Login failed: ${result.error}`
    )
  }

  // Exchange the device token for the session — tells us who the user is
  // and which FightersEdge Player they're linked to (if any).
  const meRes = await fetch(`${FE_API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${result.token}` },
  })
  if (!meRes.ok) {
    throw new Error(`Session lookup failed (${meRes.status})`)
  }
  const me = (await meRes.json()) as {
    account: { id: string; displayName: string; email: string; accountType?: string }
    linkedPlayer: { id: string; name: string; slug: string; imageUrl?: string } | null
  }

  const auth: AuthUser = {
    deviceToken: result.token,
    accountId: me.account.id,
    accountType: me.account.accountType || '',
    displayName: me.account.displayName || me.account.email || 'FightersEdge User',
    email: me.account.email || '',
    avatarUrl: '',  // FE doesn't currently serve an avatar — Dashboard falls back gracefully
    linkedPlayerId:       me.linkedPlayer?.id      || '',
    linkedPlayerName:     me.linkedPlayer?.name    || '',
    linkedPlayerSlug:     me.linkedPlayer?.slug    || '',
    linkedPlayerImageUrl: me.linkedPlayer?.imageUrl || '',
  }

  store.set('auth', auth)
  return auth
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('auth:login', async () => {
  try {
    return { ok: true, auth: await doFightersEdgeLogin() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('auth:logout', () => {
  store.set('auth', null)
  return { ok: true }
})

ipcMain.handle('auth:getStored', () => {
  return store.get('auth')
})

ipcMain.handle('worker:start', async () => {
  try {
    await startWorkerProcess()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('worker:stop', async () => {
  try {
    await shutdownWorker()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('worker:status', () => {
  return workerModule?.getStatus() ?? {
    running: false,
    obsConnected: false,
    botConnected: false,
    currentVideo: null,
    queueSize: 0,
  }
})

ipcMain.handle('obs:test', async (_event, { url, password }: { url: string; password: string }) => {
  try {
    // Dynamically import OBSClient to test connection without starting the worker
    const { OBSClient } = require('../src/obs-client') as typeof import('../src/obs-client')
    const testClient = new OBSClient(url, password)
    await testClient.connect()
    testClient.disconnect()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('obs:getConfig', () => ({
  url: store.get('obsUrl'),
  password: store.get('obsPassword'),
  setupDone: store.get('obsSetupDone'),
}))

ipcMain.handle('obs:saveConfig', (_event, { url, password }: { url: string; password: string }) => {
  store.set('obsUrl', url)
  store.set('obsPassword', password)
  store.set('obsSetupDone', true)
  return { ok: true }
})

ipcMain.handle('settings:get', () => ({
  obsUrl: store.get('obsUrl'),
  obsPassword: store.get('obsPassword'),
  twitchChannel: store.get('twitchChannel'),
  twitchBotUsername: store.get('twitchBotUsername'),
  twitchBotToken: store.get('twitchBotToken'),
  obsSetupDone: store.get('obsSetupDone'),
}))

ipcMain.handle('settings:save', (_event, settings: Partial<StoreSchema>) => {
  if (settings.obsUrl !== undefined)          store.set('obsUrl', settings.obsUrl)
  if (settings.obsPassword !== undefined)     store.set('obsPassword', settings.obsPassword)
  if (settings.twitchChannel !== undefined)   store.set('twitchChannel', settings.twitchChannel)
  if (settings.twitchBotUsername !== undefined) store.set('twitchBotUsername', settings.twitchBotUsername)
  if (settings.twitchBotToken !== undefined)  store.set('twitchBotToken', settings.twitchBotToken)
  if (settings.obsSetupDone !== undefined)    store.set('obsSetupDone', settings.obsSetupDone)
  return { ok: true }
})

ipcMain.handle('player:getUrl', () => PLAYER_URL)
