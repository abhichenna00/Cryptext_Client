import { useCallback, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'
const STORAGE_KEY = 'nshroud-theme'

function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Module-level store so every useTheme() consumer reads the same value. The
// previous per-hook useState gave each call site its own state, so toggling
// from one component left every other useTheme() (e.g. the Radix Themes
// provider in App.tsx) stuck on the old theme until an app restart.
let currentTheme: Theme = getStoredTheme() ?? getSystemTheme()
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot(): Theme {
  return currentTheme
}

/**
 * Write the `dark` class to `<html>` synchronously so the custom CSS
 * variables in `App.css`'s `.dark { ... }` block flip immediately. Going
 * through `useEffect` left a window where two `useTheme()` consumers could
 * re-add `.dark` racily — Radix Themes flipped its own wrapper to `light` for
 * Tabs/Dialogs, but `<html>` kept `.dark`, so all Tailwind utilities like
 * `bg-bg`/`bg-surface` stayed at their dark values.
 */
function applyHtmlDarkClass(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

function setStoreTheme(next: Theme): void {
  if (next === currentTheme) return
  currentTheme = next
  applyHtmlDarkClass(next)
  for (const fn of listeners) fn()
}

// Apply once at module load so the first paint matches the stored / system
// theme without waiting for React to mount.
applyHtmlDarkClass(currentTheme)

// Track the OS preference once at module level; only honor it while the user
// has no explicit override set.
if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', (e) => {
    if (getStoredTheme() === null) {
      setStoreTheme(e.matches ? 'dark' : 'light')
    }
  })
}

/**
 * Theme controller. A user override (saved to localStorage) takes precedence
 * over the OS preference. The `.dark` class on `<html>` drives the custom
 * design-token cascade (`--bg`, `--surface`, etc.) used by Tailwind utilities
 * across the app. Radix Themes drives its own light/dark wrapper class
 * independently via the `<Theme appearance>` prop in `App.tsx`.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const toggle = useCallback(() => {
    const next: Theme = currentTheme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, next)
    setStoreTheme(next)
  }, [])

  return { theme, toggle }
}
