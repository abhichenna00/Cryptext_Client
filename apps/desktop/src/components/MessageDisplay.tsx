// src/components/MessageDisplay.tsx

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import '../styles/MessageDisplay.css'

// Generic message interface for chatting
interface BaseMessage {
  id: string
  content: string
  timestamp: number
}

// Global chat message format
interface GlobalMessage extends BaseMessage {
  from: string
  isOutgoing: boolean
}

// Direct message format
interface DirectMessage extends BaseMessage {
  sender_id: string
  receiver_id: string
}

// Union type for messages
type Message = GlobalMessage | DirectMessage

interface MessageDisplayProps {
  messages: Message[]
  currentUserId: string
  mode: 'global' | 'direct'
  partnerName?: string // For DMs, pass the partner's name directly
}

interface ProfileNickname {
  user_id: string
  nickname: string
}

// Type guard to check if message is a GlobalMessage
function isGlobalMessage(msg: Message): msg is GlobalMessage {
  return 'from' in msg
}

// Type guard to check if message is a DirectMessage
function isDirectMessage(msg: Message): msg is DirectMessage {
  return 'sender_id' in msg
}

export default function MessageDisplay({ messages, currentUserId, mode, partnerName }: MessageDisplayProps) {
  const [profiles, setProfiles] = useState<Record<string, string>>({})

  useEffect(() => {
    if (mode === 'global') {
      // For global chat, fetch all unique user nicknames
      const userIds = [...new Set(messages.filter(isGlobalMessage).map(msg => msg.from))]

      if (userIds.length === 0) return

      const fetchProfiles = async () => {
        try {
          const data = await invoke<ProfileNickname[]>('get_profiles_by_ids', {
            userIds
          })

          if (data) {
            const profileMap: Record<string, string> = {}
            data.forEach((profile) => {
              profileMap[profile.user_id] = profile.nickname
            })
            setProfiles(profileMap)
          }
        } catch (error) {
          console.error('Failed to fetch profiles:', error)
        }
      }

      fetchProfiles()
    }
  }, [messages, mode])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const today = new Date()
    const isToday = date.toDateString() === today.toDateString()

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    }
  }

  const getSenderName = (msg: Message): string => {
    if (mode === 'global' && isGlobalMessage(msg)) {
      return profiles[msg.from] || 'Unknown User'
    } else if (mode === 'direct' && isDirectMessage(msg)) {
      return msg.sender_id === currentUserId ? 'You' : (partnerName || 'Unknown User')
    }
    return 'Unknown User'
  }

  if (messages.length === 0) {
    return (
      <div className="message-list">
        <p>No messages yet. Start the conversation!</p>
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map((msg) => (
        <div key={msg.id} className="message-item">
          <div className="message-header">
            <span className="message-sender">{getSenderName(msg)}</span>
            <span className="message-timestamp">{formatTime(msg.timestamp)}</span>
          </div>
          <div className="message-content">{msg.content}</div>
        </div>
      ))}
    </div>
  )
}