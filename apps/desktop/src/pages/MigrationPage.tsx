import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ErrorMessage } from '@/components/ui/ErrorMessage'
import { cn } from '@/lib/utils'

interface MigrationPageProps {
  userId: string
  onSignOut: () => void
}

type Step = 'choose' | 'migrate' | 'confirm-discard'

function fieldInputClasses(invalid = false) {
  return cn(
    'h-10 w-full rounded-md border bg-surface px-3 text-[13.5px] text-fg placeholder:text-fg-dim transition-colors',
    'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
    invalid ? 'border-[var(--danger)]' : 'border-border',
  )
}

export default function MigrationPage({ userId, onSignOut }: MigrationPageProps) {
  const [step, setStep] = useState<Step>('choose')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runMigration = async () => {
    if (!password) {
      setError('Enter your existing password.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await invoke('migrate_vault_from_password', { userId, password })
      await invoke('session_save').catch((e) => console.error('session_save failed:', e))
      invoke('sync_upload_vault').catch(console.error)
      window.location.href = '/'
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Migration failed',
      )
      setLoading(false)
    }
  }

  const runDiscard = async () => {
    setLoading(true)
    setError(null)
    try {
      await invoke('discard_and_reset_vault', { userId })
      await invoke('session_save').catch((e) => console.error('session_save failed:', e))
      invoke('sync_upload_vault').catch(console.error)
      window.location.href = '/'
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Reset failed',
      )
      setLoading(false)
    }
  }

  return (
    <div className="grid h-screen place-items-center bg-bg">
      <div className="w-[420px] rounded-xl border border-border bg-surface p-7 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2.5">
          <div
            className="grid size-[30px] place-items-center rounded-[7px] bg-[var(--brand)] font-mono text-[14px] font-semibold text-[var(--brand-fg)]"
            aria-hidden
          >
            C
          </div>
          <span className="text-[20px] font-semibold tracking-[-0.02em] text-fg">
            Local storage upgrade
          </span>
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
          Your local message history was protected with your previous account
          password. To keep that history available after signing in this way,
          enter that password once so the local key can be moved into your
          system keychain.
        </p>

        {step === 'choose' && (
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null)
                setStep('migrate')
              }}
              className={cn(
                'h-10 w-full rounded-md bg-[var(--brand)] text-[13.5px] font-medium text-[var(--brand-fg)] transition-colors',
                'hover:opacity-90',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            >
              Enter password to migrate
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setStep('confirm-discard')
              }}
              className={cn(
                'flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-[13.5px] font-medium text-fg transition-colors',
                'hover:bg-surface-2',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            >
              Discard local history
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="mt-1 text-center text-[12.5px] text-fg-muted hover:text-fg"
            >
              Sign out
            </button>
          </div>
        )}

        {step === 'migrate' && (
          <div className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-muted">
                Previous account password
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) runMigration()
                }}
                placeholder="••••••••••"
                className={fieldInputClasses()}
                autoFocus
              />
            </label>
            <button
              type="button"
              onClick={runMigration}
              disabled={loading}
              className={cn(
                'h-10 w-full rounded-md bg-[var(--brand)] text-[13.5px] font-medium text-[var(--brand-fg)] transition-colors',
                'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            >
              {loading ? 'Migrating…' : 'Migrate'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setPassword('')
                setStep('choose')
              }}
              className="text-center text-[12.5px] text-fg-muted hover:text-fg"
            >
              ← Back
            </button>
          </div>
        )}

        {step === 'confirm-discard' && (
          <div className="mt-5 flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-fg-muted">
              This will erase your locally stored conversation history and
              start fresh. Messages stored on the server will still exist but
              cannot be decrypted on this device.
            </p>
            <button
              type="button"
              onClick={runDiscard}
              disabled={loading}
              className={cn(
                'h-10 w-full rounded-md bg-[var(--danger)] text-[13.5px] font-medium text-white transition-colors',
                'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            >
              {loading ? 'Resetting…' : 'Yes, discard local history'}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setStep('choose')
              }}
              className="text-center text-[12.5px] text-fg-muted hover:text-fg"
            >
              ← Back
            </button>
          </div>
        )}

        <div className="mt-3">
          <ErrorMessage error={error} variant="inline" />
        </div>
      </div>
    </div>
  )
}
