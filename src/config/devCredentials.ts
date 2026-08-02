/**
 * DEV-ONLY credential source for one-time bootstrap authentication.
 *
 * !!! REPLACE BEFORE RELEASE !!!
 * Replace this with an EdgeFunctionCredentialSource (Phase 2/9) so the
 * permanent account credentials never ship in the application bundle.
 *
 * This module is guarded by import.meta.env.DEV so Vite tree-shakes it out
 * of production builds entirely — the production bundle contains no secrets.
 */

interface Credentials {
  email: string
  password: string
}

/**
 * Returns dev bootstrap credentials when present in the environment,
 * otherwise null. Reads VITE_DEV_EMAIL / VITE_DEV_PASSWORD from .env.
 */
export function getDevCredentials(): Credentials | null {
  if (!import.meta.env.DEV) return null
  const email = import.meta.env.VITE_DEV_EMAIL as string | undefined
  const password = import.meta.env.VITE_DEV_PASSWORD as string | undefined
  if (!email || !password) return null
  return { email, password }
}
