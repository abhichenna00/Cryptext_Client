// src/App.tsx

import { useEffect, useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import './App.css'

import { AppSidebar } from '@/components/AppSidebar'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'

import AuthPage from './pages/AuthPage'
import SignupPage from './pages/SignupPage'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import ProfilePage from './pages/ProfilePage'
import FriendsPage from './pages/FriendsPage'
import DirectMessagePage from './pages/DirectMessagePage'

// Check if running in Tauri
const isTauri = () => typeof window !== 'undefined' && '__TAURI__' in window

interface PublicSessionInfo {
  user_id: string
  email: string
  is_authenticated: boolean
}

interface UpdateProgress {
  downloaded: number
  total: number
}

// ── Update Screen ──

function UpdateScreen({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState('Checking for updates...')
  const [progress, setProgress] = useState(0)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    const checkAndUpdate = async () => {
      try {
        const newVersion = await invoke<string | null>('check_for_updates')

        if (newVersion) {
          setStatus(`Downloading update ${newVersion}...`)
          setUpdating(true)

          const unlisten = await listen<UpdateProgress>('update-progress', (event) => {
            if (event.payload.total > 0) {
              const pct = Math.round((event.payload.downloaded / event.payload.total) * 100)
              setProgress(pct)
              setStatus(`Downloading update... ${pct}%`)
            }
          })

          await invoke('install_update')
          unlisten()
          // App will restart automatically
        } else {
          onComplete()
        }
      } catch (err) {
        console.error('Update check failed:', err)
        onComplete()
      }
    }

    checkAndUpdate()
  }, [onComplete])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: '16px',
    }}>
      <span style={{ fontSize: '20px', fontWeight: 'bold' }}>Cryptext</span>
      <span style={{ fontSize: '14px', color: '#888' }}>{status}</span>
      {updating && (
        <div style={{
          width: '260px',
          height: '4px',
          borderRadius: '2px',
          background: '#333',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: '#60A5FA',
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}
    </div>
  )
}

// ── Hooks ──

function useSystemTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  return theme
}

// ── Layout ──

function AppLayout({
  children,
  showSidebar,
  onSignOut
}: {
  children: React.ReactNode
  showSidebar: boolean
  onSignOut: () => void
}) {
  if (!showSidebar) {
    return <>{children}</>
  }

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar onSignOut={onSignOut} />
      <SidebarInset>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}

// ── App ──

export default function App() {
  const systemTheme = useSystemTheme()
  const [updateComplete, setUpdateComplete] = useState(false)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<PublicSessionInfo | null>(null)
  const [hasProfile, setHasProfile] = useState(false)

  const handleUpdateComplete = useCallback(() => {
    setUpdateComplete(true)
  }, [])

  useEffect(() => {
    if (!updateComplete) return

    const initialize = async () => {
      try {
        if (isTauri()) {
          try {
            const { listen } = await import('@tauri-apps/api/event')
            await listen('deep-link', async (event) => {
              console.log('Deep link event received:', event.payload)
            })

            const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link')
            await onOpenUrl(async (urls) => {
              console.log('Deep link received:', urls)
            })
          } catch (err) {
            console.log('Deep link setup skipped:', err)
          }
        }

        const currentSession = await invoke<PublicSessionInfo | null>('get_session')
        setSession(currentSession)

        if (currentSession?.user_id) {
          const profile = await invoke('get_profile')
          setHasProfile(profile !== null)
        }
      } catch (error) {
        console.error('Failed to initialize:', error)
        setSession(null)
        setHasProfile(false)
      }

      setLoading(false)
    }

    initialize()
  }, [updateComplete])

  const handleSignOut = async () => {
    try {
      await invoke('sign_out')
      setSession(null)
      setHasProfile(false)
      window.location.href = '/'
    } catch (error) {
      console.error('Failed to sign out:', error)
    }
  }

  // Show update screen first
  if (!updateComplete) {
    return (
      <Theme appearance={systemTheme}>
        <UpdateScreen onComplete={handleUpdateComplete} />
      </Theme>
    )
  }

  if (loading) {
    return <div>Loading...</div>
  }

  const showSidebar = !!session && hasProfile

  return (
    <Theme appearance={systemTheme}>
      <BrowserRouter>
        <AppLayout showSidebar={showSidebar} onSignOut={handleSignOut}>
          <Routes>
            <Route
              path="/"
              element={
                !session
                  ? <AuthPage />
                  : hasProfile
                    ? <Navigate to="/home" />
                    : <Navigate to="/profile" />
              }
            />

            <Route
              path="/signup"
              element={
                !session
                  ? <SignupPage />
                  : hasProfile
                    ? <Navigate to="/home" />
                    : <Navigate to="/profile" />
              }
            />

            <Route
              path="/profile"
              element={
                !session
                  ? <Navigate to="/" />
                  : hasProfile
                    ? <Navigate to="/editProfile" />
                    : <ProfilePage />
              }
            />

            <Route
              path="/editProfile"
              element={
                !session
                  ? <Navigate to="/" />
                  : !hasProfile
                    ? <Navigate to="/profile" />
                    : <ProfilePage />
              }
            />

            <Route
              path="/chat"
              element={
                !session
                  ? <Navigate to="/" />
                  : hasProfile
                    ? <ChatPage />
                    : <Navigate to="/profile" />
              }
            />

            <Route
              path="/home"
              element={
                !session
                  ? <Navigate to="/" />
                  : hasProfile
                    ? <HomePage />
                    : <Navigate to="/profile" />
              }
            />

            <Route
              path="/friends"
              element={
                !session
                  ? <Navigate to="/" />
                  : hasProfile
                    ? <FriendsPage />
                    : <Navigate to="/profile" />
              }
            />

            <Route
              path="/chat/:friendId"
              element={
                !session
                  ? <Navigate to="/" />
                  : hasProfile
                    ? <DirectMessagePage />
                    : <Navigate to="/profile" />
              }
            />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </Theme>
  )
}