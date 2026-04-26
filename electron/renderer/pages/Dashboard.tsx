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
}

interface Props {
  auth: AuthUser
  onLogout: () => void
}

type View = 'home' | 'settings'

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

  // Load initial status and subscribe to live updates
  useEffect(() => {
    window.api.getStatus().then((s) => setStatus(s as WorkerStatus))

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
        </div>
      </div>

      <div style={styles.body}>
        {/* User card */}
        <div style={styles.card}>
          <Avatar name={auth.displayName} imageUrl={auth.avatarUrl} size={44} />
          <div style={styles.userInfo}>
            <div style={styles.userName}>{auth.displayName}</div>
            <div style={styles.userSub}>
              {auth.linkedPlayerName
                ? `Player: ${auth.linkedPlayerName}`
                : 'No linked player — showing all matches'}
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

          {status.running ? (
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

        {/* Player filter notice */}
        {auth.linkedPlayerName && (
          <div style={styles.filterNotice}>
            Showing matches featuring <strong>{auth.linkedPlayerName}</strong>
          </div>
        )}
      </div>
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
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      const settings = s as {
        obsUrl: string; obsPassword: string
        twitchChannel: string; twitchBotUsername: string; twitchBotToken: string
      }
      setObsUrl(settings.obsUrl || 'ws://localhost:4455')
      setObsPassword(settings.obsPassword || '')
      setTwitchChannel(settings.twitchChannel || '')
      setBotUsername(settings.twitchBotUsername || '')
      setBotToken(settings.twitchBotToken || '')
    })
  }, [])

  async function save() {
    await window.api.saveSettings({
      obsUrl, obsPassword, twitchChannel,
      twitchBotUsername: botUsername, twitchBotToken: botToken,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={styles.root}>
      <div style={styles.titleBar}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <span style={styles.titleBarText}>Settings</span>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ ...styles.body, overflowY: 'auto' }}>
        <Section title="OBS WebSocket">
          <Field label="URL" value={obsUrl} onChange={setObsUrl} placeholder="ws://localhost:4455" />
          <Field label="Password" value={obsPassword} onChange={setObsPassword} type="password" placeholder="OBS WebSocket password" />
        </Section>

        <Section title="Twitch Bot">
          <Field label="Channel" value={twitchChannel} onChange={setTwitchChannel} placeholder="your_channel" />
          <Field label="Bot Username" value={botUsername} onChange={setBotUsername} placeholder="your_bot_account" />
          <Field label="Bot Token" value={botToken} onChange={setBotToken} type="password" placeholder="oauth:xxxxxxxxxx" />
          <p style={styles.tokenHint}>
            Get a bot token at{' '}
            <a href="https://twitchapps.com/tmi/" target="_blank" rel="noreferrer">
              twitchapps.com/tmi
            </a>
          </p>
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
    fontSize: '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
