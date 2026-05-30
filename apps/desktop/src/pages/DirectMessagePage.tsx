import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDown,
  Lock,
  MoreVertical,
  Paperclip,
  Send,
  X,
} from 'lucide-react'

import { useWebSocket, WebSocketMessage } from '@/hooks'
import { ErrorMessage } from '@/components/ui/ErrorMessage'
import { ScrollArea } from '@/components/ui/scroll-area'
import Avatar from '@/components/Avatar'
import CallButton from '@/components/calls/CallButton'
import MediaMessage from '@/components/MediaMessage'
import StatusPill from '@/components/StatusPill'
import { extractVideoFirstFrame } from '@/lib/videoThumbnail'
import { cn } from '@/lib/utils'

interface ProfileInfo {
  user_id: string
  username?: string
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

const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm']

function formatDateLabel(ts: number) {
  const date = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function DaySeparator({ timestamp }: { timestamp: number }) {
  return (
    <div className="my-3 flex items-center gap-3 px-1">
      <div className="h-px flex-1 bg-border" />
      <span className="font-mono text-[10.5px] tracking-[0.08em] text-fg-muted uppercase">
        {formatDateLabel(timestamp)}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function EncryptionChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-[3px] font-mono text-[10.5px] tracking-[0.04em] text-[var(--ok)]">
      <Lock size={10} strokeWidth={2} />
      Encrypted
    </span>
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

  useEffect(() => { conversationIdRef.current = conversationId }, [conversationId])
  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { isAtBottomRef.current = isAtBottom }, [isAtBottom])
  useEffect(() => { messagesRef.current = messages }, [messages])

  const handleWsMessage = useCallback(async (data: WebSocketMessage) => {
    if (data.action !== 'new_message') return
    const notification = data.message as Message
    if (notification.conversation_id !== conversationIdRef.current) return
    if (notification.sender_id === userIdRef.current) return

    try {
      // Fire decrypt+store. The return value is unreliable: HomePage's
      // useLiveConversationList subscribes to the same push and may win the
      // per-conversation mutex first, in which case our call returns []
      // even though the message landed in local DB. Read from local DB
      // afterwards instead.
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
      if (isAtBottomRef.current) setTimeout(() => scrollToBottom(), 100)
    } catch (err) {
      console.error('Failed to fetch new messages:', err)
    }
  }, [])

  const { sendMessage: wsSend } = useWebSocket({ onMessage: handleWsMessage })

  useEffect(() => { initializeChat() }, [friendId])

  useEffect(() => {
    if (messages.length > previousMessageCount.current) {
      const newCount = messages.length - previousMessageCount.current
      if (!isAtBottom && previousMessageCount.current > 0) {
        setNewMessageCount((prev) => prev + newCount)
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

      await invoke('mls_fetch_welcomes').catch((err) => console.error('Failed to fetch welcomes:', err))

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
      profiles.forEach((profile) => {
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticMessage.id
              ? { ...m, id: result.message_id!, timestamp: result.timestamp || m.timestamp }
              : m,
          ),
        )
        try {
          wsSend({
            action: 'new_message',
            message: {
              id: result.message_id,
              conversation_id: conversationId,
              sender_id: userId,
              recipient_id: friendId,
              timestamp: result.timestamp || optimisticMessage.timestamp,
            },
          })
        } catch (err) {
          console.warn('[chat] ws notify failed:', err)
        }
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
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
        otherUserId: friendId,
        fileBytes: bytes,
        videoThumbnailBytes,
      })

      if (result.success && result.message_id) {
        await loadMessages(conversationId)
        setTimeout(() => scrollToBottom(), 100)
        try {
          wsSend({
            action: 'new_message',
            message: {
              id: result.message_id,
              conversation_id: conversationId,
              sender_id: userId,
              timestamp: result.timestamp || Date.now(),
            },
          })
        } catch (err) {
          console.warn('[chat] ws notify failed:', err)
        }
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

  const getProfile = (senderId: string): ProfileInfo | null =>
    senderId === userId ? myProfile : partnerProfile

  const isNewDay = (msg: Message, index: number): boolean => {
    if (index === 0) return true
    const prevMsg = messages[index - 1]
    return new Date(prevMsg.timestamp).toDateString() !== new Date(msg.timestamp).toDateString()
  }

  const shouldShowHeader = (msg: Message, index: number): boolean => {
    if (isNewDay(msg, index)) return true
    return messages[index - 1].sender_id !== msg.sender_id
  }

  if (loading) {
    return <div className="grid h-full place-items-center text-fg-muted">Loading…</div>
  }

  if (!friendId) {
    return <div className="grid h-full place-items-center text-[var(--danger)]">Invalid conversation</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {error && (
        <div className="border-b border-border">
          <ErrorMessage error={error} />
        </div>
      )}

      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <Avatar
            src={partnerProfile?.avatar_url}
            fallback={partnerProfile?.nickname || 'U'}
            size="md"
            status={partnerProfile?.status}
            showStatus
          />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold tracking-[-0.005em] text-fg">
              {partnerProfile?.nickname || 'Unknown User'}
            </div>
            <div className="flex items-center gap-2 leading-none">
              {partnerProfile?.username && (
                <span className="truncate font-mono text-[10.5px] tracking-[0.02em] text-fg-muted">
                  @{partnerProfile.username}
                </span>
              )}
              <StatusPill status={partnerProfile?.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conversationId && friendId && (
            <>
              <CallButton conversationId={conversationId} peerUserId={friendId} mode="audio" />
              <CallButton conversationId={conversationId} peerUserId={friendId} mode="video" />
            </>
          )}
          <EncryptionChip />
          <button
            type="button"
            className="grid size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            title="More"
          >
            <MoreVertical size={16} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* Body */}
      <div
        className={cn(
          'relative flex-1 min-h-0',
          isDragOver && 'after:pointer-events-none after:absolute after:inset-2 after:rounded-lg after:border-2 after:border-dashed after:border-[var(--brand)] after:bg-[var(--brand-soft)]',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ScrollArea
          viewportRef={messagesContainerRef}
          viewportProps={{ onScroll: handleScroll }}
          className="h-full"
        >
          <div className="flex flex-col px-5 py-4">
            {/* Intro block */}
            <div className="mb-4 flex flex-col items-center gap-3 py-6 text-center">
              <Avatar
                src={partnerProfile?.avatar_url}
                fallback={partnerProfile?.nickname || 'U'}
                size="xl"
                status={partnerProfile?.status}
                showStatus
              />
              <div>
                <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">
                  {partnerProfile?.nickname || 'Unknown User'}
                </h2>
                <p className="mt-1 text-[13px] text-fg-muted">
                  This is the beginning of your direct message history with{' '}
                  {partnerProfile?.username ? (
                    <span className="font-mono text-fg">@{partnerProfile.username}</span>
                  ) : (
                    <strong className="text-fg">{partnerProfile?.nickname || 'this user'}</strong>
                  )}
                  .
                </p>
              </div>
            </div>

            {/* Messages */}
            {messages.map((msg, index) => {
              const profile = getProfile(msg.sender_id)
              const showHeader = shouldShowHeader(msg, index)
              const showDate = isNewDay(msg, index)
              const isMedia = msg.content_type === 'media'

              return (
                <div key={msg.id}>
                  {showDate && <DaySeparator timestamp={msg.timestamp} />}
                  <div
                    className={cn(
                      'group/msg grid grid-cols-[36px_1fr] items-start gap-x-2 leading-none',
                      showHeader && 'mt-3',
                    )}
                  >
                    {showHeader ? (
                      <Avatar
                        src={profile?.avatar_url}
                        fallback={profile?.nickname || 'U'}
                        size="sm"
                        className="mt-0.5"
                      />
                    ) : (
                      <span className="select-none pt-[3px] text-right font-mono text-[10px] text-fg-dim opacity-0 transition-opacity group-hover/msg:opacity-100">
                        {formatTime(msg.timestamp)}
                      </span>
                    )}
                    <div className="min-w-0">
                      {showHeader && (
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13.5px] font-semibold tracking-[-0.005em] text-fg">
                            {profile?.nickname || 'Unknown'}
                          </span>
                          <span className="font-mono text-[10.5px] tracking-[0.02em] text-fg-dim">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                      )}
                      {isMedia ? (
                        <div className="mt-0.5">
                          <MediaMessage
                            messageId={msg.id}
                            content={msg.content}
                            conversationId={msg.conversation_id}
                          />
                        </div>
                      ) : (
                        <div className="text-[14px] leading-[1.5] tracking-[-0.003em] text-fg break-words whitespace-pre-wrap">
                          {msg.content}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {newMessageCount > 0 && (
          <button
            onClick={scrollToBottom}
            className={cn(
              'absolute right-4 bottom-4 flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-fg shadow-[var(--shadow-card)]',
              'hover:bg-surface-2 transition-colors',
            )}
          >
            <span>{newMessageCount} new message{newMessageCount > 1 ? 's' : ''} below</span>
            <ArrowDown size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Composer */}
      <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
        {selectedFile && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-surface-2 p-2">
            {filePreviewUrl ? (
              <img src={filePreviewUrl} alt="" className="size-10 rounded object-cover" />
            ) : (
              <div className="grid size-10 place-items-center rounded bg-surface-3 font-mono text-[10px] text-fg-dim">
                {(selectedFile.name.split('.').pop() || 'file').toUpperCase()}
              </div>
            )}
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
              {selectedFile.name}
            </span>
            <button
              type="button"
              onClick={clearSelectedFile}
              className="grid size-6 place-items-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileSelect(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sendingMedia}
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip size={16} strokeWidth={1.75} />
          </button>
          <textarea
            rows={1}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (selectedFile) sendMedia()
                else sendMessage()
              }
            }}
            placeholder={`Message @${partnerProfile?.username || partnerProfile?.nickname || 'user'}`}
            disabled={sending || sendingMedia}
            className={cn(
              'max-h-40 min-h-[32px] w-full resize-none rounded-md border border-border bg-bg px-3 py-1.5 text-[13.5px] text-fg placeholder:text-fg-dim',
              'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          />
          <button
            type="button"
            onClick={selectedFile ? sendMedia : sendMessage}
            disabled={(sending || sendingMedia) || (!selectedFile && !newMessage.trim())}
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[var(--brand-fg)] transition-opacity',
              'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
            )}
            title="Send"
          >
            <Send size={14} strokeWidth={1.75} />
          </button>
        </div>

        <div className="mt-1.5 px-0.5 font-mono text-[10.5px] tracking-[0.02em] text-fg-dim">
          enter to send · shift+enter for newline
        </div>
      </footer>
    </div>
  )
}
