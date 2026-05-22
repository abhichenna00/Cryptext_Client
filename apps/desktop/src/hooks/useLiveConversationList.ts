// src/hooks/useLiveConversationList.ts
//
// Fetches the conversation list once on mount, then refreshes it whenever
// a `new_message` event arrives over the shared WebSocket. Lets the home
// page surface unread counts and message previews without a manual reload.

import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWebSocketContext, type WsNewMessage } from '@/contexts/WebSocketContext'

export interface ConversationWithDetails {
  conversation_id: string
  conversation_type: string
  name: string | null
  other_user_id: string | null
  other_user_nickname: string | null
  other_user_avatar_url?: string | null
  other_user_status?: string | null
  member_count?: number | null
  last_message: string | null
  last_message_time: number | null
  last_message_content_type: string | null
  has_unread: boolean
  unread_count: number
}

interface UseLiveConversationListReturn {
  conversations: ConversationWithDetails[]
  loading: boolean
  refresh: () => Promise<void>
}

export function useLiveConversationList(): UseLiveConversationListReturn {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const ctx = useWebSocketContext()
  // Guard against running refresh after unmount.
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const data = await invoke<ConversationWithDetails[]>('get_conversations')
      if (mountedRef.current) setConversations(data)
    } catch (err) {
      console.error('Failed to refresh conversations:', err)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    refresh().finally(() => {
      if (mountedRef.current) setLoading(false)
    })
    return () => {
      mountedRef.current = false
    }
  }, [refresh])

  useEffect(() => {
    return ctx.subscribe(async (data) => {
      if (data.action !== 'new_message') return
      // The sidebar preview reads `last_message` from the local DB, which is
      // populated by decrypt — without this fetch, the preview stays stale
      // until the user opens the chat for that conversation.
      const convId = (data as WsNewMessage).message?.conversation_id
      if (convId) {
        try {
          await invoke('fetch_new_messages', { conversationId: convId })
        } catch (err) {
          console.warn('[useLiveConversationList] fetch_new_messages failed:', err)
        }
      }
      refresh()
    })
  }, [ctx, refresh])

  return { conversations, loading, refresh }
}
