// src/contexts/WebSocketContext.tsx
//
// Owns the single app-wide WebSocket connection. Handles ticket-based auth
// (the bearer token never reaches JS), auto-reconnect with exponential backoff
// + jitter, and a subscribe/send API that components consume via
// useWebSocketContext (or the thin useWebSocket wrapper). The connection is
// gated by the `enabled` prop so it only runs once the user is signed in.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { invoke } from '@tauri-apps/api/core'

// ── Message types ──

export interface WsNewMessage {
  action: 'new_message'
  message: {
    id: string
    conversation_id: string
    sender_id: string
    timestamp: number
  }
}

export interface WsStatusUpdate {
  action: 'status_update'
  user_id: string
  status: string
}

export type WebSocketMessage =
  | WsNewMessage
  | WsStatusUpdate
  | { action: string; [key: string]: unknown }

// ── Context shape ──

type Subscriber = (data: WebSocketMessage) => void

interface WebSocketContextValue {
  isConnected: boolean
  sendMessage: (data: WebSocketMessage) => void
  /** Register a callback for incoming messages. Returns an unsubscribe fn. */
  subscribe: (callback: Subscriber) => () => void
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

// ── Internal helpers ──

const DEFAULT_RECONNECT_INTERVAL = 3000
const MAX_RECONNECT_ATTEMPTS = 10
const BACKOFF_CAP_MS = 30000

// Runtime guard: accept only objects carrying a string `action`, rejecting
// arrays/primitives/malformed frames before they reach subscribers.
function parseWebSocketMessage(raw: unknown): WebSocketMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const action = (raw as Record<string, unknown>).action
  if (typeof action !== 'string') return null
  return raw as WebSocketMessage
}

// Exponential backoff (base × 2^(attempt-1)), capped, with ±25% jitter so
// reconnecting clients don't stampede the server in lockstep.
function getBackoffDelay(attempt: number, baseInterval: number): number {
  const exponential = baseInterval * Math.pow(2, attempt - 1)
  const capped = Math.min(exponential, BACKOFF_CAP_MS)
  const jitter = capped * (0.75 + Math.random() * 0.5)
  return Math.round(jitter)
}

function flushPendingSends(): void {
  invoke('retry_pending_sends', { conversationId: null }).catch((err) => {
    console.warn('[WebSocket] retry_pending_sends failed:', err)
  })
}

// ── Provider ──

interface WebSocketProviderProps {
  /** Gate connection on app state. Provider stays mounted; `false` keeps it idle. */
  enabled?: boolean
  children: ReactNode
}

