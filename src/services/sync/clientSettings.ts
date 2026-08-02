/**
 * clientSettings — localStorage-backed per-device settings shared by the UI
 * (ThemeContext, PresetsScreen) and the Sync Engine's upload/download wiring.
 *
 * Both theme and simulated date-offset are synced to the `settings` Supabase
 * table. Writes dispatch window events so the UI adopts remote values pushed
 * by the Sync Engine (last-write-wins on updated_at, like every other row).
 */

const THEME_KEY = 'training-tracker-theme'
const DATE_OFFSET_KEY = 'training-tracker-date-offset'

export function readTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function writeTheme(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* best-effort */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('training:theme-applied', { detail: theme }))
  }
}

export function readDateOffset(): number {
  try {
    const n = Number(localStorage.getItem(DATE_OFFSET_KEY) ?? 0)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function writeDateOffset(offset: number): void {
  try {
    localStorage.setItem(DATE_OFFSET_KEY, String(offset))
  } catch {
    /* best-effort */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('training:date-offset-applied', { detail: offset }))
  }
}
