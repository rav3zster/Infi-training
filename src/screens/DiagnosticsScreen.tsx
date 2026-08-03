import { ArrowLeft, Database, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSync } from '../context/SyncContext'

interface Props {
  onExit: () => void
}

export default function DiagnosticsScreen({ onExit }: Props) {
  const { isOnline } = useSync()
  const { snapshot: auth, isConfigured } = useAuth()

  return (
    <div className="min-h-screen bg-bg-primary p-4 sm:p-6 space-y-5" style={{ maxWidth: 960, margin: '0 auto' }}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            className="w-9 h-9 rounded-lg border border-border-color flex items-center justify-center text-text-primary hover:border-text-secondary transition-colors cursor-pointer"
            aria-label="Back to app"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="r-text-h1 font-semibold text-text-primary">Developer Diagnostics</h1>
            <p className="r-text-tiny text-text-secondary">Pure Supabase Cloud Architecture Status</p>
          </div>
        </div>
      </header>

      {/* Cloud Status */}
      <div className="r-card r-p-card space-y-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-text-primary" />
          <h2 className="r-text-h2 font-semibold text-text-primary">Cloud Connection & Auth</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 r-text-small">
          <div className="p-3 rounded-lg border border-border-color bg-bg-primary flex justify-between">
            <span className="text-text-secondary">Network Connection</span>
            <span className={`font-semibold ${isOnline ? 'text-emerald-500' : 'text-rose-500'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="p-3 rounded-lg border border-border-color bg-bg-primary flex justify-between">
            <span className="text-text-secondary">Supabase Configured</span>
            <span className="font-semibold text-text-primary">{isConfigured ? 'Yes' : 'No'}</span>
          </div>
          <div className="p-3 rounded-lg border border-border-color bg-bg-primary flex justify-between">
            <span className="text-text-secondary">Auth Status</span>
            <span className="font-semibold text-text-primary">{auth.status}</span>
          </div>
          <div className="p-3 rounded-lg border border-border-color bg-bg-primary flex justify-between">
            <span className="text-text-secondary">User ID</span>
            <span className="font-mono text-xs text-text-primary truncate max-w-[150px]">
              {auth.userId ?? 'None'}
            </span>
          </div>
        </div>
      </div>

      {/* Architecture Note */}
      <div className="r-card r-p-card space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-500" />
          <h3 className="r-text-small font-semibold text-text-primary">Pure Cloud-First Engine</h3>
        </div>
        <p className="r-text-tiny text-text-secondary leading-relaxed">
          This app runs on a pure Supabase Cloud-First architecture with zero local data persistence.
          Application state is stored in Postgres, hydrated on mount, and synchronized live across devices via Supabase Realtime WS.
        </p>
      </div>
    </div>
  )
}
