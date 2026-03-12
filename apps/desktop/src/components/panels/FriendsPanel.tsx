// src/components/panels/FriendsPanel.tsx

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { UserPlus, Search } from 'lucide-react'

interface Friend {
  id: string
  username: string
  last_message_at?: number
}

interface FriendsPanelProps {
  onSelectFriend: (friendId: string) => void
}

export function FriendsPanel({ onSelectFriend }: FriendsPanelProps) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadFriends()
  }, [])

  const loadFriends = async () => {
    try {
      const data = await invoke<Friend[]>('get_friends')
      // Sort by last message time (most recent first)
      const sorted = data.sort((a, b) => {
        const timeA = a.last_message_at || 0
        const timeB = b.last_message_at || 0
        return timeB - timeA
      })
      setFriends(sorted)
    } catch (err) {
      console.error('Failed to load friends:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredFriends = friends.filter(friend =>
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="panel-container">
      <div className="panel-header">
        <h2>Friends</h2>
        <button className="panel-action-button" title="Add Friend">
          <UserPlus size={18} />
        </button>
      </div>

      <div className="panel-search">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          placeholder="Search friends..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="panel-content">
        {loading ? (
          <div className="panel-loading">Loading...</div>
        ) : filteredFriends.length === 0 ? (
          <div className="panel-empty">
            {searchQuery ? 'No friends found' : 'No friends yet'}
          </div>
        ) : (
          <ul className="friends-list">
            {filteredFriends.map((friend) => (
              <li key={friend.id}>
                <button
                  className="friend-item"
                  onClick={() => onSelectFriend(friend.id)}
                >
                  <div className="friend-avatar">
                    {friend.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="friend-name">{friend.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}