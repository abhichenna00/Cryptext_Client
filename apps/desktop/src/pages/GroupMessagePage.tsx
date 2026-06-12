import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useParams } from 'react-router-dom'
import {
  ArrowDown,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react'

import { useWebSocket, WebSocketMessage } from '@/hooks'
import { ErrorMessage } from '@/components/ui/ErrorMessage'
import { ScrollArea } from '@/components/ui/scroll-area'
import Avatar from '@/components/Avatar'
import MediaMessage from '@/components/MediaMessage'
import { STATUS_LABELS, Status } from '@/constants/status'
import { extractVideoFirstFrame } from '@/lib/videoThumbnail'
import { cn } from '@/lib/utils'

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

const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm']

/** Stable hue (0–360) keyed by id so the group avatar tint is consistent. */
function hashHue(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

function isOnline(m: GroupMember): boolean {
  return m.status === 'online' || m.status === 'idle'
}

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

/** Highlight @mentions in message text as accent-tinted mono pills. */
function renderMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[\w._]+)/g)
  if (parts.length === 1) return text
  return parts.map((p, i) =>
    p.startsWith('@') ? (
      <span
        key={i}
        className="rounded bg-[var(--brand-soft)] px-1 font-mono text-[0.92em] font-medium text-[var(--brand)]"
      >
        {p}
      </span>
    ) : (
      p
    ),
  )
}

function MemberRow({ m }: { m: GroupMember }) {
  return (
    <div
      className="grid cursor-default grid-cols-[auto_1fr] items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface"
      title={m.nickname}
    >
      <Avatar src={m.avatar_url} fallback={m.nickname || 'U'} size="sm" status={m.status} showStatus />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium tracking-[-0.005em] text-fg">
          {m.nickname || 'Unknown'}
        </div>
        <div className="truncate text-[10.5px] text-fg-muted">
          {STATUS_LABELS[(m.status as Status) || 'offline']}
        </div>
      </div>
    </div>
  )
}

function MemberPanel({
  members,
  onClose,
}: {
  members: GroupMember[]
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => m.nickname.toLowerCase().includes(q))
  }, [members, filter])

  const online = filtered.filter(isOnline)
  const offline = filtered.filter((m) => !isOnline(m))

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-l border-border bg-bg">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-fg-muted uppercase">
          <Users size={13} strokeWidth={1.75} className="text-fg-dim" />
          <span>Members</span>
          <span className="rounded-full bg-surface-2 px-1.5 py-px font-mono text-[10.5px] tracking-normal text-fg-dim normal-case">
            {members.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Hide members"
          className="grid size-6 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="relative shrink-0 px-2.5 py-2">
        <Search
          size={12}
          strokeWidth={1.75}
          className="absolute top-1/2 left-[18px] -translate-y-1/2 text-fg-dim"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter"
          className={cn(
            'h-7 w-full rounded-md border border-border bg-surface pr-2 pl-7 text-[12px] text-fg placeholder:text-fg-dim',
            'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
          )}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col px-1.5 pb-2">
          {online.length > 0 && (
            <>
              <div className="px-2 pt-2 pb-1 font-mono text-[10px] tracking-[0.08em] text-fg-dim uppercase">
                Online — {online.length}
              </div>
              {online.map((m) => (
                <MemberRow key={m.user_id} m={m} />
              ))}
            </>
          )}
          {offline.length > 0 && (
            <>
              <div className="px-2 pt-2 pb-1 font-mono text-[10px] tracking-[0.08em] text-fg-dim uppercase">
                Offline — {offline.length}
              </div>
              {offline.map((m) => (
                <MemberRow key={m.user_id} m={m} />
              ))}
            </>
          )}
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-fg-dim">No members match.</p>
          )}
        </div>
      </ScrollArea>
    </aside>
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
  const [memberPanelOpen, setMemberPanelOpen] = useState(true)

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
        try {
          wsSend({
            action: 'new_message',
            message: {
              id: result.message_id,
              conversation_id: conversationId,
              sender_id: userId,
              timestamp: result.timestamp || optimisticMessage.timestamp,
            },
          })
        } catch (err) {
          console.warn('[group] ws notify failed:', err)
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
          console.warn('[group] ws notify failed:', err)
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
    profileMap.get(senderId) ?? null

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

  if (!conversationId) {
    return <div className="grid h-full place-items-center text-[var(--danger)]">Invalid conversation</div>
  }

  const onlineCount = members.filter(isOnline).length
  const groupHue = hashHue(conversationId)

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {error && (
        <div className="border-b border-border">
          <ErrorMessage error={error} />
        </div>
      )}

      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar fallback={groupName || 'G'} size="md" hue={groupHue} />
          <div className="min-w-0">
            <div className="flex items-baseline truncate text-[14px] font-semibold tracking-[-0.005em] text-fg">
              <span className="mr-px font-mono font-medium text-fg-muted">#</span>
              <span className="truncate">{groupName}</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] leading-none text-fg-muted">
              <span>{members.length} members</span>
              <span className="text-fg-dim">·</span>
              <span style={{ color: 'var(--ok)' }}>{onlineCount} online</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMemberPanelOpen((v) => !v)}
            title="Members"
            className={cn(
              'grid size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
              memberPanelOpen && 'bg-surface-2 text-fg',
            )}
          >
            <Users size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="grid size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            title="More"
          >
            <MoreHorizontal size={16} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* Main: body + optional member panel */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            'relative min-w-0 flex-1',
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
                <Avatar fallback={groupName || 'G'} size="xl" hue={groupHue} />
                <div>
                  <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">
                    <span className="mr-0.5 font-mono font-medium text-fg-muted">#</span>
                    {groupName}
                  </h2>
                  <p className="mt-1 text-[13px] text-fg-muted">
                    This is the beginning of <strong className="text-fg">#{groupName}</strong>.
                  </p>
                  <p className="mt-1 font-mono text-[10.5px] tracking-[0.02em] text-fg-dim">
                    {members.length} members · end-to-end encrypted
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
                            {renderMentions(msg.content)}
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
                'jump-pill absolute right-4 bottom-4 flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-fg shadow-[var(--shadow-card)]',
                'hover:bg-surface-2 transition-colors',
              )}
            >
              <span>{newMessageCount} new message{newMessageCount > 1 ? 's' : ''} below</span>
              <ArrowDown size={14} strokeWidth={1.75} />
            </button>
          )}
        </div>

        {memberPanelOpen && (
          <MemberPanel members={members} onClose={() => setMemberPanelOpen(false)} />
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
            placeholder={`Message #${groupName}`}
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
          enter to send · shift+enter for newline · @mention to ping
        </div>
      </footer>
    </div>
  )
}
