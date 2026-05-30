import { useEffect, useRef } from 'react'
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'

import { useCall } from '@/contexts/CallContext'
import { cn } from '@/lib/utils'

export default function InCallView() {
  const {
    snapshot,
    endCall,
    toggleMic,
    toggleCamera,
    getLocalStream,
    getRemoteStream,
  } = useCall()

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  const visible =
    snapshot.status === 'outgoing-ringing' ||
    snapshot.status === 'connecting' ||
    snapshot.status === 'in-call'

  useEffect(() => {
    if (!visible) return
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = getLocalStream()
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = getRemoteStream()
    }
  }, [visible, snapshot.status, getLocalStream, getRemoteStream])

  if (!visible) return null

  const isVideo = snapshot.mode === 'video'
  const statusLabel =
    snapshot.status === 'outgoing-ringing'
      ? 'Ringing…'
      : snapshot.status === 'connecting'
        ? 'Connecting…'
        : 'In call'

  const handleEnd = () => {
    endCall().catch((err) => console.error('[call] endCall failed:', err))
  }

  return (
    <div className="fixed inset-0 z-[60] grid grid-rows-[1fr_auto] bg-black text-white">
      <div className="relative">
        {isVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center">
            <div className="text-center">
              <div className="font-mono text-[11px] tracking-[0.08em] uppercase opacity-70">
                {statusLabel}
              </div>
              <div className="mt-2 text-[18px] font-semibold">
                {snapshot.peerUserId || 'Unknown'}
              </div>
            </div>
          </div>
        )}

        {isVideo && (
          <div className="absolute right-4 bottom-4 aspect-video w-40 overflow-hidden rounded-md border border-white/20 bg-black">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="absolute top-4 left-4 rounded-full bg-black/40 px-3 py-1 font-mono text-[11px] tracking-[0.04em] uppercase">
          {statusLabel}
        </div>

        {snapshot.error && (
          <div className="absolute top-4 right-4 rounded-md bg-[var(--danger)]/90 px-3 py-1.5 text-[12.5px]">
            {snapshot.error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 bg-black/70 py-4">
        <button
          type="button"
          onClick={toggleMic}
          className={cn(
            'grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/15',
            !snapshot.micEnabled && 'bg-[var(--danger)]/80 hover:bg-[var(--danger)]',
          )}
          title={snapshot.micEnabled ? 'Mute mic' : 'Unmute mic'}
        >
          {snapshot.micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        {isVideo && (
          <button
            type="button"
            onClick={toggleCamera}
            className={cn(
              'grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/15',
              !snapshot.cameraEnabled && 'bg-[var(--danger)]/80 hover:bg-[var(--danger)]',
            )}
            title={snapshot.cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {snapshot.cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
          </button>
        )}
        <button
          type="button"
          onClick={handleEnd}
          className="grid size-11 place-items-center rounded-full bg-[var(--danger)] text-white transition-opacity hover:opacity-90"
          title="Hang up"
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  )
}
