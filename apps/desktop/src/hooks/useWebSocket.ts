// src/hooks/useWebSocket.ts
//
// Thin wrapper over WebSocketContext. The connection itself lives on the
// Provider at App level; this hook just lets a component subscribe to
// messages and check connection state without thinking about Context.

import { useEffect, useRef } from 'react'
import {
  useWebSocketContext,
  type WebSocketMessage,
} from '@/contexts/WebSocketContext'

export type { WebSocketMessage, WsNewMessage, WsStatusUpdate } from '@/contexts/WebSocketContext'

interface UseWebSocketOptions {
  onMessage?: (data: WebSocketMessage) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  onReconnectFailed?: () => void
  autoReconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
}

interface UseWebSocketReturn {
  sendMessage: (data: WebSocketMessage) => void
  isConnected: boolean
  /** No-op — the Provider owns the connection lifecycle. */
  disconnect: () => void
  /** No-op — the Provider owns the connection lifecycle. */
  reconnect: () => void
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const { onMessage, onOpen, onClose } = options
  const ctx = useWebSocketContext()

  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current = onOpen
    onCloseRef.current = onClose
  }, [onMessage, onOpen, onClose])

  useEffect(() => {
    if (!onMessage) return
    return ctx.subscribe((data) => {
      onMessageRef.current?.(data)
    })
  }, [ctx, onMessage])

  // Fire onOpen / onClose on Provider connection-state transitions so callers
  // that relied on the old hook's lifecycle callbacks keep working.
  const prevConnectedRef = useRef(ctx.isConnected)
  useEffect(() => {
    if (ctx.isConnected && !prevConnectedRef.current) {
      onOpenRef.current?.()
    } else if (!ctx.isConnected && prevConnectedRef.current) {
      onCloseRef.current?.()
    }
    prevConnectedRef.current = ctx.isConnected
  }, [ctx.isConnected])

  return {
    sendMessage: ctx.sendMessage,
    isConnected: ctx.isConnected,
    disconnect: () => {},
    reconnect: () => {},
  }
}
