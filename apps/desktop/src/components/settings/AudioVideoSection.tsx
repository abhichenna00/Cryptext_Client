import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { MediaStreamManager } from '@/lib/calls/MediaStreamManager'
import {
  loadMediaPreferences,
  saveMediaPreference,
  type MediaPreferences,
} from '@/lib/calls/mediaPreferences'
import { cn } from '@/lib/utils'

const mediaManager = new MediaStreamManager()

type PreviewState = 'idle' | 'starting' | 'live' | 'error'

interface DeviceLists {
  microphones: MediaDeviceInfo[]
  cameras: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
}

const EMPTY_DEVICES: DeviceLists = { microphones: [], cameras: [], speakers: [] }

function classify(devices: MediaDeviceInfo[]): DeviceLists {
  const out: DeviceLists = { microphones: [], cameras: [], speakers: [] }
  for (const d of devices) {
    if (d.kind === 'audioinput') out.microphones.push(d)
    else if (d.kind === 'videoinput') out.cameras.push(d)
    else if (d.kind === 'audiooutput') out.speakers.push(d)
  }
  return out
}

function deviceLabel(d: MediaDeviceInfo, fallback: string): string {
  return d.label || `${fallback} (${d.deviceId.slice(0, 6) || 'unknown'})`
}

function supportsSinkId(): boolean {
  if (typeof HTMLMediaElement === 'undefined') return false
  return 'sinkId' in HTMLMediaElement.prototype
}

type AudioWithSinkId = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }

