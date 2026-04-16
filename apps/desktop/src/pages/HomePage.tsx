// src/pages/HomePage.tsx

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate, useParams, useLocation, Outlet } from 'react-router-dom'
import { ScrollArea } from '../components/ui/scroll-area'
import { Button } from '../components/ui/button'
import { Plus, Settings, Users } from 'lucide-react'
import Avatar from '@/components/Avatar'
import EditProfileDialog from '@/components/EditProfileDialog'
import CreateGroupDialog from '@/components/CreateGroupDialog'
import { STATUS_LABELS, Status } from '@/constants/status'
import '../styles/HomePage.css'

interface ProfileData {
  user_id: string
  username?: string
  nickname: string
  avatar_url: string | null
  status: string | null
}

interface ConversationWithDetails {
  conversation_id: string
  conversation_type: string
  name: string | null
  other_user_id: string | null
  other_user_nickname: string | null
  other_user_avatar_url?: string | null
  other_user_status?: string | null
  member_count?: number | null
  last_message: string | null
  last_message_time: number | null
  has_unread: boolean
}

export default function HomePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { friendId: activeFriendId } = useParams<{ friendId: string }>()
  const [recentChats, setRecentChats] = useState<ConversationWithDetails[]>([])
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)

  const refreshProfile = async () => {
    try {
      const profileData = await invoke<ProfileData | null>('get_profile')
      setProfile(profileData)
    } catch (err) {
      console.error('Failed to refresh profile:', err)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const [conversations, profileData] = await Promise.all([
          invoke<ConversationWithDetails[]>('get_conversations').catch(
            () => [] as ConversationWithDetails[]
          ),
          invoke<ProfileData | null>('get_profile').catch(() => null),
        ])
        setRecentChats(conversations)
        setProfile(profileData)
      } catch (err) {
        console.error('Failed to load home data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const refreshConversations = async () => {
    try {
      const conversations = await invoke<ConversationWithDetails[]>('get_conversations').catch(
        () => [] as ConversationWithDetails[]
      )
      setRecentChats(conversations)
    } catch (err) {
      console.error('Failed to refresh conversations:', err)
    }
  }

  const handleOpenChat = (chat: ConversationWithDetails) => {
    if (chat.conversation_type === 'group') {
      navigate(`/home/group/${chat.conversation_id}`)
    } else if (chat.other_user_id) {
      navigate(`/home/chat/${chat.other_user_id}`)
    }
  }

  const handleGroupCreated = (conversationId: string) => {
    refreshConversations()
    navigate(`/home/group/${conversationId}`)
  }

  const getChatDisplayName = (chat: ConversationWithDetails) =>
    chat.other_user_nickname || chat.name || 'Unknown'

  if (loading) {
    return <div className="home-loading">Loading...</div>
  }

  return (
    <div className="home-page">
      <div className="home-layout">
        {/* Recent Chats Sidebar */}
        <div className="recent-chats-panel">
          <div className="panel-header">
            <h2 className="panel-title">Recent Messages</h2>
            <Button variant="ghost" size="icon" onClick={() => setCreateGroupOpen(true)} title="New group">
              <Plus size={18} />
            </Button>
          </div>
          <ScrollArea className="recent-chats-list-container">
            <div className="recent-chats">
              {recentChats.length > 0 ? (
                recentChats.map((chat) => {
                  const isActive = chat.conversation_type === 'group'
                    ? location.pathname === `/home/group/${chat.conversation_id}`
                    : chat.other_user_id === activeFriendId
                  const isGroup = chat.conversation_type === 'group'
                  return (
                    <button
                      key={chat.conversation_id}
                      className={`recent-chat-item ${chat.has_unread ? 'has-unread' : ''} ${isActive ? 'is-active' : ''}`}
                      onClick={() => handleOpenChat(chat)}
                    >
                      {isGroup ? (
                        <div className="group-avatar-icon">
                          <Users size={18} />
                        </div>
                      ) : (
                        <Avatar
                          src={chat.other_user_avatar_url}
                          fallback={getChatDisplayName(chat)}
                          size="md"
                          status={chat.other_user_status}
                          showStatus
                          className="recent-chat-avatar"
                        />
                      )}
                      <div className="recent-chat-info">
                        <span className="recent-chat-name">{getChatDisplayName(chat)}</span>
                        <span className="recent-chat-message">
                          {chat.last_message || 'No messages yet'}
                        </span>
                      </div>
                      {chat.has_unread && <div className="unread-indicator" />}
                    </button>
                  )
                })
              ) : (
                <p className="panel-empty">No recent chats.</p>
              )}
            </div>
          </ScrollArea>

          {profile && (
            <button
              className="home-profile-card"
              onClick={() => setEditProfileOpen(true)}
              title="Edit profile"
            >
              <Avatar
                src={profile.avatar_url}
                fallback={profile.nickname || 'U'}
                size="md"
                status={profile.status}
                showStatus
              />
              <div className="home-profile-card-info">
                <span className="home-profile-card-name">{profile.nickname || 'Unknown'}</span>
                <span className="home-profile-card-status">
                  {STATUS_LABELS[(profile.status as Status) || 'offline']}
                </span>
              </div>
              <Settings size={16} className="home-profile-card-settings" />
            </button>
          )}
        </div>

        {/* Right panel: friends list or DM conversation */}
        <Outlet />
      </div>

      <EditProfileDialog
        open={editProfileOpen}
        onOpenChange={setEditProfileOpen}
        onSaved={refreshProfile}
      />

      <CreateGroupDialog
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        onCreated={handleGroupCreated}
      />
    </div>
  )
}
