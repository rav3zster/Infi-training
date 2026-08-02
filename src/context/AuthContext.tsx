import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getSupabaseClient } from '../services/supabase/supabaseClient'
import {
  AuthService,
  ANONYMOUS_SNAPSHOT,
  type AuthSnapshot,
} from '../services/supabase/authService'
import { getDevCredentials } from '../config/devCredentials'

interface AuthContextType {
  snapshot: AuthSnapshot
  isConfigured: boolean
  refreshSession: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

/**
 * AuthProvider — silent authentication for the single permanent account.
 *
 * NON-BLOCKING by design: children render immediately regardless of auth
 * state, so the app always boots without a login screen. Auth runs in the
 * background (restore session → bootstrap sign-in) and the UI simply reads
 * the latest snapshot.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    status: 'loading',
    userId: null,
    email: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    error: null,
  })
  const serviceRef = useRef<AuthService | null>(null)

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client) {
      // No (valid) env config — nothing to authenticate against.
      setSnapshot({ ...ANONYMOUS_SNAPSHOT, status: 'not-configured' })
      return
    }

    const service = new AuthService({ client, getCredentials: getDevCredentials })
    serviceRef.current = service
    let cancelled = false
    let initialized = false

    void service.initialize().then(s => {
      // initialize() is the source of truth for boot state.
      initialized = true
      if (!cancelled) setSnapshot(s)
    })
    service.subscribe(s => {
      // Ignore pre-initialize events (INITIAL_SESSION) so the UI never
      // flashes Anonymous before the bootstrap sign-in completes.
      if (!initialized || cancelled) return
      setSnapshot(s)
    })

    return () => {
      cancelled = true
      service.dispose()
      serviceRef.current = null
    }
  }, [])

  const refreshSession = useCallback(async () => {
    const service = serviceRef.current
    if (!service) return
    setSnapshot(await service.refreshSession())
  }, [])

  const signOut = useCallback(async () => {
    const service = serviceRef.current
    if (!service) return
    setSnapshot(await service.signOut())
  }, [])

  const value = useMemo<AuthContextType>(
    () => ({
      snapshot,
      isConfigured: snapshot.status !== 'not-configured',
      refreshSession,
      signOut,
    }),
    [snapshot, refreshSession, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
