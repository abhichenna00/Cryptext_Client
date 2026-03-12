// src/pages/FriendsPage.tsx

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import '../styles/FriendsPage.css'

interface FriendWithProfile {
  friend_id: string
  username: string
  nickname: string
  created_at: string
}

interface FriendRequestWithProfile {
  id: string
  from_user_id: string
  to_user_id: string
  status: string
  created_at: string
  from_username?: string
  from_nickname?: string
  to_username?: string
  to_nickname?: string
}

interface FriendsResult {
  success: boolean
  error?: string
}

type Tab = 'friends' | 'requests' | 'add'

export default function FriendsPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('friends')
  const [friends, setFriends] = useState<FriendWithProfile[]>([])
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestWithProfile[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestWithProfile[]>([])
  const [searchUsername, setSearchUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const [friendsData, incomingData, outgoingData] = await Promise.all([
        invoke<FriendWithProfile[]>('get_friends'),
        invoke<FriendRequestWithProfile[]>('get_incoming_friend_requests'),
        invoke<FriendRequestWithProfile[]>('get_outgoing_friend_requests'),
      ])
      
      setFriends(friendsData)
      setIncomingRequests(incomingData)
      setOutgoingRequests(outgoingData)
    } catch (err) {
      console.error('Failed to load friends data:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSendRequest = async () => {
    if (!searchUsername.trim()) {
      setError('Please enter a username')
      return
    }

    setActionLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await invoke<FriendsResult>('send_friend_request', {
        toUsername: searchUsername.trim(),
      })

      if (result.success) {
        setSuccess(`Friend request sent to ${searchUsername}!`)
        setSearchUsername('')
        loadData()
      } else {
        setError(result.error || 'Failed to send friend request')
      }
    } catch (err) {
      console.error('Failed to send friend request:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleAcceptRequest = async (requestId: string) => {
    setActionLoading(true)
    setError(null)

    try {
      const result = await invoke<FriendsResult>('accept_friend_request', {
        requestId,
      })

      if (result.success) {
        setSuccess('Friend request accepted!')
        loadData()
      } else {
        setError(result.error || 'Failed to accept friend request')
      }
    } catch (err) {
      console.error('Failed to accept friend request:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeclineRequest = async (requestId: string) => {
    setActionLoading(true)
    setError(null)

    try {
      const result = await invoke<FriendsResult>('decline_friend_request', {
        requestId,
      })

      if (result.success) {
        setSuccess('Friend request declined')
        loadData()
      } else {
        setError(result.error || 'Failed to decline friend request')
      }
    } catch (err) {
      console.error('Failed to decline friend request:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelRequest = async (requestId: string) => {
    setActionLoading(true)
    setError(null)

    try {
      const result = await invoke<FriendsResult>('cancel_friend_request', {
        requestId,
      })

      if (result.success) {
        setSuccess('Friend request cancelled')
        loadData()
      } else {
        setError(result.error || 'Failed to cancel friend request')
      }
    } catch (err) {
      console.error('Failed to cancel friend request:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleRemoveFriend = async (friendId: string, nickname: string) => {
    if (!confirm(`Are you sure you want to remove ${nickname} from your friends?`)) {
      return
    }

    setActionLoading(true)
    setError(null)

    try {
      const result = await invoke<FriendsResult>('remove_friend', {
        friendId,
      })

      if (result.success) {
        setSuccess('Friend removed')
        loadData()
      } else {
        setError(result.error || 'Failed to remove friend')
      }
    } catch (err) {
      console.error('Failed to remove friend:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading(false)
    }
  }

  const totalRequests = incomingRequests.length + outgoingRequests.length

  if (loading) {
    return <div className="friends-loading">Loading friends...</div>
  }

  return (
    <div className="friends-page">
      <div className="friends-header">
        <h1>Friends</h1>
      </div>

      <div className="friends-tabs">
        <button 
          className={`friends-tab ${activeTab === 'friends' ? 'active' : ''}`}
          onClick={() => setActiveTab('friends')}
        >
          Friends ({friends.length})
        </button>
        <button 
          className={`friends-tab ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          Requests ({totalRequests})
        </button>
        <button 
          className={`friends-tab ${activeTab === 'add' ? 'active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          Add Friend
        </button>
      </div>

      <div className="friends-content">
        {error && <div className="friends-error">{error}</div>}
        {success && <div className="friends-success">{success}</div>}

        {activeTab === 'friends' && (
          <div>
            <h2 className="friends-section-title">Your Friends</h2>
            {friends.length === 0 ? (
              <p className="friends-message">You don't have any friends yet. Add some!</p>
            ) : (
              <ul className="friends-list">
                {friends.map((friend) => (
                  <li key={friend.friend_id} className="friend-list-item">
                    <div className="friend-list-info">
                      <div className="friend-list-avatar">
                        {friend.nickname.charAt(0).toUpperCase()}
                      </div>
                      <div className="friend-list-details">
                        <span className="friend-list-name">{friend.nickname}</span>
                        <span className="friend-list-username">@{friend.username}</span>
                      </div>
                    </div>
                    <div className="friend-list-actions">
                      <button 
                        className="friend-action-button primary"
                        onClick={() => navigate(`/chat/${friend.friend_id}`)}
                      >
                        Message
                      </button>
                      <button
                        className="friend-action-button danger"
                        onClick={() => handleRemoveFriend(friend.friend_id, friend.nickname)}
                        disabled={actionLoading}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="requests-container">
            {/* Incoming Requests Section */}
            <div className="requests-section">
              <h2 className="friends-section-title">Incoming ({incomingRequests.length})</h2>
              {incomingRequests.length === 0 ? (
                <p className="friends-message">No incoming requests.</p>
              ) : (
                <ul className="friends-list">
                  {incomingRequests.map((request) => (
                    <li key={request.id} className="friend-list-item">
                      <div className="friend-list-info">
                        <div className="friend-list-avatar">
                          {(request.from_nickname || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="friend-list-details">
                          <span className="friend-list-name">{request.from_nickname || 'Unknown'}</span>
                          <span className="friend-list-username">@{request.from_username || 'unknown'}</span>
                        </div>
                      </div>
                      <div className="friend-list-actions">
                        <button
                          className="friend-action-button primary"
                          onClick={() => handleAcceptRequest(request.id)}
                          disabled={actionLoading}
                        >
                          Accept
                        </button>
                        <button
                          className="friend-action-button danger"
                          onClick={() => handleDeclineRequest(request.id)}
                          disabled={actionLoading}
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Outgoing Requests Section */}
            <div className="requests-section">
              <h2 className="friends-section-title">Outgoing ({outgoingRequests.length})</h2>
              {outgoingRequests.length === 0 ? (
                <p className="friends-message">No outgoing requests.</p>
              ) : (
                <ul className="friends-list">
                  {outgoingRequests.map((request) => (
                    <li key={request.id} className="friend-list-item">
                      <div className="friend-list-info">
                        <div className="friend-list-avatar">
                          {(request.to_nickname || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="friend-list-details">
                          <span className="friend-list-name">{request.to_nickname || 'Unknown'}</span>
                          <span className="friend-list-username">@{request.to_username || 'unknown'}</span>
                        </div>
                      </div>
                      <div className="friend-list-actions">
                        <button
                          className="friend-action-button danger"
                          onClick={() => handleCancelRequest(request.id)}
                          disabled={actionLoading}
                        >
                          Cancel
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === 'add' && (
          <div>
            <h2 className="friends-section-title">Add Friend</h2>
            <div className="add-friend-form">
              <p>Enter the username of the person you want to add:</p>
              <div className="add-friend-input-group">
                <input
                  type="text"
                  className="add-friend-input"
                  placeholder="Username"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendRequest()}
                />
                <button
                  className="add-friend-button"
                  onClick={handleSendRequest}
                  disabled={actionLoading || !searchUsername.trim()}
                >
                  {actionLoading ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}