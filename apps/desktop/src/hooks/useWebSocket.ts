// src/hooks/useWebSocket.ts

import { useState, useEffect, useRef, useCallback } from 'react'
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

// ── Options & return types ──

interface UseWebSocketOptions {
  /** Called when a message is received from the server */
  onMessage?: (data: WebSocketMessage) => void
  /** Called when the connection opens */
  onOpen?: () => void
  /** Called when the connection closes */
  onClose?: () => void
  /** Called on connection error */
  onError?: (error: Event) => void
  /** Called when all reconnect attempts are exhausted */
  onReconnectFailed?: () => void
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Base reconnect interval in ms (default: 3000) */
  reconnectInterval?: number
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number
}

interface UseWebSocketReturn {
  /** Send a JSON message through the WebSocket */
  sendMessage: (data: WebSocketMessage) => void
  /** Whether the WebSocket is currently connected */
  isConnected: boolean
  /** Manually disconnect */
  disconnect: () => void
  /** Manually reconnect */
  reconnect: () => void
}

/**
 * Compute exponential backoff delay with jitter.
 * Caps at 30 seconds.
 */
function getBackoffDelay(attempt: number, baseInterval: number): number {
  const exponential = baseInterval * Math.pow(2, attempt - 1)
  const capped = Math.min(exponential, 30000)
  // Add ±25% jitter to avoid thundering herd
  const jitter = capped * (0.75 + Math.random() * 0.5)
  return Math.round(jitter)
}

/**
 * Hook that manages a WebSocket connection to the API Gateway WebSocket endpoint.
 * Retrieves the WebSocket URL and auth token from the Tauri backend.
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    onMessage,
    onOpen,
    onClose,
    onError,
    onReconnectFailed,
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intentionalCloseRef = useRef(false)

  // Store latest callbacks in refs to avoid re-creating the connection
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  const onCloseRef = useRef(onClose)
  const onErrorRef = useRef(onError)
  const onReconnectFailedRef = useRef(onReconnectFailed)

  useEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current = onOpen
    onCloseRef.current = onClose
    onErrorRef.current = onError
    onReconnectFailedRef.current = onReconnectFailed
  }, [onMessage, onOpen, onClose, onError, onReconnectFailed])

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (
      !autoReconnect ||
      intentionalCloseRef.current ||
      reconnectAttemptsRef.current >= maxReconnectAttempts
    ) {
      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        console.error('[WebSocket] All reconnect attempts exhausted')
        onReconnectFailedRef.current?.()
      }
      return
    }

    reconnectAttemptsRef.current += 1
    const delay = getBackoffDelay(reconnectAttemptsRef.current, reconnectInterval)
    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`
    )
    reconnectTimerRef.current = setTimeout(connectFn, delay)
  }, [autoReconnect, reconnectInterval, maxReconnectAttempts])

  const connect = useCallback(async () => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    try {
      // Get WebSocket URL and auth token from Rust backend
      const wsUrl = await invoke<string>('get_websocket_url')
      const token = await invoke<string | null>('get_auth_token')

      // Append token as query param for API Gateway authorizer
      const url = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl

      const ws = new WebSocket(url)

      ws.onopen = () => {
        console.log('[WebSocket] Connected')
        setIsConnected(true)
        reconnectAttemptsRef.current = 0
        onOpenRef.current?.()
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketMessage
          onMessageRef.current?.(data)
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err)
        }
      }

      ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason)
        setIsConnected(false)
        wsRef.current = null
        onCloseRef.current?.()

        // Auto-reconnect unless intentionally closed
        scheduleReconnect(connect)
      }

      ws.onerror = (event) => {
        console.error('[WebSocket] Error:', event)
        onErrorRef.current?.(event)
      }

      wsRef.current = ws
    } catch (err) {
      console.error('[WebSocket] Failed to connect:', err)
      scheduleReconnect(connect)
    }
  }, [scheduleReconnect])

  const disconnect = useCallback(() => {
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
  }, [])

  const reconnect = useCallback(() => {
    intentionalCloseRef.current = false
    reconnectAttemptsRef.current = 0
    connect()
  }, [connect])

  const sendMessage = useCallback((data: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    } else {
      console.warn('[WebSocket] Cannot send — not connected')
    }
  }, [])

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    intentionalCloseRef.current = false
    connect()

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return { sendMessage, isConnected, disconnect, reconnect }
}
