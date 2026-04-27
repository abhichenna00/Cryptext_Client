import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import { Copy, MessageCircle, MoreVertical, Search, UserMinus } from 'lucide-react'

import Avatar from '@/components/Avatar'
import StatusPill from '@/components/StatusPill'
import { useFriendActions } from '@/hooks'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type FriendsTab = 'online' | 'all' | 'pending'

interface FriendWithProfile {
  friend_id: string
  username: string
  nickname: string
  created_at: string
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

interface FriendResult {
  success: boolean
  error?: string
}

function isActiveStatus(status?: string | null) {
  return status === 'online' || status === 'idle' || status === 'dnd'
}

function FriendRow({
  avatar,
  name,
  handle,
  status,
  right,
}: {
  avatar: React.ReactNode
  name: string
  handle: string
  status?: string | null
  right: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-2">
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-fg">{name}</div>
        <div className="flex items-center gap-2 text-[11.5px]">
          <span className="truncate font-mono text-fg-dim">@{handle}</span>
          <span className="text-fg-dim">·</span>
          <StatusPill status={status} />
        </div>
      </div>
      <div className="flex items-center gap-1">{right}</div>
    </div>
  )
}

function IconButton({
  onClick,
  title,
  disabled,
  tone = 'ghost',
  children,
}: {
  onClick: () => void
  title: string
  disabled?: boolean
  tone?: 'ghost' | 'accept' | 'danger'
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'accept'
      ? 'text-[var(--ok)] hover:bg-[var(--ok)]/10'
      : tone === 'danger'
        ? 'text-[var(--danger)] hover:bg-[var(--danger)]/10'
        : 'text-fg-muted hover:bg-surface-3 hover:text-fg'
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid size-8 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        toneClass,
      )}
    >
      {children}
    </button>
  )
}

