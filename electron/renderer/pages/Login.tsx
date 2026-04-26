import React, { useState } from 'react'
import type { AuthUser } from '../App'
import { Logo } from '../App'

interface Props {
  onLogin: (user: AuthUser) => void
}

export default function Login({ onLogin }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin() {
    setLoading(true)
    setError(null)
    try {
      const result = (await window.api.login()) as {
        ok: boolean
        auth?: AuthUser
        error?: string
      }
      if (result.ok && result.auth) {
        onLogin(result.auth)
      } else {
        setError(result.error || 'Login failed. Please try again.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <Logo size={52} />
          <div>
            <div style={styles.brand}>FightersEdge</div>
            <div style={styles.product}>AutoStream</div>
          </div>
        </div>

        <p style={styles.tagline}>
          Automatically stream your FightersEdge match VODs to Twitch, YouTube, or any
          RTMP destination configured in OBS — while you're away from your PC.
        </p>

        <button
          style={{ ...styles.loginBtn, ...(loading ? styles.loginBtnDisabled : {}) }}
          onClick={handleLogin}
          disabled={loading}
        >
          <Logo size={18} />
          {loading ? 'Opening browser...' : 'Log in with FightersEdge'}
        </button>

        {loading && (
          <p style={styles.hint}>
            A browser window will open. Log in, click Authorize, then return here.
          </p>
        )}

        {error && <p style={styles.error}>{error}</p>}

        <p style={styles.footer}>
          Stream destinations (Twitch, YouTube, etc.) are configured directly in OBS — AutoStream
          only handles the playlist and automation.
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: 'var(--bg-deep)',
  },
  card: {
    width: '100%',
    maxWidth: '340px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  brand: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#fff',
    lineHeight: 1.1,
    letterSpacing: '-0.5px',
  },
  product: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--accent)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  tagline: {
    fontSize: '13px',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
  },
  loginBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '13px 20px',
    borderRadius: 'var(--radius)',
    background: 'linear-gradient(135deg, #3eb489 0%, #2d8a6a 100%)',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    transition: 'opacity 0.15s',
  },
  loginBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  hint: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    textAlign: 'center' as const,
  },
  error: {
    fontSize: '13px',
    color: 'var(--red)',
    background: 'var(--red-dim)',
    padding: '10px 14px',
    borderRadius: 'var(--radius-sm)',
  },
  footer: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    lineHeight: 1.6,
    marginTop: '4px',
  },
}
