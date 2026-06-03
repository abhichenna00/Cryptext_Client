import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MediaStreamManager } from '../MediaStreamManager'

class FakeTrack {
  kind: string
  stopped = false
  #listeners: Record<string, Set<() => void>> = {}
  constructor(kind: string) {
    this.kind = kind
  }
  stop() {
    this.stopped = true
  }
  addEventListener(name: string, fn: () => void) {
    ;(this.#listeners[name] ??= new Set()).add(fn)
  }
  removeEventListener(name: string, fn: () => void) {
    this.#listeners[name]?.delete(fn)
  }
}

class FakeStream {
  tracks: FakeTrack[]
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks
  }
  getTracks() {
    return this.tracks
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t)
  }
}

beforeEach(() => {
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const tracks: FakeTrack[] = []
    if (constraints.audio) tracks.push(new FakeTrack('audio'))
    if (constraints.video) tracks.push(new FakeTrack('video'))
    return new FakeStream(tracks) as unknown as MediaStream
  })
  const enumerateDevices = vi.fn(async () => [] as MediaDeviceInfo[])
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia, enumerateDevices } },
    configurable: true,
  })
  ;(globalThis as unknown as { MediaStream: new () => FakeStream }).MediaStream = function () {
    return new FakeStream([])
  } as unknown as new () => FakeStream
})

describe('MediaStreamManager', () => {
  it('dispose() stops every tracked stream', async () => {
    const m = new MediaStreamManager()
    const a = (await m.acquireLocalStream({ audio: true })) as unknown as FakeStream
    const b = (await m.acquireLocalStream({ audio: true, video: true })) as unknown as FakeStream
    m.dispose()
    expect(a.getTracks().every((t) => t.stopped)).toBe(true)
    expect(b.getTracks().every((t) => t.stopped)).toBe(true)
  })

  it('acquireGraceful makes no capture attempt when no input devices exist', async () => {
    const m = new MediaStreamManager()
    const stream = (await m.acquireGraceful({ audio: true, video: true })) as unknown as FakeStream
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(stream.getTracks()).toHaveLength(0)
  })

  it('acquireGraceful falls back to the default device when the preferred one overconstrains', async () => {
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
      { kind: 'audioinput' },
    ] as unknown as MediaDeviceInfo[])
    let calls = 0
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
      async (c?: MediaStreamConstraints) => {
        calls += 1
        // First attempt uses the saved (absent) device and overconstrains;
        // the fallback to the default device succeeds.
        if (calls === 1) throw new Error('OverconstrainedError')
        const tracks: FakeTrack[] = []
        if (c?.audio) tracks.push(new FakeTrack('audio'))
        return new FakeStream(tracks) as unknown as MediaStream
      },
    )
    const m = new MediaStreamManager()
    const stream = (await m.acquireGraceful({ audio: true, video: false })) as unknown as FakeStream
    expect(calls).toBe(2)
    expect(stream.getAudioTracks()).toHaveLength(1)
  })

  it('stop() removes a stream so dispose() leaves untouched survivors alone', async () => {
    const m = new MediaStreamManager()
    const a = (await m.acquireLocalStream({ audio: true })) as unknown as FakeStream
    const b = (await m.acquireLocalStream({ audio: true })) as unknown as FakeStream

    // Stop `a` explicitly, then mark it manually as "not tracked anymore" by
    // resetting the stopped flag on its tracks. If dispose() still touched it,
    // the tracks would be stopped again.
    m.stop(a as unknown as MediaStream)
    expect(a.getTracks().every((t) => t.stopped)).toBe(true)
    for (const t of a.getTracks()) t.stopped = false

    m.dispose()
    expect(a.getTracks().every((t) => t.stopped)).toBe(false)
    expect(b.getTracks().every((t) => t.stopped)).toBe(true)
  })
})