export default function FriendsView() {
  const navigate = useNavigate()

  const [friends, setFriends] = useState<FriendWithProfile[]>([])
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState<FriendsTab>('all')
  const [error, setError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addUsername, setAddUsername] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState<string | null>(null)

  const [friendToRemove, setFriendToRemove] = useState<FriendWithProfile | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)

  const loadData = async () => {
    try {
      const [friendsData, incoming, outgoing] = await Promise.all([
        invoke<FriendWithProfile[]>('get_friends'),
        invoke<FriendRequest[]>('get_incoming_friend_requests'),
        invoke<FriendRequest[]>('get_outgoing_friend_requests'),
      ])
      setFriends(friendsData)
      setIncomingRequests(incoming)
      setOutgoingRequests(outgoing)
    } catch (err) {
      console.error('Failed to load friends:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const {
    actionLoading,
    error: friendActionError,
    handleAcceptRequest,
    handleDeclineRequest,
    handleCancelRequest,
  } = useFriendActions(loadData)

  useEffect(() => {
    loadData()
  }, [])

  const onlineCount = useMemo(() => friends.filter((f) => isActiveStatus(f.status)).length, [friends])
  const pendingCount = incomingRequests.length + outgoingRequests.length

  const filteredFriends = useMemo(() => {
    let list = friends
    if (tab === 'online') list = list.filter((f) => isActiveStatus(f.status))
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (f) => f.nickname.toLowerCase().includes(q) || f.username.toLowerCase().includes(q),
      )
    }
    return list
  }, [friends, tab, searchQuery])

  const handleCopyUsername = async (username: string) => {
    try {
      await navigator.clipboard.writeText(username)
    } catch (err) {
      console.error('Failed to copy username:', err)
    }
  }

  const handleRemoveFriend = async () => {
    if (!friendToRemove) return
    setRemoveLoading(true)
    try {
      const result = await invoke<FriendResult>('remove_friend', {
        friendId: friendToRemove.friend_id,
      })
      if (!result.success) setError(result.error || 'Failed to remove friend')
      else await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoveLoading(false)
      setFriendToRemove(null)
    }
  }

  const handleSendFriendRequest = async () => {
    if (!addUsername.trim()) {
      setAddError('Please enter a username')
      return
    }
    setAddLoading(true)
    setAddError(null)
    setAddSuccess(null)
    try {
      const result = await invoke<FriendResult>('send_friend_request', {
        toUsername: addUsername.trim(),
      })
      if (result.success) {
        setAddSuccess(`Friend request sent to @${addUsername.trim()}`)
        setAddUsername('')
        loadData()
        setTimeout(() => {
          setAddSuccess(null)
          setAddOpen(false)
        }, 1200)
      } else {
        setAddError(result.error || 'Failed to send friend request')
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddLoading(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex items-center gap-4">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">Friends</h2>
          <Tabs value={tab} onValueChange={(v) => setTab(v as FriendsTab)}>
            <TabsList>
              <TabsTrigger value="online">
                Online <span className="ml-1 font-mono text-fg-dim">{onlineCount}</span>
              </TabsTrigger>
              <TabsTrigger value="all">
                All <span className="ml-1 font-mono text-fg-dim">{friends.length}</span>
              </TabsTrigger>
              <TabsTrigger value="pending">
                Pending <span className="ml-1 font-mono text-fg-dim">{pendingCount}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          className="h-8 bg-[var(--brand)] text-[var(--brand-fg)] hover:opacity-90"
        >
          + Add friend
        </Button>
      </header>

      {/* Search (hidden on Pending) */}
      {tab !== 'pending' && (
        <div className="px-5 py-3">
          <div className="relative">
            <Search
              size={14}
              strokeWidth={1.75}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-dim"
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search friends"
              className={cn(
                'h-9 w-full rounded-md border border-border bg-surface-2 pr-2 pl-8 text-[13px] text-fg placeholder:text-fg-dim',
                'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            />
          </div>
        </div>
      )}

      {(error || friendActionError) && (
        <div className="px-5 pb-2 text-[12.5px] text-[var(--danger)]">
          {error || friendActionError}
        </div>
      )}

      {/* Body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-0.5 px-3 pb-4">
          {tab === 'pending' ? (
            <>
              {incomingRequests.length > 0 && (
                <section>
                  <div className="px-3 pt-3 pb-1 font-mono text-[11px] tracking-[0.08em] text-fg-muted uppercase">
                    Incoming <span className="text-fg-dim">{incomingRequests.length}</span>
                  </div>
                  {incomingRequests.map((request) => (
                    <FriendRow
                      key={request.id}
                      avatar={
                        <Avatar
                          src={request.from_avatar_url}
                          fallback={request.from_nickname || 'U'}
                          size="md"
                          status={request.from_status}
                        />
                      }
                      name={request.from_nickname || 'Unknown'}
                      handle={request.from_username || 'unknown'}
                      status={request.from_status}
                      right={
                        <>
                          <Button
                            onClick={() => handleAcceptRequest(request.id)}
                            disabled={actionLoading}
                            className="h-7 bg-[var(--brand)] text-[var(--brand-fg)] hover:opacity-90"
                          >
                            Accept
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => handleDeclineRequest(request.id)}
                            disabled={actionLoading}
                            className="h-7"
                          >
                            Decline
                          </Button>
                        </>
                      }
                    />
                  ))}
                </section>
              )}

              {outgoingRequests.length > 0 && (
                <section className="mt-2">
                  <div className="px-3 pt-3 pb-1 font-mono text-[11px] tracking-[0.08em] text-fg-muted uppercase">
                    Outgoing <span className="text-fg-dim">{outgoingRequests.length}</span>
                  </div>
                  {outgoingRequests.map((request) => (
                    <FriendRow
                      key={request.id}
                      avatar={
                        <Avatar
                          src={request.to_avatar_url}
                          fallback={request.to_nickname || 'U'}
                          size="md"
                          status={request.to_status}
                        />
                      }
                      name={request.to_nickname || 'Unknown'}
                      handle={request.to_username || 'unknown'}
                      status={request.to_status}
                      right={
                        <>
                          <span className="font-mono text-[10.5px] tracking-[0.08em] text-fg-dim uppercase">
                            awaiting
                          </span>
                          <Button
                            variant="ghost"
                            onClick={() => handleCancelRequest(request.id)}
                            disabled={actionLoading}
                            className="h-7"
                          >
                            Cancel
                          </Button>
                        </>
                      }
                    />
                  ))}
                </section>
              )}

              {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
                <p className="px-4 py-8 text-center text-[13px] text-fg-dim">
                  No pending friend requests.
                </p>
              )}
            </>
          ) : friends.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-fg-dim">
              No friends yet. Add some friends to start chatting!
            </p>
          ) : filteredFriends.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-fg-dim">
              {tab === 'online' ? 'No friends online.' : 'No friends match your search.'}
            </p>
          ) : (
            filteredFriends.map((friend) => (
              <FriendRow
                key={friend.friend_id}
                avatar={
                  <Avatar
                    src={friend.avatar_url}
                    fallback={friend.nickname}
                    size="md"
                    status={friend.status}
                  />
                }
                name={friend.nickname}
                handle={friend.username}
                status={friend.status}
                right={
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => navigate(`/home/chat/${friend.friend_id}`)}
                      className="h-7"
                    >
                      <MessageCircle size={14} strokeWidth={1.75} />
                      Message
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton onClick={() => {}} title="More">
                          <MoreVertical size={16} strokeWidth={1.75} />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleCopyUsername(friend.username)}>
                          <Copy size={14} strokeWidth={1.75} />
                          <span>Copy username</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setFriendToRemove(friend)}
                          variant="destructive"
                        >
                          <UserMinus size={14} strokeWidth={1.75} />
                          <span>Remove friend</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add-friend dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => {
        setAddOpen(open)
        if (!open) {
          setAddUsername('')
          setAddError(null)
          setAddSuccess(null)
        }
      }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add friend</DialogTitle>
            <DialogDescription>
              Send a friend request by username. Requests must be accepted before messaging.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-fg-muted">Username</span>
              <input
                type="text"
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendFriendRequest()}
                placeholder="@username"
                disabled={addLoading}
                className={cn(
                  'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-fg placeholder:text-fg-dim',
                  'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
                )}
              />
            </label>
            {addError && <p className="text-[12.5px] text-[var(--danger)]">{addError}</p>}
            {addSuccess && <p className="text-[12.5px] text-[var(--ok)]">{addSuccess}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleSendFriendRequest}
              disabled={addLoading || !addUsername.trim()}
              className="bg-[var(--brand)] text-[var(--brand-fg)] hover:opacity-90"
            >
              {addLoading ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove-friend confirmation */}
      <Dialog
        open={!!friendToRemove}
        onOpenChange={(open) => !open && setFriendToRemove(null)}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Remove friend?</DialogTitle>
            <DialogDescription>
              Remove <strong className="text-fg">{friendToRemove?.nickname}</strong> (<span className="font-mono">@{friendToRemove?.username}</span>) from your friends? You can send a new friend request later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFriendToRemove(null)} disabled={removeLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveFriend} disabled={removeLoading}>
              {removeLoading ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
