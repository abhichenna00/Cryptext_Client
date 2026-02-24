import { apiGet, apiPost } from './client'

export interface ConversationWithDetails {
  conversation_id: string
  conversation_type: string
  name: string | null
  other_user_id: string | null
  other_user_nickname: string | null
  other_user_avatar_url?: string | null
  other_user_status?: string | null
  last_message: string | null
  last_message_time: number | null
  has_unread: boolean
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  timestamp: number
}

export const conversationsApi = {
  getAll: () => apiGet<ConversationWithDetails[]>('/conversations'),

  getOrCreateDm: async (otherUserId: string) => {
    // Server returns { conversation_id } — normalize to { success, conversation_id, error }
    try {
      const result = await apiPost<{ conversation_id: string }>(
        '/conversations/dm',
        { other_user_id: otherUserId }
      )
      return { success: true, conversation_id: result.conversation_id, error: null }
    } catch (err) {
      return {
        success: false,
        conversation_id: null,
        error: err instanceof Error ? err.message : 'Failed to load conversation',
      }
    }
  },

  getMessages: (conversationId: string) =>
    apiGet<Message[]>(`/conversations/${conversationId}/messages`),

  sendMessage: (conversationId: string, content: string) =>
    apiPost<{ success: boolean; error: string | null }>(
      `/conversations/${conversationId}/messages`,
      { content }
    ),

  markRead: (conversationId: string) =>
    apiPost<{ success: boolean }>(`/conversations/${conversationId}/read`, {}),
}
