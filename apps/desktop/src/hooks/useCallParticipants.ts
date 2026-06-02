import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { useCall } from '@/contexts/CallContext'

interface ProfileLookup {
  user_id: string
  nickname: string
  avatar_url?: string | null
  status?: string | null
}

export interface EnrichedParticipant {
  userId: string
  isSelf: boolean
  micEnabled: boolean
  cameraEnabled: boolean
  joinedAt: number | null
  nickname?: string
  avatarUrl?: string | null
  status?: string | null
}

function shallowEqualSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  for (const id of a) if (!setB.has(id)) return false
  return true
}

/**
 * Reads call participants from CallContext and enriches non-self entries with
 * cached profile metadata (nickname / avatar / status). Profile lookups are
 * batched via `get_profiles_by_ids` and re-issued only when the set of
 * non-self userIds changes.
 */
export function useCallParticipants(): ReadonlyArray<EnrichedParticipant> {
  const { snapshot } = useCall()
  const cacheRef = useRef<
    Map<string, { nickname: string; avatarUrl: string | null; status: string | null }>
  >(new Map())
  const lastFetchedIdsRef = useRef<string[]>([])
  const [, setRev] = useState(0)

  const participants = snapshot.participants
  const nonSelfIds = participants.filter((p) => !p.isSelf).map((p) => p.userId)

  useEffect(() => {
    if (nonSelfIds.length === 0) {
      lastFetchedIdsRef.current = []
      return
    }
    if (shallowEqualSet(nonSelfIds, lastFetchedIdsRef.current)) return
    lastFetchedIdsRef.current = nonSelfIds.slice()

    let cancelled = false
    ;(async () => {
      try {
        const data = await invoke<ProfileLookup[]>('get_profiles_by_ids', {
          userIds: nonSelfIds,
        })
        if (cancelled) return
        for (const profile of data) {
          cacheRef.current.set(profile.user_id, {
            nickname: profile.nickname,
            avatarUrl: profile.avatar_url ?? null,
            status: profile.status ?? null,
          })
        }
        setRev((r) => r + 1)
      } catch (err) {
        console.warn('[call] participant profile lookup failed:', err)
      }
    })()

    return () => {
      cancelled = true
    }
    // We compare the id set explicitly above; depending on a join key avoids
    // re-running for stable arrays produced by every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonSelfIds.join('|')])

  return participants.map<EnrichedParticipant>((p) => {
    if (p.isSelf) {
      return {
        userId: p.userId,
        isSelf: true,
        micEnabled: p.micEnabled,
        cameraEnabled: p.cameraEnabled,
        joinedAt: p.joinedAt,
      }
    }
    const cached = cacheRef.current.get(p.userId)
    return {
      userId: p.userId,
      isSelf: false,
      micEnabled: p.micEnabled,
      cameraEnabled: p.cameraEnabled,
      joinedAt: p.joinedAt,
      nickname: cached?.nickname,
      avatarUrl: cached?.avatarUrl ?? null,
      status: cached?.status ?? null,
    }
  })
}
