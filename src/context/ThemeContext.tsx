import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** Visual style of the app. A pure UI preference: applied as
 *  <html data-style="…"> and persisted locally. Dark/Light mode
 *  composes on top of any style. */
export type ThemeStyle = 'minimal' | 'neobrutalism' | 'cyberpunk' | 'aurora'

interface ThemeContextType {
  isDark: boolean
  toggleTheme: () => void
  style: ThemeStyle
  setStyle: (style: ThemeStyle) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)
const STORAGE_KEY = 'training-tracker-theme'
const STYLE_KEY = 'training-tracker-theme-style'

const STYLES: ThemeStyle[] = ['minimal', 'neobrutalism', 'cyberpunk', 'aurora']

function readInitialStyle(): ThemeStyle {
  try {
    const stored = localStorage.getItem(STYLE_KEY)
    if (stored !== null && (STYLES as string[]).includes(stored)) return stored as ThemeStyle
  } catch {}
  return 'minimal'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored !== null) return stored === 'dark'
    } catch {}
    return typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
  })
  const [style, setStyleState] = useState<ThemeStyle>(() => {
    const s = readInitialStyle()
    // Set synchronously so a saved Neobrutalism style never flashes the
    // default theme on first paint (matches how .dark is applied later).
    if (typeof document !== 'undefined') document.documentElement.dataset.style = s
    return s
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', isDark)
    root.dataset.style = style
    try {
      localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light')
      localStorage.setItem(STYLE_KEY, style)
    } catch {}
  }, [isDark, style])

  const toggleTheme = () => setIsDark(prev => !prev)
  const setStyle = (s: ThemeStyle) => setStyleState(s)

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, style, setStyle }}>
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
