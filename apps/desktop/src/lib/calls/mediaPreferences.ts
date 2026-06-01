export interface MediaPreferences {
  micDeviceId: string | null
  cameraDeviceId: string | null
  speakerDeviceId: string | null
  echoCancellation: boolean
  noiseSuppression: boolean
  outputVolume: number
}

const PREFIX = 'nshroud.call.'

const KEYS: Record<keyof MediaPreferences, string> = {
  micDeviceId: `${PREFIX}mic`,
  cameraDeviceId: `${PREFIX}camera`,
  speakerDeviceId: `${PREFIX}speaker`,
  echoCancellation: `${PREFIX}echoCancellation`,
  noiseSuppression: `${PREFIX}noiseSuppression`,
  outputVolume: `${PREFIX}outputVolume`,
}

export const MEDIA_PREFERENCE_DEFAULTS: Readonly<MediaPreferences> = Object.freeze({
  micDeviceId: null,
  cameraDeviceId: null,
  speakerDeviceId: null,
  echoCancellation: true,
  noiseSuppression: true,
  outputVolume: 1,
})

function safeGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    /* quota / private mode — drop silently, preferences are non-critical */
  }
}

function readString(key: string): string | null {
  const raw = safeGet(key)
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = safeGet(key)
  if (raw == null) return fallback
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'boolean' ? parsed : fallback
  } catch {
    return fallback
  }
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  const raw = safeGet(key)
  if (raw == null) return fallback
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  } catch {
    return fallback
  }
}

export function loadMediaPreferences(): MediaPreferences {
  return {
    micDeviceId: readString(KEYS.micDeviceId),
    cameraDeviceId: readString(KEYS.cameraDeviceId),
    speakerDeviceId: readString(KEYS.speakerDeviceId),
    echoCancellation: readBool(KEYS.echoCancellation, MEDIA_PREFERENCE_DEFAULTS.echoCancellation),
    noiseSuppression: readBool(KEYS.noiseSuppression, MEDIA_PREFERENCE_DEFAULTS.noiseSuppression),
    outputVolume: readNumber(KEYS.outputVolume, MEDIA_PREFERENCE_DEFAULTS.outputVolume, 0, 1),
  }
}

export function saveMediaPreference<K extends keyof MediaPreferences>(
  key: K,
  value: MediaPreferences[K],
): void {
  safeSet(KEYS[key], JSON.stringify(value))
}
