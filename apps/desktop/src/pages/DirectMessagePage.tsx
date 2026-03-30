import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate, useParams } from 'react-router-dom'
import { useWebSocket, WebSocketMessage } from '@/hooks'
import { ArrowLeft, ArrowDown, Send } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Status, STATUS_LABELS } from '@/constants/status'
import Avatar from '@/components/Avatar'
import '../styles/DirectMessagePage.css'

interface ProfileInfo {
  user_id: string
  nickname: string
  avatar_url: string | null
  status: string | null
}

interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  timestamp: number
  content_type?: string
  content_bytes?: number[]
  welcome_data?: number[]
}

interface DmResult {
  success: boolean
  conversation_id: string | null
  error: string | null
}

interface MessageResult {
  success: boolean
  error: string | null
  message_id: string | null
  timestamp: number | null
}

function DateSeparator({ timestamp }: { timestamp: number }) {
  const formatDate = (ts: number) => {
    const date = new Date(ts)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="dm-date-separator">
      <div className="dm-date-separator-line" />
      <span className="dm-date-separator-text">{formatDate(timestamp)}</span>
      <div className="dm-date-separator-line" />
    </div>
  )
}

export default function DirectMessagePage() {
  const navigate = useNavigate()
  const { friendId } = useParams<{ friendId: string }>()

  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [partnerProfile, setPartnerProfile] = useState<ProfileInfo | null>(null)
  const [myProfile, setMyProfile] = useState<ProfileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const previousMessageCount = useRef(0)
  const conversationIdRef = useRef<string | null>(null)
  const userIdRef = useRef<string | null>(null)
  const isAtBottomRef = useRef(true)

  useEffect(() => { conversationIdRef.current = conversationId }, [conversationId])
  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { isAtBottomRef.current = isAtBottom }, [isAtBottom])

  const handleWsMessage = useCallback(async (data: WebSocketMessage) => {
    if (data.action === 'new_message') {
      const notification = data.message as Message
      if (notification.conversation_id !== conversationIdRef.current) return

      // Skip own messages — we already have the plaintext from the optimistic send
      if (notification.sender_id === userIdRef.current) return

      // Fetch the full message from server (includes ciphertext for decryption)
      try {
        const messages = await invoke<Message[]>('get_messages', {
          conversationId: notification.conversation_id,
        })

        setMessages(messages)

        if (conversationIdRef.current) {
          invoke('mark_read', { conversationId: conversationIdRef.current }).catch(console.error)
        }

        if (isAtBottomRef.current) {
          setTimeout(() => scrollToBottom(), 100)
        }
      } catch (err) {
        console.error('Failed to fetch messages after notification:', err)
      }
    }
  }, [])

  const { isConnected, sendMessage: wsSend } = useWebSocket({ onMessage: handleWsMessage })

  useEffect(() => { initializeChat() }, [friendId])

  useEffect(() => {
    if (messages.length > previousMessageCount.current) {
      const newCount = messages.length - previousMessageCount.current
      if (!isAtBottom && previousMessageCount.current > 0) {
        setNewMessageCount(prev => prev + newCount)
      }
    }
    previousMessageCount.current = messages.length
  }, [messages, isAtBottom])

  const loadMoreMessages = useCallback(async () => {
    if (!conversationIdRef.current || loadingMore || !hasMore) return
    setLoadingMore(true)

    try {
      const oldestMessage = messages.length > 0 ? messages[0] : undefined
      const older = await invoke<Message[]>('get_local_messages', {
        conversationId: conversationIdRef.current,
        limit: 50,
        beforeTimestamp: oldestMessage?.timestamp,
        beforeId: oldestMessage?.id,
      })

      if (older.length === 0) {
        setHasMore(false)
      } else {
        const container = messagesContainerRef.current
        const prevScrollHeight = container?.scrollHeight || 0

        setMessages((prev) => [...older, ...prev])

        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight
          }
        })
      }
    } catch (err) {
      console.error('Failed to load more messages:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [messages, loadingMore, hasMore])

  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 50
    setIsAtBottom(atBottom)
    if (atBottom) setNewMessageCount(0)

    if (scrollTop < 100 && hasMore && !loadingMore) {
      loadMoreMessages()
    }
  }, [hasMore, loadingMore, loadMoreMessages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setNewMessageCount(0)
  }

  const initializeChat = async () => {
    if (!friendId) {
      setError('Invalid conversation')
      setLoading(false)
      return
    }

    try {
      const id = await invoke<string | null>('get_user_id')
      if (!id) {
        navigate('/')
        return
      }
      setUserId(id)

      await loadProfiles(id)

      const result = await invoke<DmResult>('get_or_create_dm', { otherUserId: friendId })
      if (!result.success || !result.conversation_id) {
        setError(result.error || 'Failed to load conversation')
        setLoading(false)
        return
      }

      setConversationId(result.conversation_id)

      // Fetch any pending Welcome messages to join MLS groups
      try {
        await invoke('mls_fetch_welcomes')
      } catch (err) {
        console.error('Failed to fetch welcomes:', err)
      }

      await loadMessages(result.conversation_id)
      await invoke('mark_read', { conversationId: result.conversation_id })
    } catch (err) {
      console.error('Failed to initialize chat:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const loadProfiles = async (currentUserId: string) => {
    if (!friendId) return
    try {
      const profiles = await invoke<ProfileInfo[]>('get_profiles_by_ids', {
        userIds: [friendId, currentUserId],
      })
      profiles.forEach(profile => {
        if (profile.user_id === friendId) setPartnerProfile(profile)
        else if (profile.user_id === currentUserId) setMyProfile(profile)
      })
    } catch (err) {
      console.error('Failed to load profiles:', err)
      setPartnerProfile({ user_id: friendId, nickname: 'Unknown User', avatar_url: null, status: null })
    }
  }

  const loadMessages = async (convId: string) => {
    try {
      const data = await invoke<Message[]>('get_messages', { conversationId: convId })
      setMessages(data)
      setError(null)
      setTimeout(() => scrollToBottom(), 100)
    } catch (err) {
      console.error('Failed to load messages:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const sendMessage = async () => {
    if (!newMessage.trim() || !conversationId || sending || !userId) return

    const messageContent = newMessage.trim()
    setNewMessage('')
    setSending(true)
    setError(null)

    const optimisticMessage: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: userId,
      content: messageContent,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, optimisticMessage])
    setTimeout(() => scrollToBottom(), 100)

    try {
      const result = await invoke<MessageResult>('send_message', {
        conversationId,
        content: messageContent,
        otherUserId: friendId,
      })

      if (result.success && result.message_id) {
        // Replace optimistic message with real server ID
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticMessage.id
              ? { ...m, id: result.message_id!, timestamp: result.timestamp || m.timestamp }
              : m
          )
        )

        // Notify other clients via WebSocket that a new message is available
        wsSend({
          action: 'new_message',
          message: {
            id: result.message_id,
            conversation_id: conversationId,
            sender_id: userId,
            timestamp: result.timestamp || optimisticMessage.timestamp,
          },
        })
      } else if (!result.success) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id))
        setError(result.error || 'Failed to send message')
        setNewMessage(messageContent)
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id))
      setError(err instanceof Error ? err.message : String(err))
      setNewMessage(messageContent)
    } finally {
      setSending(false)
    }
  }

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  const getProfile = (senderId: string): ProfileInfo | null =>
    senderId === userId ? myProfile : partnerProfile

  const isNewDay = (msg: Message, index: number): boolean => {
    if (index === 0) return true
    const prevMsg = messages[index - 1]
    return new Date(prevMsg.timestamp).toDateString() !== new Date(msg.timestamp).toDateString()
  }

  const shouldShowHeader = (msg: Message, index: number): boolean => {
    if (isNewDay(msg, index)) return true
    const prevMsg = messages[index - 1]
    if (prevMsg.sender_id !== msg.sender_id) return true
    return msg.timestamp - prevMsg.timestamp > 5 * 60 * 1000
  }

  const partnerStatus = (partnerProfile?.status as Status) || 'offline'

  if (loading) {
    return <div className="dm-page"><div className="dm-loading">Loading...</div></div>
  }

  if (!friendId) {
    return <div className="dm-page"><div className="dm-error">Invalid conversation</div></div>
  }

  return (
    <div className="dm-page">
      <header className="dm-header">
        <Button variant="ghost" size="icon" onClick={() => navigate('/home')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="dm-header-info">
          <Avatar src={partnerProfile?.avatar_url} fallback={partnerProfile?.nickname || 'U'} size="md" status={partnerProfile?.status} showStatus />
          <div className="dm-header-details">
            <h1>{partnerProfile?.nickname || 'Unknown User'}</h1>
            <span className="dm-header-status">
              {STATUS_LABELS[partnerStatus]}
              {!isConnected && ' • Reconnecting...'}
            </span>
          </div>
        </div>
      </header>

      {error && <div className="dm-error-banner">{error}</div>}

      <main ref={messagesContainerRef} onScroll={handleScroll} className="dm-messages">
        {messages.length === 0 ? (
          <div className="dm-messages-empty">
            <div className="dm-empty-avatar">
              <Avatar src={partnerProfile?.avatar_url} fallback={partnerProfile?.nickname || 'U'} size="lg" status={partnerProfile?.status} showStatus />
            </div>
            <h2>{partnerProfile?.nickname || 'Unknown User'}</h2>
            <p>This is the beginning of your direct message history with <strong>{partnerProfile?.nickname}</strong>.</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const profile = getProfile(msg.sender_id)
            const showHeader = shouldShowHeader(msg, index)
            const showDateSeparator = isNewDay(msg, index)

            return (
              <div key={msg.id}>
                {showDateSeparator && <DateSeparator timestamp={msg.timestamp} />}
                <div className={`dm-message ${showHeader ? 'dm-message-with-header' : 'dm-message-grouped'}`}>
                  {showHeader ? (
                    <>
                      <Avatar src={profile?.avatar_url} fallback={profile?.nickname || 'U'} size="md" className="dm-message-avatar" />
                      <div className="dm-message-body">
                        <div className="dm-message-header">
                          <span className="dm-message-author">{profile?.nickname || 'Unknown'}</span>
                          <span className="dm-message-timestamp">{formatTime(msg.timestamp)}</span>
                        </div>
                        <div className="dm-message-content">{msg.content}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="dm-message-gutter">
                        <span className="dm-message-timestamp-hover">{formatTime(msg.timestamp)}</span>
                      </div>
                      <div className="dm-message-body">
                        <div className="dm-message-content">{msg.content}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </main>

      {newMessageCount > 0 && (
        <div className="dm-new-messages" onClick={scrollToBottom}>
          <span>{newMessageCount} new message{newMessageCount > 1 ? 's' : ''} below</span>
          <ArrowDown className="h-4 w-4" />
        </div>
      )}

      <footer className="dm-input-container">
        <Input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendMessage()
            }
          }}
          placeholder={`Message @${partnerProfile?.nickname || 'user'}`}
          className="dm-input"
          disabled={sending}
        />
        <Button onClick={sendMessage} size="icon" disabled={sending || !newMessage.trim()} className="dm-send-button">
          <Send className="h-4 w-4" />
        </Button>
      </footer>
    </div>
  )
}