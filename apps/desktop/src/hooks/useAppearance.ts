import { useCallback, useSyncExternalStore } from 'react'

/** Brand accents available in Settings ▸ Appearance. `ember` is the NShroud
 *  default baked into `:root`; the rest map to `.accent-*` classes in
 *  App.css. `custom` injects a user-picked color as inline vars on <html>. */
export type Accent = 'ember' | 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'custom'
/** Sidebar/icon-rail tone: follow the canvas palette, or pin the dark chrome. */
export type ChromeTone = 'match' | 'contrast'

export interface AppearanceState {
  accent: Accent
  chrome: ChromeTone
  glass: boolean
  customAccent: string
}

export const ACCENTS: Exclude<Accent, 'custom'>[] = [
  'ember',
  'slate',
  'indigo',
  'emerald',
  'amber',
  'rose',
]

const ALL_ACCENT_CLASSES: Accent[] = [...ACCENTS, 'custom']

const STORAGE_KEY = 'nshroud-appearance'

const DEFAULTS: AppearanceState = {
  accent: 'ember',
  chrome: 'match',
  glass: false,
  customAccent: '#ff7b00',
}

function isAccent(v: unknown): v is Accent {
  return typeof v === 'string' && (ALL_ACCENT_CLASSES as string[]).includes(v)
}

function loadStored(): AppearanceState {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<AppearanceState>
    return {
      accent: isAccent(parsed.accent) ? parsed.accent : DEFAULTS.accent,
      chrome: parsed.chrome === 'contrast' ? 'contrast' : 'match',
      glass: parsed.glass === true,
      customAccent:
        typeof parsed.customAccent === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.customAccent)
          ? parsed.customAccent
          : DEFAULTS.customAccent,
    }
  } catch {
    return DEFAULTS
  }
}

/** Pick a readable foreground for an arbitrary user-chosen accent. */
function contrastFg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.4 ? 'oklch(0.15 0 0)' : 'oklch(0.985 0 0)'
}

function applyToHtml(state: AppearanceState): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  for (const a of ALL_ACCENT_CLASSES) el.classList.remove(`accent-${a}`)
  el.classList.add(`accent-${state.accent}`)
  el.classList.toggle('chrome-contrast', state.chrome === 'contrast')
  el.classList.toggle('glass-on', state.glass)
  if (state.accent === 'custom') {
    el.style.setProperty('--brand', state.customAccent)
    el.style.setProperty('--brand-fg', contrastFg(state.customAccent))
  } else {
    el.style.removeProperty('--brand')
    el.style.removeProperty('--brand-fg')
  }
}

// Module-level store (same pattern as useTheme) so every consumer reads the
// same value and the classes on <html> are written exactly once per change.
let current: AppearanceState = loadStored()
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot(): AppearanceState {
  return current
}

function setStore(patch: Partial<AppearanceState>): void {
  current = { ...current, ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  applyToHtml(current)
  for (const fn of listeners) fn()
}

// Apply once at module load so the first paint matches stored preferences.
applyToHtml(current)

/**
 * Appearance controller — accent, sidebar tone, and floating glass.
 * Light/dark mode stays in useTheme; the Appearance settings UI composes
 * both. All changes apply instantly and persist to localStorage.
 */
export function useAppearance() {
  const appearance = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const update = useCallback((patch: Partial<AppearanceState>) => {
    setStore(patch)
  }, [])

  return { appearance, update }
}
