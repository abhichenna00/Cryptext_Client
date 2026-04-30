import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { ErrorMessage } from '@/components/ui/ErrorMessage'
import { FlickeringGrid } from '@/components/ui/flickering-grid'
import { useWindowSize } from '@/hooks'
import { cn } from '@/lib/utils'

type AuthMode = 'signin' | 'signup' | 'verify'

interface AuthResult {
  success: boolean
  error?: string
  user_id?: string
  needs_confirmation: boolean
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.35 11.1H12v2.9h5.35c-.23 1.4-1.6 4.1-5.35 4.1-3.2 0-5.8-2.65-5.8-5.9s2.6-5.9 5.8-5.9c1.8 0 3.05.78 3.75 1.45l2.55-2.45C16.9 3.9 14.7 3 12 3 6.9 3 2.8 7.1 2.8 12.2S6.9 21.4 12 21.4c6.9 0 9.55-4.85 9.55-7.3 0-.5-.05-.9-.2-1.6z" />
    </svg>
  )
}

function MicrosoftGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="2" width="9" height="9" fill="#F25022" />
      <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
      <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
      <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

function fieldInputClasses(invalid = false) {
  return cn(
    'h-10 w-full rounded-md border bg-surface px-3 text-[13.5px] text-fg placeholder:text-fg-dim transition-colors',
    'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
    invalid ? 'border-[var(--danger)]' : 'border-border',
  )
}

