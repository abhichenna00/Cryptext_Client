import { apiGet, apiPost, apiDelete } from './client'

export interface FriendWithProfile {
  friend_id: string
  username: string
  nickname: string
  created_at: string
  is_online?: boolean
  avatar_url?: string | null
  status?: string | null
}

export interface FriendRequest {
  id: string
  from_user_id: string
  to_user_id: string
  status: string
  created_at: string
  from_username?: string
  from_nickname?: string
  from_avatar_url?: string | null
  from_status?: string | null
  to_username?: string
  to_nickname?: string
  to_avatar_url?: string | null
  to_status?: string | null
}

export const friendsApi = {
  getAll: () => apiGet<FriendWithProfile[]>('/friends'),

  getIncomingRequests: () => apiGet<FriendRequest[]>('/friends/requests/incoming'),

  getOutgoingRequests: () => apiGet<FriendRequest[]>('/friends/requests/outgoing'),

  sendRequest: (toUsername: string) =>
    apiPost<{ success: boolean; error?: string }>('/friends/requests/send', {
      to_username: toUsername,
    }),

  acceptRequest: (requestId: string) =>
    apiPost<{ success: boolean; error?: string }>(
      `/friends/requests/${requestId}/accept`,
      {}
    ),

  declineRequest: (requestId: string) =>
    apiPost<{ success: boolean; error?: string }>(
      `/friends/requests/${requestId}/decline`,
      {}
    ),

  cancelRequest: (requestId: string) =>
    apiDelete<{ success: boolean; error?: string }>(`/friends/requests/${requestId}/cancel`),
}
