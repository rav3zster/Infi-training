import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { syncStatusService, type SyncStatus } from '../services/sync/SyncStatus'
import { localDatabase } from '../services/database/LocalDatabase'

interface SyncContextType {
  status: SyncStatus
  isOnline: boolean
  lastSyncAt: string | null
  syncNow: () => Promise<void>
  clearError: () => void
}

const SyncContext = createContext<SyncContextType | null>(null)

/**
 * SyncContext — exposes the sync status service to the UI and tracks the
 * network state. The actual sync engine (Phase 3) plugs into this provider;
 * today it reports idle/offline and exposes a manual sync hook.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>(() => syncStatusService.get())
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = syncStatusService.subscribe(event => {
      if (event.type === 'status') setStatus(event.status)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      syncStatusService.set('idle')
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

  useEffect(() => {
    let cancelled = false
    localDatabase.getLastSyncAt().then(ts => {
      if (!cancelled) setLastSyncAt(ts)
    })
    return () => {
      cancelled = true
    }
  }, [status])

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) {
      syncStatusService.set('offline')
      return
    }
    // Phase 3: invoke the SyncEngine. For now record an idle heartbeat.
    const ts = new Date().toISOString()
    await localDatabase.setLastSyncAt(ts)
    setLastSyncAt(ts)
  }, [])

  const clearError = useCallback(() => {
    syncStatusService.set('idle')
  }, [])

  return (
    <SyncContext.Provider value={{ status, isOnline, lastSyncAt, syncNow, clearError }}>
      {children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncContextType {
  const context = useContext(SyncContext)
  if (!context) throw new Error('useSync must be used within a SyncProvider')
  return context
}
