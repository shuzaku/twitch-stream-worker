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
import { Config, setDevMode } from '../src/config'

// Tell Config whether to honour env-var overrides. ONLY in dev — packaged
// builds always use the baked-in production constants, regardless of whatever
// stray env vars the user's machine might have set. Must be called before any
// `Config.*` access below.
setDevMode(!app.isPackaged)

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
  displayName: string
  email: string
  avatarUrl: string
  accountType: string
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
  twitchBotEnabled: boolean
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
    twitchBotEnabled: false,
    obsSetupDone: false,
  },
})

// ── Window references ─────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

// All values below come from src/config.ts which bakes in production defaults
// and only honours env overrides in dev mode (set above via setDevMode).
const PLAYER_URL = `http://localhost:${Config.PLAYER_PORT}/player`

const FE_WEB_BASE          = Config.FE_WEB_BASE
const FE_API_BASE          = Config.FE_API_BASE
const DEVICE_CALLBACK_PORT = Config.DEVICE_CALLBACK_PORT
const DEVICE_CALLBACK_URI  = `http://localhost:${DEVICE_CALLBACK_PORT}/callback`

// Twitch OAuth — used ONLY for the optional chat-bot integration. Identity
// stays with FightersEdge; this just gets a token tmi.js can use to post
// "Now playing" messages in your channel. Different port from the FE callback
// so the two flows can never collide.
const TWITCH_CLIENT_ID         = Config.TWITCH_CLIENT_ID
const TWITCH_BOT_CALLBACK_PORT = Config.TWITCH_BOT_CALLBACK_PORT
const TWITCH_BOT_CALLBACK_URI  = `http://localhost:${TWITCH_BOT_CALLBACK_PORT}/twitch-bot-callback`

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

// ── Worker management ─────────────────────────────────────────────────────────

let workerModule: typeof import('../src/index') | null = null
let workerRunning = false

