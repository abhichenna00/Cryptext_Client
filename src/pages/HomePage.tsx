// src/pages/HomePage.tsx

import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import { ScrollArea } from '../components/ui/scroll-area'
import { Separator } from '../components/ui/separator'
import { Button } from '../components/ui/button'
import { ButtonGroup } from '../components/ui/button-group'
import { Input } from '../components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import { MessageCircle, MoreVertical, Plus, Check, X } from 'lucide-react'
import '../styles/HomePage.css'

type FriendsTab = 'online' | 'all' | 'pending'
type Status = 'online' | 'idle' | 'dnd' | 'offline'

const STATUS_COLORS: Record<Status, string> = {
  online: '#22c55e',
  idle: '#eab308',
  dnd: '#ef4444',
  offline: '#6b7280',
}

interface ProfileData {
  user_id: string
  username?: string
  nickname: string
  avatar_url: string | null
  status: string | null
}

interface FriendWithProfile {
  friend_id: string
  username: string
  nickname: string
  created_at: string
  is_online?: boolean
  avatar_url?: string | null
  status?: string | null
}

interface FriendRequest {
  id: string
  from_user_id: string
  to_user_id: string
  status: string
  created_at: string
  from_username?: string
  from_nickname?: string
  from_avatar_url?: string | null
  from_status?: string | null
  to_username?: string
  to_nickname?: string
  to_avatar_url?: string | null
  to_status?: string | null
}

interface ConversationWithDetails {
  conversation_id: string
  conversation_type: string
  name: string | null
  other_user_id: string | null
  other_user_nickname: string | null
  other_user_avatar_url?: string | null
  other_user_status?: string | null
  last_message: string | null
  last_message_time: number | null
  has_unread: boolean
}

interface FriendResult {
  success: boolean
  error?: string
}

interface AvatarProps {
  src?: string | null
  fallback: string
  size?: 'sm' | 'md' | 'lg'
  status?: string | null
  showStatus?: boolean
  className?: string
}

