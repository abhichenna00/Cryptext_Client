import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

function parseWebSocketMessage(raw: unknown): WebSocketMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const action = (raw as Record<string, unknown>).action
  if (typeof action !== 'string') return null
  return raw as WebSocketMessage
}

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

      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('[WebSocket] Connected, authenticating...')
        if (ticket) {
          ws.send(JSON.stringify({ action: 'authenticate', token: ticket }))
        } else {
          console.error('[WebSocket] No ticket available')
          ws.close()
        }
      }

      ws.onmessage = (event) => {
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
        console.log('[WebSocket] Disconnected:', event.code, event.reason)
        setIsConnected(false)
        wsRef.current = null
        scheduleReconnect(connect)
      }

      ws.onerror = (event) => {
        console.error('[WebSocket] Error:', event)
      }

      wsRef.current = ws
    } catch (err) {
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

  return (
    <WebSocketContext.Provider value={{ isConnected, sendMessage, subscribe }}>
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
