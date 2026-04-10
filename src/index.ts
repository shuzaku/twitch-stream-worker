import 'dotenv/config'
import { spawn } from 'child_process'
import { buildPlaylist, Video } from './api'
import { startPlayerServer, playVideo } from './player-server'
import { OBSClient } from './obs-client'
import { TwitchBot } from './twitch-bot'

const QUEUE_SIZE           = parseInt(process.env.QUEUE_SIZE    || '10',   10)
const RETRY_DELAY_MS       = 5000
const MAX_CONSECUTIVE_ERRORS = 5
const PLAYER_PORT          = process.env.PLAYER_PORT || process.env.OVERLAY_PORT || '3001'
const CHROME_PATH          = process.env.CHROME_PATH ||
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
  ], { detached: false, stdio: 'ignore' })

  chrome.on('error', (err) => {
    console.error(`[main] Failed to launch Chrome: ${err.message}`)
    console.error(`[main] Set CHROME_PATH in .env to your Chrome executable path`)
  })

  console.log(`[main] Chrome launched — open OBS and point a Window/Browser source at ${playerUrl}`)

  // Give Chrome a moment to open before connecting OBS
  await sleep(2000)

  const obs = new OBSClient()
  await obs.connect()
  await obs.startStream()

  const bot = new TwitchBot()
  await bot.connect()

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

  // ── Infinite playlist loop ────────────────────────────────────────────
  let playlist: Video[] = []
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
