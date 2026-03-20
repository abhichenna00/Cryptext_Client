// src/App.tsx

import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<PublicSessionInfo | null>(null)
  const [hasProfile, setHasProfile] = useState(false)

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
          try {
            await invoke('init_local_db', { userId: currentSession.user_id })
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