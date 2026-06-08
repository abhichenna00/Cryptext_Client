// src/contexts/CallContext.tsx
//
// React bridge for voice/video calls. Owns the CallManager lifecycle and wires
// it to the shared WebSocket (for signaling) and a MediaStreamManager (for
// mic/camera). The manager's call state is exposed to React as an immutable
// snapshot via useSyncExternalStore, and call actions (start/accept/end,
// toggle mic/camera) are surfaced through the useCall() hook.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { invoke } from '@tauri-apps/api/core'

import { CallManager } from '@/lib/calls/CallManager'
import { MediaStreamManager } from '@/lib/calls/MediaStreamManager'
import { WebSocketCallSignaling } from '@/lib/calls/WebSocketCallSignaling'
import type { CallConfig, CallMode, CallSnapshot } from '@/lib/calls/types'

import { useWebSocketContext } from './WebSocketContext'

// STUN-only fallback, used when the server's /config/ice-servers endpoint
// (which mints short-lived TURN credentials) is unreachable. Keeps same-network
// and cone-NAT calls working; symmetric-NAT calls need the server-fetched TURN
// relay. Two different-provider STUN servers are kept for resilience.
const DEFAULT_CONFIG: CallConfig = Object.freeze({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  ringTimeoutMs: 30_000,
})

const IDLE_SNAPSHOT: CallSnapshot = Object.freeze({
  status: 'idle',
  mode: 'audio',
  conversationId: null,
  conversationType: 'dm',
  error: null,
  participants: Object.freeze([]),
  callStartedAt: null,
  localAudioAvailable: false,
  localVideoAvailable: false,
})

export type CallDisplayMode = 'floating' | 'expanded'

interface CallContextValue {
  snapshot: CallSnapshot
  startCall: (conversationId: string, peerUserId: string, mode: CallMode) => Promise<void>
  acceptCall: () => Promise<void>
  declineCall: () => Promise<void>
  endCall: () => Promise<void>
  toggleMic: () => void
  toggleCamera: () => void
  getLocalStream: () => MediaStream | null
  getRemoteStream: () => MediaStream | null
  displayMode: CallDisplayMode
  setDisplayMode: (mode: CallDisplayMode) => void
}

const CallContext = createContext<CallContextValue | null>(null)

function noManager(): Promise<never> {
  return Promise.reject(new Error('Call manager not ready'))
}

/** Fetch fresh ICE servers (STUN + short-lived TURN credentials) from the
 *  backend. Falls back to the bundled STUN servers if the request fails, so
 *  same-network calls still work. */
async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const servers = await invoke<RTCIceServer[]>('get_ice_servers')
    if (Array.isArray(servers) && servers.length > 0) return servers
  } catch (err) {
    console.warn('[call] get_ice_servers failed; using STUN fallback:', err)
  }
  return [...DEFAULT_CONFIG.iceServers]
}

/**
 * Constructs the CallManager (plus its signaling + media managers) once the
 * WebSocket is available, tears them down on unmount, and provides call state
 * and actions to the tree. ICE servers (STUN + short-lived TURN) are fetched
 * fresh on each start/accept so TURN credentials never go stale mid-session.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocketContext()
  const managerRef = useRef<CallManager | null>(null)
  const snapshotRef = useRef<CallSnapshot>(IDLE_SNAPSHOT)
  const reactSubscribersRef = useRef<Set<() => void>>(new Set())
  const [displayMode, setDisplayMode] = useState<CallDisplayMode>('floating')

  useEffect(() => {
    const media = new MediaStreamManager()
    const signaling = new WebSocketCallSignaling({
      sendMessage: (frame) => ws.sendMessage(frame),
      subscribe: (cb) => ws.subscribe((data) => cb(data as { action: string; [k: string]: unknown })),
    })
    const manager = new CallManager(signaling, media, DEFAULT_CONFIG)
    snapshotRef.current = manager.state
    managerRef.current = manager

    const unsub = manager.subscribe((snap) => {
      snapshotRef.current = snap
      for (const cb of reactSubscribersRef.current) cb()
    })
    for (const cb of reactSubscribersRef.current) cb()

    return () => {
      unsub()
      signaling.dispose()
      media.dispose()
      managerRef.current = null
      snapshotRef.current = IDLE_SNAPSHOT
      for (const cb of reactSubscribersRef.current) cb()
    }
  }, [ws.sendMessage, ws.subscribe])

  const externalSubscribe = useCallback((cb: () => void) => {
    reactSubscribersRef.current.add(cb)
    return () => {
      reactSubscribersRef.current.delete(cb)
    }
  }, [])

  const getSnapshot = useCallback(() => snapshotRef.current, [])

  const snapshot = useSyncExternalStore(externalSubscribe, getSnapshot, getSnapshot)

  // Reset display mode to 'floating' whenever a call ends or none is in flight.
  useEffect(() => {
    if (snapshot.status === 'idle' || snapshot.status === 'ended') {
      setDisplayMode('floating')
    }
  }, [snapshot.status])

  const value = useMemo<CallContextValue>(
    () => ({
      snapshot,
      startCall: async (cid, pid, m) => {
        const mgr = managerRef.current
        if (!mgr) return noManager()
        mgr.setIceServers(await fetchIceServers())
        return mgr.startCall(cid, pid, m)
      },
      acceptCall: async () => {
        const mgr = managerRef.current
        if (!mgr) return noManager()
        mgr.setIceServers(await fetchIceServers())
        return mgr.acceptCall()
      },
      declineCall: () => managerRef.current?.declineCall() ?? noManager(),
      endCall: () => managerRef.current?.endCall() ?? noManager(),
      toggleMic: () => managerRef.current?.toggleMic(),
      toggleCamera: () => managerRef.current?.toggleCamera(),
      getLocalStream: () => managerRef.current?.getLocalStream() ?? null,
      getRemoteStream: () => managerRef.current?.getRemoteStream() ?? null,
      displayMode,
      setDisplayMode,
    }),
    [snapshot, displayMode],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used inside <CallProvider>')
  return ctx
}
