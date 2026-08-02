import type { SupabaseClient } from '@supabase/supabase-js'
import type { DatabaseDriver } from '../database/driver'
import { localDatabase, type SyncHistoryEntry, type SyncStats } from '../database/LocalDatabase'
import { getSupabaseClient } from '../supabase/supabaseClient'
import type { TrainingData, SubTopic, Assessment } from '../../types'
import { JOINING_DATE } from '../../engine/adaptiveEngine'
import { SYNC_PROTOCOL_VERSION } from '../database/versions'
import { getDeviceId } from './deviceId'
import {
  listPendingOps,
  listAllOps,
  removeOp,
  markOpFailed,
  countPendingOps,
  resetStuckOps,
  clearOutbox,
  type OutboxOp,
  type SyncTable,
} from './outboxRepository'
import { TABLE_CONFIG, DOWNLOAD_TABLES, remoteToDailyLog, remoteToStudySession, remoteToStudyEvent } from './mappers'
import { syncStatusService } from './SyncStatus'
import { latestTrainingData } from './latestData'

/**
 * syncEngine — the background synchronization engine (Phase 3).
 *
 * Offline-first: local writes always land first (TrainingContext), the outbox
 * records them, and this engine drains the outbox to Supabase in the
 * background — the UI never waits for the network. Then it downloads NEWER
 * cloud rows (delta: `updated_at > lastSyncAt`) and merges them into local
 * data with a simple last-write-wins policy:
 *   • Rows with a PENDING outbox op (unsent local change) are never
 *     overwritten by a download — the local change wins and gets pushed.
 *   • Otherwise the NEWEST updated_at wins, and every field is applied
 *     verbatim (strict LWW — a newer remote un-check or lower hours applies).
 *   • Logs/sessions/events are append-only: remote rows missing locally are
 *     added, existing client_ids are never duplicated.
 *   • Settings (theme + date offset) converge on the newest row.
 *
 * Every uploaded row is stamped with `user_id`, `device_id` and
 * `sync_version` (LWW provenance). Once per day, after a successful cycle, a
 * full backup snapshot is uploaded to the `backups` table (keep latest 5) —
 * purely for recovery, never used for synchronization.
 *
 * The engine is a pure service: it talks to the driver, the Supabase client,
 * and the LocalDatabase facade — never to React.
 */

export const BATCH_SIZE = 50
export const RETRY_CAP = 8
export const MAX_CLOUD_BACKUPS = 5

/**
 * Delta filter column per table (server-side watermark for incremental
 * downloads). Everything uses `updated_at` EXCEPT study_events, which is
 * append-only and has no updated_at column — its natural event timestamp
 * (`occurred_at`, present in migration 0001) is the correct delta key.
 */
const DELTA_COLUMN: Partial<Record<SyncTable, string>> = {
  study_events: 'occurred_at',
}

/**
 * Safety overlap for delta downloads. The watermark is set from the CLIENT
 * clock at the end of each cycle; a device clock slightly ahead of the DB
 * clock could otherwise skip rows written between db-now and client-now.
 * Re-downloading a small overlap window and letting client_id dedup (plus
 * the client-side cutoff check) handle idempotency costs nothing.
 */
const DELTA_OVERLAP_MS = 5 * 60_000

export interface SyncEngineDeps {
  driver: DatabaseDriver
  getClient: () => SupabaseClient | null
  history: (entry: Omit<SyncHistoryEntry, 'id'>) => Promise<void>
  stats: {
    load(): Promise<SyncStats>
    save(patch: Partial<SyncStats>): Promise<SyncStats>
  }
  lastSyncAt: {
    get(): Promise<string | null>
    set(ts: string): Promise<void>
  }
  hydrate: () => Promise<TrainingData | null>
  persist: (data: TrainingData) => Promise<void>
  /** Notify React that a remote merge changed the data (adopt via setData). */
  notifyRemoteMerge: (data: TrainingData) => void
  /** Read the device-local theme preference (for settings upload). */
  getTheme: () => string
  /** Push a downloaded theme into device storage (for settings download). */
  applyTheme: (theme: string) => void
  /** Read the device-local simulated date offset (for settings upload). */
  getDateOffset: () => number
  /** Push a downloaded date offset into device storage. */
  applyDateOffset: (offset: number) => void
  /** Full portable backup snapshot JSON (for the daily cloud backup). */
  exportSnapshot: () => Promise<string>
}

export interface SyncRunReport {
  uploaded: number
  deleted: number
  failed: number
  downloaded: number
  ok: boolean
  reason?: string
}

