import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import { Input } from './ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { MessageCircle, MoreVertical, Check, X, Copy, UserMinus } from 'lucide-react'
import Avatar from './Avatar'
import { useFriendActions } from '@/hooks'

type FriendsTab = 'online' | 'all' | 'pending'

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

interface FriendResult {
  success: boolean
  error?: string
}

export default function FriendsView() {
  const navigate = useNavigate()
  const [friends, setFriends] = useState<FriendWithProfile[]>([])
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [friendsTab, setFriendsTab] = useState<FriendsTab>('all')
  const [error, setError] = useState<string | null>(null)

  const [searchUsername, setSearchUsername] = useState('')
  const [addFriendLoading, setAddFriendLoading] = useState(false)
  const [addFriendError, setAddFriendError] = useState<string | null>(null)
  const [addFriendSuccess, setAddFriendSuccess] = useState<string | null>(null)

  const [friendToRemove, setFriendToRemove] = useState<FriendWithProfile | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)

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
      if (!result.success) {
        setError(result.error || 'Failed to remove friend')
      } else {
        await loadData()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoveLoading(false)
      setFriendToRemove(null)
    }
  }

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

  return (
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
          <DialogContent>
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

      {(error || friendActionError) && <p className="home-error">{error || friendActionError}</p>}

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
                        <button className="friend-action-icon" onClick={() => navigate(`/home/chat/${friend.friend_id}`)} title="Message">
                          <MessageCircle size={18} />
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="friend-action-icon" title="More options">
                              <MoreVertical size={18} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleCopyUsername(friend.username)}>
                              <Copy size={14} />
                              <span>Copy username</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setFriendToRemove(friend)}
                              variant="destructive"
                            >
                              <UserMinus size={14} />
                              <span>Remove friend</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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

      <Dialog open={!!friendToRemove} onOpenChange={(open) => !open && setFriendToRemove(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Remove friend?</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{friendToRemove?.nickname}</strong> (@{friendToRemove?.username})
              from your friends? You can send a new friend request later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFriendToRemove(null)} disabled={removeLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveFriend} disabled={removeLoading}>
              {removeLoading ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
