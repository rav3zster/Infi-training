import type { DatabaseDriver, DatabaseStats, IntegrityCheckResult } from './driver'
import { createDriver } from './createDriver'
import { STORE_NAMES, USER_STORES } from './stores'
import { runMigrations } from './migrations'
import {
  APP_VERSION,
  CURRICULUM_VERSION,
  SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  META_KEYS,
  type VersionInfo,
} from './versions'
import { loadTrainingData, saveTrainingData } from '../repositories/trainingRepository'
import type { TrainingData } from '../../types'

export interface BackupSnapshot {
  schemaVersion: number
  appVersion: string
  curriculumVersion: number
  exportedAt: string
  tables: Record<string, Record<string, unknown>[]>
}

export interface BackupMeta {
  id: string
  exportedAt: string
  rows: number
}

export interface SyncHistoryEntry {
  id: string
  timestamp: string
  kind: 'upload' | 'download' | 'conflict' | 'offline' | 'info' | 'error'
  detail: string
  rows?: number
}

export interface HealthReport {
  database: 'healthy' | 'degraded' | 'error'
  storage: 'healthy' | 'degraded' | 'error'
  auth: 'not-configured' | 'healthy' | 'error'
  supabase: 'not-configured' | 'healthy' | 'error'
  sync: 'idle' | 'syncing' | 'preparing' | 'uploading' | 'downloading' | 'merging' | 'completed' | 'retrying' | 'offline' | 'error' | 'conflict'
  detail: string[]
}

/**
 * SyncStats — persisted live metrics from the Sync Engine (Phase 3).
 * Stored as JSON in app_meta under the 'sync_stats' key.
 */
export interface SyncStats {
  lastUploadAt: string | null
  lastDownloadAt: string | null
  rowsUploaded: number
  rowsDownloaded: number
  failedOps: number
  retryCount: number
  avgSyncTimeMs: number | null
  lastError: string | null
  currentOp: string | null
  queueSize: number
  latencyMs: number | null
  lastSyncAt: string | null
  /** Which device last wrote the most recent uploaded row (LWW provenance). */
  deviceId: string | null
  /** Human label of the most recent uploaded record (e.g. 'topic_progress:m2-t1-s1'). */
  lastUploadedRecord: string | null
  /** Human label of the most recent downloaded record. */
  lastDownloadedRecord: string | null
  /** ISO timestamp of the last Realtime event received from another device. */
  lastRealtimeEvent: string | null
  /** Upload throughput (rows/sec) of the last cycle. */
  uploadSpeedRowsPerSec: number | null
  /** Download throughput (rows/sec) of the last cycle. */
  downloadSpeedRowsPerSec: number | null
  /** ISO timestamp of the last automatic cloud backup snapshot. */
  lastCloudBackupAt: string | null
  /** Total automatic cloud backups created. */
  cloudBackupCount: number
}

export const DEFAULT_SYNC_STATS: SyncStats = {
  lastUploadAt: null,
  lastDownloadAt: null,
  rowsUploaded: 0,
  rowsDownloaded: 0,
  failedOps: 0,
  retryCount: 0,
  avgSyncTimeMs: null,
  lastError: null,
  currentOp: null,
  queueSize: 0,
  latencyMs: null,
  lastSyncAt: null,
  deviceId: null,
  lastUploadedRecord: null,
  lastDownloadedRecord: null,
  lastRealtimeEvent: null,
  uploadSpeedRowsPerSec: null,
  downloadSpeedRowsPerSec: null,
  lastCloudBackupAt: null,
  cloudBackupCount: 0,
}

const MAX_BACKUPS = 5
const MAX_SYNC_HISTORY = 200

/**
 * LocalDatabase — the persistence facade. The ONLY place the app talks to
 * the local engine. Repositories above this hide SQLite-vs-IndexedDB.
 *
 * Responsibilities: open + migrate, hydrate/persist TrainingData, integrity
 * checking with repair, automatic + manual backups (keep 5), JSON export /
 * import, sync history, stats, health.
 */
export class LocalDatabase {
  private driver: DatabaseDriver
  private ready = false
  private initPromise: Promise<void> | null = null

  constructor(driver?: DatabaseDriver) {
    this.driver = driver ?? createDriver()
  }

  get isReady(): boolean {
    return this.ready
  }