async function startWorkerProcess() {
  if (workerRunning) return

  // Lazy-load the worker module
  if (!workerModule) {
    workerModule = require('../src/index') as typeof import('../src/index')
  }

  workerModule.setStatusChangeCallback((status) => {
    mainWindow?.webContents.send('worker:statusUpdate', status)
  })

  const auth = store.get('auth')
  const obsUrl = store.get('obsUrl') as string
  const obsPassword = store.get('obsPassword') as string
  const botEnabled = store.get('twitchBotEnabled') as boolean
  const twitchChannel     = botEnabled ? store.get('twitchChannel')     as string : ''
  const twitchBotUsername = botEnabled ? store.get('twitchBotUsername') as string : ''
  const twitchBotToken    = botEnabled ? store.get('twitchBotToken')    as string : ''

  const isAdmin = auth?.accountType === 'admin'

  // Prime the player-server with the saved volume *before* the stream starts.
  // This ensures the first ready signal from any browser client gets the correct
  // volume immediately, preventing a loud spike on the first video.
  const savedVolume = (store.get as (key: string, def: number) => number)('playerVolume', 80)
  const { setVolume } = require('../src/player-server') as typeof import('../src/player-server')
  setVolume(savedVolume)

  workerRunning = true
  workerModule.startWorker({
    playerId: isAdmin ? undefined : (auth?.linkedPlayerId || undefined),
    obsUrl,
    obsPassword,
    twitchChannel,
    twitchBotUsername,
    twitchBotToken,
  }).catch((err) => {
    console.error('[electron] Worker crashed:', err)
    workerRunning = false
    mainWindow?.webContents.send('worker:statusUpdate', {
      running: false,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

async function shutdownWorker() {
  if (!workerRunning || !workerModule) return
  await workerModule.stopWorker()
  workerRunning = false
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
    displayName: me.account.displayName || me.account.email || 'FightersEdge User',
    email: me.account.email || '',
    avatarUrl: '',  // FE doesn't currently serve an avatar — Dashboard falls back gracefully
    accountType: me.account.accountType || '',
    linkedPlayerId:       me.linkedPlayer?.id      || '',
    linkedPlayerName:     me.linkedPlayer?.name    || '',
    linkedPlayerSlug:     me.linkedPlayer?.slug    || '',
    linkedPlayerImageUrl: me.linkedPlayer?.imageUrl || '',
  }

  store.set('auth', auth)
  return auth
}

// ── Twitch chat-bot connection (optional) ────────────────────────────────────
//
// This is a separate, opt-in OAuth flow that ONLY exists to populate the
// twitchChannel / twitchBotUsername / twitchBotToken settings used by tmi.js.
// Twitch is NOT the user's identity — that's FightersEdge above. A user can
// stream to YouTube or anywhere else and skip this entirely.
//
// We use Twitch's implicit flow (token in URL fragment) because it doesn't
// require a client secret — perfect for an unattended desktop client. The
// token is only used to authenticate tmi.js as the bot account.

let twitchBotCallbackServer: http.Server | null = null

interface TwitchBotConnectResult {
  botUsername: string
  displayName: string
}

function startTwitchBotCallbackServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${TWITCH_BOT_CALLBACK_PORT}`)

      if (url.pathname === '/twitch-bot-callback') {
        // The access token is in the URL fragment (#access_token=...) which
        // browsers don't send to the server. We serve a tiny page that reads
        // it client-side and POSTs it back to /twitch-bot-token below.
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!DOCTYPE html>
<html><head><title>FightersEdge AutoStream</title>
<style>body{font-family:sans-serif;background:#1a1d24;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}div{max-width:360px}h1{color:#3eb489;margin:0 0 12px}</style>
</head><body><div><h1 id="t">Connecting Twitch bot...</h1><p id="p">One moment.</p></div>
<script>
  const params = new URLSearchParams(window.location.hash.slice(1))
  const token = params.get('access_token')
  if (!token) {
    document.getElementById('t').textContent = 'Authorization cancelled'
    document.getElementById('t').style.color = '#ff6b6b'
    document.getElementById('p').textContent = 'Return to FightersEdge AutoStream to try again.'
    fetch('/twitch-bot-token', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ error: 'denied' }) }).catch(()=>{})
  } else {
    fetch('/twitch-bot-token', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token }) })
      .then(() => {
        document.getElementById('t').textContent = 'Twitch bot connected!'
        document.getElementById('p').textContent = 'You can close this tab.'
      })
      .catch(() => {
        document.getElementById('t').textContent = 'Connection failed'
        document.getElementById('t').style.color = '#ff6b6b'
      })
  }
</script>
</body></html>`)
        return
      }

      if (url.pathname === '/twitch-bot-token' && req.method === 'POST') {
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { token?: string; error?: string }
            res.writeHead(200)
            res.end('ok')
            server.close()
            twitchBotCallbackServer = null
            if (parsed.error) {
              reject(new Error(parsed.error === 'denied' ? 'Authorization was cancelled.' : parsed.error))
            } else if (parsed.token) {
              resolve(parsed.token)
            } else {
              reject(new Error('No token returned'))
            }
          } catch {
            res.writeHead(400)
            res.end('bad request')
            reject(new Error('Token parse failed'))
          }
        })
        return
      }

      res.writeHead(404)
      res.end()
    })

    server.listen(TWITCH_BOT_CALLBACK_PORT, () => {
      twitchBotCallbackServer = server
    })
    server.on('error', reject)

    setTimeout(() => {
      if (twitchBotCallbackServer === server) {
        server.close()
        twitchBotCallbackServer = null
        reject(new Error('Twitch connection timed out. Please try again.'))
      }
    }, 5 * 60 * 1000)
  })
}

