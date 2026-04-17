import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { useWindowSize } from '@/hooks'
import { ErrorMessage } from '@/components/ui/ErrorMessage'
import { Card, Flex, Text, TextField, Button, Heading, Box } from '@radix-ui/themes'
import { FlickeringGrid } from "../components/ui/flickering-grid"
import '../styles/AuthPage.css'

interface AuthResult {
  success: boolean
  error?: string
  user_id?: string
  needs_confirmation: boolean
}

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const navigate = useNavigate()
  const windowSize = useWindowSize()

  const signInWithEmail = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await invoke<AuthResult>('sign_in', {
        email,
        password,
      })

      if (!result.success) {
        if (result.needs_confirmation) {
          setError('Please confirm your email first. Check your inbox for a verification code.')
        } else {
          setError(result.error || 'Sign in failed')
        }
        setLoading(false)
        return
      }

      if (!result.user_id) {
        setError('Sign in did not return a user id')
        setLoading(false)
        return
      }

      const userId = result.user_id

      // Unlock (or create) the local vault using the password. A failure here
      // blocks everything downstream — surface it instead of redirecting.
      try {
        const vaultExists = await invoke<boolean>('has_vault', { userId })
        if (vaultExists) {
          await invoke('unlock_vault', { userId, secret: password })
        } else {
          const syncExists = await invoke<boolean>('sync_check_exists').catch(() => false)
          if (syncExists) {
            await invoke('sync_download_vault')
            await invoke('unlock_vault', { userId, secret: password })
            invoke('sync_restore_mls_state').catch(console.error)
            invoke('sync_download_messages_db').catch(console.error)
          } else {
            await invoke('setup_vault', { userId, password })
          }
        }
      } catch (vaultErr) {
        console.error('Vault initialization failed:', vaultErr)
        setError(`Could not unlock local storage: ${vaultErr instanceof Error ? vaultErr.message : String(vaultErr)}`)
        setLoading(false)
        return
      }

      // Fire-and-forget server sync of local state.
      invoke('sync_upload_vault').catch(console.error)
      invoke('sync_upload_mls_state').catch(console.error)

      // Persist session (DEK + refresh token) to OS keyring so subsequent
      // launches can auto-restore without a login prompt. Non-fatal if it
      // fails (e.g. no keyring daemon on headless Linux) — the user can
      // still sign in manually next launch.
      await invoke('session_save').catch((err) => console.error('session_save failed:', err))

      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const signInWithGoogle = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await invoke<AuthResult>('sign_in_with_google')

      if (result.success) {
        window.location.href = '/'
      } else {
        setError(result.error || 'Google sign-in failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      signInWithEmail()
    }
  }

  // Grid sizing
  const squareSize = 2
  const gridGap = 8
  const columns = Math.ceil(windowSize.width / (squareSize + gridGap))
  const rows = Math.ceil(windowSize.height / (squareSize + gridGap))

  const totalGridWidth = columns * squareSize + (columns - 1) * gridGap
  const totalGridHeight = rows * squareSize + (rows - 1) * gridGap

  const offsetX = (windowSize.width - totalGridWidth) / 2
  const offsetY = (windowSize.height - totalGridHeight) / 2

  return (
    <div className="auth-container relative">
      <div className="auth-background">
        <div
          className="absolute inset-0"
          style={{
            maskImage: 'radial-gradient(circle at center, white, transparent)',
            WebkitMaskImage: 'radial-gradient(circle at center, white, transparent)',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
          }}
        >
          <FlickeringGrid
            squareSize={squareSize}
            gridGap={gridGap}
            color="#60A5FA"
            maxOpacity={1}
            flickerChance={0.6}
            height={windowSize.height + 6}
            width={windowSize.width}
            style={{
              position: 'absolute',
              left: offsetX,
              top: offsetY,
            }}
          />
        </div>
      </div>

      <Box maxWidth="400px" width="100%" className="relative z-10">
        <Card size="4" variant="surface">
          <Flex direction="column" gap="4">
            <Heading align="center" size="6">Cryptext</Heading>

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="email">
                Email
              </Text>
              <TextField.Root
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                size="3"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="password">
                Password
              </Text>
              <TextField.Root
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                size="3"
              />
            </Flex>

            <Flex direction="column" gap="2">
              <Button
                size="3"
                onClick={signInWithEmail}
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>

              <Button
                size="3"
                variant="soft"
                onClick={() => navigate('/signup')}
              >
                Sign Up
              </Button>

              <Box style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--gray-6)' }} />
                <Text size="1" color="gray">or</Text>
                <div style={{ flex: 1, height: '1px', background: 'var(--gray-6)' }} />
              </Box>

              <Button
                size="3"
                variant="outline"
                onClick={signInWithGoogle}
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign in with Google'}
              </Button>
            </Flex>

            <ErrorMessage error={error} variant="inline" />
          </Flex>
        </Card>
      </Box>
    </div>
  )
}
