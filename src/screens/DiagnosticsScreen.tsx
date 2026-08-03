import { useEffect, useState } from 'react'
import { ArrowLeft, Database, ShieldCheck, Wifi, WifiOff, Activity, Clock, Zap } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSync } from '../context/SyncContext'
import { cloudRealtime, type RealtimeStats } from '../services/cloud/cloudRealtime'

interface Props {
  onExit: () => void
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold
        ${ok
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
        }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-400'} inline-block`} />
      {label}
    </span>
  )
}

function RealtimeStatusBadge({ status }: { status: RealtimeStats['status'] }) {
  const map = {
    connected:     { color: 'emerald', label: 'Connected', dot: 'animate-pulse' },
    connecting:    { color: 'amber',   label: 'Connecting…', dot: 'animate-pulse' },
    disconnected:  { color: 'slate',   label: 'Disconnected', dot: '' },
    error:         { color: 'rose',    label: 'Error', dot: '' },
  }
  const { color, label, dot } = map[status] ?? map.disconnected
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold
      bg-${color}-500/15 text-${color}-400 border border-${color}-500/30`}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-${color}-400 inline-block ${dot}`} />
      {label}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg border border-border-color bg-bg-primary flex items-center justify-between gap-4">
      <span className="text-sm text-text-secondary flex-shrink-0">{label}</span>
      <span className="text-sm font-semibold text-text-primary text-right">{children}</span>
    </div>
  )
}

export default function DiagnosticsScreen({ onExit }: Props) {
  const { isOnline } = useSync()
  const { snapshot: auth, isConfigured } = useAuth()
  const [rtStats, setRtStats] = useState<RealtimeStats>(cloudRealtime.stats)

  // Subscribe to live realtime stats
  useEffect(() => {
    return cloudRealtime.onStats(setRtStats)
  }, [])

  const connectedAt = rtStats.connectedAt
    ? new Date(rtStats.connectedAt).toLocaleTimeString()
    : '—'
  const lastEventAt = rtStats.lastEventAt
    ? new Date(rtStats.lastEventAt).toLocaleTimeString()
    : 'None'

  return (
    <div className="min-h-screen bg-bg-primary p-4 sm:p-6 space-y-5" style={{ maxWidth: 960, margin: '0 auto' }}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            className="w-9 h-9 rounded-lg border border-border-color flex items-center justify-center
              text-text-primary hover:border-text-secondary transition-colors cursor-pointer"
            aria-label="Back to app"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="r-text-h1 font-semibold text-text-primary">Developer Diagnostics</h1>
            <p className="r-text-tiny text-text-secondary">Pure Supabase Cloud-First Architecture Status</p>
          </div>
        </div>
      </header>

      {/* Auth & Network */}
      <div className="r-card r-p-card space-y-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-text-primary" />
          <h2 className="r-text-h2 font-semibold text-text-primary">Auth & Network</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label="Network Connection">
            <StatusBadge ok={isOnline} label={isOnline ? 'Online' : 'Offline'} />
          </Row>
          <Row label="Supabase Configured">
            <StatusBadge ok={isConfigured} label={isConfigured ? 'Yes' : 'No'} />
          </Row>
          <Row label="Auth Status">
            <span className="capitalize">{auth.status}</span>
          </Row>
          <Row label="User ID">
            <span className="font-mono text-xs truncate max-w-[160px]">
              {auth.userId ?? 'None'}
            </span>
          </Row>
        </div>
      </div>

      {/* Realtime Channel */}
      <div className="r-card r-p-card space-y-4">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-text-primary" />
          <h2 className="r-text-h2 font-semibold text-text-primary">Realtime Channel</h2>
          <div className="ml-auto">
            <RealtimeStatusBadge status={rtStats.status} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label="Channel Status">
            <RealtimeStatusBadge status={rtStats.status} />
          </Row>
          <Row label="Events Received">
            <span className="flex items-center gap-1.5">
              <Zap size={13} className="text-amber-400" />
              {rtStats.eventCount}
            </span>
          </Row>
          <Row label="Connected At">
            <span className="flex items-center gap-1.5">
              <Wifi size={13} className="text-text-secondary" />
              {connectedAt}
            </span>
          </Row>
          <Row label="Last Event At">
            <span className="flex items-center gap-1.5">
              <Clock size={13} className="text-text-secondary" />
              {lastEventAt}
            </span>
          </Row>
          {rtStats.latencyMs !== null && (
            <Row label="Channel Latency">
              <span className={rtStats.latencyMs < 500 ? 'text-emerald-400' : rtStats.latencyMs < 2000 ? 'text-amber-400' : 'text-rose-400'}>
                {rtStats.latencyMs} ms
              </span>
            </Row>
          )}
        </div>

        <p className="r-text-tiny text-text-secondary">
          Subscribed to: <code className="font-mono bg-bg-primary px-1 rounded text-[10px]">
            topic_progress, assessment_progress, daily_logs, study_sessions
          </code> — per-table row-level filters using <code className="font-mono bg-bg-primary px-1 rounded text-[10px]">user_id=eq.&lt;uid&gt;</code>
        </p>
      </div>

      {/* Architecture Note */}
      <div className="r-card r-p-card space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-500" />
          <h3 className="r-text-small font-semibold text-text-primary">Pure Cloud-First Engine</h3>
          {isOnline && rtStats.status === 'connected'
            ? <span className="ml-auto r-text-tiny text-emerald-400 font-medium">● Live</span>
            : <span className="ml-auto r-text-tiny text-rose-400 font-medium">● Offline</span>
          }
        </div>
        <p className="r-text-tiny text-text-secondary leading-relaxed">
          Supabase is the single source of truth. State hydrates from Postgres at startup via{' '}
          <code className="font-mono bg-bg-primary px-1 rounded text-[10px]">get_user_snapshot()</code>.
          Realtime CDC events are applied surgically to in-memory state — no re-fetch on every change.
          Full re-fetch only fires on WebSocket reconnect recovery.
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          {isOnline
            ? <Wifi size={12} className="text-emerald-400" />
            : <WifiOff size={12} className="text-rose-400" />
          }
          <span className="r-text-tiny text-text-secondary">
            {isOnline ? 'Connected to internet' : 'No internet connection — changes will sync when reconnected'}
          </span>
        </div>
      </div>
    </div>
  )
}
