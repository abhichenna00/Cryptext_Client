import { useCallback, useEffect, useSyncExternalStore } from 'react'

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

function setStoreTheme(next: Theme): void {
  if (next === currentTheme) return
  currentTheme = next
  for (const fn of listeners) fn()
}

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
 * over the OS preference. The `.dark` class is written to <html> so Tailwind's
 * dark variant reaches portalled content (dialogs, dropdowns) too.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [theme])

  const toggle = useCallback(() => {
    const next: Theme = currentTheme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, next)
    setStoreTheme(next)
  }, [])

  return { theme, toggle }
}
