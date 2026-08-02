import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { enqueueSettingsSync } from '../services/sync/settingsSync'

interface ThemeContextType {
  isDark: boolean
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

const STORAGE_KEY = 'training-tracker-theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored !== null) return stored === 'dark'
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Set true ONLY while adopting a theme pushed by the Sync Engine, so the
  // enqueue below doesn't echo the same value back to the cloud (no loop).
  const adoptingRemote = useRef(false)

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    try {
      localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light')
    } catch {}
    // Phase 3: enqueue the settings row so the new theme syncs to the cloud
    // (last-write-wins). Skipped while adopting a remote theme.
    const wasRemote = adoptingRemote.current
    adoptingRemote.current = false
    if (!wasRemote) {
      void enqueueSettingsSync()
    }
  }, [isDark])

  // Phase 3: adopt a theme synced from another device (Sync Engine download).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onRemoteTheme = (e: Event) => {
      const theme = (e as CustomEvent<string>).detail
      if (theme === 'dark') {
        adoptingRemote.current = true
        setIsDark(true)
      } else if (theme === 'light') {
        adoptingRemote.current = true
        setIsDark(false)
      }
    }
    window.addEventListener('training:theme-applied', onRemoteTheme)
    return () => window.removeEventListener('training:theme-applied', onRemoteTheme)
  }, [])

  const toggleTheme = () => setIsDark(prev => !prev)

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
