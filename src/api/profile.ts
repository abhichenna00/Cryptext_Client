import { apiGet, apiPost, apiPut } from './client'

export interface ProfileData {
  user_id: string
  username?: string
  nickname: string
  avatar_url: string | null
  status: string | null
}

export interface PlaceholderProfile {
  username: string
  nickname: string
}

export const profileApi = {
  get: async (): Promise<ProfileData | null> => {
    try {
      return await apiGet<ProfileData>('/profile')
    } catch (err: unknown) {
      // Server returns 404 when no profile exists — treat as null
      if (err instanceof Error && err.message.includes('404')) return null
      throw err
    }
  },

  getByIds: (userIds: string[]) =>
    apiPost<ProfileData[]>('/profiles', { user_ids: userIds }),

  create: (username: string, nickname: string, avatarUrl?: string | null) =>
    apiPost<{ success: boolean; error?: string }>('/profile', {
      username,
      nickname,
      avatar_url: avatarUrl ?? null,
    }),

  update: (username: string, nickname: string, avatarUrl?: string | null) =>
    apiPut<{ success: boolean; error?: string }>('/profile', {
      username,
      nickname,
      avatar_url: avatarUrl ?? null,
    }),

  updateStatus: (status: string) =>
    apiPut<{ success: boolean; error?: string }>('/profile/status', { status }),

  uploadAvatar: async (file: File): Promise<{ success: boolean; url?: string; error?: string }> => {
    // Server expects base64 JSON, not FormData
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        resolve(result.split(',')[1]) // strip data:image/...;base64, prefix
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const extension = file.name.split('.').pop() || 'png'

    return apiPost<{ success: boolean; url?: string; error?: string }>('/profile/avatar', {
      image_data: base64,
      file_name: `avatar.${extension}`,
      content_type: file.type,
    })
  },

  generatePlaceholder: () => apiGet<PlaceholderProfile>('/profile/placeholder'),
}
