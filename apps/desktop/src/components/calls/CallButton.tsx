import { Phone, Video } from 'lucide-react'

import { useCall } from '@/contexts/CallContext'
import { isCallingSupported } from '@/lib/calls/support'
import type { CallMode } from '@/lib/calls/types'
import { cn } from '@/lib/utils'

interface CallButtonProps {
  conversationId: string
  peerUserId: string
  mode?: CallMode
  title?: string
}

export default function CallButton({
  conversationId,
  peerUserId,
  mode = 'audio',
  title,
}: CallButtonProps) {
  const { snapshot, startCall } = useCall()
  const supported = isCallingSupported()
  const busy = snapshot.status !== 'idle'
  const disabled = busy || !supported
  const Icon = mode === 'video' ? Video : Phone

  const handleClick = () => {
    if (disabled) return
    startCall(conversationId, peerUserId, mode).catch((err) => {
      console.error('[call] startCall failed:', err)
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={
        !supported
          ? "Calls aren't supported on this device"
          : (title ?? (mode === 'video' ? 'Start video call' : 'Start audio call'))
      }
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
