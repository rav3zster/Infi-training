import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { syncStatusService, type SyncStatus, type SyncProgress } from '../services/sync/SyncStatus'
import { getSyncEngine } from '../services/sync/syncEngine'
import { realtimeService } from '../services/sync/realtimeService'
import { getSupabaseClient } from '../services/supabase/supabaseClient'
import { localDatabase, type SyncStats } from '../services/database/LocalDatabase'
import { useAuth } from './AuthContext'

/**
 * SyncContext — exposes the live state of the background Sync Engine.
 *
 * The engine itself is a pure service (services/sync/syncEngine.ts). This
 * provider owns its lifecycle:
 *   • start the periodic cycle (every 20s while online)
 *   • run a cycle as soon as silent auth succeeds
 *   • subscribe to Supabase Realtime (postgres_changes) while authenticated,
 *     so changes made on ANOTHER device trigger a delta download + merge
 *     within seconds — no refresh button
 *   • run a cycle on reconnect and on every local `sync:request` event
 *     (dispatched by TrainingContext after mutations)
 *   • purge remote data on `training:purge` (factory reset)
 *
 * The UI never blocks on the network — everything happens in the background.
 */

interface SyncContextType {
  status: SyncStatus
  progress: SyncProgress | null
  isOnline: boolean
  lastSyncAt: string | null
  stats: SyncStats | null
  syncNow: () => Promise<void>
  clearError: () => void
}

const SyncContext = createContext<SyncContextType | null>(null)

const PERIODIC_MS = 3_000

export function SyncProvider({ children }: { children: ReactNode }) {
  const { snapshot: auth } = useAuth()
  const [status, setStatus] = useState<SyncStatus>(() => syncStatusService.get())
  const [progress, setProgress] = useState<SyncProgress | null>(() => syncStatusService.getProgress())
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [stats, setStats] = useState<SyncStats | null>(null)

  // ── Subscribe to the status service ──
  useEffect(() => {
    const unsubscribe = syncStatusService.subscribe(event => {
      if (event.type === 'status') {
        setStatus(event.status)
        setProgress(event.progress)
      }
    })
    return unsubscribe
  }, [])

  // ── Refresh persisted stats + lastSyncAt whenever status settles ──
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const [s, t] = await Promise.all([localDatabase.getSyncStats(), localDatabase.getLastSyncAt()])
      if (cancelled) return
      setStats(s)
      setLastSyncAt(t)
    }
    void refresh()
    const iv = window.setInterval(() => void refresh(), 4000)
    return () => {
      cancelled = true
      window.clearInterval(iv)
    }
  }, [status])

  // ── Silent-auth success triggers an immediate sync cycle ──
  const authStatus = auth.status
  useEffect(() => {
    if (authStatus === 'authenticated') {
      void getSyncEngine().syncNow()
    }
  }, [authStatus])

  // ── Supabase Realtime: subscribe while authenticated, unsubscribe on logout ──
  useEffect(() => {
    if (authStatus !== 'authenticated' || !auth.userId) return
    const client = getSupabaseClient()
    if (!client) return
    realtimeService.subscribe(client, auth.userId)
    return () => realtimeService.unsubscribe()
  }, [authStatus, auth.userId])

  // ── Realtime event from another device → record it + trigger a delta sync ──
  useEffect(() => {
    const onRealtime = () => {
      void localDatabase.updateSyncStats({ lastRealtimeEvent: new Date().toISOString() })
      // A remote change means the cloud moved past our watermark — pull it now.
      getSyncEngine().requestSync(1500)
    }
    window.addEventListener('sync:realtime', onRealtime)
    return () => window.removeEventListener('sync:realtime', onRealtime)
  }, [])

  // ── Local mutation event → background sync (throttled by the engine) ──
  useEffect(() => {
    const onRequest = () => getSyncEngine().requestSync()
    const onPurge = () => void getSyncEngine().purgeRemote()
    window.addEventListener('sync:request', onRequest)
    window.addEventListener('training:purge', onPurge)
    return () => {
      window.removeEventListener('sync:request', onRequest)
      window.removeEventListener('training:purge', onPurge)
    }
  }, [])

  // ── Online / offline ──
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      syncStatusService.set('idle')
      getSyncEngine().requestSync()
    }
    const onOffline = () => {
      setIsOnline(false)
      syncStatusService.set('offline')
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // ── Periodic background cycle while online + immediate sync on focus/visibility ──
  useEffect(() => {
    const triggerSync = () => {
      if (navigator.onLine) getSyncEngine().requestSync(500)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') triggerSync()
    }

    window.addEventListener('focus', triggerSync)
    document.addEventListener('visibilitychange', onVisibility)

    const iv = window.setInterval(() => {
      if (navigator.onLine) getSyncEngine().requestSync(2_000)
    }, PERIODIC_MS)

    return () => {
      window.removeEventListener('focus', triggerSync)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(iv)
    }
  }, [])

  const syncNow = useCallback(async () => {
    await getSyncEngine().syncNow()
  }, [])

  const clearError = useCallback(() => {
    syncStatusService.set('idle')
  }, [])

  return (
    <SyncContext.Provider value={{ status, progress, isOnline, lastSyncAt, stats, syncNow, clearError }}>
      {children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncContextType {
  const context = useContext(SyncContext)
  if (!context) throw new Error('useSync must be used within a SyncProvider')
  return context
}