  getDriver(): DatabaseDriver {
    return this.driver
  }

  // ─── Boot ────────────────────────────────────────────────────────────

  /** Open → migrate → integrity → auto-backup. Idempotent. */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    await this.driver.open()
    await runMigrations(this.driver)

    const integrity = await this.integrityCheck()
    if (!integrity.ok) {
      await this.recordSyncHistory({
        timestamp: new Date().toISOString(),
        kind: 'error',
        detail: `Integrity check failed: ${integrity.errors.join('; ')}`,
      })
      // Repair: restore from latest backup if the document is unreadable.
      const hydrated = await loadTrainingData(this.driver)
      if (!hydrated) {
        const restored = await this.restoreLatestBackup()
        if (!restored) {
          await this.recordSyncHistory({
            timestamp: new Date().toISOString(),
            kind: 'info',
            detail: 'No usable data — fresh install path',
          })
        }
      }
    }

    // Only take the daily backup when there is real data — the very first
    // boot (fresh install, pre-migration) must not snapshot an empty DB.
    if (!(await this.isFresh())) {
      await this.autoBackupIfDue()
    }
    this.ready = true
  }

  // ─── Versions ────────────────────────────────────────────────────────

  async getVersionInfo(): Promise<VersionInfo> {
    const schema = await this.readMetaNum(META_KEYS.schemaVersion, SCHEMA_VERSION)
    const curriculum = await this.readMetaNum(META_KEYS.curriculumVersion, CURRICULUM_VERSION)
    const sync = await this.readMetaNum(META_KEYS.syncProtocol, SYNC_PROTOCOL_VERSION)
    return {
      schemaVersion: schema,
      curriculumVersion: curriculum,
      syncProtocolVersion: sync,
      appVersion: APP_VERSION,
    }
  }

  private async readMeta(key: string): Promise<string | null> {
    const row = await this.driver.get('app_meta', key)
    return row ? String(row.value ?? '') : null
  }

  private async readMetaNum(key: string, fallback: number): Promise<number> {
    const v = await this.readMeta(key)
    const n = v !== null ? Number(v) : NaN
    return Number.isFinite(n) ? n : fallback
  }

  private async writeMeta(key: string, value: string | number): Promise<void> {
    await this.driver.put('app_meta', { id: key, value })
  }

  // ─── TrainingData (single source of truth) ───────────────────────────

  async hydrateTrainingData(): Promise<TrainingData | null> {
    return loadTrainingData(this.driver)
  }

  async persistTrainingData(data: TrainingData): Promise<void> {
    await saveTrainingData(this.driver, data)
  }

  /** Replace all user data with a fresh seed and persist it. */
  async resetToSeed(seed: TrainingData): Promise<void> {
    await this.driver.transaction(async () => {
      for (const store of STORE_NAMES) {
        if (store === 'app_meta' || store === 'backups') continue
        await this.driver.clear(store)
      }
    })
    await this.persistTrainingData(seed)
  }

  // ─── Integrity ───────────────────────────────────────────────────────

  async integrityCheck(): Promise<IntegrityCheckResult> {
    const base = await this.driver.integrityCheck([...STORE_NAMES])
    const checks = [...base.checks]
    const errors = [...base.errors]

    // Schema validation: the app_state document must parse as TrainingData.
    try {
      const data = await loadTrainingData(this.driver)
      if (data === null && !this.isFresh()) {
        errors.push('app_state: document missing')
      } else {
        checks.push(`app_state: ${data ? 'valid' : 'fresh'}`)
      }
    } catch (e) {
      errors.push(`app_state: unreadable (${String(e)})`)
    }

    return { ok: errors.length === 0, checks, errors }
  }

  private async isFresh(): Promise<boolean> {
    try {
      return (await this.driver.count('app_state')) === 0
    } catch {
      return false
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  async getStats(): Promise<DatabaseStats> {
    const rowsByStore: Record<string, number> = {}
    let totalRows = 0
    let estimatedBytes = 0
    let largestTable: { name: string; rows: number } | null = null

    for (const store of STORE_NAMES) {
      const rows = await this.driver.getAll(store)
      const count = rows.length
      rowsByStore[store] = count
      totalRows += count
      for (const row of rows) {
        estimatedBytes += JSON.stringify(row).length
      }
      if (largestTable === null || count > largestTable.rows) {
        largestTable = { name: store, rows: count }
      }
    }

    // Measure average query latency over a handful of reads
    let avg = 0
    const samples = 3
    for (let i = 0; i < samples; i++) {
      const start = performance.now()
      await this.driver.getAll('daily_logs')
      avg += performance.now() - start
    }
    avg = Math.round((avg / samples) * 100) / 100

    const pendingQueue = rowsByStore.sync_outbox ?? 0

    return {
      storeCount: STORE_NAMES.length,
      rowsByStore,
      totalRows,
      estimatedBytes,
      largestTable,
      averageQueryTimeMs: avg,
      pendingQueue,
      engine: this.driver.engineName,
      version: await this.driver.getVersion(),
    }
  }

  // ─── Backups ─────────────────────────────────────────────────────────

  async exportBackup(): Promise<string> {
    // Only user data is portable — never infra stores (backups, outbox,
    // sync history, AI tables) which are client-local bookkeeping.
    const tables: Record<string, Record<string, unknown>[]> = {}
    for (const store of USER_STORES) {
      tables[store] = await this.driver.getAll(store)
    }
    const snapshot: BackupSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      curriculumVersion: CURRICULUM_VERSION,
      exportedAt: new Date().toISOString(),
      tables,
    }
    return JSON.stringify(snapshot)
  }

  /** Import a backup JSON; restores the user data stores. */
  async importBackup(json: string): Promise<TrainingData> {
    let snapshot: BackupSnapshot
    try {
      snapshot = JSON.parse(json) as BackupSnapshot
    } catch {
      throw new Error('Invalid backup file: not valid JSON')
    }
    if (!snapshot || typeof snapshot.tables !== 'object' || snapshot.tables === null) {
      throw new Error('Invalid backup file: missing tables')
    }
    if (typeof snapshot.schemaVersion === 'number' && snapshot.schemaVersion > SCHEMA_VERSION) {
      throw new Error(
        `Backup schema (v${snapshot.schemaVersion}) is newer than the app supports (v${SCHEMA_VERSION}). Update the app first.`,
      )
    }

    await this.createBackup('pre-import')
    await this.driver.importAll(snapshot.tables)

    await this.writeMeta(META_KEYS.schemaVersion, snapshot.schemaVersion ?? SCHEMA_VERSION)
    await this.writeMeta(META_KEYS.curriculumVersion, snapshot.curriculumVersion ?? CURRICULUM_VERSION)

    const data = await loadTrainingData(this.driver)
    if (!data) throw new Error('Backup did not contain valid training data')
    return data
  }

  /** Daily auto-backup — runs once per calendar day. */
  private async autoBackupIfDue(): Promise<void> {
    const last = await this.readMeta(META_KEYS.lastAutoBackup)
    const today = new Date().toISOString().slice(0, 10)
    if (last === today) return
    await this.createBackup('daily')
    await this.writeMeta(META_KEYS.lastAutoBackup, today)
  }

  /** Create a backup snapshot (manual, pre-import, pre-reset, daily). */
  async createBackup(reason: string): Promise<void> {
    const json = await this.exportBackup()
    // Unique id: timestamp + random suffix so rapid backups never collide.
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await this.driver.put('backups', { id, data: json })
    await this.pruneBackups()
    await this.recordSyncHistory({
      timestamp: new Date().toISOString(),
      kind: 'info',
      detail: `Backup created (${reason})`,
    })
  }

  async listBackups(): Promise<BackupMeta[]> {
    const rows = await this.driver.getAll('backups')
    return rows
      .map(r => {
        const data = r.data as unknown
        const parsed = typeof data === 'string' ? (JSON.parse(data) as BackupSnapshot) : (data as BackupSnapshot)
        return {
          id: String(r.id),
          exportedAt: parsed?.exportedAt ?? String(r.id),
          rows: Object.values(parsed?.tables ?? {}).reduce((s, t) => s + (t as unknown[]).length, 0),
        }
      })
      .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
  }

  async restoreLatestBackup(): Promise<TrainingData | null> {
    const backups = await this.listBackups()
    if (backups.length === 0) return null
    const latest = backups[0]
    const row = await this.driver.get('backups', latest.id)
    if (!row) return null
    const json = typeof row.data === 'string' ? row.data : JSON.stringify(row.data)
    const data = await this.importBackup(json)
    await this.recordSyncHistory({
      timestamp: new Date().toISOString(),
      kind: 'info',
      detail: `Restored from backup ${latest.exportedAt}`,
    })
    return data
  }

  private async pruneBackups(): Promise<void> {
    const rows = await this.driver.getAll('backups')
    const sorted = rows.sort((a, b) => backupExportTime(b).localeCompare(backupExportTime(a)))
    for (const extra of sorted.slice(MAX_BACKUPS)) {
      await this.driver.delete('backups', String(extra.id))
    }
  }

  // ─── Sync history ────────────────────────────────────────────────────

  async recordSyncHistory(entry: Omit<SyncHistoryEntry, 'id'>): Promise<void> {
    try {
      const full: SyncHistoryEntry = { ...entry, id: genHistoryId(entry.kind) }
      await this.driver.put('sync_history', { id: full.id, data: full as unknown as Record<string, unknown> })
      const count = await this.driver.count('sync_history')
      if (count > MAX_SYNC_HISTORY) {
        const all = await this.driver.getAll('sync_history')
        const sorted = all.sort((a, b) => String(a.id).localeCompare(String(b.id)))
        for (const old of sorted.slice(0, count - MAX_SYNC_HISTORY)) {
          await this.driver.delete('sync_history', String(old.id))
        }
      }
    } catch {
      // history is best-effort
    }
  }

  async getSyncHistory(limit = 50): Promise<SyncHistoryEntry[]> {
    try {
      const rows = await this.driver.getAll('sync_history')
      return (rows as { id: string; data: SyncHistoryEntry }[])
        .map(r => r.data)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit)
    } catch {
      return []
    }
  }

  async getLastSyncAt(): Promise<string | null> {
    return this.readMeta(META_KEYS.lastSyncAt)
  }

  async setLastSyncAt(ts: string): Promise<void> {
    await this.writeMeta(META_KEYS.lastSyncAt, ts)
  }

  // ─── Sync engine live stats ────────────────────────────────────────

  async getSyncStats(): Promise<SyncStats> {
    const raw = await this.readMeta(META_KEYS.syncStats)
    if (!raw) return { ...DEFAULT_SYNC_STATS }
    try {
      return { ...DEFAULT_SYNC_STATS, ...(JSON.parse(raw) as Partial<SyncStats>) }
    } catch {
      return { ...DEFAULT_SYNC_STATS }
    }
  }

  async updateSyncStats(patch: Partial<SyncStats>): Promise<SyncStats> {
    const current = await this.getSyncStats()
    const next = { ...current, ...patch }
    await this.writeMeta(META_KEYS.syncStats, JSON.stringify(next))
    return next
  }

  // ─── Health ──────────────────────────────────────────────────────────

  async healthCheck(syncStatus: HealthReport['sync'] = 'idle'): Promise<HealthReport> {
    const detail: string[] = []
    const integrity = await this.integrityCheck()

    let database: HealthReport['database'] = 'healthy'
    let storage: HealthReport['storage'] = 'healthy'
    if (!integrity.ok) {
      database = 'degraded'
      detail.push(`database: ${integrity.errors.join('; ')}`)
    }

    try {
      await this.driver.put('app_meta', { id: 'health_probe', value: Date.now() })
      await this.driver.delete('app_meta', 'health_probe')
    } catch (e) {
      storage = 'error'
      detail.push(`storage: ${String(e)}`)
    }

    return {
      database,
      storage,
      auth: 'not-configured', // Phase 2: Supabase auth
      supabase: 'not-configured', // Phase 3: sync engine
      sync: syncStatus,
      detail,
    }
  }
}

function genHistoryId(kind: string): string {
  return `${Date.now()}-${kind}-${Math.random().toString(36).slice(2, 6)}`
}

/** Extract a backup's export timestamp from its stored row (id or snapshot). */
function backupExportTime(row: Record<string, unknown>): string {
  const data = row.data as unknown
  try {
    const parsed = typeof data === 'string' ? (JSON.parse(data) as BackupSnapshot) : (data as BackupSnapshot)
    return parsed?.exportedAt ?? String(row.id)
  } catch {
    return String(row.id)
  }
}

/** App-wide singleton facade. */
export const localDatabase = new LocalDatabase()
