import { Phone, Video } from 'lucide-react'

import { useCall } from '@/contexts/CallContext'
import type { CallMode } from '@/lib/calls/types'
import { cn } from '@/lib/utils'

interface CallButtonProps {
  conversationId: string
  peerUserId: string
  mode?: CallMode
  title?: string
}

/** Toolbar button that starts an audio or video call. Disabled while any call
 *  is already in progress. */
export default function CallButton({
  conversationId,
  peerUserId,
  mode = 'audio',
  title,
}: CallButtonProps) {
  const { snapshot, startCall } = useCall()
  const busy = snapshot.status !== 'idle'
  const Icon = mode === 'video' ? Video : Phone

  const handleClick = () => {
    if (busy) return
    startCall(conversationId, peerUserId, mode).catch((err) => {
      console.error('[call] startCall failed:', err)
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={title ?? (mode === 'video' ? 'Start video call' : 'Start audio call')}
      className={cn(
        'grid size-7 place-items-center rounded-md text-fg-muted transition-colors',
        'hover:bg-surface-2 hover:text-fg',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted',
      )}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  )
}
