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

export default function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'signup' | 'verify'>('signup')

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

  const handleSignup = async () => {
    setError(null)

    if (!email.trim()) {
      setError('Email is required')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    try {
      const result = await invoke<AuthResult>('sign_up', {
        email: email.trim(),
        password,
        phone: phone.trim() || null,
      })

      if (result.success) {
        if (result.needs_confirmation) {
          // Cognito sent a verification code to the email
          setStep('verify')
          setLoading(false)
        } else {
          // Auto-confirmed, go to profile setup
          navigate('/profile')
        }
      } else {
        setError(result.error || 'Signup failed')
        setLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    setError(null)

    if (!verificationCode.trim()) {
      setError('Verification code is required')
      return
    }

    setLoading(true)

    try {
      const result = await invoke<AuthResult>('confirm_sign_up', {
        email: email.trim(),
        code: verificationCode.trim(),
      })

      if (result.success) {
        // Now sign them in automatically
        const signInResult = await invoke<AuthResult>('sign_in', {
          email: email.trim(),
          password,
        })

        if (signInResult.success) {
          navigate('/profile')
        } else {
          // Confirmed but sign-in failed, send to login page
          navigate('/')
        }
      } else {
        setError(result.error || 'Verification failed')
        setLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      if (step === 'signup') {
        handleSignup()
      } else {
        handleVerify()
      }
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
          {step === 'signup' ? (
            <Flex direction="column" gap="4">
              <Heading align="center" size="6">Create Account</Heading>

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
                <Text as="label" size="2" weight="medium" htmlFor="phone">
                  Phone Number (optional)
                </Text>
                <TextField.Root
                  id="phone"
                  type="tel"
                  placeholder="+1234567890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
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

              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium" htmlFor="confirmPassword">
                  Confirm Password
                </Text>
                <TextField.Root
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  size="3"
                />
              </Flex>

              <Flex direction="column" gap="2">
                <Button
                  size="3"
                  onClick={handleSignup}
                  disabled={loading}
                >
                  {loading ? 'Signing up...' : 'Sign Up'}
                </Button>

                <Button
                  size="3"
                  variant="soft"
                  onClick={() => navigate('/')}
                >
                  Already have an account? Sign in
                </Button>
              </Flex>

              {error && (
                <Text color="red" size="2" align="center">
                  {error}
                </Text>
              )}
            </Flex>
          ) : (
            <Flex direction="column" gap="4">
              <Heading align="center" size="6">Verify Your Email</Heading>

              <Text size="2" align="center" color="gray">
                We sent a verification code to <Text weight="bold">{email}</Text>
              </Text>

              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium" htmlFor="code">
                  Verification Code
                </Text>
                <TextField.Root
                  id="code"
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  onKeyDown={handleKeyDown}
                  size="3"
                />
              </Flex>

              <Flex direction="column" gap="2">
                <Button
                  size="3"
                  onClick={handleVerify}
                  disabled={loading}
                >
                  {loading ? 'Verifying...' : 'Verify & Sign In'}
                </Button>

                <Button
                  size="3"
                  variant="soft"
                  onClick={() => {
                    setStep('signup')
                    setError(null)
                  }}
                >
                  Back
                </Button>
              </Flex>

              {error && (
                <Text color="red" size="2" align="center">
                  {error}
                </Text>
              )}
            </Flex>
          )}
        </Card>
      </Box>
    </div>
  )
}