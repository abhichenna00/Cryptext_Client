import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useLocation, useNavigate, useParams, Outlet } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'

import Avatar from '@/components/Avatar'
import IconRail, { IconRailView } from '@/components/IconRail'
import EditProfileDialog from '@/components/EditProfileDialog'
import CreateGroupDialog from '@/components/CreateGroupDialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { STATUS_LABELS, Status } from '@/constants/status'
import { useLiveConversationList, useTheme, type ConversationWithDetails } from '@/hooks'
import { cn } from '@/lib/utils'

interface HomePageProps {
  onSignOut: () => void
}

interface ProfileData {
  user_id: string
  username?: string
  nickname: string
  avatar_url: string | null
  status: string | null
}

function conversationDisplayName(c: ConversationWithDetails): string {
  return c.other_user_nickname || c.name || 'Unknown'
}

/** Sidebar preview text — media messages carry JSON in `content`, so we
 *  render just the file name (e.g. `vacation.jpg`) instead of the raw
 *  metadata blob. */
function conversationPreview(c: ConversationWithDetails): string {
  if (!c.last_message) return 'No messages yet'
  if (c.last_message_content_type === 'media') {
    try {
      const meta = JSON.parse(c.last_message)
      return meta.file_name || 'Attachment'
    } catch {
      return 'Attachment'
    }
  }
  return c.last_message
}

/** Stable hue (0–360) keyed by id so each conversation gets a consistent tint. */
function hashHue(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

export default function HomePage({ onSignOut }: HomePageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { friendId: activeFriendId } = useParams<{ friendId: string }>()
  const { theme, toggle: toggleTheme } = useTheme()

  const { conversations: recentChats, loading: conversationsLoading, refresh: refreshConversations } =
    useLiveConversationList()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [query, setQuery] = useState('')

  const loading = conversationsLoading || profileLoading

  const refreshProfile = async () => {
    try {
      setProfile(await invoke<ProfileData | null>('get_profile'))
    } catch (err) {
      console.error('Failed to refresh profile:', err)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        setProfile(await invoke<ProfileData | null>('get_profile'))
      } catch (err) {
        console.error('Failed to load profile:', err)
      } finally {
        setProfileLoading(false)
      }
    })()
  }, [])

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

  // IconRail view state is derived from the current route. DM if we're in a
  // chat/group conversation; otherwise the default (Friends/index).
  const railView: IconRailView = useMemo(() => {
    if (location.pathname.startsWith('/home/chat/') || location.pathname.startsWith('/home/group/')) {
      return 'dm'
    }
    return 'friends'
  }, [location.pathname])

  const filteredChats = useMemo(() => {
    if (!query.trim()) return recentChats
    const q = query.trim().toLowerCase()
    return recentChats.filter((c) => conversationDisplayName(c).toLowerCase().includes(q))
  }, [recentChats, query])

  if (loading) {
    return (
      <div className="grid h-screen place-items-center bg-bg text-fg-muted">
        Loading…
      </div>
    )
  }

  return (
    <div className="grid h-screen grid-cols-[52px_280px_1fr] bg-bg text-fg">
      <IconRail
        view={railView}
        theme={theme}
        onSelectDM={() => navigate('/home')}
        onSelectFriends={() => navigate('/home')}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setEditProfileOpen(true)}
        onSignOut={onSignOut}
      />

      <aside className="flex min-h-0 flex-col border-r border-border bg-surface">
        <div className="flex h-12 items-center justify-between px-3">
          <h2 className="text-sm font-semibold text-fg">Messages</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCreateGroupOpen(true)}
            title="New conversation"
            className="size-7"
          >
            <Plus size={16} strokeWidth={1.75} />
          </Button>
        </div>

        <div className="px-3">
          <div className="relative">
            <Search
              size={14}
              strokeWidth={1.75}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-dim"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className={cn(
                'h-8 w-full rounded-md border border-border bg-surface-2 pr-2 pl-8 text-[13px] text-fg placeholder:text-fg-dim',
                'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between px-3 pb-1">
          <span className="font-mono text-[11px] tracking-[0.08em] text-fg-muted uppercase">
            Direct messages
          </span>
          <span className="font-mono text-[11px] tracking-[0.08em] text-fg-dim">
            {filteredChats.length}
          </span>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-0.5 px-2 py-1">
            {filteredChats.length === 0 ? (
              <p className="px-3 py-4 text-[13px] text-fg-dim">No conversations.</p>
            ) : (
              filteredChats.map((chat) => {
                const isActive =
                  chat.conversation_type === 'group'
                    ? location.pathname === `/home/group/${chat.conversation_id}`
                    : chat.other_user_id === activeFriendId
                const isGroup = chat.conversation_type === 'group'
                const name = conversationDisplayName(chat)
                return (
                  <button
                    key={chat.conversation_id}
                    onClick={() => handleOpenChat(chat)}
                    className={cn(
                      'group/row grid grid-cols-[28px_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      'hover:bg-surface-2',
                      isActive &&
                        'bg-surface-2 shadow-[inset_2px_0_0_var(--brand)]',
                    )}
                  >
                    {isGroup ? (
                      <div className="grid size-7 place-items-center rounded-full bg-surface-2 text-fg-muted">
                        <Users size={14} strokeWidth={1.75} />
                      </div>
                    ) : (
                      <Avatar
                        src={chat.other_user_avatar_url}
                        fallback={name}
                        size="sm"
                        status={chat.other_user_status}
                        showStatus
                        hue={hashHue(chat.conversation_id)}
                      />
                    )}
                    <div className="min-w-0">
                      <div
                        className={cn(
                          'truncate text-[13.5px] leading-tight',
                          chat.unread_count > 0 ? 'font-semibold text-fg' : 'text-fg',
                        )}
                      >
                        {name}
                      </div>
                      <div
                        className={cn(
                          'truncate text-[12px]',
                          chat.unread_count > 0 ? 'text-fg-muted' : 'text-fg-dim',
                        )}
                      >
                        {conversationPreview(chat)}
                      </div>
                    </div>
                    {chat.unread_count > 0 && (
                      <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--brand)] px-1 font-mono text-[10.5px] text-[var(--brand-fg)]">
                        {chat.unread_count > 99 ? '99+' : chat.unread_count}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>

        {profile && (
          <button
            onClick={() => setEditProfileOpen(true)}
            className={cn(
              'flex items-center gap-2 border-t border-border px-3 py-2.5 text-left transition-colors',
              'hover:bg-surface-2',
            )}
            title="Edit profile"
          >
            <Avatar
              src={profile.avatar_url}
              fallback={profile.nickname || 'U'}
              size="sm"
              status={profile.status}
              showStatus
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-fg">
                {profile.nickname || 'Unknown'}
              </div>
              <div className="truncate font-mono text-[10.5px] tracking-[0.02em] text-fg-dim">
                {STATUS_LABELS[(profile.status as Status) || 'offline']}
              </div>
            </div>
          </button>
        )}
      </aside>

      <main className="flex min-h-0 flex-col overflow-hidden bg-bg">
        <Outlet />
      </main>

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
