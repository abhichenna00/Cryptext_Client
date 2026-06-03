import { useEffect, useRef, useState } from 'react'
import { Maximize2, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'

import Avatar from '@/components/Avatar'
import { useCall } from '@/contexts/CallContext'
import { useAudioLevel, useCallDuration, useCallParticipants } from '@/hooks'
import { cn } from '@/lib/utils'

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const STORAGE_KEY = 'nshroud-call-window-corner'
const EDGE_MARGIN = 16

function readStoredCorner(): Corner {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'top-left' || v === 'top-right' || v === 'bottom-left' || v === 'bottom-right') {
      return v
    }
  } catch {
    // localStorage can throw in private mode; default below is safe
  }
  return 'bottom-right'
}

function persistCorner(c: Corner): void {
  try {
    localStorage.setItem(STORAGE_KEY, c)
  } catch {
    // ignored: storage unavailable
  }
}

function nearestCorner(x: number, y: number, w: number, h: number): Corner {
  const left = x + w / 2 < window.innerWidth / 2
  const top = y + h / 2 < window.innerHeight / 2
  if (top && left) return 'top-left'
  if (top && !left) return 'top-right'
  if (!top && left) return 'bottom-left'
  return 'bottom-right'
}

function cornerPosition(c: Corner, w: number, h: number): { left: number; top: number } {
  switch (c) {
    case 'top-left':
      return { left: EDGE_MARGIN, top: EDGE_MARGIN }
    case 'top-right':
      return { left: window.innerWidth - w - EDGE_MARGIN, top: EDGE_MARGIN }
    case 'bottom-left':
      return { left: EDGE_MARGIN, top: window.innerHeight - h - EDGE_MARGIN }
    case 'bottom-right':
      return {
        left: window.innerWidth - w - EDGE_MARGIN,
        top: window.innerHeight - h - EDGE_MARGIN,
      }
  }
}

