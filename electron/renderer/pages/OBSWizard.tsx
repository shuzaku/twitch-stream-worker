import React, { useState, useEffect } from 'react'

interface Props {
  onComplete: () => void
}

type Step = 'install' | 'websocket' | 'browser-source' | 'test'

const STEPS: Step[] = ['install', 'websocket', 'browser-source', 'test']
const STEP_LABELS: Record<Step, string> = {
  install: 'Install OBS',
  websocket: 'Enable WebSocket',
  'browser-source': 'Add Browser Source',
  test: 'Test Connection',
}

export default function OBSWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('install')
  const [obsUrl, setObsUrl] = useState('ws://localhost:4455')
  const [obsPassword, setObsPassword] = useState('')
  const [playerUrl, setPlayerUrl] = useState('http://localhost:3001/player')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  useEffect(() => {
    async function load() {
      const config = await window.api.getOBSConfig() as { url: string; password: string }
      if (config.url) setObsUrl(config.url)
      if (config.password) setObsPassword(config.password)
      const url = await window.api.getPlayerUrl() as string
      setPlayerUrl(url)
    }
    load()
  }, [])

  const stepIdx = STEPS.indexOf(step)

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    const result = await window.api.testOBSConnection(obsUrl, obsPassword) as { ok: boolean; error?: string }
    setTestResult(result)
    setTesting(false)
    if (result.ok) {
      await window.api.saveOBSConfig(obsUrl, obsPassword)
    }
  }

  async function finish() {
    await window.api.saveOBSConfig(obsUrl, obsPassword)
    onComplete()
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>OBS Setup</div>
        <div style={styles.subtitle}>One-time setup — takes about 2 minutes</div>
      </div>

      {/* Step indicator */}
      <div style={styles.stepRow}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div style={{
              ...styles.stepDot,
              ...(i <= stepIdx ? styles.stepDotActive : {}),
            }} />
            {i < STEPS.length - 1 && (
              <div style={{
                ...styles.stepLine,
                ...(i < stepIdx ? styles.stepLineActive : {}),
              }} />
            )}
          </React.Fragment>
        ))}
      </div>
      <div style={styles.stepLabel}>{STEP_LABELS[step]}</div>

      {/* Step content */}
      <div style={styles.content}>
        {step === 'install' && (
          <StepInstall onNext={() => setStep('websocket')} />
        )}
        {step === 'websocket' && (
          <StepWebSocket
            obsUrl={obsUrl}
            obsPassword={obsPassword}
            onUrlChange={setObsUrl}
            onPasswordChange={setObsPassword}
            onBack={() => setStep('install')}
            onNext={() => setStep('browser-source')}
          />
        )}
        {step === 'browser-source' && (
          <StepBrowserSource
            playerUrl={playerUrl}
            onBack={() => setStep('websocket')}
            onNext={() => setStep('test')}
          />
        )}
        {step === 'test' && (
          <StepTest
            testing={testing}
            result={testResult}
            onTest={testConnection}
            onBack={() => setStep('browser-source')}
            onFinish={finish}
          />
        )}
      </div>
    </div>
  )
}

// ── Step sub-components ────────────────────────────────────────────────────────

function StepInstall({ onNext }: { onNext: () => void }) {
  return (
    <div style={styles.stepContent}>
      <InstructionList items={[
        'Download OBS Studio from obsproject.com',
        'Run the installer and complete setup',
        'Launch OBS at least once to initialise it',
      ]} />
      <p style={styles.alreadyNote}>Already have OBS installed? Skip ahead.</p>
      <NavButtons onNext={onNext} nextLabel="I have OBS →" />
    </div>
  )
}

