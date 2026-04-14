// src/App.tsx

import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import './App.css'

import { AppSidebar } from '@/components/AppSidebar'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'

import SplashPage from './pages/SplashPage'
import AuthPage from './pages/AuthPage'
import SignupPage from './pages/SignupPage'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import ProfilePage from './pages/ProfilePage'
import FriendsPage from './pages/FriendsPage'
import DirectMessagePage from './pages/DirectMessagePage'
import FriendsView from './components/FriendsView'

// Check if running in Tauri
const isTauri = () => typeof window !== 'undefined' && '__TAURI__' in window

interface PublicSessionInfo {
  user_id: string
  email: string
  is_authenticated: boolean
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

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  return theme
}

function LegacyChatRedirect() {
  const { friendId } = useParams<{ friendId: string }>()
  return <Navigate to={friendId ? `/home/chat/${friendId}` : '/home'} replace />
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
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<PublicSessionInfo | null>(null)
  const [hasProfile, setHasProfile] = useState(false)
  const [mlsWarning, setMlsWarning] = useState<string | null>(null)

  useEffect(() => {
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

          // Initialize local message database
          // Vault is unlocked at login time (AuthPage/SignupPage).
          // On app restart with existing session, try legacy init (unencrypted).
          // If vault exists, the lock screen will handle it.
          try {
            const vaultExists = await invoke<boolean>('has_vault', { userId: currentSession.user_id })
            if (!vaultExists) {
              // No vault yet — use legacy unencrypted DB
              await invoke('init_local_db', { userId: currentSession.user_id })
            }
            // If vault exists, it was already unlocked during sign_in.
            // If this is a session restore (app restart), we need the lock screen.
          } catch (dbErr) {
            console.error('Local DB initialization failed:', dbErr)
          }

          // Initialize MLS encryption
          try {
            const signerRegenerated = await invoke<boolean>('mls_init')
            if (signerRegenerated) {
              // Signer changed — old key packages on server are invalid
              await invoke('mls_delete_key_packages')
              await invoke('mls_upload_key_packages')
            } else {
              // Signer intact — only upload if running low
              await invoke('mls_check_key_packages')
            }
            await invoke('mls_fetch_welcomes')
          } catch (mlsErr) {
            console.error('MLS initialization failed:', mlsErr)
            setMlsWarning('Encryption failed to initialize. Messages may not be delivered securely. Try restarting the app.')
          }
        }
      } catch (error) {
        console.error('Failed to initialize:', error)
        setSession(null)
        setHasProfile(false)
      }

      setLoading(false)
    }

    initialize()
  }, [])

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

  if (loading) {
    return <div>Loading...</div>
  }

  const showSidebar = !!session && hasProfile

  return (
    <Theme appearance={systemTheme}>
      <BrowserRouter>
        <AppLayout showSidebar={showSidebar} onSignOut={handleSignOut}>
          {mlsWarning && (
            <div style={{
              background: '#b91c1c',
              color: 'white',
              padding: '8px 16px',
              fontSize: '13px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>{mlsWarning}</span>
              <button
                onClick={() => setMlsWarning(null)}
                style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '16px' }}
              >
                ×
              </button>
            </div>
          )}
          <Routes>
            <Route path="/splash" element={<SplashPage />} />

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
                    ? <Navigate to="/home" />
                    : <ProfilePage />
              }
            />

            <Route path="/editProfile" element={<Navigate to="/home" replace />} />

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
            >
              <Route index element={<FriendsView />} />
              <Route path="chat/:friendId" element={<DirectMessagePage />} />
            </Route>

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

            <Route path="/chat/:friendId" element={<LegacyChatRedirect />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </Theme>
  )
}