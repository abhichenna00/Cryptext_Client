import { useEffect, useState } from 'react'

import { useCall } from '@/contexts/CallContext'

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return `${pad(minutes)}:${pad(seconds)}`
}

/**
 * Returns a live MM:SS (or HH:MM:SS past an hour) string for the active call,
 * or null when no call is in the in-call phase yet.
 */
export function useCallDuration(): string | null {
  const { snapshot } = useCall()
  const startedAt = snapshot.callStartedAt
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (startedAt === null) return null
  return format(now - startedAt)
}
