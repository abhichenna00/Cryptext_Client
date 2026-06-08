// src/components/calls/InCallView.tsx
//
// Full-screen ("expanded") call UI: the remote participant grid, a draggable
// self picture-in-picture tile, call duration, and mic/camera/hang-up/minimize
// controls. Reads everything from CallContext and renders only while a call is
// in the expanded display mode; the compact floating view is FloatingCallWindow.

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Minimize2, PhoneOff, Video, VideoOff } from 'lucide-react'

import Avatar from '@/components/Avatar'
import { useCall } from '@/contexts/CallContext'
import { useAudioLevel, useCallDuration, useCallParticipants, type EnrichedParticipant } from '@/hooks'
import { cn } from '@/lib/utils'

type PipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const PIP_STORAGE_KEY = 'nshroud-call-pip-corner'
const PIP_MARGIN = 16
const PIP_WIDTH = 180
const PIP_HEIGHT = 120

function readStoredPipCorner(): PipCorner {
  try {
    const v = localStorage.getItem(PIP_STORAGE_KEY)
    if (v === 'top-left' || v === 'top-right' || v === 'bottom-left' || v === 'bottom-right') {
      return v
    }
  } catch {
    // localStorage unavailable; default below
  }
  return 'bottom-right'
}

function persistPipCorner(c: PipCorner): void {
  try {
    localStorage.setItem(PIP_STORAGE_KEY, c)
  } catch {
    // ignored
  }
}

function gridClass(remoteCount: number): string {
  if (remoteCount <= 1) return 'grid grid-cols-1 grid-rows-1'
  if (remoteCount === 2) return 'grid grid-cols-2 grid-rows-1'
  if (remoteCount <= 4) return 'grid grid-cols-2 grid-rows-2'
  // Adaptive 5+: aim for roughly square layout.
  const cols = Math.ceil(Math.sqrt(remoteCount))
  return `grid grid-cols-${cols}`
}

function gridStyle(remoteCount: number): React.CSSProperties | undefined {
  if (remoteCount <= 4) return undefined
  const cols = Math.ceil(Math.sqrt(remoteCount))
  const rows = Math.ceil(remoteCount / cols)
  return {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  }
}

interface RemoteTileProps {
  participant: EnrichedParticipant
  videoStream: MediaStream | null
  showVideo: boolean
}

function RemoteTile({ participant, videoStream, showVideo }: RemoteTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioOnlyLevel = useAudioLevel(showVideo ? null : videoStream)

  useEffect(() => {
    if (!showVideo) return
    if (videoRef.current) {
      videoRef.current.srcObject = videoStream
    }
  }, [videoStream, showVideo])

  const ringScale = 1 + Math.min(audioOnlyLevel * 0.5, 0.5)

  return (
    <div className="relative overflow-hidden bg-black">
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <div className="relative grid place-items-center">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-[var(--ok)]/30"
              style={{ transform: `scale(${ringScale})`, opacity: 0.6 }}
            />
            <div className="relative">
              <Avatar
                src={participant.avatarUrl}
                fallback={participant.nickname ?? participant.userId ?? '?'}
                size="xl"
              />
            </div>
          </div>
        </div>
      )}
      <div className="absolute right-0 bottom-0 left-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-[12.5px]">
        <span className="truncate font-medium">
          {participant.nickname ?? participant.userId ?? 'Unknown'}
        </span>
        {!participant.micEnabled && <MicOff size={14} className="text-[var(--danger)]" />}
      </div>
    </div>
  )
}

