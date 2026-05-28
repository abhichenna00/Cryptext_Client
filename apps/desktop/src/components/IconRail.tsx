import { MessageSquare, Users, Sun, Moon, Settings, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export type IconRailView = 'dm' | 'friends'

interface IconRailProps {
  view: IconRailView
  theme: 'light' | 'dark'
  onSelectDM: () => void
  onSelectFriends: () => void
  onToggleTheme: () => void
  onOpenSettings: () => void
  onSignOut: () => void
}

function RailButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'grid size-9 place-items-center rounded-md text-fg-muted transition-colors',
        'hover:bg-surface hover:text-fg',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
        active && 'bg-surface-2 text-fg',
      )}
    >
      {children}
    </button>
  )
}

export default function IconRail({
  view,
  theme,
  onSelectDM,
  onSelectFriends,
  onToggleTheme,
  onOpenSettings,
  onSignOut,
}: IconRailProps) {
  return (
    <aside className="flex w-[52px] flex-col items-center gap-2 border-r border-border bg-chrome px-2 py-3 text-chrome-fg">
      <img
        src="/nshroud-mark.svg"
        alt=""
        title="NShroud"
        className="size-7"
      />

      <div className="mt-2 flex flex-col gap-1">
        <RailButton active={view === 'dm'} title="Messages" onClick={onSelectDM}>
          <MessageSquare size={18} strokeWidth={1.75} />
        </RailButton>
        <RailButton active={view === 'friends'} title="Friends" onClick={onSelectFriends}>
          <Users size={18} strokeWidth={1.75} />
        </RailButton>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-1">
        <RailButton
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </RailButton>
        <RailButton title="Profile settings" onClick={onOpenSettings}>
          <Settings size={18} strokeWidth={1.75} />
        </RailButton>
        <RailButton title="Sign out" onClick={onSignOut}>
          <LogOut size={18} strokeWidth={1.75} />
        </RailButton>
      </div>
    </aside>
  )
}
