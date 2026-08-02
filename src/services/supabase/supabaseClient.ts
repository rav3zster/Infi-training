import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * supabaseClient — the ONLY place that constructs the Supabase client.
 *
 * Config is read from Vite env vars (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
 * When the env vars are missing, empty, or still contain the .env.example
 * placeholders, the client is NOT created and the app reports
 * "not-configured" — the application must keep working without Supabase.
 *
 * The publishable (anon) key is the only key ever used in the client bundle.
 * The secret/service-role key must never appear in frontend code.
 */

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

/** Marker substrings that indicate the .env.example placeholders were not replaced. */
const PLACEHOLDER_MARKERS = [
  'your-project.supabase.co',
  'your-publishable-key',
  '<',
  'changeme',
]

/**
 * Validates the environment and returns the Supabase config, or null when not
 * configured. Pure and injectable so unit tests can exercise every branch.
 */
export function getSupabaseConfig(
  env: Record<string, unknown> = import.meta.env as Record<string, unknown>,
): SupabaseConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : ''
  const key =
    typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string'
      ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      : ''

  if (!url || !key) return null
  if (!/^https?:\/\/.+/.test(url)) return null
  if (PLACEHOLDER_MARKERS.some(m => url.includes(m) || key.includes(m))) return null
  if (key.length < 16) return null

  return { url, publishableKey: key }
}

let cachedClient: SupabaseClient | null | undefined

/** Lazy singleton — returns null (never throws) when Supabase is not configured. */
export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig()
  if (!config) return null
  if (cachedClient === undefined) {
    cachedClient = createClient(config.url, config.publishableKey, {
      auth: {
        // Session is persisted to localStorage by the SDK and restored on
        // boot; expired access tokens are auto-refreshed in the background.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return cachedClient
}

/** Reset the cached client (used only by tests). */
export function resetSupabaseClientForTests(): void {
  cachedClient = undefined
}

/**
 * Decodes the payload segment of a JWT without verifying its signature.
 * Returns null on any malformed input — never throws.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2 || !parts[1]) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const payload = JSON.parse(json) as Record<string, unknown>
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

/** Reads the `exp` claim (epoch seconds) from a JWT, or null when unavailable. */
export function jwtExpirySeconds(token: string): number | null {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return null
  return payload.exp
}