function Avatar({ src, fallback, size = 'md', status, showStatus = false, className = '' }: AvatarProps) {
  const sizeClasses = { sm: 'avatar-sm', md: 'avatar-md', lg: 'avatar-lg' }
  const statusColor = STATUS_COLORS[(status as Status) || 'offline']

  return (
    <div className={`avatar ${sizeClasses[size]} ${className}`}>
      {src ? (
        <img src={src} alt={fallback} className="avatar-image" />
      ) : (
        <span className="avatar-fallback">{fallback.charAt(0).toUpperCase()}</span>
      )}
      {showStatus && (
        <div className="status-indicator" style={{ backgroundColor: statusColor }} />
      )}
    </div>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const [, setUsername] = useState<string>('')
  const [friends, setFriends] = useState<FriendWithProfile[]>([])
  const [recentChats, setRecentChats] = useState<ConversationWithDetails[]>([])
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [friendsTab, setFriendsTab] = useState<FriendsTab>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const [searchUsername, setSearchUsername] = useState('')
  const [addFriendLoading, setAddFriendLoading] = useState(false)
  const [addFriendError, setAddFriendError] = useState<string | null>(null)
  const [addFriendSuccess, setAddFriendSuccess] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [profile, friendsData, incoming, outgoing, conversations] = await Promise.all([
        invoke<ProfileData | null>('get_profile'),
        invoke<FriendWithProfile[]>('get_friends'),
        invoke<FriendRequest[]>('get_incoming_friend_requests'),
        invoke<FriendRequest[]>('get_outgoing_friend_requests'),
        invoke<ConversationWithDetails[]>('get_conversations').catch(() => [] as ConversationWithDetails[]),
      ])

      if (profile) setUsername(profile.username || profile.nickname)
      setFriends(friendsData)
      setIncomingRequests(incoming)
      setOutgoingRequests(outgoing)
      setRecentChats(conversations)
    } catch (err) {
      console.error('Failed to load data:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const filteredFriends = useMemo(() => {
    let filtered = friends
    if (friendsTab === 'online') {
      filtered = filtered.filter(f =>
        f.status === 'online' || f.status === 'idle' || f.status === 'dnd'
      )
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        f => f.nickname.toLowerCase().includes(query) || f.username.toLowerCase().includes(query)
      )
    }
    return filtered
  }, [friends, searchQuery, friendsTab])

  const onlineFriendsCount = useMemo(() =>
    friends.filter(f => f.status === 'online' || f.status === 'idle' || f.status === 'dnd').length,
    [friends]
  )

  const pendingCount = incomingRequests.length + outgoingRequests.length

  const handleSendFriendRequest = async () => {
    if (!searchUsername.trim()) {
      setAddFriendError('Please enter a username')
      return
    }
    setAddFriendLoading(true)
    setAddFriendError(null)
    setAddFriendSuccess(null)
    try {
      const result = await invoke<FriendResult>('send_friend_request', {
        toUsername: searchUsername.trim(),
      })
      if (result.success) {
        setAddFriendSuccess(`Friend request sent to ${searchUsername}!`)
        setSearchUsername('')
        loadData()
        setTimeout(() => setAddFriendSuccess(null), 1500)
      } else {
        setAddFriendError(result.error || 'Failed to send friend request')
      }
    } catch (err) {
      setAddFriendError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddFriendLoading(false)
    }
  }

  const handleAcceptRequest = async (requestId: string) => {
    setActionLoading(true)
    try {
      const result = await invoke<FriendResult>('accept_friend_request', { requestId })
      if (result.success) loadData()
      else setError(result.error || 'Failed to accept request')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeclineRequest = async (requestId: string) => {
    setActionLoading(true)
    try {
      const result = await invoke<FriendResult>('decline_friend_request', { requestId })
      if (result.success) loadData()
      else setError(result.error || 'Failed to decline request')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelRequest = async (requestId: string) => {
    setActionLoading(true)
    try {
      const result = await invoke<FriendResult>('cancel_friend_request', { requestId })
      if (result.success) loadData()
      else setError(result.error || 'Failed to cancel request')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleOpenChat = (chat: ConversationWithDetails) => {
    if (chat.other_user_id) {
      navigate(`/chat/${chat.other_user_id}`)
    }
  }

  const getChatDisplayName = (chat: ConversationWithDetails) =>
    chat.other_user_nickname || chat.name || 'Unknown'

  if (loading) {
    return <div className="home-loading">Loading...</div>
  }

  return (
    <div className="home-page">
      <h2>
        Welcome
      </h2>
      <div className="home-layout">
        {/* Recent Chats Sidebar */}
        <div className="recent-chats-panel">
          <div className="panel-header">
            <h2 className="panel-title">Recent Messages</h2>
            <Button variant="ghost" size="icon">
              <Plus size={18} />
            </Button>
          </div>
          <ScrollArea className="recent-chats-list-container">
            <div className="recent-chats">
              {recentChats.length > 0 ? (
                recentChats.map((chat) => (
                  <button
                    key={chat.conversation_id}
                    className={`recent-chat-item ${chat.has_unread ? 'has-unread' : ''}`}
                    onClick={() => handleOpenChat(chat)}
                  >
                    <Avatar
                      src={chat.other_user_avatar_url}
                      fallback={getChatDisplayName(chat)}
                      size="md"
                      status={chat.other_user_status}
                      showStatus
                      className="recent-chat-avatar"
                    />
                    <div className="recent-chat-info">
                      <span className="recent-chat-name">{getChatDisplayName(chat)}</span>
                      <span className="recent-chat-message">
                        {chat.last_message || 'No messages yet'}
                      </span>
                    </div>
                    {chat.has_unread && <div className="unread-indicator" />}
                  </button>
                ))
              ) : (
                <p className="panel-empty">No recent chats.</p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Friends List */}
        <div className="home-content">
          <div className="panel-header">
            <h2 className="panel-title">Friends</h2>
            <ButtonGroup>
              <Button variant={friendsTab === 'online' ? 'default' : 'outline'} size="sm" onClick={() => setFriendsTab('online')}>
                Online ({onlineFriendsCount})
              </Button>
              <Button variant={friendsTab === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFriendsTab('all')}>
                All ({friends.length})
              </Button>
              <Button variant={friendsTab === 'pending' ? 'default' : 'outline'} size="sm" onClick={() => setFriendsTab('pending')}>
                Pending ({pendingCount})
              </Button>
            </ButtonGroup>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="border-green-600 text-green-600 hover:bg-green-600 hover:text-white">
                  Add Friend
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card text-card-foreground">
                <DialogHeader>
                  <DialogTitle>Add Friend</DialogTitle>
                  <DialogDescription>
                    Enter the username of the person you want to add as a friend.
                  </DialogDescription>
                </DialogHeader>
                <div className="add-friend-dialog-content">
                  {addFriendError && <p className="add-friend-dialog-error">{addFriendError}</p>}
                  {addFriendSuccess && <p className="add-friend-dialog-success">{addFriendSuccess}</p>}
                  <Input
                    type="text"
                    placeholder="Username"
                    value={searchUsername}
                    onChange={(e) => setSearchUsername(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendFriendRequest()}
                    disabled={addFriendLoading}
                  />
                </div>
                <DialogFooter>
                  <Button onClick={handleSendFriendRequest} disabled={addFriendLoading || !searchUsername.trim()}>
                    {addFriendLoading ? 'Sending...' : 'Send Request'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {friendsTab !== 'pending' && (
            <div className="home-search">
              <input
                type="text"
                className="home-search-input"
                placeholder="Search friends..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}

          {error && <p className="home-error">{error}</p>}

          {friendsTab === 'pending' ? (
            <ScrollArea className="friends-list-container">
              <div className="friends-list">
                {incomingRequests.length > 0 && (
                  <>
                    <div className="requests-section-header">Incoming ({incomingRequests.length})</div>
                    {incomingRequests.map((request, index) => (
                      <div key={request.id}>
                        <div className="friend-row">
                          <div className="friend-row-left">
                            <Avatar src={request.from_avatar_url} fallback={request.from_nickname || 'U'} size="sm" status={request.from_status} showStatus className="friend-avatar" />
                            <div className="friend-info">
                              <span className="friend-name">{request.from_nickname || 'Unknown'}</span>
                              <span className="friend-username">@{request.from_username || 'unknown'}</span>
                            </div>
                          </div>
                          <div className="friend-row-actions">
                            <button className="friend-action-icon accept" onClick={() => handleAcceptRequest(request.id)} disabled={actionLoading} title="Accept">
                              <Check size={18} />
                            </button>
                            <button className="friend-action-icon decline" onClick={() => handleDeclineRequest(request.id)} disabled={actionLoading} title="Decline">
                              <X size={18} />
                            </button>
                          </div>
                        </div>
                        {index < incomingRequests.length - 1 && <Separator />}
                      </div>
                    ))}
                  </>
                )}

                {incomingRequests.length > 0 && outgoingRequests.length > 0 && <div className="requests-divider" />}

                {outgoingRequests.length > 0 && (
                  <>
                    <div className="requests-section-header">Outgoing ({outgoingRequests.length})</div>
                    {outgoingRequests.map((request, index) => (
                      <div key={request.id}>
                        <div className="friend-row">
                          <div className="friend-row-left">
                            <Avatar src={request.to_avatar_url} fallback={request.to_nickname || 'U'} size="sm" status={request.to_status} showStatus className="friend-avatar" />
                            <div className="friend-info">
                              <span className="friend-name">{request.to_nickname || 'Unknown'}</span>
                              <span className="friend-username">@{request.to_username || 'unknown'}</span>
                            </div>
                          </div>
                          <div className="friend-row-actions">
                            <button className="friend-action-icon decline" onClick={() => handleCancelRequest(request.id)} disabled={actionLoading} title="Cancel Request">
                              <X size={18} />
                            </button>
                          </div>
                        </div>
                        {index < outgoingRequests.length - 1 && <Separator />}
                      </div>
                    ))}
                  </>
                )}

                {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
                  <p className="home-empty">No pending friend requests.</p>
                )}
              </div>
            </ScrollArea>
          ) : (
            friends.length > 0 ? (
              <ScrollArea className="friends-list-container">
                <div className="friends-list">
                  {filteredFriends.length > 0 ? (
                    filteredFriends.map((friend, index) => (
                      <div key={friend.friend_id}>
                        <div className="friend-row">
                          <div className="friend-row-left">
                            <Avatar src={friend.avatar_url} fallback={friend.nickname} size="sm" status={friend.status} showStatus className="friend-avatar" />
                            <div className="friend-info">
                              <span className="friend-name">{friend.nickname}</span>
                              <span className="friend-username">@{friend.username}</span>
                            </div>
                          </div>
                          <div className="friend-row-actions">
                            <button className="friend-action-icon" onClick={() => navigate(`/chat/${friend.friend_id}`)} title="Message">
                              <MessageCircle size={18} />
                            </button>
                            <button className="friend-action-icon" title="More options">
                              <MoreVertical size={18} />
                            </button>
                          </div>
                        </div>
                        {index < filteredFriends.length - 1 && <Separator />}
                      </div>
                    ))
                  ) : (
                    <p className="home-empty">
                      {friendsTab === 'online' ? 'No friends online.' : 'No friends match your search.'}
                    </p>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <p className="home-empty">No friends yet. Add some friends to start chatting!</p>
            )
          )}
        </div>
      </div>
    </div>
  )
}