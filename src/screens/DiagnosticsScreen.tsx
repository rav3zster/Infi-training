import { useEffect, useState } from 'react'
import { ArrowLeft, Database, RefreshCw, HardDrive, ShieldCheck } from 'lucide-react'
import { localDatabase, type SyncHistoryEntry, type BackupMeta } from '../services/database/LocalDatabase'
import type { DatabaseStats } from '../services/database/driver'
import type { VersionInfo } from '../services/database/versions'
import { useSync } from '../context/SyncContext'
import { getDevCredentials } from '../config/devCredentials'

interface Props {
  onExit: () => void
}

/**
 * DiagnosticsScreen — HIDDEN developer diagnostics page.
 * Reached via ?diag=1 (or 7-taps on the Presets version label). Never in the
 * navigation. Reads everything from the LocalDatabase facade / contexts —
 * no duplicated state.
 */
export default function DiagnosticsScreen({ onExit }: Props) {
  const { status, isOnline, lastSyncAt, syncNow } = useSync()
  const [stats, setStats] = useState<DatabaseStats | null>(null)
  const [versions, setVersions] = useState<VersionInfo | null>(null)
  const [history, setHistory] = useState<SyncHistoryEntry[]>([])
  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [health, setHealth] = useState<Awaited<ReturnType<typeof localDatabase.healthCheck>> | null>(null)
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const refresh = () => setRefreshTick(t => t + 1)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [s, v, h, bk] = await Promise.all([
        localDatabase.getStats(),
        localDatabase.getVersionInfo(),
        localDatabase.healthCheck(status),
        localDatabase.listBackups(),
      ])
      if (cancelled) return
      setStats(s)
      setVersions(v)
      setHealth(h)
      setBackups(bk)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshTick, status])

  useEffect(() => {
    let cancelled = false
    localDatabase.getSyncHistory(50).then(h => {
      if (!cancelled) setHistory(h)
    })
    return () => {
      cancelled = true
    }
  }, [refreshTick])

  useEffect(() => {
    const dev = getDevCredentials()
    setSessionEmail(dev?.email ?? null)
  }, [])

  const engine = stats?.engine ?? '—'
  const version = stats?.version ?? '—'

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
            <p className="r-text-tiny text-text-secondary">Hidden page — never shown in navigation</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-2 r-text-small rounded-lg border border-border-color text-text-primary hover:border-text-secondary transition-colors cursor-pointer"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </header>

      {/* Health dashboard */}
      <section className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><ShieldCheck size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Health</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <HealthBadge label="Database" value={health?.database ?? '…'} />
          <HealthBadge label="Storage" value={health?.storage ?? '…'} />
          <HealthBadge label="Auth" value={health?.auth ?? 'not-configured'} />
          <HealthBadge label="Supabase" value={health?.supabase ?? 'not-configured'} />
          <HealthBadge label="Sync" value={status} />
          <HealthBadge label="Network" value={isOnline ? 'online' : 'offline'} />
        </div>
        {health && health.detail.length > 0 && (
          <p className="r-text-tiny text-text-secondary mt-2">{health.detail.join(' · ')}</p>
        )}
      </section>

      {/* Session */}
      <section className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><ShieldCheck size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Session</span>
        </div>
        <dl className="r-text-small grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <Row label="Status" value={sessionEmail ? `restored (${sessionEmail})` : 'not-configured'} />
          <Row label="Current user" value={sessionEmail ?? '— (Phase 2: Supabase auth)'} />
          <Row label="Last sync" value={lastSyncAt ?? 'never'} />
          <Row label="Queue size" value={String(stats?.pendingQueue ?? 0)} />
          <Row label="Pending uploads" value="0" />
          <Row label="Pending downloads" value="0" />
          <Row label="Sync errors" value={String(history.filter(h => h.kind === 'error').length)} />
          <Row label="Sync protocol" value={String(versions?.syncProtocolVersion ?? '—')} />
        </dl>
        <button
          type="button"
          onClick={() => void syncNow()}
          className="mt-3 flex items-center gap-1.5 px-3 py-2 r-text-small font-medium rounded-lg border border-border-color text-text-primary hover:border-text-secondary transition-colors cursor-pointer"
        >
          <RefreshCw size={12} /> Sync now
        </button>
      </section>

      {/* Database */}
      <section className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><Database size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Database</span>
        </div>
        <dl className="r-text-small grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <Row label="Engine" value={engine} />
          <Row label="Version" value={version} />
          <Row label="Schema version" value={String(versions?.schemaVersion ?? '—')} />
          <Row label="Curriculum version" value={String(versions?.curriculumVersion ?? '—')} />
          <Row label="App version" value={versions?.appVersion ?? '—'} />
          <Row label="Stores" value={String(stats?.storeCount ?? 0)} />
          <Row label="Total rows" value={String(stats?.totalRows ?? 0)} />
          <Row label="Est. size" value={formatBytes(stats?.estimatedBytes ?? 0)} />
          <Row label="Largest table" value={stats?.largestTable ? `${stats.largestTable.name} (${stats.largestTable.rows})` : '—'} />
          <Row label="Avg query time" value={`${stats?.averageQueryTimeMs ?? 0}ms`} />
        </dl>

        <div className="mt-4">
          <p className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider mb-2">Rows per store</p>
          <div className="flex flex-wrap gap-1.5">
            {stats && Object.entries(stats.rowsByStore).map(([name, n]) => (
              <span key={name} className="px-2 py-1 r-text-tiny rounded-md border border-border-color text-text-secondary">
                {name}: <span className="text-text-primary font-medium tabular-nums">{n}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Sync history */}
      <section className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><HardDrive size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Sync history</span>
        </div>
        {history.length === 0 ? (
          <p className="r-text-small text-text-secondary">No sync activity yet.</p>
        ) : (
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {history.map(h => (
              <li key={h.id} className="flex items-start justify-between gap-3 r-text-small border-b border-border-color/50 pb-1.5">
                <span className="text-text-secondary">{h.detail}</span>
                <span className="text-text-secondary flex-shrink-0">
                  {h.kind}
                  {h.rows != null ? ` · ${h.rows}` : ''}
                  <span className="tabular-nums ml-2">{new Date(h.timestamp).toLocaleTimeString()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Backups */}
      <section className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><HardDrive size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Backups (auto · keep 5)</span>
        </div>
        {backups.length === 0 ? (
          <p className="r-text-small text-text-secondary">No backups yet — one is created automatically each day.</p>
        ) : (
          <ul className="space-y-1.5">
            {backups.map(b => (
              <li key={b.id} className="flex items-center justify-between gap-3 r-text-small border-b border-border-color/50 pb-1.5">
                <span className="text-text-secondary tabular-nums">{new Date(b.exportedAt).toLocaleString()}</span>
                <span className="text-text-secondary">{b.rows} rows</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-color/40 pb-1">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-text-primary font-medium tabular-nums text-right break-all">{value}</dd>
    </div>
  )
}

function HealthBadge({ label, value }: { label: string; value: string }) {
  const color =
    value === 'healthy' || value === 'online' || value === 'idle'
      ? 'text-emerald-600 dark:text-emerald-400'
      : value === 'offline' || value === 'error'
        ? 'text-red-600 dark:text-red-400'
        : value === 'not-configured'
          ? 'text-text-secondary'
          : 'text-amber-600 dark:text-amber-400'
  return (
    <div className="rounded-lg border border-border-color p-2.5 text-center">
      <p className="r-text-tiny text-text-secondary">{label}</p>
      <p className={`r-text-small font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
