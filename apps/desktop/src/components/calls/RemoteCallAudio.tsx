import { useEffect, useRef } from 'react'

import { useCall } from '@/contexts/CallContext'

/**
 * Plays the remote participant's audio during an audio call.
 *
 * Video calls attach the remote stream to a `<video>` element, which sinks its
 * audio for free. Audio calls render no media element, so without this a
 * connected audio call is **silent** — nothing plays the incoming stream.
 * Mounted once at app level so it persists across floating/expanded display
 * changes and the whole call lifecycle.
 */
export default function RemoteCallAudio() {
  const { snapshot, getRemoteStream } = useCall()
  const ref = useRef<HTMLAudioElement>(null)
  const active =
    snapshot.mode === 'audio' &&
    (snapshot.status === 'connecting' || snapshot.status === 'in-call')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // The remote stream is live — tracks are added when they arrive, so setting
    // it once is enough; the element plays them as they come in.
    el.srcObject = active ? getRemoteStream() : null
  }, [active, getRemoteStream])

  if (!active) return null
  return <audio ref={ref} autoPlay />
}
