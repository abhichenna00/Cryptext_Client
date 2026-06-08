import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface FriendActionResult {
  success: boolean
  error?: string
}

/**
 * Shared accept / decline / cancel handlers for friend requests. Each handler
 * invokes the matching Tauri command, tracks loading/error/success state, and
 * calls `onSuccess` (e.g. to refresh the request list) when the command
 * succeeds.
 */
export function useFriendActions(onSuccess: () => void) {
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleAction = async (
    command: string,
    requestId: string,
    successMessage: string,
  ) => {
    setActionLoading(true)
    setError(null)

    try {
      const result = await invoke<FriendActionResult>(command, { requestId })

      if (result.success) {
        setSuccess(successMessage)
        onSuccess()
      } else {
        setError(result.error || 'Failed to process friend request')
      }
    } catch (err) {
      console.error(`Failed to ${command}:`, err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleAcceptRequest = (requestId: string) =>
    handleAction('accept_friend_request', requestId, 'Friend request accepted!')

  const handleDeclineRequest = (requestId: string) =>
    handleAction('decline_friend_request', requestId, 'Friend request declined')

  const handleCancelRequest = (requestId: string) =>
    handleAction('cancel_friend_request', requestId, 'Friend request cancelled')

  return {
    actionLoading,
    error,
    setError,
    success,
    setSuccess,
    handleAcceptRequest,
    handleDeclineRequest,
    handleCancelRequest,
  }
}
