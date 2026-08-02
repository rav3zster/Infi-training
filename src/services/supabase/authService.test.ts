import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import {
  getSupabaseConfig,
  decodeJwtPayload,
  jwtExpirySeconds,
  getSupabaseClient,
  resetSupabaseClientForTests,
} from './supabaseClient'
import {
  AuthService,
  snapshotFromSession,
  ANONYMOUS_SNAPSHOT,
  type AuthSnapshot,
} from './authService'

// Build a real-shaped JWT with a known payload (for exp decoding).
function jwt(payload: Record<string, unknown>): string {
  const b64 = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${b64(payload)}.signature`
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: jwt({ exp: 2_000_000_000 }),
    refresh_token: jwt({ exp: 2_100_000_000 }),
    expires_in: 3600,
    expires_at: 2_000_000_000,
    token_type: 'bearer',
    user: { id: 'user-123', email: 'dev@infosys.test' } as unknown as Session['user'],
    ...overrides,
  }
}

/** A minimal Supabase auth mock surface. */
function mockClient() {
  const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
  const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const unsubscribe = vi.fn()
  let handler: ((event: string, session: Session | null) => void) | null = null
  const onAuthStateChange = vi.fn((cb: (event: string, session: Session | null) => void) => {
    handler = cb
    return { data: { subscription: { unsubscribe } } }
  })
  const auth = { getSession, signInWithPassword, signOut, onAuthStateChange }
  const client = { auth } as unknown as SupabaseClient
  return {
    client,
    auth,
    getSession,
    signInWithPassword,
    signOut,
    unsubscribe,
    emit: (e: string, s: Session | null) => handler?.(e, s),
  }
}

// Force the env used by the lazy client factory to "empty" so tests are
// deterministic regardless of what the developer has in .env.
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
  resetSupabaseClientForTests()
})
afterEach(() => {
  vi.unstubAllEnvs()
  resetSupabaseClientForTests()
})

describe('getSupabaseConfig', () => {
  it('returns null when env vars are missing', () => {
    expect(getSupabaseConfig({})).toBeNull()
  })

  it('rejects the .env.example placeholder values', () => {
    const env = {
      VITE_SUPABASE_URL: 'https://your-project.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'your-publishable-key',
    }
    expect(getSupabaseConfig(env)).toBeNull()
  })

  it('rejects non-http URLs and too-short keys', () => {
    expect(
      getSupabaseConfig({
        VITE_SUPABASE_URL: 'ftp://not-http',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'k'.repeat(20),
      }),
    ).toBeNull()
    expect(
      getSupabaseConfig({
        VITE_SUPABASE_URL: 'https://ok.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'short',
      }),
    ).toBeNull()
  })

  it('accepts a valid config', () => {
    expect(
      getSupabaseConfig({
        VITE_SUPABASE_URL: 'https://abc123.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc',
      }),
    ).toEqual({
      url: 'https://abc123.supabase.co',
      publishableKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc',
    })
  })

  it('getSupabaseClient returns null when not configured (never throws)', () => {
    expect(getSupabaseClient()).toBeNull()
  })
})

describe('JWT helpers', () => {
  it('decodes a payload and reads exp', () => {
    const token = jwt({ exp: 1_234_567_890, ref: 'abc' })
    expect(decodeJwtPayload(token)).toEqual({ exp: 1_234_567_890, ref: 'abc' })
    expect(jwtExpirySeconds(token)).toBe(1_234_567_890)
  })

  it('returns null for malformed input and missing exp', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
    expect(decodeJwtPayload('a.b')).toBeNull()
    expect(jwtExpirySeconds('a.b.c')).toBeNull()
    expect(jwtExpirySeconds(jwt({ foo: 1 }))).toBeNull()
  })
})

describe('snapshotFromSession', () => {
  it('maps session fields incl. decoded refresh-token expiry', () => {
    const snap = snapshotFromSession(makeSession())
    expect(snap).toEqual({
      status: 'authenticated',
      userId: 'user-123',
      email: 'dev@infosys.test',
      accessTokenExpiresAt: 2_000_000_000,
      refreshTokenExpiresAt: 2_100_000_000,
      error: null,
    })
  })

  it('returns anonymous for a null session', () => {
    expect(snapshotFromSession(null)).toEqual(ANONYMOUS_SNAPSHOT)
  })
})

describe('AuthService', () => {
  it('restores an existing session without signing in', async () => {
    const m = mockClient()
    m.getSession.mockResolvedValue({ data: { session: makeSession() }, error: null })
    const service = new AuthService({ client: m.client, getCredentials: () => null })

    const snap = await service.initialize()

    expect(snap.status).toBe('authenticated')
    expect(snap.userId).toBe('user-123')
    expect(m.signInWithPassword).not.toHaveBeenCalled()
  })

  it('silently bootstraps a sign-in when no session and dev credentials exist', async () => {
    const m = mockClient()
    m.signInWithPassword.mockResolvedValue({ data: { session: makeSession() }, error: null })
    const service = new AuthService({
      client: m.client,
      getCredentials: () => ({ email: 'dev@infosys.test', password: 'secret' }),
    })

    const snap = await service.initialize()

    expect(m.signInWithPassword).toHaveBeenCalledWith({
      email: 'dev@infosys.test',
      password: 'secret',
    })
    expect(snap.status).toBe('authenticated')
  })

  it('stays anonymous when no session and no credentials', async () => {
    const m = mockClient()
    const service = new AuthService({ client: m.client, getCredentials: () => null })

    const snap = await service.initialize()

    expect(snap).toEqual(ANONYMOUS_SNAPSHOT)
    expect(m.signInWithPassword).not.toHaveBeenCalled()
  })

  it('never throws — returns an error snapshot when getSession itself fails', async () => {
    const m = mockClient()
    m.getSession.mockRejectedValue(new Error('network down'))
    const service = new AuthService({ client: m.client, getCredentials: () => null })

    const snap = await service.initialize()

    expect(snap.status).toBe('error')
    expect(snap.error).toBe('network down')
  })

  it('surfaces a sign-in error without throwing', async () => {
    const m = mockClient()
    m.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    })
    const service = new AuthService({
      client: m.client,
      getCredentials: () => ({ email: 'dev@infosys.test', password: 'wrong' }),
    })

    const snap = await service.initialize()

    expect(snap.status).toBe('error')
    expect(snap.error).toBe('Invalid login credentials')
  })

  it('refreshSession re-bootstraps when the session is gone', async () => {
    const m = mockClient()
    m.signInWithPassword.mockResolvedValue({ data: { session: makeSession() }, error: null })
    const service = new AuthService({
      client: m.client,
      getCredentials: () => ({ email: 'dev@infosys.test', password: 'secret' }),
    })

    const snap = await service.refreshSession()

    expect(snap.status).toBe('authenticated')
    expect(m.signInWithPassword).toHaveBeenCalledTimes(1)
  })

  it('subscribes to token refreshes and sign-outs', () => {
    const m = mockClient()
    const service = new AuthService({ client: m.client, getCredentials: () => null })
    const onChange = vi.fn()
    service.subscribe(onChange)

    m.emit('TOKEN_REFRESHED', makeSession())
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining<Partial<AuthSnapshot>>({ status: 'authenticated' }),
    )

    m.emit('SIGNED_OUT', null)
    expect(onChange).toHaveBeenLastCalledWith(ANONYMOUS_SNAPSHOT)
    service.dispose()
  })

  it('dispose unsubscribes the auth listener', () => {
    const m = mockClient()
    const service = new AuthService({ client: m.client, getCredentials: () => null })
    service.subscribe(() => {})
    service.dispose()
    expect(m.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
