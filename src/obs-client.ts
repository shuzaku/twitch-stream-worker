import OBSWebSocket, { OBSWebSocketError } from 'obs-websocket-js'

export class OBSClient {
  private obs = new OBSWebSocket()
  private connected = false
  private readonly url: string
  private readonly password: string

  constructor(url?: string, password?: string) {
    this.url      = url      ?? process.env.OBS_WS_URL      ?? 'ws://localhost:4455'
    this.password = password ?? process.env.OBS_WS_PASSWORD ?? ''
  }

  async connect(): Promise<void> {
    try {
      await this.obs.connect(this.url, this.password || undefined)
      this.connected = true
      console.log('[obs] Connected to OBS WebSocket')

      this.obs.on('ConnectionClosed', () => {
        this.connected = false
        console.warn('[obs] Connection closed — will retry on next action')
      })
    } catch (err) {
      this.connected = false
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[obs] Could not connect to OBS (${msg}) — streaming control disabled`)
    }
  }

  async startStream(): Promise<void> {
    if (!this.connected) {
      console.warn('[obs] Not connected — skipping StartStream')
      return
    }
    try {
      const status = await this.obs.call('GetStreamStatus')
      if (status.outputActive) {
        console.log('[obs] Stream already active')
        return
      }
      await this.obs.call('StartStream')
      console.log('[obs] Stream started')
    } catch (err) {
      const msg = err instanceof OBSWebSocketError ? err.message : String(err)
      console.error(`[obs] StartStream failed: ${msg}`)
    }
  }

  async stopStream(): Promise<void> {
    if (!this.connected) return
    try {
      const status = await this.obs.call('GetStreamStatus')
      if (!status.outputActive) return
      await this.obs.call('StopStream')
      console.log('[obs] Stream stopped')
    } catch (err) {
      const msg = err instanceof OBSWebSocketError ? err.message : String(err)
      console.error(`[obs] StopStream failed: ${msg}`)
    }
  }

  disconnect(): void {
    if (this.connected) {
      this.obs.disconnect()
      this.connected = false
    }
  }
}
