import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
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

  // Track window size for responsive grid
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  })

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const signInWithEmail = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await invoke<AuthResult>('sign_in', {
        email,
        password,
      })

      if (result.success && result.user_id) {
        // Set up or unlock the encrypted message database
        try {
          const vaultExists = await invoke<boolean>('has_vault', { userId: result.user_id })
          if (vaultExists) {
            await invoke('unlock_vault', { userId: result.user_id, pin: password })
          } else {
            await invoke('setup_vault', { userId: result.user_id, pin: password })
          }
        } catch (vaultErr) {
          console.error('Vault initialization failed:', vaultErr)
        }
        window.location.href = '/'
      } else if (result.needs_confirmation) {
        setError('Please confirm your email first. Check your inbox for a verification code.')
        setLoading(false)
      } else {
        setError(result.error || 'Sign in failed')
        setLoading(false)
      }
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
      {/* Full-page background grid */}
      <div className="auth-background">
        {/* Mask wrapper */}
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

      {/* Login card */}
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

            {error && (
              <Text color="red" size="2" align="center">
                {error}
              </Text>
            )}
          </Flex>
        </Card>
      </Box>
    </div>
  )
}