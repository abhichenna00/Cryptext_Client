import { describe, it, expect, beforeEach } from 'vitest'

import {
  loadMediaPreferences,
  saveMediaPreference,
  MEDIA_PREFERENCE_DEFAULTS,
} from '../mediaPreferences'

class MemoryStorage implements Storage {
  #map = new Map<string, string>()
  get length(): number {
    return this.#map.size
  }
  clear(): void {
    this.#map.clear()
  }
  getItem(key: string): string | null {
    return this.#map.has(key) ? (this.#map.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value)
  }
  removeItem(key: string): void {
    this.#map.delete(key)
  }
  key(index: number): string | null {
    return Array.from(this.#map.keys())[index] ?? null
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  })
})

describe('mediaPreferences', () => {
  it('returns defaults on a fresh store', () => {
    expect(loadMediaPreferences()).toEqual(MEDIA_PREFERENCE_DEFAULTS)
  })

  it('round-trips each field through save/load', () => {
    saveMediaPreference('micDeviceId', 'mic-1')
    saveMediaPreference('cameraDeviceId', 'cam-1')
    saveMediaPreference('speakerDeviceId', 'spk-1')
    saveMediaPreference('echoCancellation', false)
    saveMediaPreference('noiseSuppression', false)
    saveMediaPreference('outputVolume', 0.5)

    expect(loadMediaPreferences()).toEqual({
      micDeviceId: 'mic-1',
      cameraDeviceId: 'cam-1',
      speakerDeviceId: 'spk-1',
      echoCancellation: false,
      noiseSuppression: false,
      outputVolume: 0.5,
    })
  })

  it('falls back to default per field when stored JSON is malformed', () => {
    localStorage.setItem('nshroud.call.mic', '{not json')
    localStorage.setItem('nshroud.call.echoCancellation', 'true-ish')
    localStorage.setItem('nshroud.call.outputVolume', 'NaN-ish')

    const prefs = loadMediaPreferences()
    expect(prefs.micDeviceId).toBeNull()
    expect(prefs.echoCancellation).toBe(MEDIA_PREFERENCE_DEFAULTS.echoCancellation)
    expect(prefs.outputVolume).toBe(MEDIA_PREFERENCE_DEFAULTS.outputVolume)
  })

  it('falls back when a stored value has the wrong JSON type', () => {
    localStorage.setItem('nshroud.call.mic', JSON.stringify(42))
    localStorage.setItem('nshroud.call.echoCancellation', JSON.stringify('yes'))
    localStorage.setItem('nshroud.call.outputVolume', JSON.stringify('loud'))

    const prefs = loadMediaPreferences()
    expect(prefs.micDeviceId).toBeNull()
    expect(prefs.echoCancellation).toBe(MEDIA_PREFERENCE_DEFAULTS.echoCancellation)
    expect(prefs.outputVolume).toBe(MEDIA_PREFERENCE_DEFAULTS.outputVolume)
  })

  it('clamps outputVolume to [0, 1]', () => {
    saveMediaPreference('outputVolume', 9)
    expect(loadMediaPreferences().outputVolume).toBe(1)

    saveMediaPreference('outputVolume', -2)
    expect(loadMediaPreferences().outputVolume).toBe(0)
  })

  it('treats empty-string device IDs as null', () => {
    saveMediaPreference('micDeviceId', '')
    expect(loadMediaPreferences().micDeviceId).toBeNull()
  })

  it('clears a device ID when saved as null', () => {
    saveMediaPreference('micDeviceId', 'mic-1')
    expect(loadMediaPreferences().micDeviceId).toBe('mic-1')
    saveMediaPreference('micDeviceId', null)
    expect(loadMediaPreferences().micDeviceId).toBeNull()
  })
})
