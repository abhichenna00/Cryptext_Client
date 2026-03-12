import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate, useLocation } from 'react-router-dom'
import { Input } from "@/components/ui/input"
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Circle, ChevronDown } from 'lucide-react'
import '../styles/ProfilePage.css'

type Status = 'online' | 'idle' | 'dnd' | 'offline'

interface ProfileData {
  user_id: string
  username?: string
  nickname: string
  avatar_url: string | null
  status: string | null
}

interface PlaceholderProfile {
  username: string
  nickname: string
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

const STATUS_OPTIONS: { value: Status; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: '#22c55e' },
  { value: 'idle', label: 'Idle', color: '#eab308' },
  { value: 'dnd', label: 'Do Not Disturb', color: '#ef4444' },
  { value: 'offline', label: 'Invisible', color: '#6b7280' },
]

export default function ProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const isEditMode = location.pathname === '/editProfile'
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
  const [initialLoading, setInitialLoading] = useState(true)
  const [isNewUser, setIsNewUser] = useState(true)

  const generatePlaceholder = async () => {
    try {
      const placeholder = await invoke<PlaceholderProfile>('generate_placeholder')
      setUsername(placeholder.username)
      setNickname(placeholder.nickname)
    } catch (err) {
      console.error('Failed to generate placeholder:', err)
    }
  }

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const id = await invoke<string | null>('get_user_id')
        if (!id) {
          navigate('/')
          return
        }

        const profile = await invoke<ProfileData | null>('get_profile')

        if (profile) {
          setIsNewUser(false)
          setUsername(profile.username || '')
          setNickname(profile.nickname || '')
          setAvatarUrl(profile.avatar_url)
          setAvatarPreview(profile.avatar_url)
          setStatus((profile.status as Status) || 'online')
        } else {
          setIsNewUser(true)
          await generatePlaceholder()
        }
      } catch (err) {
        console.error('Failed to load profile:', err)
        setError('Failed to load profile')
      } finally {
        setInitialLoading(false)
      }
    }

    loadProfile()
  }, [navigate])

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

    if (!isNewUser) {
      try {
        const result = await invoke<ProfileResult>('update_status', { status: newStatus })
        if (!result.success) {
          setStatus(oldStatus)
          setError(result.error || 'Failed to update status')
        }
      } catch (err) {
        setStatus(oldStatus)
        console.error('Failed to update status:', err)
      }
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
          // Read file as base64
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

      if (isNewUser) {
        const result = await invoke<ProfileResult>('create_profile', {
          username: username.trim(),
          nickname: nickname.trim(),
          avatarUrl: finalAvatarUrl,
        })
        if (!result.success) {
          setError(result.error || 'Failed to create profile')
          setLoading(false)
          return
        }
        await invoke('update_status', { status })
      } else {
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
      }

      setLoading(false)

      if (isEditMode) {
        navigate('/home')
      } else {
        window.location.href = '/home'
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const isSaveDisabled = !username.trim() || !nickname.trim() || loading || uploadingImage
  const currentStatus = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]

  if (initialLoading) {
    return (
      <div className="profile-container">
        <div className="profile-card"><p>Loading...</p></div>
      </div>
    )
  }

  return (
    <div className="profile-container">
      <div className="profile-card">
        <div className="profile-card-header">
          <h2>{isNewUser ? 'Complete Your Profile' : 'Edit Profile'}</h2>
        </div>

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
                id="avatar-upload"
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
              <label htmlFor="username">Username</label>
              <Input id="username" placeholder="unique_username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="displayname">Display Name</label>
              <Input id="displayname" placeholder="Your Name" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
          </div>

          {error && <p className="error-message">{error}</p>}
        </div>

        <div className="profile-card-footer">
          {(!isNewUser || isEditMode) && (
            <Button variant="ghost" onClick={() => navigate('/home')}>Cancel</Button>
          )}
          <Button onClick={handleSave} disabled={isSaveDisabled}>
            {uploadingImage ? 'Uploading...' : loading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}