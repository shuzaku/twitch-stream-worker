import React, { useEffect, useState } from 'react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import OBSWizard from './pages/OBSWizard'

export interface AuthUser {
  deviceToken: string
  accountId: string
  displayName: string
  email: string
  avatarUrl: string
  accountType: string
  linkedPlayerId: string
  linkedPlayerName: string
  linkedPlayerSlug: string
  linkedPlayerImageUrl: string
  linkedPlayers: { id: string; name: string; slug: string; imageUrl: string }[]
}

export default function App() {
  const [auth, setAuth] = useState<AuthUser | null>(null)
  const [obsSetupDone, setObsSetupDone] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const storedAuth = await window.api.getStoredAuth()
      if (storedAuth) setAuth(storedAuth as AuthUser)

      const obsConfig = await window.api.getOBSConfig()
      setObsSetupDone(!!(obsConfig as { setupDone: boolean }).setupDone)
      setLoading(false)
    }
    init()
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Logo size={48} />
      </div>
    )
  }

  if (!auth) {
    return <Login onLogin={(user) => setAuth(user)} />
  }

  if (!obsSetupDone) {
    return <OBSWizard onComplete={() => setObsSetupDone(true)} />
  }

  return (
    <Dashboard
      auth={auth}
      onLogout={() => {
        window.api.logout()
        setAuth(null)
      }}
    />
  )
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="https://res.cloudinary.com/shuzchef/image/upload/v1622816435/bb5h6tgdysfys9qi1du5.png"
      alt="FightersEdge"
      width={size}
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}