export default function AuthPage() {
  const navigate = useNavigate()
  const windowSize = useWindowSize()

  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetErrors = () => setError(null)
  const switchMode = (next: AuthMode) => {
    resetErrors()
    setMode(next)
  }

  const performVaultUnlock = async (userId: string) => {
    const vaultExists = await invoke<boolean>('has_vault', { userId })
    if (vaultExists) {
      await invoke('unlock_vault', { userId, secret: password })
      return
    }
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

  const afterSignedIn = async (userId: string) => {
    try {
      await performVaultUnlock(userId)
    } catch (err) {
      console.error('Vault initialization failed:', err)
      setError(
        `Could not unlock local storage: ${err instanceof Error ? err.message : String(err)}`,
      )
      setLoading(false)
      return
    }

    invoke('sync_upload_vault').catch(console.error)
    invoke('sync_upload_mls_state').catch(console.error)

    await invoke('session_save').catch((e) => console.error('session_save failed:', e))
    window.location.href = '/'
  }

  const signInWithEmail = async () => {
    setLoading(true)
    resetErrors()
    try {
      const result = await invoke<AuthResult>('sign_in', { email, password })
      if (!result.success) {
        setError(
          result.needs_confirmation
            ? 'Please confirm your email first. Check your inbox for a verification code.'
            : result.error || 'Sign in failed',
        )
        setLoading(false)
        return
      }
      if (!result.user_id) {
        setError('Sign in did not return a user id')
        setLoading(false)
        return
      }
      await afterSignedIn(result.user_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const submitSignup = async () => {
    resetErrors()
    if (!email.trim()) return setError('Email is required')
    if (password !== confirmPassword) return setError('Passwords do not match')
    if (password.length < 8) return setError('Password must be at least 8 characters')

    setLoading(true)
    try {
      const result = await invoke<AuthResult>('sign_up', {
        email: email.trim(),
        password,
        phone: phone.trim() || null,
      })
      if (result.success) {
        if (result.needs_confirmation) {
          switchMode('verify')
        } else {
          navigate('/profile')
        }
      } else {
        setError(result.error || 'Signup failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const submitVerification = async () => {
    resetErrors()
    if (!verificationCode.trim()) return setError('Verification code is required')

    setLoading(true)
    try {
      const result = await invoke<AuthResult>('confirm_sign_up', {
        email: email.trim(),
        code: verificationCode.trim(),
      })
      if (!result.success) {
        setError(result.error || 'Verification failed')
        setLoading(false)
        return
      }
      const signInResult = await invoke<AuthResult>('sign_in', { email: email.trim(), password })
      if (!signInResult.success || !signInResult.user_id) {
        navigate('/')
        return
      }
      try {
        await invoke('setup_vault', { userId: signInResult.user_id, password })
        await invoke('mls_init')
        await invoke('mls_upload_key_packages')
      } catch (err) {
        console.error('Post-signup setup failed:', err)
        setError('Account created, but encryption setup failed. Please restart the app and sign in again.')
        setLoading(false)
        return
      }
      invoke('sync_upload_vault').catch(console.error)
      invoke('sync_upload_mls_state').catch(console.error)
      await invoke('session_save').catch((e) => console.error('session_save failed:', e))
      navigate('/profile')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const signInWithGoogle = async () => {
    setLoading(true)
    resetErrors()
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

  const signInWithEntra = async () => {
    setLoading(true)
    resetErrors()
    try {
      const result = await invoke<AuthResult>('sign_in_with_entra')
      if (result.success) {
        window.location.href = '/'
      } else {
        setError(result.error || 'Microsoft sign-in failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = () => {
    if (loading) return
    if (mode === 'signin') signInWithEmail()
    else if (mode === 'signup') submitSignup()
    else submitVerification()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSubmit()
  }

  const isVerify = mode === 'verify'
  const isSignup = mode === 'signup'

  return (
    <div className="relative grid h-screen place-items-center bg-bg">
      {/* Flicker grid backdrop — masked to a soft vignette. */}
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div
          className="absolute inset-0"
          style={{
            maskImage: 'radial-gradient(circle at center, white, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(circle at center, white, transparent 70%)',
          }}
        >
          <FlickeringGrid
            squareSize={2}
            gridGap={8}
            color="rgb(140, 160, 220)"
            maxOpacity={0.5}
            flickerChance={0.35}
            width={windowSize.width}
            height={windowSize.height}
          />
        </div>
      </div>

      <div className="relative z-10 w-[380px] rounded-xl border border-border bg-surface p-7 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2.5">
          <div
            className="grid size-[30px] place-items-center rounded-[7px] bg-[var(--brand)] font-mono text-[14px] font-semibold text-[var(--brand-fg)]"
            aria-hidden
          >
            C
          </div>
          <span className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Cryptext</span>
        </div>

        <p className="mt-2 text-[13px] text-fg-muted">
          End-to-end encrypted messaging on your desktop.
        </p>

        {isVerify ? (
          <div className="mt-6 flex flex-col gap-4">
            <p className="text-[13px] text-fg-muted">
              We sent a verification code to <span className="text-fg">{email}</span>.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-muted">Verification code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Enter 6-digit code"
                className={fieldInputClasses()}
              />
            </label>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-muted">Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="you@example.com"
                className={fieldInputClasses()}
              />
            </label>

            {isSignup && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-fg-muted">
                  Phone <span className="font-normal text-fg-dim">(optional)</span>
                </span>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="+1234567890"
                  className={fieldInputClasses()}
                />
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-muted">
                {isSignup ? 'Choose a password' : 'Password'}
              </span>
              <input
                type="password"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="••••••••••"
                className={fieldInputClasses()}
              />
              {isSignup && (
                <span className="font-mono text-[10.5px] tracking-[0.02em] text-fg-dim">
                  used to derive your local vault key via Argon2id
                </span>
              )}
            </label>

            {isSignup && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-fg-muted">Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="••••••••••"
                  className={fieldInputClasses()}
                />
              </label>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          className={cn(
            'mt-5 h-10 w-full rounded-md bg-[var(--brand)] text-[13.5px] font-medium text-[var(--brand-fg)] transition-colors',
            'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
          )}
        >
          {loading
            ? (isVerify ? 'Verifying…' : isSignup ? 'Creating account…' : 'Signing in…')
            : isVerify
              ? 'Verify & sign in'
              : isSignup
                ? 'Create account'
                : 'Sign in'}
        </button>

        {!isVerify && (
          <>
            <div className="my-4 flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="font-mono text-[11px] tracking-[0.08em] text-fg-dim uppercase">
                or
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={loading}
              className={cn(
                'flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-[13.5px] font-medium text-fg transition-colors',
                'hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            >
              <GoogleGlyph />
              Continue with Google
            </button>

            <button
              type="button"
              onClick={signInWithEntra}
              disabled={loading}
              className={cn(
                'mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-[13.5px] font-medium text-fg transition-colors',
                'hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            >
              <MicrosoftGlyph />
              Continue with Microsoft
            </button>
          </>
        )}

        <div className="mt-5 text-center text-[12.5px] text-fg-muted">
          {isVerify ? (
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className="text-[var(--brand)] font-medium hover:underline"
            >
              ← Back
            </button>
          ) : isSignup ? (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-[var(--brand)] font-medium hover:underline"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="text-[var(--brand)] font-medium hover:underline"
              >
                Sign up
              </button>
            </>
          )}
        </div>

        <div className="mt-3">
          <ErrorMessage error={error} variant="inline" />
        </div>
      </div>
    </div>
  )
}
