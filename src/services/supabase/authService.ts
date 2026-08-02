import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { jwtExpirySeconds } from './supabaseClient'

/**
 * authService — silent authentication for the single permanent account.
 *
 * No login screen, ever. On boot:
 *   1. Restore the persisted session (SDK storage). If the access token is
 *      expired, getSession() transparently refreshes it with the refresh token.
 *   2. If there is no session at all, silently sign in with the permanent
 *      dev account credentials (isolated in config/devCredentials).
 *   3. Subscribe to onAuthStateChange so token refreshes / sign-outs keep
 *      the UI in sync.
 *
 * All session management (persistence, auto-refresh) is delegated to the
 * Supabase SDK. This module owns none of it.
 */

export type AuthStatus =
  | 'loading'
  | 'authenticated'
  | 'anonymous'
  | 'not-configured'
  | 'error'

export interface AuthSnapshot {
  status: AuthStatus
  /** Supabase auth user UUID (auth.users.id) — null when not authenticated. */
  userId: string | null
  email: string | null
  /** Access token expiry as epoch seconds — null when not authenticated. */
  accessTokenExpiresAt: number | null
  /** Refresh token expiry as epoch seconds (decoded from the JWT) — null when unknown. */
  refreshTokenExpiresAt: number | null
  error: string | null
}

export const ANONYMOUS_SNAPSHOT: AuthSnapshot = {
  status: 'anonymous',
  userId: null,
  email: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  error: null,
}

/** Maps a Supabase Session to an AuthSnapshot (authenticated or anonymous). */
export function snapshotFromSession(session: Session | null): AuthSnapshot {
  if (!session || !session.user) return ANONYMOUS_SNAPSHOT
  return {
    status: 'authenticated',
    userId: session.user.id,
    email: session.user.email ?? null,
    accessTokenExpiresAt:
      typeof session.expires_at === 'number' ? session.expires_at : null,
    refreshTokenExpiresAt: session.refresh_token
      ? jwtExpirySeconds(session.refresh_token)
      : null,
    error: null,
  }
}

export interface Credentials {
  email: string
  password: string
}

export interface AuthServiceOptions {
  client: SupabaseClient
  /** Returns the permanent-account credentials for silent bootstrap, or null. */
  getCredentials?: () => Credentials | null
}

export class AuthService {
  private readonly client: SupabaseClient
  private readonly getCredentials: (() => Credentials | null) | undefined
  private unsubscribeFn: (() => void) | null = null

  constructor(options: AuthServiceOptions) {
    this.client = options.client
    this.getCredentials = options.getCredentials
  }

  /**
   * Boot sequence: restore session → silent bootstrap sign-in → snapshot.
   * Never throws; returns an error snapshot on any auth failure.
   */
  async initialize(): Promise<AuthSnapshot> {
    try {
      const { data } = await this.client.auth.getSession()
      if (data.session) return snapshotFromSession(data.session)

      const credentials = this.getCredentials?.() ?? null
      if (credentials) {
        return await this.bootstrapSignIn(credentials)
      }
      return ANONYMOUS_SNAPSHOT
    } catch (error) {
      return this.errorSnapshot(error)
    }
  }

  /** Force a refresh attempt: getSession() restores/refreshes, else re-bootstrap. */
  async refreshSession(): Promise<AuthSnapshot> {
    try {
      const { data } = await this.client.auth.getSession()
      if (data.session) return snapshotFromSession(data.session)

      const credentials = this.getCredentials?.() ?? null
      if (credentials) return await this.bootstrapSignIn(credentials)
      return ANONYMOUS_SNAPSHOT
    } catch (error) {
      return this.errorSnapshot(error)
    }
  }

  async signOut(): Promise<AuthSnapshot> {
    try {
      await this.client.auth.signOut()
      return ANONYMOUS_SNAPSHOT
    } catch (error) {
      return this.errorSnapshot(error)
    }
  }

  /** Live session changes (SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT / …). */
  subscribe(onChange: (snapshot: AuthSnapshot) => void): void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') onChange(ANONYMOUS_SNAPSHOT)
      else onChange(snapshotFromSession(session))
    })
    this.unsubscribeFn = () => data.subscription.unsubscribe()
  }

  dispose(): void {
    if (this.unsubscribeFn) {
      this.unsubscribeFn()
      this.unsubscribeFn = null
    }
  }

  private async bootstrapSignIn(
    credentials: Credentials,
  ): Promise<AuthSnapshot> {
    const { data, error } = await this.client.auth.signInWithPassword(credentials)
    if (error) {
      return {
        status: 'error',
        userId: null,
        email: credentials.email,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        error: error.message,
      }
    }
    return snapshotFromSession(data.session ?? null)
  }

  private errorSnapshot(error: unknown): AuthSnapshot {
    return {
      status: 'error',
      userId: null,
      email: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
