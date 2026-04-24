// src/App.tsx

import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import './App.css'

import { useTheme } from '@/hooks'

import SplashPage from './pages/SplashPage'
import AuthPage from './pages/AuthPage'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import ProfilePage from './pages/ProfilePage'
import FriendsPage from './pages/FriendsPage'
import DirectMessagePage from './pages/DirectMessagePage'
import GroupMessagePage from './pages/GroupMessagePage'
import FriendsView from './components/FriendsView'

// Check if running in Tauri
const isTauri = () => typeof window !== 'undefined' && '__TAURI__' in window

interface PublicSessionInfo {
  user_id: string
  email: string
  is_authenticated: boolean
}

function LegacyChatRedirect() {
  const { friendId } = useParams<{ friendId: string }>()
  return <Navigate to={friendId ? `/home/chat/${friendId}` : '/home'} replace />
}

export default function App() {
  const { theme } = useTheme()
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

        // Try to restore a prior session from the OS keyring. If the stored
        // refresh token is revoked or the DB is missing, the command clears
        // the keyring entry itself and returns an error — we swallow it here
        // and fall back to the login form.
        await invoke('session_restore').catch((err) => console.error('session_restore failed:', err))

        const currentSession = await invoke<PublicSessionInfo | null>('get_session')
        setSession(currentSession)

        if (currentSession?.user_id) {
          const profile = await invoke('get_profile')
          setHasProfile(profile !== null)

          try {
            const vaultExists = await invoke<boolean>('has_vault', { userId: currentSession.user_id })
            if (vaultExists) {
              const unlocked = await invoke<boolean>('is_vault_unlocked')
              if (!unlocked) {
                // Vault exists but is locked. Force re-login.
                await invoke('sign_out').catch(() => {})
                setSession(null)
                setHasProfile(false)
                setLoading(false)
                return
              }
            } else {
              await invoke('init_local_db', { userId: currentSession.user_id })
            }
          } catch (dbErr) {
            console.error('Local DB initialization failed:', dbErr)
          }

          try {
            const signerRegenerated = await invoke<boolean>('mls_init')
            if (signerRegenerated) {
              await invoke('mls_delete_key_packages')
              await invoke('mls_upload_key_packages')
            } else {
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
      await invoke('session_clear').catch((err) => console.error('session_clear failed:', err))
      await invoke('sign_out')
      setSession(null)
      setHasProfile(false)
      window.location.href = '/'
    } catch (error) {
      console.error('Failed to sign out:', error)
    }
  }

  if (loading) {
    return (
      <div className="grid h-screen place-items-center bg-bg text-fg-muted">
        Loading…
      </div>
    )
  }

  return (
    <Theme appearance={theme}>
      <BrowserRouter>
        {mlsWarning && (
          <div className="flex items-center justify-between bg-[var(--danger)] px-4 py-2 text-[13px] text-white">
            <span>{mlsWarning}</span>
            <button
              onClick={() => setMlsWarning(null)}
              className="cursor-pointer border-none bg-transparent text-base text-white"
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

          {/* /signup absorbed into AuthPage; redirect legacy links. */}
          <Route path="/signup" element={<Navigate to="/" replace />} />

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
                  ? <HomePage onSignOut={handleSignOut} />
                  : <Navigate to="/profile" />
            }
          >
            <Route index element={<FriendsView />} />
            <Route path="chat/:friendId" element={<DirectMessagePage />} />
            <Route path="group/:conversationId" element={<GroupMessagePage />} />
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
      </BrowserRouter>
    </Theme>
  )
}
