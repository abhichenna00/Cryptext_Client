import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ErrorMessage } from '@/components/ui/ErrorMessage'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Circle, ChevronDown } from 'lucide-react'
import { Status, STATUS_OPTIONS } from '@/constants/status'
import '../styles/ProfilePage.css'

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

interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export default function EditProfileDialog({ open, onOpenChange, onSaved }: EditProfileDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [username, setUsername] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>('online')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)

  useEffect(() => {
    if (!open) return
    const load = async () => {
      try {
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
    }
    load()
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

  const handleRemoveImage = () => {
    setSelectedFile(null)
    setAvatarPreview(avatarUrl)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleStatusChange = async (newStatus: Status) => {
    const oldStatus = status
    setStatus(newStatus)
    try {
      const result = await invoke<ProfileResult>('update_status', { status: newStatus })
      if (!result.success) {
        setStatus(oldStatus)
        setError(result.error || 'Failed to update status')
      } else {
        onSaved?.()
      }
    } catch (err) {
      setStatus(oldStatus)
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
  const currentStatus = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>
            Update your avatar, status, username, and display name.
          </DialogDescription>
        </DialogHeader>

        <div className="profile-card-content">
          <div className="avatar-section">
            <div className="avatar-wrapper">
              <div className="avatar-preview">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Profile preview" className="avatar-image" />
                ) : (
                  <div className="avatar-placeholder">
                    <span>{nickname?.[0]?.toUpperCase() || username?.[0]?.toUpperCase() || '?'}</span>
                  </div>
                )}
              </div>
              <div className="status-indicator-large" style={{ backgroundColor: currentStatus.color }} />
            </div>
            <div className="avatar-buttons">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleFileSelect}
                className="file-input-hidden"
              />
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingImage}>
                {avatarPreview ? 'Change' : 'Upload'}
              </Button>
              {selectedFile && (
                <Button variant="ghost" size="sm" onClick={handleRemoveImage} disabled={uploadingImage}>
                  Undo
                </Button>
              )}
            </div>
          </div>

          <div className="field">
            <label>Status</label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="status-trigger">
                  <Circle size={12} fill={currentStatus.color} color={currentStatus.color} />
                  <span className="status-label">{currentStatus.label}</span>
                  <ChevronDown size={16} className="status-chevron" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="status-menu">
                {STATUS_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.value} onClick={() => handleStatusChange(option.value)} className="status-menu-item">
                    <Circle size={12} fill={option.color} color={option.color} />
                    <span>{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="profile-fields">
            <div className="field">
              <label htmlFor="edit-username">Username</label>
              <Input id="edit-username" placeholder="unique_username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="edit-displayname">Display Name</label>
              <Input id="edit-displayname" placeholder="Your Name" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
          </div>

          <ErrorMessage error={error} className="error-message" />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaveDisabled}>
            {uploadingImage ? 'Uploading...' : loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
