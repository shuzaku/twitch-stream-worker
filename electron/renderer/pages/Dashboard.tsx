import React, { useEffect, useState, useCallback } from 'react'
import type { AuthUser } from '../App'
import { Logo } from '../App'

interface WorkerStatus {
  running: boolean
  obsConnected: boolean
  botConnected: boolean
  currentVideo: {
    Url: string
    Title?: string
    Game?: string
    players?: { name: string; profileUrl: string }[]
  } | null
  queueSize: number
  error?: string
}

interface Props {
  auth: AuthUser
  onLogout: () => void
}

type View = 'home' | 'settings' | 'obs'

export default function Dashboard({ auth, onLogout }: Props) {
  const [view, setView] = useState<View>('home')
  const [status, setStatus] = useState<WorkerStatus>({
    running: false,
    obsConnected: false,
    botConnected: false,
    currentVideo: null,
    queueSize: 0,
  })
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [playerUrl, setPlayerUrl] = useState('http://localhost:3001/player')
  const [volume, setVolumeState] = useState(80)

  function handleVolumeChange(val: number) {
    setVolumeState(val)
    window.api.setPlayerVolume(val)
  }

  // Load initial status and subscribe to live updates
  useEffect(() => {
    window.api.getStatus().then((s) => setStatus(s as WorkerStatus))
    window.api.getPlayerUrl().then((u) => setPlayerUrl(u as string))
    window.api.getPlayerVolume().then((v) => setVolumeState(v as number))

    const unsub = window.api.onStatusUpdate((s) => {
      setStatus(s as WorkerStatus)
    })
    return unsub
  }, [])

  const handleStart = useCallback(async () => {
    setStarting(true)
    await window.api.startStream()
    setStarting(false)
  }, [])

  const handleStop = useCallback(async () => {
    setStopping(true)
    await window.api.stopStream()
    setStopping(false)
  }, [])

  if (view === 'settings') {
    return <SettingsView onBack={() => setView('home')} auth={auth} onLogout={onLogout} />
  }

  if (view === 'obs') {
    return <OBSSetupView onBack={() => setView('home')} playerUrl={playerUrl} />
  }

  return (
    <div style={styles.root}>
      {/* Title bar drag region */}
      <div style={styles.titleBar}>
        <div style={styles.titleBarInner}>
          <Logo size={18} />
          <span style={styles.titleBarText}>FightersEdge AutoStream</span>
        </div>
        <div style={styles.titleBarButtons}>
          <button style={styles.titleBarBtn} onClick={() => setView('settings')} title="Settings">
            ⚙
          </button>
          <button style={styles.titleBarBtn} onClick={() => window.api.minimizeWindow()} title="Minimize">
            ─
          </button>
          <button style={{ ...styles.titleBarBtn, ...styles.titleBarClose }} onClick={() => window.api.closeWindow()} title="Quit">
            ✕
          </button>
        </div>
      </div>

      <div style={styles.body}>
        {/* User card */}
        <div style={styles.card}>
          <Avatar name={auth.displayName} imageUrl={auth.avatarUrl} size={44} />
          <div style={styles.userInfo}>
            <div style={styles.userName}>{auth.displayName}</div>
            <div style={styles.userSub}>
              {auth.accountType === 'admin'
                ? 'Admin account — all eligible matches'
                : auth.linkedPlayerName
                  ? `Player: ${auth.linkedPlayerName}`
                  : 'No linked player'}
            </div>
          </div>
        </div>

        {/* Stream status */}
        <div style={styles.section}>
          <div style={styles.statusRow}>
            <StatusDot active={status.running} />
            <span style={styles.statusLabel}>
              {status.running ? 'Stream is LIVE' : 'Stream is offline'}
            </span>
          </div>

          {auth.accountType !== 'admin' ? (
            <div style={styles.adminGate}>
              Only FightersEdge admin accounts can start AutoStream.
            </div>
          ) : status.running ? (
            <button
              style={{ ...styles.actionBtn, ...styles.stopBtn, ...(stopping ? styles.btnDisabled : {}) }}
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? 'Stopping...' : '■ Stop Stream'}
            </button>
          ) : (
            <button
              style={{ ...styles.actionBtn, ...styles.startBtn, ...(starting ? styles.btnDisabled : {}) }}
              onClick={handleStart}
              disabled={starting}
            >
              {starting ? 'Starting...' : '▶ Start Stream'}
            </button>
          )}

          {status.error && !status.running && (
            <div style={styles.startError}>⚠ {status.error}</div>
          )}
        </div>

        {/* Now playing */}
        {status.running && (
          <div style={styles.nowPlayingCard}>
            <div style={styles.npLabel}>Now Playing</div>
            {status.currentVideo ? (
              <>
                <div style={styles.npTitle}>
                  {status.currentVideo.Title || status.currentVideo.Url}
                </div>
                {status.currentVideo.Game && (
                  <div style={styles.gameTag}>{status.currentVideo.Game}</div>
                )}
                {status.currentVideo.players && status.currentVideo.players.length > 0 && (
                  <div style={styles.players}>
                    {status.currentVideo.players.map((p, i) => (
                      <span key={i} style={styles.playerName}>{p.name}</span>
                    ))}
                  </div>
                )}
                <a
                  href={`https://youtu.be/${status.currentVideo.Url}`}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.ytLink}
                >
                  ▶ Watch on YouTube
                </a>
              </>
            ) : (
              <div style={styles.npLoading}>Loading playlist...</div>
            )}
          </div>
        )}

        {/* System status */}
        <div style={styles.systemGrid}>
          <SystemBadge label="OBS" connected={status.obsConnected} />
          <SystemBadge label="Twitch Bot" connected={status.botConnected} />
          {status.running && (
            <div style={styles.queueBadge}>
              <span style={styles.queueNum}>{status.queueSize}</span>
              <span style={styles.queueLabel}>videos queued</span>
            </div>
          )}
        </div>

        {/* Volume control */}
        <div style={styles.volumeRow}>
          <span style={styles.volumeIcon}>{volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            style={styles.volumeSlider}
          />
          <span style={styles.volumeValue}>{volume}%</span>
        </div>

        {/* OBS Setup link */}
        <button style={styles.obsNavBtn} onClick={() => setView('obs')}>
          <span>OBS Setup</span>
          <span style={styles.obsNavChevron}>›</span>
        </button>

        {/* Player filter / playlist notice */}
        {auth.accountType === 'admin' ? (
          <div style={styles.filterNotice}>
            Playlist uses all eligible recent matches.
          </div>
        ) : auth.linkedPlayerName ? (
          <div style={styles.filterNotice}>
            Showing matches featuring <strong>{auth.linkedPlayerName}</strong>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── OBS Setup card ────────────────────────────────────────────────────────────

function OBSSetupView({ onBack, playerUrl }: { onBack: () => void; playerUrl: string }) {
  const [tab, setTab] = React.useState<'websocket' | 'browser'>('websocket')
  const [copiedUrl, setCopiedUrl] = React.useState(false)

  function copyUrl() {
    navigator.clipboard.writeText(playerUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  return (
    <div style={styles.root}>
      <div style={styles.titleBar}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <span style={styles.titleBarText}>OBS Setup</span>
        <div style={styles.titleBarButtons}>
          <button style={styles.titleBarBtn} onClick={() => window.api.minimizeWindow()} title="Minimize">─</button>
          <button style={{ ...styles.titleBarBtn, ...styles.titleBarClose }} onClick={() => window.api.closeWindow()} title="Quit">✕</button>
        </div>
      </div>

      <div style={styles.body}>
        {/* Tab switcher */}
        <div style={styles.obsTabRow}>
          <button
            style={{ ...styles.obsTab, ...(tab === 'websocket' ? styles.obsTabActive : {}) }}
            onClick={() => setTab('websocket')}
          >
            WebSocket
          </button>
          <button
            style={{ ...styles.obsTab, ...(tab === 'browser' ? styles.obsTabActive : {}) }}
            onClick={() => setTab('browser')}
          >
            Browser Source
          </button>
        </div>

        {tab === 'websocket' && (
          <div style={styles.obsSection}>
            <OBSStep n={1} text='Open OBS → Tools → obs-websocket Settings' />
            <OBSStep n={2} text='Check "Enable WebSocket server"' />
            <OBSStep n={3} text='Set Server Port to 4455 (default)' />
            <OBSStep n={4} text='Enable authentication and set a password' />
            <OBSStep n={5} text='Click Apply → OK' />
            <OBSStep n={6} text='Enter the same URL and password in AutoStream Settings (⚙)' />
          </div>
        )}

        {tab === 'browser' && (
          <div style={styles.obsSection}>
            <OBSStep n={1} text='In OBS Sources panel, click + → Browser' />
            <OBSStep n={2} text='Name it "FightersEdge Player" → OK' />
            <OBSStep n={3} text='Paste the URL below into the URL field' />
            <div style={styles.obsUrlBox}>
              <span style={styles.obsUrl}>{playerUrl}</span>
              <button style={styles.obsCopyBtn} onClick={copyUrl}>
                {copiedUrl ? '✓' : 'Copy'}
              </button>
            </div>
            <OBSStep n={4} text='Set Width: 1920  Height: 1080' />
            <OBSStep n={5} text='Check "Control audio via OBS" → OK' />
          </div>
        )}
      </div>
    </div>
  )
}

function OBSStep({ n, text }: { n: number; text: string }) {
  return (
    <div style={styles.obsStepRow}>
      <span style={styles.obsStepNum}>{n}</span>
      <span style={styles.obsStepText}>{text}</span>
    </div>
  )
}

// ── Settings view ─────────────────────────────────────────────────────────────

function SettingsView({ onBack, auth, onLogout }: { onBack: () => void; auth: AuthUser; onLogout: () => void }) {
  const [obsUrl, setObsUrl] = useState('ws://localhost:4455')
  const [obsPassword, setObsPassword] = useState('')
  const [twitchChannel, setTwitchChannel] = useState('')
  const [botUsername, setBotUsername] = useState('')
  const [botToken, setBotToken] = useState('')
  const [botEnabled, setBotEnabled] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showBotAdvanced, setShowBotAdvanced] = useState(false)
  const [connectingBot, setConnectingBot] = useState(false)
  const [botError, setBotError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      const settings = s as {
        obsUrl: string; obsPassword: string
        twitchChannel: string; twitchBotUsername: string
        twitchBotToken: string; twitchBotEnabled: boolean
      }
      setObsUrl(settings.obsUrl || 'ws://localhost:4455')
      setObsPassword(settings.obsPassword || '')
      setTwitchChannel(settings.twitchChannel || '')
      setBotUsername(settings.twitchBotUsername || '')
      setBotToken(settings.twitchBotToken || '')
      setBotEnabled(!!settings.twitchBotEnabled)
    })
  }, [])

  async function save() {
    await window.api.saveSettings({
      obsUrl, obsPassword, twitchChannel,
      twitchBotUsername: botUsername, twitchBotToken: botToken,
      twitchBotEnabled: botEnabled,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleConnectTwitchBot() {
    setConnectingBot(true)
    setBotError(null)
    try {
      const result = (await window.api.connectTwitchBot()) as {
        ok: boolean; botUsername?: string; error?: string
      }
      if (result.ok && result.botUsername) {
        // Re-pull settings so the form reflects what main.ts just wrote.
        const s = (await window.api.getSettings()) as {
          twitchChannel: string; twitchBotUsername: string; twitchBotToken: string
        }
        setBotUsername(s.twitchBotUsername || '')
        setBotToken(s.twitchBotToken || '')
        setTwitchChannel(s.twitchChannel || '')
      } else {
        setBotError(result.error || 'Connection failed.')
      }
    } catch (err) {
      setBotError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnectingBot(false)
    }
  }

  async function handleDisconnectTwitchBot() {
    await window.api.disconnectTwitchBot()
    setBotUsername('')
    setBotToken('')
    setBotError(null)
  }

  const botConnected = !!(botUsername && botToken)

  return (
    <div style={styles.root}>
      <div style={styles.titleBar}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <span style={styles.titleBarText}>Settings</span>
        <div style={styles.titleBarButtons}>
          <button style={styles.titleBarBtn} onClick={() => window.api.minimizeWindow()} title="Minimize">
            ─
          </button>
          <button style={{ ...styles.titleBarBtn, ...styles.titleBarClose }} onClick={() => window.api.closeWindow()} title="Quit">
            ✕
          </button>
        </div>
      </div>

      <div style={{ ...styles.body, overflowY: 'auto' }}>
        <Section title="OBS WebSocket">
          <Field label="URL" value={obsUrl} onChange={setObsUrl} placeholder="ws://localhost:4455" />
          <Field label="Password" value={obsPassword} onChange={setObsPassword} type="password" placeholder="OBS WebSocket password" />
        </Section>

        <Section title="Twitch Chat Bot">
          {/* Enable / disable toggle */}
          <div style={styles.toggleRow}>
            <div>
              <div style={styles.toggleLabel}>Enable Twitch chat bot</div>
              <div style={styles.toggleSub}>
                Announces each match in your Twitch channel chat
              </div>
            </div>
            <button
              role="switch"
              aria-checked={botEnabled}
              style={{ ...styles.toggle, ...(botEnabled ? styles.toggleOn : {}) }}
              onClick={() => setBotEnabled((v) => !v)}
            >
              <span style={{ ...styles.toggleThumb, ...(botEnabled ? styles.toggleThumbOn : {}) }} />
            </button>
          </div>

          {/* Bot config — only shown when enabled */}
          {botEnabled && (
            <>
              {botConnected ? (
                <div style={styles.botStatusCard}>
                  <div style={styles.botStatusRow}>
                    <TwitchIcon />
                    <div style={{ flex: 1 }}>
                      <div style={styles.botStatusName}>@{botUsername}</div>
                      <div style={styles.botStatusSub}>Connected</div>
                    </div>
                    <button style={styles.botDisconnectBtn} onClick={handleDisconnectTwitchBot}>
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  style={{ ...styles.twitchConnectBtn, ...(connectingBot ? styles.btnDisabled : {}) }}
                  onClick={handleConnectTwitchBot}
                  disabled={connectingBot}
                >
                  <TwitchIcon />
                  {connectingBot ? 'Opening browser...' : 'Connect with Twitch'}
                </button>
              )}

              {botError && <p style={styles.error}>{botError}</p>}

              <Field label="Channel" value={twitchChannel} onChange={setTwitchChannel} placeholder="your_channel" />

              <button
                style={styles.advancedToggle}
                onClick={() => setShowBotAdvanced((v) => !v)}
              >
                {showBotAdvanced ? '− Hide' : '+ Advanced'} (manual bot credentials)
              </button>

              {showBotAdvanced && (
                <>
                  <Field label="Bot Username" value={botUsername} onChange={setBotUsername} placeholder="your_bot_account" />
                  <Field label="Bot Token" value={botToken} onChange={setBotToken} type="password" placeholder="oauth:xxxxxxxxxx" />
                  <p style={styles.tokenHint}>
                    Or get a token manually at{' '}
                    <a href="https://twitchapps.com/tmi/" target="_blank" rel="noreferrer">
                      twitchapps.com/tmi
                    </a>
                  </p>
                </>
              )}
            </>
          )}
        </Section>

        <Section title="Account">
          <div style={styles.accountRow}>
            <Avatar name={auth.displayName} imageUrl={auth.avatarUrl} size={36} />
            <div>
              <div style={{ fontWeight: 600 }}>{auth.displayName}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {auth.linkedPlayerName || 'No linked player'}
              </div>
            </div>
          </div>
          <button style={styles.logoutBtn} onClick={onLogout}>Log out</button>
        </Section>

        <button style={{ ...styles.saveBtn, ...(saved ? styles.saveBtnDone : {}) }} onClick={save}>
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Avatar({ name, imageUrl, size }: { name: string; imageUrl?: string; size: number }) {
  // If we ever end up with an avatar URL from FE, use it. Otherwise fall back
  // to a gradient circle with the user's initial — keeps the UI looking
  // intentional rather than a broken image icon.
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  const initial = (name || '?').charAt(0).toUpperCase()
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #3eb489 0%, #2d8a6a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 700,
        fontSize: size * 0.42,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  )
}

function TwitchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
    </svg>
  )
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span style={{
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: active ? 'var(--accent)' : 'var(--text-muted)',
      display: 'inline-block',
      boxShadow: active ? '0 0 8px var(--accent)' : 'none',
    }} />
  )
}

function SystemBadge({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div style={styles.badge}>
      <StatusDot active={connected} />
      <span style={{ fontSize: '12px', color: connected ? '#fff' : 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.settingsSection}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div style={styles.fieldGroup}>
      <label style={styles.fieldLabel}>{label}</label>
      <input
        style={styles.input}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--bg-deep)',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    WebkitAppRegion: 'drag' as unknown as undefined,
    flexShrink: 0,
  },
  titleBarInner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    WebkitAppRegion: 'drag' as unknown as undefined,
  },
  titleBarText: {
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--text-muted)',
    letterSpacing: '0.03em',
  },
  titleBarButtons: {
    display: 'flex',
    gap: '4px',
    WebkitAppRegion: 'no-drag' as unknown as undefined,
  },
  titleBarBtn: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBarClose: {
    color: 'rgba(255,255,255,0.4)',
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--accent)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '4px 8px',
    width: 60,
    WebkitAppRegion: 'no-drag' as unknown as undefined,
  },
  body: {
    flex: 1,
    minHeight: 0, // required for overflow to work inside a flex column parent
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    overflowY: 'auto',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px',
    background: 'var(--bg-panel)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    objectFit: 'cover',
  },
  avatarSm: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    objectFit: 'cover',
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontWeight: 700,
    fontSize: '15px',
    color: '#fff',
  },
  userSub: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    background: 'var(--bg-panel)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusLabel: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#fff',
  },
  actionBtn: {
    width: '100%',
    padding: '12px',
    borderRadius: 'var(--radius)',
    fontSize: '15px',
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
  },
  startBtn: {
    background: 'var(--accent)',
    color: '#fff',
  },
  stopBtn: {
    background: 'var(--red-dim)',
    color: 'var(--red)',
    border: '1px solid var(--red)',
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  nowPlayingCard: {
    padding: '14px',
    background: 'var(--bg-panel)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  npLabel: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  npTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#fff',
    lineHeight: 1.4,
  },
  npLoading: {
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
  gameTag: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: '4px',
    background: 'var(--accent-dim)',
    border: '1px solid var(--accent)',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--accent)',
    letterSpacing: '0.05em',
    alignSelf: 'flex-start',
  },
  players: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  playerName: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    background: 'var(--bg-card)',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  ytLink: {
    fontSize: '12px',
    color: 'var(--accent)',
    marginTop: '2px',
  },
  systemGrid: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  badge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    background: 'var(--bg-panel)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  queueBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 10px',
    background: 'var(--bg-panel)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  queueNum: {
    fontSize: '14px',
    fontWeight: 700,
    color: 'var(--accent)',
  },
  queueLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  filterNotice: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    padding: '8px 12px',
    background: 'var(--accent-dim)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(62,180,137,0.3)',
  },
  adminGate: {
    fontSize: '13px',
    color: 'var(--red)',
    background: 'var(--red-dim)',
    padding: '10px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--red)',
  },
  startError: {
    fontSize: '12px',
    color: 'var(--red)',
    background: 'var(--red-dim)',
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--red)',
    lineHeight: 1.4,
  },
  // OBS source card
  obsNavBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    color: 'var(--text)',
    fontSize: '13px',
    fontWeight: 600,
  },
  obsNavChevron: {
    fontSize: '18px',
    color: 'var(--text-muted)',
    lineHeight: 1,
  },
  obsUrlBox: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '4px 8px',
    minWidth: 0,
  },
  obsUrl: {
    flex: 1,
    fontSize: '11px',
    color: 'var(--accent)',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  obsCopyBtn: {
    padding: '2px 8px',
    borderRadius: '3px',
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    fontSize: '11px',
    fontWeight: 600,
    border: '1px solid var(--accent)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  obsVal: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 1.4,
  },
  // Tab switcher
  obsTabRow: {
    display: 'flex',
    gap: '4px',
    marginBottom: '4px',
  },
  obsTab: {
    flex: 1,
    padding: '6px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 600,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  obsTabActive: {
    background: 'var(--accent-dim)',
    border: '1px solid var(--accent)',
    color: 'var(--accent)',
  },
  obsSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  obsStepRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
  },
  obsStepNum: {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: 'var(--accent-dim)',
    border: '1px solid var(--accent)',
    color: 'var(--accent)',
    fontSize: '10px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '1px',
  },
  obsStepText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 1.5,
  },
  // Settings view
  settingsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    background: 'var(--bg-panel)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '2px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  fieldLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    padding: '9px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    color: '#fff',
    fontSize: '13px',
    outline: 'none',
    width: '100%',
    fontFamily: 'inherit',
  },
  tokenHint: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
  },
  volumeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  volumeIcon: {
    fontSize: '16px',
    flexShrink: 0,
    width: '20px',
    textAlign: 'center' as const,
  },
  volumeSlider: {
    flex: 1,
    accentColor: 'var(--accent)',
    cursor: 'pointer',
    height: '4px',
  },
  volumeValue: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    width: '34px',
    textAlign: 'right' as const,
    flexShrink: 0,
  },
  botBlurb: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
    margin: '0 0 12px 0',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '16px',
  },
  toggleLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#fff',
  },
  toggleSub: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  toggle: {
    position: 'relative' as const,
    width: '42px',
    height: '24px',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.15)',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
    transition: 'background 0.2s, border-color 0.2s',
  },
  toggleOn: {
    background: '#9146FF',
    border: '1px solid #9146FF',
  },
  toggleThumb: {
    position: 'absolute' as const,
    top: '3px',
    left: '3px',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.5)',
    transition: 'left 0.2s, background 0.2s',
  },
  toggleThumbOn: {
    left: '21px',
    background: '#fff',
  },
  twitchConnectBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    padding: '11px 14px',
    borderRadius: 'var(--radius-sm)',
    background: '#9146FF',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    marginBottom: '12px',
  },
  botStatusCard: {
    padding: '12px 14px',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(145, 70, 255, 0.12)',
    border: '1px solid rgba(145, 70, 255, 0.35)',
    marginBottom: '12px',
  },
  botStatusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: '#9146FF',
  },
  botStatusName: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#fff',
  },
  botStatusSub: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  botDisconnectBtn: {
    padding: '6px 10px',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  advancedToggle: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '11px',
    cursor: 'pointer',
    padding: '6px 0',
    textAlign: 'left' as const,
    width: 'fit-content',
  },
  error: {
    fontSize: '12px',
    color: 'var(--red)',
    background: 'var(--red-dim)',
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm)',
    margin: '0 0 12px 0',
  },
  accountRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  logoutBtn: {
    padding: '9px 14px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--red-dim)',
    border: '1px solid var(--red)',
    color: 'var(--red)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  saveBtn: {
    padding: '12px',
    borderRadius: 'var(--radius)',
    background: 'var(--accent)',
    border: 'none',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: '4px',
  },
  saveBtnDone: {
    background: 'rgba(62,180,137,0.4)',
  },
}
