/**
 * Bootstrap credential source for silent authentication.
 *
 * Reads VITE_DEV_EMAIL / VITE_DEV_PASSWORD from .env. These values are
 * inlined by Vite into every build (dev, preview, and production/APK) so
 * the app can authenticate on all platforms.
 *
 * !!! REPLACE BEFORE MULTI-USER RELEASE !!!
 * Replace with an EdgeFunctionCredentialSource (Phase 2/9) so credentials
 * are never shipped inside the bundle.
 */

interface Credentials {
  email: string
  password: string
}

/**
 * Returns bootstrap credentials when present in the environment, otherwise
 * null. Reads VITE_DEV_EMAIL / VITE_DEV_PASSWORD from .env.
 */
export function getDevCredentials(): Credentials | null {
  const email = import.meta.env.VITE_DEV_EMAIL as string | undefined
  const password = import.meta.env.VITE_DEV_PASSWORD as string | undefined
  if (!email || !password) return null
  return { email, password }
}