export default function InCallView() {
  const {
    snapshot,
    displayMode,
    setDisplayMode,
    endCall,
    toggleMic,
    toggleCamera,
    getLocalStream,
    getRemoteStream,
  } = useCall()
  const participants = useCallParticipants()
  const duration = useCallDuration()

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const [pipCorner, setPipCorner] = useState<PipCorner>(() => readStoredPipCorner())
  const [pipPos, setPipPos] = useState<{ left: number; top: number } | null>(null)
  const [pipDragging, setPipDragging] = useState(false)
  const pipOffsetRef = useRef<{ dx: number; dy: number } | null>(null)

  const visible =
    displayMode === 'expanded' &&
    (snapshot.status === 'outgoing-ringing' ||
      snapshot.status === 'connecting' ||
      snapshot.status === 'in-call')

  const isVideo = snapshot.mode === 'video'
  const remoteParticipants = participants.filter((p) => !p.isSelf)
  const selfParticipant = participants.find((p) => p.isSelf)
  const remoteStream = visible ? getRemoteStream() : null
  const selfStream = visible ? getLocalStream() : null
  const selfAudioLevel = useAudioLevel(
    !isVideo && selfParticipant?.micEnabled ? selfStream : null,
  )

  useEffect(() => {
    if (!visible) return
    if (isVideo && localVideoRef.current) {
      localVideoRef.current.srcObject = selfStream
    }
  }, [visible, isVideo, snapshot.status, selfStream])

  // Position the self PiP at the stored corner once mounted, and on resize.
  useEffect(() => {
    if (!visible || !isVideo) return
    const setFromCorner = () => {
      const left =
        pipCorner === 'top-left' || pipCorner === 'bottom-left'
          ? PIP_MARGIN
          : window.innerWidth - PIP_WIDTH - PIP_MARGIN
      const top =
        pipCorner === 'top-left' || pipCorner === 'top-right'
          ? PIP_MARGIN + 60
          : window.innerHeight - PIP_HEIGHT - PIP_MARGIN - 80
      setPipPos({ left, top })
    }
    setFromCorner()
    window.addEventListener('resize', setFromCorner)
    return () => window.removeEventListener('resize', setFromCorner)
  }, [visible, isVideo, pipCorner])

  if (!visible) return null

  const statusLabel =
    snapshot.status === 'outgoing-ringing'
      ? 'Ringing…'
      : snapshot.status === 'connecting'
        ? 'Connecting…'
        : 'In call'

  const headerName =
    snapshot.conversationType === 'group'
      ? `Group call · ${remoteParticipants.length + 1} people`
      : remoteParticipants[0]?.nickname ?? remoteParticipants[0]?.userId ?? 'Unknown'

  const micOn = selfParticipant?.micEnabled ?? true
  const camOn = selfParticipant?.cameraEnabled ?? true
  const micAvailable = snapshot.localAudioAvailable
  const camAvailable = snapshot.localVideoAvailable

  const handleEnd = () => {
    endCall().catch((err) => console.error('[call] endCall failed:', err))
  }
  const handleMinimize = () => setDisplayMode('floating')

  const handlePipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pipPos) return
    pipOffsetRef.current = { dx: e.clientX - pipPos.left, dy: e.clientY - pipPos.top }
    setPipDragging(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const handlePipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pipDragging || !pipOffsetRef.current) return
    setPipPos({
      left: e.clientX - pipOffsetRef.current.dx,
      top: e.clientY - pipOffsetRef.current.dy,
    })
  }
  const handlePipPointerUp = () => {
    if (!pipDragging || !pipPos) return
    setPipDragging(false)
    pipOffsetRef.current = null
    const left = pipPos.left < window.innerWidth / 2
    const top = pipPos.top + PIP_HEIGHT / 2 < window.innerHeight / 2
    const next: PipCorner = top
      ? left
        ? 'top-left'
        : 'top-right'
      : left
        ? 'bottom-left'
        : 'bottom-right'
    setPipCorner(next)
    persistPipCorner(next)
  }

  const micRingScale = 1 + Math.min(selfAudioLevel * 0.6, 0.6)

  return (
    <div className="fixed inset-0 z-[60] grid grid-rows-[auto_1fr_auto] bg-black text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="truncate text-[14px] font-semibold">{headerName}</div>
          {duration && (
            <div className="font-mono text-[12px] text-white/70">{duration}</div>
          )}
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] uppercase text-white/80">
            {statusLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={handleMinimize}
          className="grid size-8 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Minimize"
        >
          <Minimize2 size={14} />
        </button>
      </div>

      <div className="relative">
        {snapshot.error && (
          <div className="absolute top-4 left-1/2 z-10 mx-auto max-w-md -translate-x-1/2 rounded-md bg-[var(--danger)]/90 px-3 py-1.5 text-center text-[12.5px]">
            {snapshot.error}
          </div>
        )}

        <div
          className={cn('h-full w-full gap-1', gridClass(remoteParticipants.length))}
          style={gridStyle(remoteParticipants.length)}
        >
          {remoteParticipants.map((p) => (
            <RemoteTile
              key={p.userId}
              participant={p}
              videoStream={remoteStream}
              showVideo={isVideo && (remoteStream?.getVideoTracks().length ?? 0) > 0}
            />
          ))}
        </div>

        {isVideo && pipPos && selfParticipant && (
          <div
            onPointerDown={handlePipPointerDown}
            onPointerMove={handlePipPointerMove}
            onPointerUp={handlePipPointerUp}
            onPointerCancel={handlePipPointerUp}
            style={{
              position: 'fixed',
              left: pipPos.left,
              top: pipPos.top,
              width: PIP_WIDTH,
              height: PIP_HEIGHT,
              cursor: pipDragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
            className="overflow-hidden rounded-md border border-white/20 bg-black shadow"
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 bg-black/70 py-4">
        <div className="relative grid place-items-center">
          {!isVideo && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-[var(--ok)]/40"
              style={{
                transform: `scale(${micOn ? micRingScale : 1})`,
                opacity: micOn ? 0.45 : 0,
              }}
            />
          )}
          <button
            type="button"
            onClick={toggleMic}
            disabled={!micAvailable}
            className={cn(
              'relative grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/15',
              !micOn && 'bg-[var(--danger)]/80 hover:bg-[var(--danger)]',
              'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10',
            )}
            title={!micAvailable ? 'No microphone' : micOn ? 'Mute mic' : 'Unmute mic'}
          >
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
        </div>
        {isVideo && (
          <button
            type="button"
            onClick={toggleCamera}
            disabled={!camAvailable}
            className={cn(
              'grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/15',
              !camOn && 'bg-[var(--danger)]/80 hover:bg-[var(--danger)]',
              'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10',
            )}
            title={!camAvailable ? 'No camera' : camOn ? 'Turn off camera' : 'Turn on camera'}
          >
            {camOn ? <Video size={18} /> : <VideoOff size={18} />}
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
