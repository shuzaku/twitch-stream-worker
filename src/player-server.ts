import http from 'http'
import path from 'path'
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { Video } from './api'
import { Config } from './config'

const PORT = Config.PLAYER_PORT

// Resolve overlay path relative to project root regardless of whether we are
// running from src/ (ts-node) or dist-electron/src/ (compiled).
function overlayDir(): string {
  // Walk up from __dirname until we find src/overlay
  const candidates = [
    path.join(__dirname, 'overlay'),                      // ts-node: src/overlay
    path.join(__dirname, '..', 'src', 'overlay'),         // dist-electron/src → project root
    path.join(__dirname, '..', '..', 'src', 'overlay'),   // extra level just in case
  ]
  const fs = require('fs') as typeof import('fs')
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'player.html'))) return p
  }
  return candidates[0]
}

const OVERLAY_DIR = overlayDir()

const app = express()
app.use(express.json())
app.use(express.static(OVERLAY_DIR))

app.get('/player', (_req, res) => {
  res.sendFile(path.join(OVERLAY_DIR, 'player.html'))
})

// Legacy preview endpoint — still useful for monitoring
app.get('/api/now-playing', (_req, res) => {
  res.json(currentVideo)
})

let currentVideo: Video | null = null
let targetVolume = 80  // kept in sync via setVolume(); pushed to each client on ready
let onTimeUpdate: ((currentTime: number, duration: number) => void) | null = null

export function setTimeUpdateCallback(cb: (currentTime: number, duration: number) => void) {
  onTimeUpdate = cb
}

// Pending playback promise — resolved/rejected when the browser reports ended/error
let pendingResolve: (() => void) | null = null
let pendingReject: ((err: Error) => void) | null = null

// Resolves once any client sends { type: 'ready' } (YouTube player fully initialised).
// Re-created each time startPlayerServer() is called so restarts work correctly.
let browserReadyResolve: (() => void) | null = null
let browserReadyPromise: Promise<void> = new Promise<void>((resolve) => {
  browserReadyResolve = resolve
})

export function waitForBrowser(): Promise<void> {
  return browserReadyPromise
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  console.log(`[player] Browser connected (${wss.clients.size} total)`)

  ws.on('message', (raw) => {
    let msg: { type: string; code?: number }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'ready') {
      console.log('[player] YouTube player ready')
      ws.send(JSON.stringify({ type: 'setVolume', volume: targetVolume }))
      browserReadyResolve?.()
      browserReadyResolve = null
    } else if ((msg as any).type === 'timeUpdate') {
      const { currentTime, duration } = msg as any
      onTimeUpdate?.(currentTime, duration)
    } else if (msg.type === 'ended') {
      console.log(`[player] Video ended: ${currentVideo?.Url}`)
      // Only the first 'ended' signal matters — clear handlers so duplicates are ignored
      const resolve = pendingResolve
      pendingResolve = null
      pendingReject = null
      resolve?.()
    } else if (msg.type === 'error') {
      const err = new Error(`YouTube player error (code ${msg.code}) for ${currentVideo?.Url}`)
      console.error(`[player] ${err.message}`)
      const reject = pendingReject
      pendingResolve = null
      pendingReject = null
      reject?.(err)
    }
  })

  ws.on('close', () => {
    console.warn(`[player] Browser disconnected (${wss.clients.size} remaining)`)
    // Only fail the pending video if no clients are left
    if (wss.clients.size === 0) {
      const reject = pendingReject
      pendingResolve = null
      pendingReject = null
      reject?.(new Error('All browsers disconnected during playback'))
    }
  })
})

export function setVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(volume)))
  targetVolume = clamped
  const msg = JSON.stringify({ type: 'setVolume', volume: clamped })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  })
}

export function skipVideo(): void {
  // Tell the browser to stop immediately
  const msg = JSON.stringify({ type: 'skip' })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  })
  // Resolve the pending playback promise so the worker loop advances
  const resolve = pendingResolve
  pendingResolve = null
  pendingReject = null
  resolve?.()
}

export function playVideo(video: Video): Promise<void> {
  return new Promise((resolve, reject) => {
    const clients = [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN)
    if (clients.length === 0) {
      return reject(new Error('No browsers connected to player server'))
    }

    // Cancel any previous pending promise
    pendingResolve?.()
    pendingResolve = null
    pendingReject = null

    currentVideo = video
    pendingResolve = resolve
    pendingReject = reject

    const payload = JSON.stringify({
      type: 'play',
      videoId: video.Url,
      title: video.Title || null,
      game: video.Game || null,
      player1: video.players?.[0]?.name || null,
      player2: video.players?.[1]?.name || null,
      clipStart: video.clipStart ?? null,
      clipEnd:   video.clipEnd   ?? null,
    })

    // Broadcast to every connected client — Electron window + OBS browser source
    for (const client of clients) {
      client.send(payload)
    }
  })
}

export function startPlayerServer(): Promise<void> {
  // Reset browser-ready promise so restarts wait for a new ready signal.
  // If clients are already connected (OBS stayed open between streams),
  // resolve immediately — the YouTube player is already initialised.
  if (wss.clients.size > 0) {
    browserReadyPromise = Promise.resolve()
    browserReadyResolve = null
  } else {
    browserReadyPromise = new Promise<void>((resolve) => {
      browserReadyResolve = resolve
    })
  }
  pendingResolve = null
  pendingReject = null
  currentVideo = null

  // If the server is already listening (kept alive from the previous stream),
  // skip the listen call entirely.
  if ((server as any).listening) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[player] Server running at http://localhost:${PORT}/player`)
      resolve()
    })
  })
}

export function stopPlayerServer(): Promise<void> {
  // Keep the server running so OBS stays connected and restarts work cleanly.
  // State is reset in the next startPlayerServer() call.
  return Promise.resolve()
}

export function getPlayerUrl(): string {
  return `http://localhost:${PORT}/player`
}
