import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface SyncContextType {
  isOnline: boolean
  syncStatus: 'idle' | 'syncing' | 'error'
  lastSyncAt: string | null
  requestSync: () => void
}

const SyncContext = createContext<SyncContextType | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() => new Date().toISOString())

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const requestSync = () => {
    setLastSyncAt(new Date().toISOString())
  }

  return (
    <SyncContext.Provider
      value={{
        isOnline,
        syncStatus: 'idle',
        lastSyncAt,
        requestSync,
      }}
    >
      {children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncContextType {
  const context = useContext(SyncContext)
  if (!context) {
    return {
      isOnline: true,
      syncStatus: 'idle',
      lastSyncAt: null,
      requestSync: () => {},
    }
  }
  return context
}