export default function AudioVideoSection() {
  const [prefs, setPrefs] = useState<MediaPreferences>(loadMediaPreferences)
  const [devices, setDevices] = useState<DeviceLists>(EMPTY_DEVICES)
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [micLevel, setMicLevel] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const previewStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const restartRequestedRef = useRef(false)

  const sinkSupported = useMemo(supportsSinkId, [])

  const update = <K extends keyof MediaPreferences>(key: K, value: MediaPreferences[K]) => {
    setPrefs((cur) => ({ ...cur, [key]: value }))
    saveMediaPreference(key, value)
  }

  const refreshDevices = async () => {
    try {
      const list = await mediaManager.enumerateDevices()
      setDevices(classify(list))
    } catch (err) {
      console.error('enumerateDevices failed:', err)
    }
  }

  const stopPreview = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect()
      } catch {
        /* noop */
      }
      sourceNodeRef.current = null
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch {
        /* noop */
      }
      analyserRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined)
      audioCtxRef.current = null
    }
    if (previewStreamRef.current) {
      mediaManager.stop(previewStreamRef.current)
      previewStreamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setMicLevel(0)
  }

  const startPreview = async () => {
    setPreviewState('starting')
    setPreviewError(null)
    try {
      const stream = await mediaManager.acquireLocalStream(mediaManager.getPreferredConstraints('video'))
      previewStreamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream

      const Ctx = window.AudioContext
      if (Ctx) {
        const ctx = new Ctx()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        sourceNodeRef.current = source
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.5
        source.connect(analyser)
        analyserRef.current = analyser
        const data = new Uint8Array(analyser.fftSize)
        const tick = () => {
          const a = analyserRef.current
          if (!a) return
          a.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / data.length)
          setMicLevel(Math.min(1, rms * 2.5))
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      }

      setPreviewState('live')
      void refreshDevices()
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error'
      const msg = err instanceof Error ? err.message : String(err)
      setPreviewError(`${name}: ${msg}`)
      setPreviewState('error')
    }
  }

  const playTestTone = async () => {
    const Ctx = window.AudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    try {
      const dest = ctx.createMediaStreamDestination()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 440
      const now = ctx.currentTime
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.3, now + 0.05)
      gain.gain.setValueAtTime(0.3, now + 0.45)
      gain.gain.linearRampToValueAtTime(0, now + 0.5)
      osc.connect(gain).connect(dest)
      osc.start(now)
      osc.stop(now + 0.5)
      if (audioRef.current) {
        audioRef.current.srcObject = dest.stream
        await audioRef.current.play().catch(() => undefined)
      }
      setTimeout(() => void ctx.close().catch(() => undefined), 800)
    } catch (err) {
      console.warn('Test tone failed:', err)
      void ctx.close().catch(() => undefined)
    }
  }

  useEffect(() => {
    void refreshDevices()
    const handleChange = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handleChange)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleChange)
      stopPreview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!sinkSupported || !audioRef.current) return
    const el = audioRef.current as AudioWithSinkId
    if (!el.setSinkId) return
    void el.setSinkId(prefs.speakerDeviceId ?? '').catch((err) => {
      console.warn('setSinkId failed:', err)
    })
  }, [prefs.speakerDeviceId, sinkSupported])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = prefs.outputVolume
  }, [prefs.outputVolume])

  // Restart preview when input constraints change while live, debounced to one frame.
  useEffect(() => {
    if (previewState !== 'live' || restartRequestedRef.current) return
    restartRequestedRef.current = true
    const id = requestAnimationFrame(async () => {
      restartRequestedRef.current = false
      stopPreview()
      await startPreview()
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.micDeviceId, prefs.cameraDeviceId, prefs.echoCancellation, prefs.noiseSuppression])

  const micPickerValue = prefs.micDeviceId ?? ''
  const cameraPickerValue = prefs.cameraDeviceId ?? ''
  const speakerPickerValue = prefs.speakerDeviceId ?? ''
  const previewLive = previewState === 'live'

  return (
    <div className="flex flex-col gap-6">
      {/* Preview */}
      <section className="flex flex-col gap-2">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
          Preview
        </h4>
        <div className="grid grid-cols-[240px_1fr] gap-3">
          <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {!previewLive && (
              <div className="absolute inset-0 grid place-items-center text-[12px] text-white/70">
                {previewState === 'starting'
                  ? 'Requesting access…'
                  : previewState === 'error'
                    ? 'Preview unavailable'
                    : 'Preview off'}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-fg-muted">Microphone level</span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-75"
                  style={{ width: `${Math.round(micLevel * 100)}%` }}
                />
              </div>
              {previewError && (
                <span className="text-[11.5px] text-red-500">{previewError}</span>
              )}
            </div>
            <div className="flex gap-2">
              {previewLive ? (
                <Button variant="outline" onClick={stopPreview} className="h-8">
                  Stop preview
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={startPreview}
                  disabled={previewState === 'starting'}
                  className="h-8"
                >
                  {previewState === 'starting' ? 'Starting…' : 'Start preview'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Input devices */}
      <section className="flex flex-col gap-3">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
          Input
        </h4>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-fg-muted">Microphone</span>
          <select
            value={micPickerValue}
            onChange={(e) => update('micDeviceId', e.target.value || null)}
            className={cn(
              'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-fg',
              'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
            )}
          >
            <option value="">System default</option>
            {devices.microphones.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {deviceLabel(d, 'Microphone')}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-fg-muted">Camera</span>
          <select
            value={cameraPickerValue}
            onChange={(e) => update('cameraDeviceId', e.target.value || null)}
            className={cn(
              'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-fg',
              'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
            )}
          >
            <option value="">System default</option>
            {devices.cameras.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {deviceLabel(d, 'Camera')}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* Output */}
      <section className="flex flex-col gap-3">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
          Output
        </h4>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-fg-muted">Speaker</span>
          {sinkSupported ? (
            <select
              value={speakerPickerValue}
              onChange={(e) => update('speakerDeviceId', e.target.value || null)}
              className={cn(
                'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-fg',
                'focus:outline-none focus-visible:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]',
              )}
            >
              <option value="">System default</option>
              {devices.speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {deviceLabel(d, 'Speaker')}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[12px] text-fg-dim">
              This platform does not expose speaker selection; system default will be used.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between text-[12px] font-medium text-fg-muted">
            <span>Output volume</span>
            <span className="font-mono text-[11px] text-fg-dim">
              {Math.round(prefs.outputVolume * 100)}%
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={prefs.outputVolume}
            onChange={(e) => update('outputVolume', Number(e.target.value))}
            className="h-2 w-full"
          />
        </label>

        <div>
          <Button variant="outline" onClick={playTestTone} className="h-8">
            Test speaker
          </Button>
          {/* Audio element used as the sink for setSinkId + volume — kept off-screen. */}
          <audio ref={audioRef} className="hidden" />
        </div>
      </section>

      {/* Processing */}
      <section className="flex flex-col gap-3">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
          Voice processing
        </h4>

        <label className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-[13px] text-fg">Echo cancellation</span>
            <span className="text-[11.5px] text-fg-dim">
              Suppresses your speaker output from being picked up by the mic.
            </span>
          </span>
          <input
            type="checkbox"
            checked={prefs.echoCancellation}
            onChange={(e) => update('echoCancellation', e.target.checked)}
            className="size-4"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-[13px] text-fg">Noise suppression</span>
            <span className="text-[11.5px] text-fg-dim">
              Reduces steady background sounds like fans and traffic.
            </span>
          </span>
          <input
            type="checkbox"
            checked={prefs.noiseSuppression}
            onChange={(e) => update('noiseSuppression', e.target.checked)}
            className="size-4"
          />
        </label>
      </section>
    </div>
  )
}
