import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  User,
  ShieldCheck,
  Palette,
  Bell,
  KeyRound,
  Smartphone,
  HardDrive,
  Sliders,
  Info,
  X,
} from 'lucide-react'

import Avatar from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { ErrorMessage } from '@/components/ui/ErrorMessage'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { STATUS_COLORS, STATUS_OPTIONS, Status } from '@/constants/status'
import { cn } from '@/lib/utils'

interface ProfileData {
  user_id: string
  username?: string
  nickname: string
  avatar_url: string | null
  status: string | null
}

interface ProfileResult {
  success: boolean
  error?: string
}

interface AvatarResult {
  success: boolean
  url?: string
  error?: string
}

interface PublicSessionInfo {
  user_id: string
  email: string
  is_authenticated: boolean
  is_enterprise: boolean
}

interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

type SectionId =
  | 'profile'
  | 'account'
  | 'appearance'
  | 'notifications'
  | 'privacy'
  | 'devices'
  | 'storage'
  | 'advanced'
  | 'about'

const SECTIONS: { id: SectionId; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'account', label: 'Account', icon: ShieldCheck },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy & keys', icon: KeyRound },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'advanced', label: 'Advanced', icon: Sliders },
  { id: 'about', label: 'About', icon: Info },
]

function SectionStub({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-surface-2">
      <div className="text-center text-[13px] text-fg-dim">
        <div className="mb-1 text-fg-muted">{label}</div>
        <div>Settings go here</div>
      </div>
    </div>
  )
}

