import 'dotenv/config'
import { spawn } from 'child_process'
import { buildPlaylist, Video } from './api'
import { startPlayerServer, playVideo, waitForBrowser } from './player-server'
import { OBSClient } from './obs-client'
import { TwitchBot } from './twitch-bot'

const QUEUE_SIZE             = parseInt(process.env.QUEUE_SIZE || '10', 10)
const RETRY_DELAY_MS         = 5000
const MAX_CONSECUTIVE_ERRORS = 5
const PLAYER_PORT            = process.env.PLAYER_PORT || process.env.OVERLAY_PORT || '3001'
const CHROME_PATH            = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

async function main() {
  console.log('[main] FightersEdge Twitch Stream Worker starting...')

  await startPlayerServer()

  // Launch Chrome in app mode pointing at the player page
  const playerUrl = `http://localhost:${PLAYER_PORT}/player`
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
  ], { detached: false, stdio: 'ignore' })

  chrome.on('error', (err) => {
    console.error(`[main] Failed to launch Chrome: ${err.message}`)
    console.error('[main] Set CHROME_PATH in .env to your Chrome executable path')
  })

  console.log(`[main] Chrome launched — open OBS and point a Browser Source at ${playerUrl}`)

  // While Chrome is loading, do all the slow async work in parallel:
  //   - pre-fetch the first playlist batch
  //   - connect to OBS and start the stream
  //   - connect the Twitch bot
  //   - wait for the browser WebSocket to connect
  // Playback starts as soon as ALL of these are ready.
  const obs = new OBSClient()
  const bot = new TwitchBot()

  let initialPlaylist: Video[] = []

  await Promise.all([
    // Pre-fetch playlist
    buildPlaylist(QUEUE_SIZE)
      .then((videos) => { initialPlaylist = videos })
      .catch((err) => console.error('[main] Failed to pre-fetch playlist:', err)),
    // OBS + bot
    obs.connect().then(() => obs.startStream()),
    bot.connect(),
    // Wait for browser WebSocket — this is the gate that holds playback
    waitForBrowser().then(() => console.log('[main] Browser ready')),
  ])

  console.log('[main] All systems ready — starting playback')

  process.on('SIGINT', async () => {
    console.log('\n[main] Shutting down...')
    await obs.stopStream()
    obs.disconnect()
    bot.disconnect()
    chrome.kill()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await obs.stopStream()
    obs.disconnect()
    bot.disconnect()
    chrome.kill()
    process.exit(0)
  })

  // ── Infinite playlist loop ────────────────────────────────────────────────
  let playlist = initialPlaylist
  let playlistIndex = 0
  let consecutiveErrors = 0

  while (true) {
    if (playlistIndex >= playlist.length) {
      console.log('[main] Fetching new playlist batch...')
      try {
        playlist = await buildPlaylist(QUEUE_SIZE)
        playlistIndex = 0
        console.log(`[main] Loaded ${playlist.length} videos into queue`)
      } catch (err) {
        console.error('[main] Failed to fetch playlist:', err)
        await sleep(RETRY_DELAY_MS * 2)
        continue
      }
    }

    if (playlist.length === 0) {
      console.warn('[main] No videos returned from API. Retrying in 30s...')
      await sleep(30000)
      continue
    }

    const video = playlist[playlistIndex++]
    console.log(`[main] Now playing: ${video.Title || video.Url}`)

    await bot.announceVideo(video)

    try {
      await playVideo(video)
      consecutiveErrors = 0
      console.log(`[main] Finished: ${video.Title || video.Url}`)
    } catch (err) {
      consecutiveErrors++
      console.error(
        `[main] Playback failed (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
        err instanceof Error ? err.message : err
      )

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error('[main] Too many consecutive errors — waiting 60s...')
        consecutiveErrors = 0
        await sleep(60000)
      } else {
        await sleep(RETRY_DELAY_MS)
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('[main] Fatal error:', err)
  process.exit(1)
})
