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
}

beforeEach(() => {
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const tracks: FakeTrack[] = []
    if (constraints.audio) tracks.push(new FakeTrack('audio'))
    if (constraints.video) tracks.push(new FakeTrack('video'))
    return new FakeStream(tracks) as unknown as MediaStream
  })
  const enumerateDevices = vi.fn(async () => [])
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia, enumerateDevices } },
    configurable: true,
  })
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
