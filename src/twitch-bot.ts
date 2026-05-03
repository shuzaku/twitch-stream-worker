import tmi from 'tmi.js'
import { Video } from './api'

export class TwitchBot {
  private client: tmi.Client | null = null
  private connected = false
  private readonly channel: string
  private readonly username: string
  private readonly token: string

  constructor(channel?: string, username?: string, token?: string) {
    this.channel  = channel  ?? process.env.TWITCH_CHANNEL       ?? ''
    this.username = username ?? process.env.TWITCH_BOT_USERNAME  ?? ''
    this.token    = token    ?? process.env.TWITCH_BOT_TOKEN     ?? ''
  }

  async connect(): Promise<void> {
    if (!this.channel || !this.username || !this.token) {
      console.warn('[bot] Channel, username or token not set — chat bot disabled')
      return
    }

    this.client = new tmi.Client({
      options: { debug: false },
      identity: { username: this.username, password: this.token },
      channels: [this.channel],
    })

    try {
      await this.client.connect()
      this.connected = true
      console.log(`[bot] Connected to #${this.channel}`)
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

    // Player profile links — only include players that have a profile URL
    if (video.players && video.players.length > 0) {
      const playerLinks = video.players
        .map((p) => p.profileUrl ? `${p.name} → ${p.profileUrl}` : p.name)
        .join('  |  ')
      parts.push(playerLinks)
    }

    const message = parts.join('  •  ')

    try {
      await this.client.say(this.channel, message)
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
