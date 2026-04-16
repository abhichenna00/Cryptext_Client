import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { ScrollArea } from './ui/scroll-area'
import { Check } from 'lucide-react'
import Avatar from './Avatar'

interface FriendWithProfile {
  friend_id: string
  username: string
  nickname: string
  avatar_url?: string | null
  status?: string | null
}

interface GroupResult {
  success: boolean
  conversation_id: string | null
  error: string | null
}

interface CreateGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (conversationId: string) => void
}

export default function CreateGroupDialog({ open, onOpenChange, onCreated }: CreateGroupDialogProps) {
  const [friends, setFriends] = useState<FriendWithProfile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [groupName, setGroupName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelectedIds(new Set())
    setGroupName('')
    setError(null)
    const load = async () => {
      try {
        const data = await invoke<FriendWithProfile[]>('get_friends')
        setFriends(data)
      } catch (err) {
        console.error('Failed to load friends:', err)
      }
    }
    load()
  }, [open])

  const toggleFriend = (friendId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(friendId)) next.delete(friendId)
      else next.add(friendId)
      return next
    })
  }

  const handleCreate = async () => {
    if (!groupName.trim()) {
      setError('Group name is required')
      return
    }
    if (selectedIds.size < 1) {
      setError('Select at least one friend')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const result = await invoke<GroupResult>('create_group', {
        name: groupName.trim(),
        memberIds: Array.from(selectedIds),
      })

      if (result.success && result.conversation_id) {
        onCreated?.(result.conversation_id)
        onOpenChange(false)
      } else {
        setError(result.error || 'Failed to create group')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New Group</DialogTitle>
          <DialogDescription>
            Name your group and select friends to add.
          </DialogDescription>
        </DialogHeader>

        <div className="create-group-content">
          <Input
            placeholder="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            disabled={creating}
          />

          <div className="create-group-label">
            Friends ({selectedIds.size} selected)
          </div>

          <ScrollArea className="create-group-friends-list">
            {friends.map((friend) => {
              const selected = selectedIds.has(friend.friend_id)
              return (
                <button
                  key={friend.friend_id}
                  className={`create-group-friend-row ${selected ? 'selected' : ''}`}
                  onClick={() => toggleFriend(friend.friend_id)}
                  disabled={creating}
                >
                  <Avatar
                    src={friend.avatar_url}
                    fallback={friend.nickname}
                    size="sm"
                    status={friend.status}
                    showStatus
                  />
                  <span className="create-group-friend-name">{friend.nickname}</span>
                  {selected && <Check size={16} className="create-group-check" />}
                </button>
              )
            })}
            {friends.length === 0 && (
              <p className="create-group-empty">No friends to add.</p>
            )}
          </ScrollArea>

          {error && <p className="create-group-error">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !groupName.trim() || selectedIds.size < 1}>
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