export function WebSocketProvider({
  enabled = true,
  children,
}: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intentionalCloseRef = useRef(false)
  const subscribersRef = useRef<Set<Subscriber>>(new Set())
  // Monotonic token for connect() attempts. Bumped on every attempt and on
  // teardown so a stale async attempt (or a superseded socket's handlers) can
  // detect it's no longer current and bail — prevents a duplicate, untracked
  // WebSocket from leaking and dispatching every message twice.
  const connectGenRef = useRef(0)

  const subscribe = useCallback<WebSocketContextValue['subscribe']>((callback) => {
    subscribersRef.current.add(callback)
    return () => {
      subscribersRef.current.delete(callback)
    }
  }, [])

  const sendMessage = useCallback<WebSocketContextValue['sendMessage']>((data) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
      return
    }
    throw new Error('WebSocket not connected')
  }, [])

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (
      intentionalCloseRef.current ||
      reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS
    ) {
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[WebSocket] All reconnect attempts exhausted')
      }
      return
    }

    reconnectAttemptsRef.current += 1
    const delay = getBackoffDelay(
      reconnectAttemptsRef.current,
      DEFAULT_RECONNECT_INTERVAL,
    )
    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`,
    )
    reconnectTimerRef.current = setTimeout(connectFn, delay)
  }, [])

  const connect = useCallback(async () => {
    // Claim a generation for this attempt. If a newer attempt starts (StrictMode
    // remount, reconnect) or the provider is torn down while we await the URL /
    // ticket below, this attempt is stale and must not open a socket — otherwise
    // the async gap leaks a second, untracked WebSocket and every inbound message
    // gets dispatched twice (which scrambled call-signaling ordering).
    const gen = ++connectGenRef.current
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    try {
      const wsUrl = await invoke<string>('get_websocket_url')
      // Single-use, short-lived ticket exchanged for the bearer inside Rust.
      // The bearer never reaches the JS layer, so a compromised webview
      // cannot exfiltrate it.
      let ticket: string | null = null
      try {
        ticket = await invoke<string>('get_ws_ticket')
      } catch (err) {
        console.error('[WebSocket] Failed to obtain ticket:', err)
      }

      // Superseded or torn down while awaiting above — don't open a second socket.
      if (gen !== connectGenRef.current) return

      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        if (gen !== connectGenRef.current) return
        console.log('[WebSocket] Connected, authenticating...')
        if (ticket) {
          ws.send(JSON.stringify({ action: 'authenticate', token: ticket }))
        } else {
          console.error('[WebSocket] No ticket available')
          ws.close()
        }
      }

      ws.onmessage = (event) => {
        if (gen !== connectGenRef.current) return
        let raw: unknown
        try {
          raw = JSON.parse(event.data)
        } catch (err) {
          console.error('[WebSocket] Failed to parse message JSON:', err)
          return
        }

        const data = parseWebSocketMessage(raw)
        if (!data) {
          console.error('[WebSocket] Rejected malformed message (missing action)')
          return
        }

        if (data.action === 'authenticated') {
          const userId = (data as Record<string, unknown>).user_id
          console.log(
            '[WebSocket] Authenticated as',
            typeof userId === 'string' ? userId : '<unknown>',
          )
          setIsConnected(true)
          reconnectAttemptsRef.current = 0
          // Drain outbox on initial connect and on every successful reconnect.
          flushPendingSends()
          return
        }
        if (data.action === 'auth_error') {
          const errMsg = (data as Record<string, unknown>).error
          console.error(
            '[WebSocket] Auth failed:',
            typeof errMsg === 'string' ? errMsg : '<unknown>',
          )
          ws.close()
          return
        }

        for (const callback of subscribersRef.current) {
          try {
            callback(data)
          } catch (err) {
            console.error('[WebSocket] subscriber threw:', err)
          }
        }
      }

      ws.onclose = (event) => {
        if (gen !== connectGenRef.current) return
        console.log('[WebSocket] Disconnected:', event.code, event.reason)
        setIsConnected(false)
        wsRef.current = null
        scheduleReconnect(connect)
      }

      ws.onerror = (event) => {
        if (gen !== connectGenRef.current) return
        console.error('[WebSocket] Error:', event)
      }

      wsRef.current = ws
    } catch (err) {
      if (gen !== connectGenRef.current) return
      console.error('[WebSocket] Failed to connect:', err)
      scheduleReconnect(connect)
    }
  }, [scheduleReconnect])

  useEffect(() => {
    if (!enabled) {
      intentionalCloseRef.current = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setIsConnected(false)
      return
    }

    intentionalCloseRef.current = false
    reconnectAttemptsRef.current = 0
    connect()

    return () => {
      intentionalCloseRef.current = true
      // Invalidate any in-flight connect() so a socket opened after teardown
      // (StrictMode unmount during the async connect) is abandoned, not leaked.
      connectGenRef.current += 1
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [enabled, connect])

  // Memoize so the context value's identity is stable across re-renders that
  // don't change isConnected. Consumers that pass `ctx` into a useEffect dep
  // list (e.g. useLiveConversationList) would otherwise unsubscribe and
  // resubscribe on every provider render.
  const value = useMemo(
    () => ({ isConnected, sendMessage, subscribe }),
    [isConnected, sendMessage, subscribe],
  )

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocketContext(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext)
  if (!ctx) {
    throw new Error('useWebSocketContext must be used inside <WebSocketProvider>')
  }
  return ctx
}
