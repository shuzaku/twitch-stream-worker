import http from 'http'
import path from 'path'
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { Video } from './api'

const PORT = parseInt(process.env.PLAYER_PORT || process.env.OVERLAY_PORT || '3001', 10)

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'overlay')))

app.get('/player', (_req, res) => {
  res.sendFile(path.join(__dirname, 'overlay', 'player.html'))
})

// Legacy preview endpoint — still useful for monitoring
app.get('/api/now-playing', (_req, res) => {
  res.json(currentVideo)
})

let currentVideo: Video | null = null
let browserSocket: WebSocket | null = null

// Pending playback promise — resolved/rejected when the browser reports ended/error
let pendingResolve: (() => void) | null = null
let pendingReject: ((err: Error) => void) | null = null

// Resolves once the browser sends { type: 'ready' } (YouTube player fully initialised)
let browserReadyResolve: (() => void) | null = null
const browserReadyPromise = new Promise<void>((resolve) => {
  browserReadyResolve = resolve
})

export function waitForBrowser(): Promise<void> {
  return browserReadyPromise
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  console.log('[player] Browser connected')
  browserSocket = ws

  ws.on('message', (raw) => {
    let msg: { type: string; code?: number }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'ready') {
      console.log('[player] YouTube player ready')
      browserReadyResolve?.()
      browserReadyResolve = null
    } else if (msg.type === 'ended') {
      console.log(`[player] Video ended: ${currentVideo?.Url}`)
      pendingResolve?.()
      pendingResolve = null
      pendingReject = null
    } else if (msg.type === 'error') {
      const err = new Error(`YouTube player error (code ${msg.code}) for ${currentVideo?.Url}`)
      console.error(`[player] ${err.message}`)
      pendingReject?.(err)
      pendingResolve = null
      pendingReject = null
    }
  })

  ws.on('close', () => {
    console.warn('[player] Browser disconnected')
    if (browserSocket === ws) browserSocket = null
    // If a video was playing, reject so the main loop can handle it
    pendingReject?.(new Error('Browser disconnected during playback'))
    pendingResolve = null
    pendingReject = null
  })
})

export function playVideo(video: Video): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) {
      return reject(new Error('No browser connected to player server'))
    }

    // Cancel any previous pending promise
    pendingResolve?.()
    pendingResolve = null
    pendingReject = null

    currentVideo = video
    pendingResolve = resolve
    pendingReject = reject

    browserSocket.send(JSON.stringify({
      type: 'play',
      videoId: video.Url,
      title: video.Title || null,
      game: video.Game || null,
      player1: video.players?.[0]?.name || null,
      player2: video.players?.[1]?.name || null,
    }))
  })
}

export function startPlayerServer(): Promise<void> {
  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[player] Server running at http://localhost:${PORT}/player`)
      resolve()
    })
  })
}