async function doConnectTwitchBot(): Promise<TwitchBotConnectResult> {
  if (!TWITCH_CLIENT_ID) {
    throw new Error(
      'TWITCH_CLIENT_ID is not configured. Add it to your .env file. ' +
      'Register a Twitch app at https://dev.twitch.tv/console/apps with ' +
      `OAuth redirect URL set to ${TWITCH_BOT_CALLBACK_URI}.`
    )
  }

  if (twitchBotCallbackServer) {
    try { twitchBotCallbackServer.close() } catch { /* ignore */ }
    twitchBotCallbackServer = null
  }

  const tokenPromise = startTwitchBotCallbackServer()

  // chat:read + chat:edit are the only scopes tmi.js needs to read/post
  // chat. user:read:email lets us identify which Twitch account the user
  // selected (so we can default the channel + bot username to it).
  // force_verify=true makes Twitch always show the consent screen, so users
  // who want to use a *separate* bot account can pick "Switch user" rather
  // than silently auto-approving with their main account.
  const scopes = 'chat:read chat:edit user:read:email'
  const authUrl =
    `https://id.twitch.tv/oauth2/authorize` +
    `?client_id=${TWITCH_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(TWITCH_BOT_CALLBACK_URI)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&force_verify=true`

  await shell.openExternal(authUrl)
  const accessToken = await tokenPromise

  // Fetch the Twitch user behind the token so we know which @ to save.
  const userRes = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID,
    },
  })
  if (!userRes.ok) {
    throw new Error(`Failed to fetch Twitch user info (${userRes.status})`)
  }
  const userData = (await userRes.json()) as {
    data: { id: string; login: string; display_name: string }[]
  }
  const twitchUser = userData.data[0]
  if (!twitchUser) {
    throw new Error('Twitch returned no user data')
  }

  // Persist. tmi.js expects the token prefixed with "oauth:".
  store.set('twitchBotUsername', twitchUser.login)
  store.set('twitchBotToken', `oauth:${accessToken}`)

  // Default the channel to the connecting account if the user hasn't already
  // set one — most people run the bot in their own channel. They can change
  // it later if running the bot in someone else's channel.
  if (!store.get('twitchChannel')) {
    store.set('twitchChannel', twitchUser.login)
  }

  return {
    botUsername: twitchUser.login,
    displayName: twitchUser.display_name,
  }
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
  twitchBotEnabled: store.get('twitchBotEnabled'),
  obsSetupDone: store.get('obsSetupDone'),
}))

ipcMain.handle('settings:save', (_event, settings: Partial<StoreSchema>) => {
  if (settings.obsUrl !== undefined)            store.set('obsUrl', settings.obsUrl)
  if (settings.obsPassword !== undefined)       store.set('obsPassword', settings.obsPassword)
  if (settings.twitchChannel !== undefined)     store.set('twitchChannel', settings.twitchChannel)
  if (settings.twitchBotUsername !== undefined) store.set('twitchBotUsername', settings.twitchBotUsername)
  if (settings.twitchBotToken !== undefined)    store.set('twitchBotToken', settings.twitchBotToken)
  if (settings.twitchBotEnabled !== undefined)  store.set('twitchBotEnabled', settings.twitchBotEnabled)
  if (settings.obsSetupDone !== undefined)      store.set('obsSetupDone', settings.obsSetupDone)
  return { ok: true }
})

ipcMain.handle('player:getUrl', () => PLAYER_URL)

ipcMain.handle('player:setVolume', (_event, volume: number) => {
  const { setVolume } = require('../src/player-server') as typeof import('../src/player-server')
  setVolume(volume)
  store.set('playerVolume' as never, volume)
  return { ok: true }
})

ipcMain.handle('player:getVolume', () => {
  return (store.get as (key: string, def: number) => number)('playerVolume', 80)
})

// ── Window controls ───────────────────────────────────────────────────────────
// The window is frameless, so the renderer draws its own title bar with these.

ipcMain.on('window:minimize', () => mainWindow?.minimize())

ipcMain.on('window:close', async () => {
  await shutdownWorker()
  app.quit()
})

ipcMain.handle('bot:connectTwitch', async () => {
  try {
    const result = await doConnectTwitchBot()
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('bot:disconnectTwitch', () => {
  store.set('twitchBotUsername', '')
  store.set('twitchBotToken', '')
  return { ok: true }
})
