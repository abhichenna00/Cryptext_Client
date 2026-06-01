import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { CallManager } from '@/lib/calls/CallManager'
import { MediaStreamManager } from '@/lib/calls/MediaStreamManager'
import { WebSocketCallSignaling } from '@/lib/calls/WebSocketCallSignaling'
import type { CallConfig, CallMode, CallSnapshot } from '@/lib/calls/types'

import { useWebSocketContext } from './WebSocketContext'

const DEFAULT_CONFIG: CallConfig = Object.freeze({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  ringTimeoutMs: 30_000,
})

const IDLE_SNAPSHOT: CallSnapshot = Object.freeze({
  status: 'idle',
  mode: 'audio',
  conversationId: null,
  peerUserId: null,
  error: null,
  micEnabled: true,
  cameraEnabled: true,
})

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
}

const CallContext = createContext<CallContextValue | null>(null)

function noManager(): Promise<never> {
  return Promise.reject(new Error('Call manager not ready'))
}

export function CallProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocketContext()
  const managerRef = useRef<CallManager | null>(null)
  const snapshotRef = useRef<CallSnapshot>(IDLE_SNAPSHOT)
  const reactSubscribersRef = useRef<Set<() => void>>(new Set())

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

  const value = useMemo<CallContextValue>(
    () => ({
      snapshot,
      startCall: (cid, pid, m) => managerRef.current?.startCall(cid, pid, m) ?? noManager(),
      acceptCall: () => managerRef.current?.acceptCall() ?? noManager(),
      declineCall: () => managerRef.current?.declineCall() ?? noManager(),
      endCall: () => managerRef.current?.endCall() ?? noManager(),
      toggleMic: () => managerRef.current?.toggleMic(),
      toggleCamera: () => managerRef.current?.toggleCamera(),
      getLocalStream: () => managerRef.current?.getLocalStream() ?? null,
      getRemoteStream: () => managerRef.current?.getRemoteStream() ?? null,
    }),
    [snapshot],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used inside <CallProvider>')
  return ctx
}
