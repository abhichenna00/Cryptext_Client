import { useEffect, useRef, useState } from 'react'

const SAMPLE_INTERVAL_MS = 33 // ~30 Hz cap on re-renders

/**
 * Returns a normalized [0..1] audio amplitude for the given MediaStream's
 * first audio track. Returns 0 when stream is null. Disposes its
 * AudioContext on unmount or stream change.
 */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0)
  const rafRef = useRef<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const lastSampleRef = useRef(0)

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevel(0)
      return
    }

    let cancelled = false
    let analyser: AnalyserNode | null = null
    let buffer: Uint8Array | null = null
    let source: MediaStreamAudioSourceNode | null = null

    try {
      const AudioCtor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtor) return
      const ctx = new AudioCtor()
      ctxRef.current = ctx
      source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      buffer = new Uint8Array(analyser.frequencyBinCount)
      source.connect(analyser)
    } catch (err) {
      console.warn('[call] audio level init failed:', err)
      return
    }

    const tick = () => {
      if (cancelled || !analyser || !buffer) return
      const now = performance.now()
      if (now - lastSampleRef.current >= SAMPLE_INTERVAL_MS) {
        lastSampleRef.current = now
        analyser.getByteFrequencyData(buffer as unknown as Uint8Array<ArrayBuffer>)
        let sum = 0
        for (let i = 0; i < buffer.length; i++) sum += buffer[i]
        const avg = sum / buffer.length / 255
        setLevel(avg)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      try {
        source?.disconnect()
        analyser?.disconnect()
      } catch {
        // disconnect on already-torn-down node is a no-op we want to swallow
      }
      const ctx = ctxRef.current
      ctxRef.current = null
      if (ctx) {
        ctx.close().catch(() => {})
      }
      setLevel(0)
    }
  }, [stream])

  return level
}