export class SyncEngine {
  private readonly deps: SyncEngineDeps
  private busy = false
  private lastRequestAt = 0

  constructor(deps: SyncEngineDeps) {
    this.deps = deps
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /** Throttled request — coalesces rapid mutations into one cycle. */
  requestSync(minIntervalMs = 1000): void {
    const now = Date.now()
    if (this.busy) return
    if (now - this.lastRequestAt < minIntervalMs) return
    this.lastRequestAt = now
    void this.syncNow()
  }

  /** Delete all user records from Supabase cloud tables on factory reset. */
  async purgeCloudData(): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return
    const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
    const uid = session.data.session?.user?.id
    if (!uid) return

    const tables = [
      'topic_progress',
      'assessment_progress',
      'daily_logs',
      'study_sessions',
      'study_events',
      'settings',
      'backups',
      'revision_queue',
    ]
    for (const table of tables) {
      await client.from(table).delete().eq('user_id', uid)
    }
    await this.deps.driver.clear('sync_outbox')
    await this.deps.lastSyncAt.set('')
  }

  /**
   * Full sync cycle: upload outbox → download delta + merge → daily cloud
   * backup. Never throws; every failure is captured in the report and the
   * SyncStatus service.
   */
  async syncNow(): Promise<SyncRunReport> {
    if (this.busy) return { uploaded: 0, deleted: 0, failed: 0, downloaded: 0, ok: false, reason: 'busy' }
    this.busy = true
    const started = performance.now()
    try {
      const client = this.deps.getClient()
      if (!client) {
        syncStatusService.set('idle')
        return { uploaded: 0, deleted: 0, failed: 0, downloaded: 0, ok: false, reason: 'not-configured' }
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        syncStatusService.set('offline')
        return { uploaded: 0, deleted: 0, failed: 0, downloaded: 0, ok: false, reason: 'offline' }
      }

      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id ?? null
      if (!uid) {
        syncStatusService.set('idle') // auth not ready — will be retried on sign-in
        return { uploaded: 0, deleted: 0, failed: 0, downloaded: 0, ok: false, reason: 'unauthenticated' }
      }

      syncStatusService.set('syncing', { phase: 'upload', done: 0, total: 0, percent: 0 })

      await this.ensureProfile(client, uid)
      const upload = await this.uploadAll(client, uid)
      const downloaded = await this.downloadAndMerge(client, uid)
      await this.maybeCloudBackup(client, uid)

      const elapsed = Math.round(performance.now() - started)
      const nowIso = new Date().toISOString()
      const current = await this.deps.stats.load()
      await this.deps.lastSyncAt.set(nowIso)
      await this.deps.stats.save({
        lastUploadAt: upload.uploaded > 0 || upload.deleted > 0 ? nowIso : undefined,
        lastDownloadAt: downloaded > 0 ? nowIso : undefined,
        rowsUploaded: current.rowsUploaded + upload.uploaded,
        rowsDownloaded: current.rowsDownloaded + downloaded,
        failedOps: upload.failed,
        retryCount: current.retryCount + upload.failed,
        avgSyncTimeMs: elapsed,
        lastError: upload.failed > 0 ? 'Some operations failed and will retry.' : null,
        currentOp: null,
        queueSize: await countPendingOps(this.deps.driver),
        latencyMs: elapsed,
        lastSyncAt: nowIso,
        deviceId: getDeviceId(),
        uploadSpeedRowsPerSec: upload.uploaded > 0 ? Math.round((upload.uploaded / Math.max(0.001, elapsed / 1000)) * 10) / 10 : current.uploadSpeedRowsPerSec,
        downloadSpeedRowsPerSec: downloaded > 0 ? Math.round((downloaded / Math.max(0.001, elapsed / 1000)) * 10) / 10 : current.downloadSpeedRowsPerSec,
      })
      await this.deps.history({
        timestamp: nowIso,
        kind: upload.failed > 0 ? 'error' : 'info',
        detail: upload.failed > 0
          ? `Uploaded ${upload.uploaded}, ${upload.failed} failed (retrying)`
          : `Uploaded ${upload.uploaded}, downloaded ${downloaded}`,
        rows: upload.uploaded + downloaded,
      })

      if (upload.failed > 0) {
        syncStatusService.set('retrying', { phase: 'upload', done: upload.uploaded, total: upload.uploaded + upload.failed, percent: 0 })
      } else {
        syncStatusService.set('completed', { phase: 'upload', done: upload.uploaded, total: Math.max(1, upload.uploaded), percent: 100 })
      }
      // Return to idle shortly after a successful cycle (transient "completed").
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          if (syncStatusService.get() === 'completed') syncStatusService.set('idle')
        }, 2500)
      }

      return { uploaded: upload.uploaded, deleted: upload.deleted, failed: upload.failed, downloaded, ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      syncStatusService.setError(message)
      await this.deps.history({
        timestamp: new Date().toISOString(),
        kind: 'error',
        detail: `Sync failed: ${message}`,
      })
      await this.deps.stats.save({ lastError: message, currentOp: null })
      return { uploaded: 0, deleted: 0, failed: 0, downloaded: 0, ok: false, reason: message }
    } finally {
      this.busy = false
    }
  }

  /** Factory reset: delete every user row from every synced table remotely. */
  async purgeRemote(): Promise<void> {
    try {
      const client = this.deps.getClient()
      if (!client) return
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id ?? null
      if (!uid) return
      for (const table of [...DOWNLOAD_TABLES]) {
        await client.from(table).delete().eq('user_id', uid)
      }
      await clearOutbox(this.deps.driver)
      await this.deps.history({
        timestamp: new Date().toISOString(),
        kind: 'info',
        detail: 'Remote data purged (factory reset)',
      })
    } catch {
      // Best-effort — the local reset already happened.
    }
  }

  // ─── Upload ─────────────────────────────────────────────────────────

  private async ensureProfile(client: SupabaseClient, uid: string): Promise<void> {
    const { error } = await client.from('profiles').upsert(
      {
        user_id: uid,
        joining_date: JOINING_DATE.toISOString().slice(0, 10),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
      { onConflict: 'user_id' },
    )
    if (error) throw new Error(`profiles upsert: ${error.message}`)
  }

  private async uploadAll(
    client: SupabaseClient,
    uid: string,
  ): Promise<{ uploaded: number; deleted: number; failed: number }> {
    // Re-enable ops that were capped by transient failures (e.g. a schema
    // migration mid-flight) so no queued change is ever dropped for good.
    await resetStuckOps(this.deps.driver)
    const pending = await listPendingOps(this.deps.driver)
    if (pending.length === 0) return { uploaded: 0, deleted: 0, failed: 0 }

    syncStatusService.set('uploading', { phase: 'upload', done: 0, total: pending.length, percent: 0 })

    const byTable = new Map<SyncTable, OutboxOp[]>()
    for (const op of pending) {
      const list = byTable.get(op.table) ?? []
      list.push(op)
      byTable.set(op.table, list)
    }

    let uploaded = 0
    let deleted = 0
    let failed = 0
    let done = 0
    let lastUploadedLabel: string | null = null
    const deviceId = getDeviceId()

    for (const [table, ops] of byTable) {
      const cfg = TABLE_CONFIG[table]
      if (!cfg) {
        for (const op of ops) await removeOp(this.deps.driver, op.id)
        continue
      }

      // ── Upserts, batched ──
      const upserts = ops.filter(o => o.action === 'upsert')
      for (let i = 0; i < upserts.length; i += BATCH_SIZE) {
        const batch = upserts.slice(i, i + BATCH_SIZE)
        const rows = batch.map(op => ({
          ...(op.payload ?? {}),
          user_id: uid,
          // LWW provenance stamping. profiles lacks these columns and is never
          // enqueued (only ensureProfile writes it) — skip it defensively.
          ...(table !== 'profiles'
            ? { device_id: deviceId, sync_version: SYNC_PROTOCOL_VERSION }
            : {}),
        }))
        const { error } = await client.from(table).upsert(rows, { onConflict: cfg.onConflict })
        done += batch.length
        if (error) {
          failed += batch.length
          for (const op of batch) {
            await markOpFailed(this.deps.driver, op.id, error.message)
          }
        } else {
          uploaded += batch.length
          lastUploadedLabel = `${table}:${batch[batch.length - 1].clientId}`
          for (const op of batch) await removeOp(this.deps.driver, op.id)
        }
        syncStatusService.set('uploading', { phase: 'upload', done, total: pending.length, percent: Math.round((done / pending.length) * 100) })
      }

      // ── Deletes ──
      for (const op of ops.filter(o => o.action === 'delete')) {
        if (!cfg.deleteKey) {
          await removeOp(this.deps.driver, op.id)
          continue
        }
        const { error } = await client
          .from(table)
          .delete()
          .eq('user_id', uid)
          .eq(cfg.deleteKey, op.clientId)
        done += 1
        if (error) {
          failed += 1
          await markOpFailed(this.deps.driver, op.id, error.message)
        } else {
          deleted += 1
          lastUploadedLabel = `${table}:${op.clientId}`
          await removeOp(this.deps.driver, op.id)
        }
        syncStatusService.set('uploading', { phase: 'upload', done, total: pending.length, percent: Math.round((done / pending.length) * 100) })
      }
    }

    if (lastUploadedLabel) {
      await this.deps.stats.save({ lastUploadedRecord: lastUploadedLabel })
    }
    return { uploaded, deleted, failed }
  }

  // ─── Download + last-write-wins merge ───────────────────────────────

  private async downloadAndMerge(client: SupabaseClient, uid: string): Promise<number> {
    syncStatusService.set('downloading', { phase: 'download', done: 0, total: DOWNLOAD_TABLES.length, percent: 0 })

    const lastSyncRaw = await this.deps.lastSyncAt.get()
    const cutoffIso = lastSyncRaw ?? undefined

    const remote: Record<string, Record<string, unknown>[]> = {}
    for (let i = 0; i < DOWNLOAD_TABLES.length; i++) {
      const table = DOWNLOAD_TABLES[i]
      const deltaColumn = DELTA_COLUMN[table] ?? 'updated_at'
      let query = client.from(table).select('*').eq('user_id', uid)
      if (cutoffIso) {
        const from = new Date(new Date(cutoffIso).getTime() - DELTA_OVERLAP_MS).toISOString()
        query = query.gt(deltaColumn, from)
      }
      const { data, error } = await query
      if (error) throw new Error(`${table} download: ${error.message}`)
      remote[table] = (data ?? []) as Record<string, unknown>[]
      syncStatusService.set('downloading', {
        phase: 'download',
        done: i + 1,
        total: DOWNLOAD_TABLES.length,
        percent: Math.round(((i + 1) / DOWNLOAD_TABLES.length) * 100),
      })
    }

    // Merge onto the FRESHEST in-memory data (never a stale DB snapshot).
    let data = latestTrainingData.current ?? (await this.deps.hydrate())
    if (!data) return 0
    data = structuredClone(data)

    // Local-first guard: ANY queued op for a key means the local change
    // is unsent and must win over a download.
    const pendingKeys = new Set((await listAllOps(this.deps.driver)).map(op => op.id))

    syncStatusService.set('merging', { phase: 'merge', done: 0, total: DOWNLOAD_TABLES.length, percent: 0 })

    let applied = 0
    applied += this.mergeTopicProgress(data, remote.topic_progress ?? [], pendingKeys)
    applied += this.mergeAssessmentProgress(data, remote.assessment_progress ?? [], pendingKeys)
    applied += this.mergeLogsAndSessions(data, remote)
    applied += await this.mergeStudyEvents(remote.study_events ?? [])
    applied += this.mergeSettings(remote.settings ?? [])

    syncStatusService.set('merging', { phase: 'merge', done: DOWNLOAD_TABLES.length, total: DOWNLOAD_TABLES.length, percent: 100 })

    if (applied > 0) {
      await this.deps.persist(data)
      this.deps.notifyRemoteMerge(data)
      await this.deps.stats.save({ lastDownloadedRecord: `merged ${applied} rows` })
    }
    return applied
  }

  /**
   * Subtopic progress merge: when there is no unsent local change, adopt
   * remote completed, hoursSpent, and lastStudied verbatim so tick marks and
   * hours sync instantly across devices.
   */
  private mergeTopicProgress(
    data: TrainingData,
    rows: Record<string, unknown>[],
    pendingKeys: Set<string>,
  ): number {
    let applied = 0
    const subs = collectSubtopics(data)
    for (const row of rows) {
      const subId = String(row.subtopic_id ?? '')
      if (!subId) continue
      const key = `topic_progress:${subId}`
      // Local-first: an unsent local change always wins over a download.
      if (pendingKeys.has(key)) continue

      const sub = subs.get(subId)
      if (!sub) continue
      const remoteCompleted = Boolean(row.completed)
      const remoteHours = Number(row.hours_spent ?? 0)
      const remoteLast = row.last_studied_at ? String(row.last_studied_at) : ''

      const nextHours = Math.max(sub.hoursSpent, Math.round(remoteHours * 100) / 100)
      if (
        sub.completed !== remoteCompleted ||
        sub.hoursSpent !== nextHours ||
        (sub.lastStudied ?? '') !== remoteLast
      ) {
        sub.completed = remoteCompleted
        sub.hoursSpent = nextHours
        sub.lastStudied = remoteLast
        applied++
      }
    }
    return applied
  }

  /** Assessment progress merge (completed + score verbatim). */
  private mergeAssessmentProgress(
    data: TrainingData,
    rows: Record<string, unknown>[],
    pendingKeys: Set<string>,
  ): number {
    let applied = 0
    const assessments = collectAssessments(data)
    for (const row of rows) {
      const id = String(row.assessment_id ?? '')
      if (!id) continue
      const key = `assessment_progress:${id}`
      if (pendingKeys.has(key)) continue
      const a = assessments.get(id)
      if (!a) continue
      const remoteCompleted = Boolean(row.completed)
      const remoteScore = row.score != null ? Number(row.score) : undefined
      if (
        a.completed !== remoteCompleted ||
        (remoteScore != null && Number.isFinite(remoteScore) && a.score !== remoteScore)
      ) {
        a.completed = remoteCompleted
        if (remoteScore != null && Number.isFinite(remoteScore)) a.score = remoteScore
        applied++
      }
    }
    return applied
  }

  /** Append-only merge: add remote logs/sessions missing locally (by client_id). */
  private mergeLogsAndSessions(
    data: TrainingData,
    remote: Record<string, Record<string, unknown>[]>,
  ): number {
    let applied = 0
    const localLogIds = new Set(data.dailyLogs.map(l => l.id))
    for (const row of remote.daily_logs ?? []) {
      const id = String(row.client_id ?? '')
      if (!id || localLogIds.has(id)) continue
      const log = remoteToDailyLog(row)
      if (!log) continue
      data.dailyLogs.push(log)
      localLogIds.add(id)
      applied++
    }

    if (!data.studySessions) data.studySessions = []
    const localSessionIds = new Set(data.studySessions.map(s => s.id))
    for (const row of remote.study_sessions ?? []) {
      const id = String(row.client_id ?? '')
      if (!id || localSessionIds.has(id)) continue
      const session = remoteToStudySession(row)
      if (!session) continue
      data.studySessions.push(session)
      localSessionIds.add(id)
      applied++
    }
    return applied
  }

  /** Append-only merge: add remote study events into the local event store. */
  private async mergeStudyEvents(rows: Record<string, unknown>[]): Promise<number> {
    let applied = 0
    for (const row of rows) {
      const id = String(row.client_id ?? '')
      if (!id) continue
      const existing = await this.deps.driver.get('study_events', id)
      if (existing) continue
      const event = remoteToStudyEvent(row)
      if (!event) continue
      await this.deps.driver.put('study_events', { id, data: event as unknown as Record<string, unknown> })
      applied++
    }
    return applied
  }

  /** Settings: single row per user — apply date offset if changed (theme is device-local). */
  private mergeSettings(rows: Record<string, unknown>[]): number {
    let applied = 0
    for (const row of rows) {
      const offset = Number(row.date_offset)
      if (Number.isFinite(offset) && offset !== this.deps.getDateOffset()) {
        this.deps.applyDateOffset(Math.round(offset))
        applied++
      }
    }
    return applied
  }

  // ─── Daily cloud backup (recovery only, never sync) ────────────────

  /**
   * Once per calendar day, upload a full portable backup snapshot to the
   * `backups` table (keep the latest MAX_CLOUD_BACKUPS). Best-effort — a
   * failed backup must never break the sync cycle.
   */
  private async maybeCloudBackup(client: SupabaseClient, uid: string): Promise<void> {
    try {
      const stats = await this.deps.stats.load()
      const today = new Date().toISOString().slice(0, 10)
      if (stats.lastCloudBackupAt && stats.lastCloudBackupAt.slice(0, 10) === today) return

      const snapshot = await this.deps.exportSnapshot()
      if (!snapshot) return
      const payload = JSON.parse(snapshot) as Record<string, unknown>
      const name = `auto-${today}`
      const backupRow = {
        user_id: uid,
        name,
        kind: 'auto',
        payload,
        size_bytes: snapshot.length,
      }
      // Upsert on the (user_id, name) unique key (migration 0002) so a crash
      // between insert and stats.save can never create a duplicate snapshot.
      // If the unique index is not deployed yet (pre-0002 database), fall back
      // to an IDEMPOTENT check-then-insert: only insert when no snapshot with
      // this name already exists, so repeated cycles (or a crash between the
      // insert and stats.save) can never pile up duplicate (user_id, name)
      // rows. Backups are best-effort and must never block sync.
      let created = true
      let error: { message: string } | null = null
      const res = await client.from('backups').upsert(backupRow, { onConflict: 'user_id,name' })
      error = res.error
      if (error && /unique or exclusion constraint|ON CONFLICT/i.test(error.message)) {
        // Pre-0002 database — no unique key, resolve idempotency manually.
        const { data: existing, error: checkErr } = await client
          .from('backups')
          .select('id')
          .eq('user_id', uid)
          .eq('name', name)
          .limit(1)
        if (checkErr) throw new Error(`backup check: ${checkErr.message}`)
        if (!existing || existing.length === 0) {
          const fallback = await client.from('backups').insert(backupRow)
          error = fallback.error
        } else {
          created = false // snapshot already exists — idempotent, nothing to do
          error = null
        }
      }
      if (error) throw new Error(`backup upload: ${error.message}`)

      // Keep the latest MAX_CLOUD_BACKUPS (prune older auto snapshots).
      const { data: existing, error: listErr } = await client
        .from('backups')
        .select('id, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
      if (!listErr && existing && existing.length > MAX_CLOUD_BACKUPS) {
        for (const extra of existing.slice(MAX_CLOUD_BACKUPS)) {
          await client.from('backups').delete().eq('user_id', uid).eq('id', String(extra.id))
        }
      }

      await this.deps.stats.save({
        lastCloudBackupAt: new Date().toISOString(),
        cloudBackupCount: stats.cloudBackupCount + (created ? 1 : 0),
      })
      await this.deps.history({
        timestamp: new Date().toISOString(),
        kind: 'info',
        detail: `Cloud backup snapshot uploaded (${name})`,
      })
    } catch (error) {
      // A backup failure must never masquerade as a sync failure — record it
      // in sync history only, leave lastError (the sync error) untouched.
      const message = error instanceof Error ? error.message : String(error)
      await this.deps.history({
        timestamp: new Date().toISOString(),
        kind: 'error',
        detail: `Cloud backup failed: ${message}`,
      })
    }
  }
}

// ─── Index helpers ────────────────────────────────────────────────────

export function collectSubtopics(data: TrainingData): Map<string, SubTopic> {
  const map = new Map<string, SubTopic>()
  for (const mod of data.modules) {
    for (const topic of mod.topics) {
      for (const sub of topic.subtopics) map.set(sub.id, sub)
    }
  }
  return map
}

export function collectAssessments(data: TrainingData): Map<string, Assessment> {
  const map = new Map<string, Assessment>()
  for (const mod of data.modules) {
    for (const a of mod.assessments ?? []) map.set(a.id, a)
  }
  return map
}

// ─── Default wiring (used by SyncContext) ─────────────────────────────

let engineSingleton: SyncEngine | null = null

export function getSyncEngine(): SyncEngine {
  if (!engineSingleton) {
    engineSingleton = new SyncEngine({
      driver: localDatabase.getDriver(),
      getClient: getSupabaseClient,
      history: entry => localDatabase.recordSyncHistory(entry),
      stats: {
        load: () => localDatabase.getSyncStats(),
        save: patch => localDatabase.updateSyncStats(patch),
      },
      lastSyncAt: {
        get: () => localDatabase.getLastSyncAt(),
        set: ts => localDatabase.setLastSyncAt(ts),
      },
      hydrate: () => localDatabase.hydrateTrainingData(),
      persist: data => localDatabase.persistTrainingData(data),
      notifyRemoteMerge: data => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('training:remote-merge', { detail: data }))
        }
      },
      getTheme: () => {
        try {
          return localStorage.getItem('training-tracker-theme') === 'dark' ? 'dark' : 'light'
        } catch {
          return 'light'
        }
      },
      applyTheme: theme => {
        try {
          localStorage.setItem('training-tracker-theme', theme)
        } catch {
          /* best-effort */
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('training:theme-applied', { detail: theme }))
        }
      },
      getDateOffset: () => {
        try {
          const n = Number(localStorage.getItem('training-tracker-date-offset') ?? 0)
          return Number.isFinite(n) ? n : 0
        } catch {
          return 0
        }
      },
      applyDateOffset: offset => {
        try {
          localStorage.setItem('training-tracker-date-offset', String(offset))
        } catch {
          /* best-effort */
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('training:date-offset-applied', { detail: offset }))
        }
      },
      exportSnapshot: () => localDatabase.exportBackup(),
    })
  }
  return engineSingleton
}
