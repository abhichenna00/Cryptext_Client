// src/pages/ChatPage.tsx

import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import { useWebSocket, WebSocketMessage } from '../hooks/useWebSocket'
import { ScrollArea } from '../components/ui/scroll-area'
import { Send } from 'lucide-react'
import '../styles/ChatPage.css'

interface Message {
  id: string
  from: string
  content: string
  timestamp: number
  is_outgoing: boolean
}

interface DisplayMessage {
  id: string
  from: string
  content: string
  timestamp: number
  isOutgoing: boolean
  senderNickname?: string
  senderAvatarUrl?: string | null
}

interface ProfileInfo {
  user_id: string
  nickname: string
  avatar_url: string | null
}

interface ChatPageProps {
  onSignOut?: () => void
}

// Avatar component
interface AvatarProps {
  src?: string | null
  fallback: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function Avatar({ src, fallback, size = 'md', className = '' }: AvatarProps) {
  const sizeClasses = {
    sm: 'avatar-sm',
    md: 'avatar-md',
    lg: 'avatar-lg'
  }

  return (
    <div className={`avatar ${sizeClasses[size]} ${className}`}>
      {src ? (
        <img src={src} alt={fallback} className="avatar-image" />
      ) : (
        <span className="avatar-fallback">{fallback.charAt(0).toUpperCase()}</span>
      )}
    </div>
  )
}

export default function ChatPage({ onSignOut }: ChatPageProps) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profilesMap, setProfilesMap] = useState<Map<string, ProfileInfo>>(new Map())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const profilesMapRef = useRef<Map<string, ProfileInfo>>(new Map())
  const userIdRef = useRef<string | null>(null)

  // Keep refs in sync with state
  useEffect(() => {
    profilesMapRef.current = profilesMap
  }, [profilesMap])

  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  // Handle incoming WebSocket messages
  const handleWsMessage = useCallback(async (data: WebSocketMessage) => {
    if (data.action === 'new_message') {
      const newMsg = data.message as Message

      // Fetch profile for sender if we don't have it
      const profiles = await fetchProfilesForIds([newMsg.from])
      const senderProfile = profiles.get(newMsg.from)

      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) {
          return prev
        }

        const displayMsg: DisplayMessage = {
          id: newMsg.id,
          from: newMsg.from,
          content: newMsg.content,
          timestamp: newMsg.timestamp,
          isOutgoing: newMsg.from === userIdRef.current,
          senderNickname: senderProfile?.nickname,
          senderAvatarUrl: senderProfile?.avatar_url,
        }

        return [...prev, displayMsg]
      })
    }
  }, [])

  // Connect to WebSocket for realtime messages
  const { isConnected } = useWebSocket({
    onMessage: handleWsMessage,
  })

  useEffect(() => {
    loadUser()
  }, [])

  useEffect(() => {
    if (userId) {
      loadMessages()
    }
  }, [userId])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadUser = async () => {
    try {
      const id = await invoke<string | null>('get_user_id')
      if (id) {
        setUserId(id)
      } else {
        window.location.href = '/'
      }
    } catch (err) {
      console.error('Failed to load user:', err)
      setError('Failed to authenticate. Please sign in again.')
    } finally {
      setLoading(false)
    }
  }

  // Fetch profiles for a list of user IDs
  const fetchProfilesForIds = async (userIds: string[]): Promise<Map<string, ProfileInfo>> => {
    const uniqueIds = [...new Set(userIds)]
    const currentMap = profilesMapRef.current
    const newIds = uniqueIds.filter(id => !currentMap.has(id))

    if (newIds.length === 0) {
      return currentMap
    }

    try {
      const profiles = await invoke<ProfileInfo[]>('get_profiles_by_ids', {
        userIds: newIds
      })

      const updatedMap = new Map(currentMap)
      profiles.forEach(p => updatedMap.set(p.user_id, p))
      setProfilesMap(updatedMap)
      return updatedMap
    } catch (err) {
      console.error('Failed to fetch profiles:', err)
      return currentMap
    }
  }

  const loadMessages = async () => {
    if (!userId) return

    try {
      const data: Message[] = await invoke('fetch_messages')

      // Get unique sender IDs and fetch their profiles
      const senderIds = [...new Set(data.map(msg => msg.from))]
      const profiles = await fetchProfilesForIds(senderIds)

      const formatted: DisplayMessage[] = data.map((msg) => {
        const senderProfile = profiles.get(msg.from)
        return {
          id: msg.id,
          from: msg.from,
          content: msg.content,
          timestamp: msg.timestamp,
          isOutgoing: msg.from === userId,
          senderNickname: senderProfile?.nickname,
          senderAvatarUrl: senderProfile?.avatar_url,
        }
      })

      setMessages(formatted)
      setError(null)
    } catch (err) {
      console.error('Failed to load messages:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const sendMessage = async () => {
    if (!newMessage.trim() || !userId) return

    const messageContent = newMessage
    setNewMessage('')

    try {
      await invoke('send_message', { content: messageContent })
      setError(null)
      loadMessages()
    } catch (err) {
      console.error('Failed to send message:', err)
      setError(err instanceof Error ? err.message : String(err))
      setNewMessage(messageContent)
    }
  }

  const handleSignOut = async () => {
    if (onSignOut) {
      onSignOut()
    } else {
      try {
        await invoke('sign_out')
        window.location.href = '/'
      } catch (err) {
        console.error('Failed to sign out:', err)
      }
    }
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  if (loading) {
    return <div className="chat-loading">Loading...</div>
  }

  return (
    <div className="chat-page">
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-header-avatar">💬</div>
          <div className="chat-header-details">
            <h1>Global Chat</h1>
            <p>
              {messages.length} messages
              {!isConnected && ' • Reconnecting...'}
            </p>
          </div>
        </div>
        <div className="chat-header-actions">
          <button onClick={() => navigate('/home')} className="header-action-btn">
            Home
          </button>
          <button onClick={() => navigate('/editProfile')} className="header-action-btn">
            Profile
          </button>
          <button onClick={handleSignOut} className="header-action-btn">
            Logout
          </button>
        </div>
      </div>

      {error && (
        <div className="chat-error-banner">
          {error}
        </div>
      )}

      <ScrollArea className="messages-area">
        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="chat-messages-empty">
              No messages yet. Start the conversation!
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`message-row ${msg.isOutgoing ? 'message-row-sent' : 'message-row-received'}`}
              >
                {!msg.isOutgoing && (
                  <Avatar
                    src={msg.senderAvatarUrl}
                    fallback={msg.senderNickname || 'U'}
                    size="sm"
                    className="message-avatar"
                  />
                )}
                <div className={`message ${msg.isOutgoing ? 'message-sent' : 'message-received'}`}>
                  {!msg.isOutgoing && msg.senderNickname && (
                    <div className="message-sender">{msg.senderNickname}</div>
                  )}
                  <div className="message-content">{msg.content}</div>
                  <div className="message-time">{formatTime(msg.timestamp)}</div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="chat-input-container">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendMessage()
            }
          }}
          placeholder="Type a message..."
          className="chat-input"
        />
        <button
          onClick={sendMessage}
          disabled={!newMessage.trim()}
          className="chat-send-button"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}