export default function FloatingCallWindow() {
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

  const visible =
    displayMode === 'floating' &&
    (snapshot.status === 'outgoing-ringing' ||
      snapshot.status === 'connecting' ||
      snapshot.status === 'in-call')

  const isVideo = snapshot.mode === 'video'
  const width = isVideo ? 320 : 280
  const height = isVideo ? 240 : 80

  const [corner, setCorner] = useState<Corner>(() => readStoredCorner())
  const [pos, setPos] = useState(() => cornerPosition(readStoredCorner(), 280, 80))
  const [dragging, setDragging] = useState(false)
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  // Snap to the current corner whenever the window resizes or the dimensions
  // change (audio <-> video swap).
  useEffect(() => {
    if (!visible) return
    setPos(cornerPosition(corner, width, height))
    const onResize = () => setPos(cornerPosition(corner, width, height))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [visible, corner, width, height])

  useEffect(() => {
    if (!visible) return
    if (isVideo && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = getRemoteStream()
    }
  }, [visible, isVideo, snapshot.status, getRemoteStream])

  const selfParticipant = participants.find((p) => p.isSelf)
  const peerParticipant = participants.find((p) => !p.isSelf)
  const selfStream = visible ? getLocalStream() : null
  const selfAudioLevel = useAudioLevel(selfParticipant?.micEnabled ? selfStream : null)

  // A failed call lands in `error`, which no active-call view renders. Surface a
  // dismissible card so the user gets feedback and `endCall()` can reset the
  // machine to idle — otherwise the call buttons stay disabled indefinitely.
  if (snapshot.status === 'error') {
    const failedPeer = peerParticipant?.nickname ?? peerParticipant?.userId ?? 'the other person'
    return (
      <div
        role="alert"
        style={{ position: 'fixed', right: EDGE_MARGIN, bottom: EDGE_MARGIN, width: 280, zIndex: 50 }}
        className="overflow-hidden rounded-lg border border-[var(--danger)]/40 bg-black text-white shadow-lg"
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--danger)]/20 text-[var(--danger)]">
            <PhoneOff size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">Call failed</div>
            <div className="truncate text-[11px] text-white/60">
              {snapshot.error ?? `Couldn’t connect to ${failedPeer}`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => endCall().catch((err) => console.error('[call] endCall failed:', err))}
            className="rounded-md px-2 py-1 text-[12px] font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  if (!visible) return null

  const statusLabel =
    snapshot.status === 'outgoing-ringing'
      ? 'Ringing…'
      : snapshot.status === 'connecting'
        ? 'Connecting…'
        : null

  const peerName = peerParticipant?.nickname ?? peerParticipant?.userId ?? 'Unknown'
  const micOn = selfParticipant?.micEnabled ?? true
  const camOn = selfParticipant?.cameraEnabled ?? true
  const micAvailable = snapshot.localAudioAvailable
  const camAvailable = snapshot.localVideoAvailable

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    dragOffsetRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragOffsetRef.current) return
    setPos({
      left: e.clientX - dragOffsetRef.current.dx,
      top: e.clientY - dragOffsetRef.current.dy,
    })
  }

  const handlePointerUp = () => {
    if (!dragging) return
    setDragging(false)
    dragOffsetRef.current = null
    const next = nearestCorner(pos.left, pos.top, width, height)
    setCorner(next)
    persistCorner(next)
    setPos(cornerPosition(next, width, height))
  }

  const handleExpand = () => setDisplayMode('expanded')
  const handleEnd = () => {
    endCall().catch((err) => console.error('[call] endCall failed:', err))
  }

  const micRingScale = 1 + Math.min(selfAudioLevel * 0.6, 0.6)

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width,
        height,
        zIndex: 50,
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      className="overflow-hidden rounded-lg border border-white/10 bg-black text-white shadow-lg select-none"
    >
      {isVideo ? (
        <div className="group relative h-full w-full">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
          {statusLabel && (
            <div className="absolute inset-0 grid place-items-center bg-black/40 font-mono text-[11px] tracking-[0.08em] uppercase">
              {statusLabel}
            </div>
          )}
          <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center gap-2 bg-black/60 px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={toggleMic}
              disabled={!micAvailable}
              className={cn(
                'grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20',
                !micOn && 'bg-[var(--danger)]/80 hover:bg-[var(--danger)]',
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10',
              )}
              title={!micAvailable ? 'No microphone' : micOn ? 'Mute mic' : 'Unmute mic'}
            >
              {micOn ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
            <button
              type="button"
              onClick={toggleCamera}
              disabled={!camAvailable}
              className={cn(
                'grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20',
                !camOn && 'bg-[var(--danger)]/80 hover:bg-[var(--danger)]',
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10',
              )}
              title={!camAvailable ? 'No camera' : camOn ? 'Turn off camera' : 'Turn on camera'}
            >
              {camOn ? <Video size={14} /> : <VideoOff size={14} />}
            </button>
            <button
              type="button"
              onClick={handleEnd}
              className="grid size-8 place-items-center rounded-full bg-[var(--danger)] hover:opacity-90"
              title="Hang up"
            >
              <PhoneOff size={14} />
            </button>
            <button
              type="button"
              onClick={handleExpand}
              className="grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              title="Expand"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center gap-3 px-3 py-2">
          <div className="relative">
            <Avatar
              src={peerParticipant?.avatarUrl}
              fallback={peerParticipant?.nickname ?? peerParticipant?.userId ?? '?'}
              size="md"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{peerName}</div>
            <div className="font-mono text-[11px] tracking-[0.04em] text-white/70">
              {statusLabel ?? duration ?? '00:00'}
            </div>
          </div>
          <div className="relative grid place-items-center">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-[var(--ok)]/40 transition-transform"
              style={{
                transform: `scale(${micOn ? micRingScale : 1})`,
                opacity: micOn ? 0.45 : 0,
              }}
            />
            <button
              type="button"
              onClick={toggleMic}
              disabled={!micAvailable}
              className={cn(
                'relative grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20',
                !micOn && 'bg-[var(--danger)]/80 hover:bg-[var(--danger)]',
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10',
              )}
              title={!micAvailable ? 'No microphone' : micOn ? 'Mute mic' : 'Unmute mic'}
            >
              {micOn ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
          </div>
          <button
            type="button"
            onClick={handleEnd}
            className="grid size-8 place-items-center rounded-full bg-[var(--danger)] hover:opacity-90"
            title="Hang up"
          >
            <PhoneOff size={14} />
          </button>
          <button
            type="button"
            onClick={handleExpand}
            className="grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20"
            title="Expand"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
