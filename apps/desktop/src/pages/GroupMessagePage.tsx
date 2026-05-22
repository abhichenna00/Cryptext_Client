import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useParams } from 'react-router-dom'
import { useWebSocket, WebSocketMessage } from '@/hooks'
import { ErrorMessage } from '@/components/ui/ErrorMessage'
import { ArrowDown, Send, Paperclip, X, Users } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import Avatar from '@/components/Avatar'
import MediaMessage from '@/components/MediaMessage'
import { extractVideoFirstFrame } from '@/lib/videoThumbnail'
import '../styles/DirectMessagePage.css'

interface ProfileInfo {
  user_id: string
  nickname: string
  avatar_url: string | null
  status: string | null
}

interface GroupMember {
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

export default function GroupMessagePage() {
  const { conversationId } = useParams<{ conversationId: string }>()

  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [profileMap, setProfileMap] = useState<Map<string, ProfileInfo>>(new Map())
  const [groupName, setGroupName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [sendingMedia, setSendingMedia] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const previousMessageCount = useRef(0)
  const conversationIdRef = useRef<string | null>(null)
  const userIdRef = useRef<string | null>(null)
  const isAtBottomRef = useRef(true)
  const messagesRef = useRef<Message[]>([])

  useEffect(() => { conversationIdRef.current = conversationId ?? null }, [conversationId])
  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { isAtBottomRef.current = isAtBottom }, [isAtBottom])
  useEffect(() => { messagesRef.current = messages }, [messages])

  const handleWsMessage = useCallback(async (data: WebSocketMessage) => {
    if (data.action !== 'new_message') return
    const notification = data.message as Message
    if (notification.conversation_id !== conversationIdRef.current) return
    if (notification.sender_id === userIdRef.current) return

    try {
      // Fire decrypt+store. Read truth from local DB after, since another
      // subscriber (HomePage) may win the per-conversation mutex and leave
      // our return empty even though the message landed.
      await invoke('fetch_new_messages', { conversationId: notification.conversation_id })

      const lastShownTs = messagesRef.current.length > 0
        ? messagesRef.current[messagesRef.current.length - 1].timestamp
        : 0
      const fresh = await invoke<Message[]>('get_local_messages_after', {
        conversationId: notification.conversation_id,
        afterTimestamp: lastShownTs,
      })

      if (fresh.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id))
          const toAppend = fresh.filter((m) => !seen.has(m.id))
          return toAppend.length > 0 ? [...prev, ...toAppend] : prev
        })
      }