function StepWebSocket({
  obsUrl, obsPassword, onUrlChange, onPasswordChange, onBack, onNext,
}: {
  obsUrl: string; obsPassword: string
  onUrlChange: (v: string) => void; onPasswordChange: (v: string) => void
  onBack: () => void; onNext: () => void
}) {
  return (
    <div style={styles.stepContent}>
      <InstructionList items={[
        'In OBS, open Tools → obs-websocket Settings',
        'Enable "Enable WebSocket server"',
        'Note the Server Port (default: 4455)',
        'Set a password and copy it below',
      ]} />
      <div style={styles.fieldGroup}>
        <label style={styles.label}>WebSocket URL</label>
        <input
          style={styles.input}
          value={obsUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="ws://localhost:4455"
        />
      </div>
      <div style={styles.fieldGroup}>
        <label style={styles.label}>Password</label>
        <input
          style={styles.input}
          type="password"
          value={obsPassword}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="Your OBS WebSocket password"
        />
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  )
}

function StepBrowserSource({ playerUrl, onBack, onNext }: {
  playerUrl: string; onBack: () => void; onNext: () => void
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(playerUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={styles.stepContent}>
      <InstructionList items={[
        'In OBS, click the + button in the Sources panel',
        'Select "Browser" from the list',
        'Name it "FightersEdge Player" and click OK',
        'Paste the URL below into the URL field',
        'Set Width to 1920 and Height to 1080',
        'Check "Control audio via OBS" and click OK',
      ]} />
      <div style={styles.urlBox}>
        <span style={styles.urlText}>{playerUrl}</span>
        <button style={styles.copyBtn} onClick={copy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Done →" />
    </div>
  )
}

function StepTest({
  testing, result, onTest, onBack, onFinish,
}: {
  testing: boolean
  result: { ok: boolean; error?: string } | null
  onTest: () => void
  onBack: () => void
  onFinish: () => void
}) {
  return (
    <div style={styles.stepContent}>
      <p style={styles.testDesc}>
        Click the button below to verify AutoStream can connect to OBS. Make sure OBS is open.
      </p>

      <button
        style={{ ...styles.testBtn, ...(testing ? styles.testBtnDisabled : {}) }}
        onClick={onTest}
        disabled={testing}
      >
        {testing ? 'Testing...' : 'Test OBS Connection'}
      </button>

      {result?.ok && (
        <div style={styles.successBox}>
          <span style={{ color: 'var(--accent)', fontSize: '18px' }}>✓</span>
          <span>OBS connected successfully!</span>
        </div>
      )}
      {result && !result.ok && (
        <div style={styles.errorBox}>
          <span style={{ color: 'var(--red)', fontSize: '18px' }}>✕</span>
          <span>Could not connect: {result.error}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <button
          style={{
            ...styles.finishBtn,
            ...(!result?.ok ? styles.finishBtnDisabled : {}),
          }}
          onClick={onFinish}
          disabled={!result?.ok}
        >
          Finish Setup
        </button>
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function InstructionList({ items }: { items: string[] }) {
  return (
    <ol style={styles.list}>
      {items.map((item, i) => (
        <li key={i} style={styles.listItem}>{item}</li>
      ))}
    </ol>
  )
}

function NavButtons({
  onBack, onNext, nextLabel = 'Next →',
}: {
  onBack?: () => void
  onNext?: () => void
  nextLabel?: string
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
      {onBack && <button style={styles.backBtn} onClick={onBack}>← Back</button>}
      {onNext && <button style={styles.nextBtn} onClick={onNext}>{nextLabel}</button>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    gap: '16px',
    background: 'var(--bg-deep)',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#fff',
  },
  subtitle: {
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
  },
  stepDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: 'var(--bg-card)',
    border: '2px solid var(--border)',
    flexShrink: 0,
  },
  stepDotActive: {
    background: 'var(--accent)',
    border: '2px solid var(--accent)',
  },
  stepLine: {
    flex: 1,
    height: '2px',
    background: 'var(--border)',
  },
  stepLineActive: {
    background: 'var(--accent)',
  },
  stepLabel: {
    fontSize: '12px',
    color: 'var(--accent)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  content: {
    flex: 1,
  },
  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  list: {
    paddingLeft: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  listItem: {
    fontSize: '13px',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  alreadyNote: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    color: '#fff',
    fontSize: '13px',
    outline: 'none',
    width: '100%',
    fontFamily: 'inherit',
  },
  urlBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  urlText: {
    flex: 1,
    fontSize: '12px',
    color: 'var(--accent)',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  copyBtn: {
    padding: '4px 10px',
    borderRadius: '4px',
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    fontSize: '12px',
    fontWeight: 600,
    border: '1px solid var(--accent)',
    cursor: 'pointer',
  },
  testDesc: {
    fontSize: '13px',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
  },
  testBtn: {
    padding: '12px',
    borderRadius: 'var(--radius)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  },
  testBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  successBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--accent-dim)',
    border: '1px solid var(--accent)',
    fontSize: '13px',
    color: '#fff',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--red-dim)',
    border: '1px solid var(--red)',
    fontSize: '13px',
    color: '#fff',
  },
  backBtn: {
    flex: 1,
    padding: '11px',
    borderRadius: 'var(--radius)',
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  nextBtn: {
    flex: 2,
    padding: '11px',
    borderRadius: 'var(--radius)',
    background: 'var(--accent)',
    border: 'none',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  finishBtn: {
    flex: 2,
    padding: '11px',
    borderRadius: 'var(--radius)',
    background: 'var(--accent)',
    border: 'none',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  finishBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
}
