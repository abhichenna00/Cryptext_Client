// src/components/panels/ProfilePanel.tsx

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Settings, Edit } from 'lucide-react'

interface Profile {
  username: string
  email?: string
}

interface ProfilePanelProps {
  onNavigate: (path: string) => void
}

export function ProfilePanel({ onNavigate }: ProfilePanelProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      const data = await invoke<Profile | null>('get_profile')
      setProfile(data)
    } catch (err) {
      console.error('Failed to load profile:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="panel-container">
      <div className="panel-header">
        <h2>Profile</h2>
      </div>

      <div className="panel-content">
        {loading ? (
          <div className="panel-loading">Loading...</div>
        ) : profile ? (
          <div className="profile-info">
            <div className="profile-avatar">
              {profile.username.charAt(0).toUpperCase()}
            </div>
            <div className="profile-details">
              <h3>{profile.username}</h3>
              {profile.email && <p className="profile-email">{profile.email}</p>}
            </div>
          </div>
        ) : (
          <div className="panel-empty">Could not load profile</div>
        )}

        <div className="profile-actions">
          <button
            className="profile-action-item"
            onClick={() => onNavigate('/editProfile')}
          >
            <Edit size={18} />
            <span>Edit Profile</span>
          </button>
          <button
            className="profile-action-item"
            onClick={() => onNavigate('/settings')}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  )
}