      if (conversationIdRef.current) {
        invoke('mark_read', { conversationId: conversationIdRef.current }).catch(console.error)
      }
      if (isAtBottomRef.current) {
        setTimeout(() => scrollToBottom(), 100)
      }
    } catch (err) {
      console.error('Failed to fetch new messages:', err)
    }
  }, [])

  const { sendMessage: wsSend } = useWebSocket({ onMessage: handleWsMessage })

  useEffect(() => { initializeChat() }, [conversationId])

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
          if (container) container.scrollTop = container.scrollHeight - prevScrollHeight
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
    if (scrollTop < 100 && hasMore && !loadingMore) loadMoreMessages()
  }, [hasMore, loadingMore, loadMoreMessages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setNewMessageCount(0)
  }

  const initializeChat = async () => {
    if (!conversationId) {
      setError('Invalid conversation')
      setLoading(false)
      return
    }

    try {
      const id = await invoke<string | null>('get_user_id')
      if (!id) return
      setUserId(id)

      const [memberList, conversations] = await Promise.all([
        invoke<GroupMember[]>('get_group_members', { conversationId }),
        invoke<{ name: string | null }[]>('get_conversations').catch(() => []),
      ])

      setMembers(memberList)
      const pMap = new Map<string, ProfileInfo>()
      memberList.forEach(m => pMap.set(m.user_id, m))
      setProfileMap(pMap)

      const conv = (conversations as any[]).find(
        (c: any) => c.conversation_id === conversationId
      )
      setGroupName(conv?.name || 'Group')

      try {
        await invoke('mls_fetch_welcomes')
      } catch (err) {
        console.error('Failed to fetch welcomes:', err)
      }

      await loadMessages(conversationId)
      await invoke('mark_read', { conversationId: conversationId })
    } catch (err) {
      console.error('Failed to initialize group chat:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
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
      })

      if (result.success && result.message_id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticMessage.id
              ? { ...m, id: result.message_id!, timestamp: result.timestamp || m.timestamp }
              : m
          )
        )
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

  const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm']

  const handleFileSelect = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!MEDIA_EXTENSIONS.includes(ext)) {
      setError(`Unsupported file type: .${ext}`)
      return
    }
    setSelectedFile(file)
    if (file.type.startsWith('image/')) {
      setFilePreviewUrl(URL.createObjectURL(file))
    } else {
      setFilePreviewUrl(null)
    }
  }

  const clearSelectedFile = () => {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl)
    setSelectedFile(null)
    setFilePreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false) }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }

  const sendMedia = async () => {
    if (!selectedFile || !conversationId || sendingMedia || !userId) return
    setSendingMedia(true)
    setError(null)
    try {
      const arrayBuffer = await selectedFile.arrayBuffer()
      const bytes = Array.from(new Uint8Array(arrayBuffer))

      let videoThumbnailBytes: number[] | null = null
      if (selectedFile.type.startsWith('video/')) {
        const frame = await extractVideoFirstFrame(selectedFile)
        if (frame) videoThumbnailBytes = Array.from(frame)
      }

      const result = await invoke<MessageResult>('send_media', {
        conversationId,
        filePath: selectedFile.name,
        fileBytes: bytes,
        videoThumbnailBytes,
      })
      if (result.success && result.message_id) {
        await loadMessages(conversationId)
        setTimeout(() => scrollToBottom(), 100)
        wsSend({
          action: 'new_message',
          message: {
            id: result.message_id,
            conversation_id: conversationId,
            sender_id: userId,
            timestamp: result.timestamp || Date.now(),
          },
        })
      } else {
        setError(result.error || 'Failed to send media')
      }
    } catch (err) {
      console.error('Failed to send media:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSendingMedia(false)
      clearSelectedFile()
    }
  }

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  const getProfile = (senderId: string): ProfileInfo | null =>
    profileMap.get(senderId) ?? null

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

  if (loading) return <div className="dm-page"><div className="dm-loading">Loading...</div></div>
  if (!conversationId) return <div className="dm-page"><div className="dm-error">Invalid conversation</div></div>

  return (
    <div className="dm-page">
      <ErrorMessage error={error} className="dm-error-banner" />

      <ScrollArea
        viewportRef={messagesContainerRef}
        viewportProps={{ onScroll: handleScroll }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`dm-messages ${isDragOver ? 'dm-messages-dragover' : ''}`}
      >
        <div className="dm-messages-inner">
        <div className="dm-conversation-intro">
          <div className="group-intro-icon">
            <Users size={32} />
          </div>
          <h2>{groupName}</h2>
          <p>{members.length} members</p>
        </div>
        {messages.length > 0 && (
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
                        {msg.content_type === 'media' ? (
                          <MediaMessage messageId={msg.id} content={msg.content} conversationId={msg.conversation_id} />
                        ) : (
                          <div className="dm-message-content">{msg.content}</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="dm-message-gutter">
                        <span className="dm-message-timestamp-hover">{formatTime(msg.timestamp)}</span>
                      </div>
                      <div className="dm-message-body">
                        {msg.content_type === 'media' ? (
                          <MediaMessage messageId={msg.id} content={msg.content} conversationId={msg.conversation_id} />
                        ) : (
                          <div className="dm-message-content">{msg.content}</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {newMessageCount > 0 && (
        <div className="dm-new-messages" onClick={scrollToBottom}>
          <span>{newMessageCount} new message{newMessageCount > 1 ? 's' : ''} below</span>
          <ArrowDown className="h-4 w-4" />
        </div>
      )}

      <footer className="dm-input-container">
        {selectedFile && (
          <div className="dm-media-preview">
            {filePreviewUrl ? (
              <img src={filePreviewUrl} alt="Preview" className="dm-media-preview-image" />
            ) : (
              <div className="dm-media-preview-file">
                <span>{selectedFile.name}</span>
              </div>
            )}
            <button className="dm-media-preview-close" onClick={clearSelectedFile}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="dm-input-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm"
            className="dm-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileSelect(file)
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="dm-attach-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sendingMedia}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (selectedFile) sendMedia()
                else sendMessage()
              }
            }}
            placeholder={`Message ${groupName}`}
            className="dm-input"
            disabled={sending || sendingMedia}
          />
          <Button
            onClick={selectedFile ? sendMedia : sendMessage}
            size="icon"
            disabled={(sending || sendingMedia) || (!selectedFile && !newMessage.trim())}
            className="dm-send-button"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  )
}
