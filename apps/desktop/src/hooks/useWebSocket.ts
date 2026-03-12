// src/hooks/useWebSocket.ts

import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface WebSocketMessage {
  action: string
  [key: string]: unknown
}

interface UseWebSocketOptions {
  /** Called when a message is received from the server */
  onMessage?: (data: WebSocketMessage) => void
  /** Called when the connection opens */
  onOpen?: () => void
  /** Called when the connection closes */
  onClose?: () => void
  /** Called on connection error */
  onError?: (error: Event) => void
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Reconnect interval in ms (default: 3000) */
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
 * Hook that manages a WebSocket connection to the API Gateway WebSocket endpoint.
 * Retrieves the WebSocket URL and auth token from the Tauri backend.
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    onMessage,
    onOpen,
    onClose,
    onError,
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

  useEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current = onOpen
    onCloseRef.current = onClose
    onErrorRef.current = onError
  }, [onMessage, onOpen, onClose, onError])

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
        if (
          autoReconnect &&
          !intentionalCloseRef.current &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          reconnectAttemptsRef.current += 1
          console.log(
            `[WebSocket] Reconnecting (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`
          )
          reconnectTimerRef.current = setTimeout(connect, reconnectInterval)
        }
      }

      ws.onerror = (event) => {
        console.error('[WebSocket] Error:', event)
        onErrorRef.current?.(event)
      }

      wsRef.current = ws
    } catch (err) {
      console.error('[WebSocket] Failed to connect:', err)

      // Retry if auto-reconnect enabled
      if (
        autoReconnect &&
        !intentionalCloseRef.current &&
        reconnectAttemptsRef.current < maxReconnectAttempts
      ) {
        reconnectAttemptsRef.current += 1
        reconnectTimerRef.current = setTimeout(connect, reconnectInterval)
      }
    }
  }, [autoReconnect, reconnectInterval, maxReconnectAttempts])

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