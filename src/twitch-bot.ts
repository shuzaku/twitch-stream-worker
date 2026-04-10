import tmi from 'tmi.js'
import { Video } from './api'

const CHANNEL  = process.env.TWITCH_CHANNEL       || ''
const USERNAME = process.env.TWITCH_BOT_USERNAME   || ''
const TOKEN    = process.env.TWITCH_BOT_TOKEN      || '' // OAuth token: oauth:xxxxxxxx

export class TwitchBot {
  private client: tmi.Client | null = null
  private connected = false

  async connect(): Promise<void> {
    if (!CHANNEL || !USERNAME || !TOKEN) {
      console.warn('[bot] TWITCH_CHANNEL, TWITCH_BOT_USERNAME or TWITCH_BOT_TOKEN not set — chat bot disabled')
      return
    }

    this.client = new tmi.Client({
      options: { debug: false },
      identity: { username: USERNAME, password: TOKEN },
      channels: [CHANNEL],
    })

    try {
      await this.client.connect()
      this.connected = true
      console.log(`[bot] Connected to #${CHANNEL}`)
    } catch (err) {
      console.error('[bot] Failed to connect:', err)
    }

    this.client.on('disconnected', (reason) => {
      this.connected = false
      console.warn(`[bot] Disconnected: ${reason}`)
    })
  }

  async announceVideo(video: Video): Promise<void> {
    if (!this.connected || !this.client) return

    const parts: string[] = []

    // Video title
    const title = video.Title || `Match ${video.Url}`
    parts.push(`Now playing: ${title}`)

    // YouTube link
    parts.push(`▶ https://youtu.be/${video.Url}`)

    // Player profile links
    if (video.players && video.players.length > 0) {
      const playerLinks = video.players
        .map((p) => `${p.name} → ${p.profileUrl}`)
        .join('  |  ')
      parts.push(playerLinks)
    }

    const message = parts.join('  •  ')

    try {
      await this.client.say(CHANNEL, message)
    } catch (err) {
      console.error('[bot] Failed to send message:', err)
    }
  }

  disconnect(): void {
    if (this.client && this.connected) {
      this.client.disconnect()
      this.connected = false
    }
  }
}