export default function EditProfileDialog({ open, onOpenChange, onSaved }: EditProfileDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [section, setSection] = useState<SectionId>('profile')
  const [username, setUsername] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>('online')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [usernameLocked, setUsernameLocked] = useState(false)

  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const session = await invoke<PublicSessionInfo | null>('get_session')
        if (session?.is_enterprise) setUsernameLocked(true)

        const profile = await invoke<ProfileData | null>('get_profile')
        if (profile) {
          setUsername(profile.username || '')
          setNickname(profile.nickname || '')
          setAvatarUrl(profile.avatar_url)
          setAvatarPreview(profile.avatar_url)
          setStatus((profile.status as Status) || 'online')
        }
      } catch (err) {
        console.error('Failed to load profile:', err)
        setError('Failed to load profile')
      }
    })()
  }, [open])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setError('Please select a valid image file (JPEG, PNG, GIF, or WebP)')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB')
      return
    }
    setSelectedFile(file)
    setError(null)
    const reader = new FileReader()
    reader.onloadend = () => setAvatarPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleStatusPick = async (next: Status) => {
    const prev = status
    setStatus(next)
    try {
      const result = await invoke<ProfileResult>('update_status', { status: next })
      if (!result.success) {
        setStatus(prev)
        setError(result.error || 'Failed to update status')
      } else {
        onSaved?.()
      }
    } catch (err) {
      setStatus(prev)
      console.error('Failed to update status:', err)
    }
  }

  const handleSave = async () => {
    setError(null)
    if (!username.trim() || !nickname.trim()) {
      setError('Username and Display Name are required')
      return
    }
    setLoading(true)
    try {
      let finalAvatarUrl = avatarUrl
      if (selectedFile) {
        setUploadingImage(true)
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => {
              const result = reader.result as string
              resolve(result.split(',')[1])
            }
            reader.onerror = reject
            reader.readAsDataURL(selectedFile)
          })
          const extension = selectedFile.name.split('.').pop() || 'png'
          const result = await invoke<AvatarResult>('upload_avatar', {
            imageData: base64,
            fileName: `avatar.${extension}`,
            contentType: selectedFile.type,
          })
          if (!result.success || !result.url) throw new Error(result.error || 'Upload failed')
          finalAvatarUrl = result.url
        } finally {
          setUploadingImage(false)
        }
      }

      const result = await invoke<ProfileResult>('update_profile', {
        username: username.trim(),
        nickname: nickname.trim(),
        avatarUrl: finalAvatarUrl,
      })
      if (!result.success) {
        setError(result.error || 'Failed to update profile')
        setLoading(false)
        return
      }
      setLoading(false)
      setSelectedFile(null)
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const isSaveDisabled = !username.trim() || !nickname.trim() || loading || uploadingImage
  const isProfile = section === 'profile'
  const currentSectionLabel = SECTIONS.find((s) => s.id === section)?.label || 'Settings'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid max-h-[520px] w-[720px] max-w-[90vw] grid-cols-[180px_1fr] gap-0 overflow-hidden p-0 sm:max-w-[720px]"
      >
        {/* Left nav */}
        <aside className="flex h-[520px] flex-col border-r border-border bg-surface-2">
          <div className="px-4 pt-4 pb-2">
            <DialogTitle className="text-[13px] font-semibold tracking-[-0.005em] text-fg">
              Settings
            </DialogTitle>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                    section === s.id
                      ? 'bg-surface-3 text-fg'
                      : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  <Icon size={14} strokeWidth={1.75} />
                  <span>{s.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="p-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
            >
              <X size={14} strokeWidth={1.75} />
              <span>Close</span>
            </button>
          </div>
        </aside>

        {/* Right content */}
        <div className="flex h-[520px] flex-col">
          <header className="border-b border-border px-5 py-3">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
              {currentSectionLabel}
            </h3>
            {isProfile && (
              <p className="mt-0.5 text-[12.5px] text-fg-muted">
                How you appear to friends across Cryptext.
              </p>
            )}
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {isProfile ? (
              <div className="flex flex-col gap-5">
                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <Avatar
                    src={avatarPreview}
                    fallback={nickname || username || '?'}
                    size="xl"
                    status={status}
                    showStatus
                  />
                  <div className="flex flex-col gap-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Button
                      variant="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage}
                      className="h-7 self-start"
                    >
                      {avatarPreview ? 'Change' : 'Upload'}
                    </Button>
                    {selectedFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFile(null)
                          setAvatarPreview(avatarUrl)
                          if (fileInputRef.current) fileInputRef.current.value = ''
                        }}
                        className="self-start text-[11.5px] text-fg-dim underline-offset-2 hover:underline"
                      >
                        Undo
                      </button>
                    )}
                  </div>
                </div>

                {/* Display name */}
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-fg-muted">Display name</span>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Your Name"
                    className={cn(
                      'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-fg placeholder:text-fg-dim',
                      'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
                    )}
                  />
                </label>

                {/* Username */}
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-fg-muted">Username</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="unique_username"
                    readOnly={usernameLocked}
                    className={cn(
                      'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-fg placeholder:text-fg-dim',
                      'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
                      usernameLocked && 'bg-surface-2 cursor-not-allowed text-fg-muted',
                    )}
                  />
                  <span className="font-mono text-[10.5px] tracking-[0.02em] text-fg-dim">
                    {usernameLocked
                      ? 'Set by your organization'
                      : `@${username || 'handle'} · unique across Cryptext`}
                  </span>
                </label>

                {/* Status picker */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-fg-muted">Status</span>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((option) => {
                      const active = option.value === status
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleStatusPick(option.value)}
                          className={cn(
                            'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] transition-colors',
                            active
                              ? 'border-[var(--brand)] bg-surface-2 text-fg'
                              : 'border-border bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg',
                          )}
                        >
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{ backgroundColor: STATUS_COLORS[option.value] }}
                          />
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <ErrorMessage error={error} />
              </div>
            ) : (
              <SectionStub label={currentSectionLabel} />
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {isProfile && (
              <Button
                onClick={handleSave}
                disabled={isSaveDisabled}
                className="bg-[var(--brand)] text-[var(--brand-fg)] hover:opacity-90"
              >
                {uploadingImage ? 'Uploading…' : loading ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
