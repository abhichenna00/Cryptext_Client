import { Phone, PhoneOff, Video } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useCall } from '@/contexts/CallContext'

interface IncomingCallModalProps {
  vaultReady: boolean
}

export default function IncomingCallModal({ vaultReady }: IncomingCallModalProps) {
  const { snapshot, acceptCall, declineCall } = useCall()
  const open = snapshot.status === 'incoming-ringing'
  const Icon = snapshot.mode === 'video' ? Video : Phone

  const handleAccept = () => {
    acceptCall().catch((err) => console.error('[call] acceptCall failed:', err))
  }

  const handleDecline = () => {
    declineCall().catch((err) => console.error('[call] declineCall failed:', err))
  }

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="grid w-[360px] gap-4 p-6 text-center"
      >
        <div className="grid place-items-center">
          <div className="grid size-16 place-items-center rounded-full bg-surface-2 text-fg">
            <Icon size={28} strokeWidth={1.75} />
          </div>
        </div>
        <div>
          <DialogTitle className="text-[15px] font-semibold tracking-[-0.005em] text-fg">
            Incoming {snapshot.mode} call
          </DialogTitle>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            {vaultReady
              ? `From ${snapshot.peerUserId || 'someone'}.`
              : 'Local storage is locked — sign in to accept.'}
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={handleDecline}
            className="flex h-10 items-center gap-2 rounded-md bg-[var(--danger)] px-4 text-[13px] font-medium text-white hover:opacity-90"
          >
            <PhoneOff size={16} strokeWidth={1.75} />
            Decline
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={!vaultReady}
            className="flex h-10 items-center gap-2 rounded-md bg-[var(--ok)] px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Phone size={16} strokeWidth={1.75} />
            Accept
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
