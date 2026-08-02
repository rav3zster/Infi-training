import type { SupabaseClient } from '@supabase/supabase-js'
import type { DatabaseDriver } from '../database/driver'
import { localDatabase, type SyncHistoryEntry, type SyncStats } from '../database/LocalDatabase'
import { getSupabaseClient } from '../supabase/supabaseClient'
import type { TrainingData, SubTopic, Assessment } from '../../types'
import { JOINING_DATE } from '../../engine/adaptiveEngine'
import {
  listPendingOps,
  listAllOps,
  removeOp,
  markOpFailed,
  countPendingOps,
  clearOutbox,
  type OutboxOp,
  type SyncTable,
} from './outboxRepository'
import { TABLE_CONFIG, DOWNLOAD_TABLES, remoteToDailyLog, remoteToStudySession } from './mappers'
import { syncStatusService } from './SyncStatus'
import { latestTrainingData } from './latestData'

/**
 * syncEngine — the background synchronization engine (Phase 3).
 *
 * Offline-first: local writes always land first (TrainingContext), the outbox
 * records them, and this engine drains the outbox to Supabase in the
 * background — the UI never waits for the network. Then it downloads newer
 * cloud rows and merges them into local data with a local-first policy:
 *   • Rows with a PENDING outbox op (unsent local change) are never
 *     overwritten by a download — the local change wins and gets pushed.
 *   • Otherwise the newest updated_at wins (last-write-wins).
 *   • Logs/sessions are append-only: remote rows missing locally are added,
 *     existing client_ids are never duplicated.
 *
 * The engine is a pure service: it talks to the driver, the Supabase client,
 * and the LocalDatabase facade — never to React.
 */

export const BATCH_SIZE = 50
export const RETRY_CAP = 8

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
  requestSync(minIntervalMs = 3000): void {
    const now = Date.now()
    if (this.busy) return
    if (now - this.lastRequestAt < minIntervalMs) return
    this.lastRequestAt = now
    void this.syncNow()
  }

  /**
   * Full sync cycle: upload outbox → download + merge. Never throws; every
   * failure is captured in the report and the SyncStatus service.
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

      const elapsed = Math.round(performance.now() - started)
      const nowIso = new Date().toISOString()
      await this.deps.lastSyncAt.set(nowIso)
      await this.deps.stats.save({
        lastUploadAt: upload.uploaded > 0 || upload.deleted > 0 ? nowIso : undefined,
        lastDownloadAt: downloaded > 0 ? nowIso : undefined,
        rowsUploaded: (await this.deps.stats.load()).rowsUploaded + upload.uploaded,
        rowsDownloaded: (await this.deps.stats.load()).rowsDownloaded + downloaded,
        failedOps: upload.failed,
        retryCount: upload.failed,
        avgSyncTimeMs: elapsed,
        lastError: upload.failed > 0 ? 'Some operations failed and will retry.' : null,
        currentOp: null,
        queueSize: await countPendingOps(this.deps.driver),
        latencyMs: elapsed,
        lastSyncAt: nowIso,
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
        const rows = batch.map(op => ({ ...(op.payload ?? {}), user_id: uid }))
        const { error } = await client.from(table).upsert(rows, { onConflict: cfg.onConflict })
        done += batch.length
        if (error) {
          failed += batch.length
          for (const op of batch) {
            await markOpFailed(this.deps.driver, op.id, error.message)
          }
        } else {
          uploaded += batch.length
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
          await removeOp(this.deps.driver, op.id)
        }
        syncStatusService.set('uploading', { phase: 'upload', done, total: pending.length, percent: Math.round((done / pending.length) * 100) })
      }
    }

    return { uploaded, deleted, failed }
  }

  // ─── Download + local-first merge ───────────────────────────────────

  private async downloadAndMerge(client: SupabaseClient, uid: string): Promise<number> {
    syncStatusService.set('downloading', { phase: 'download', done: 0, total: DOWNLOAD_TABLES.length, percent: 0 })

    const remote: Record<string, Record<string, unknown>[]> = {}
    for (let i = 0; i < DOWNLOAD_TABLES.length; i++) {
      const table = DOWNLOAD_TABLES[i]
      const { data, error } = await client.from(table).select('*').eq('user_id', uid)
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

    // Local-first guard: ANY queued op for a key (including ops in a retry
    // backoff window, which listPendingOps filters out) means the local change
    // is unsent and must win over a download. listAllOps covers both.
    const pendingKeys = new Set((await listAllOps(this.deps.driver)).map(op => op.id))
    const lastSyncRaw = await this.deps.lastSyncAt.get()
    const cutoff = lastSyncRaw ? new Date(lastSyncRaw).getTime() : 0

    syncStatusService.set('merging', { phase: 'merge', done: 0, total: DOWNLOAD_TABLES.length, percent: 0 })

    let applied = 0
    applied += this.mergeTopicProgress(data, remote.topic_progress ?? [], pendingKeys, cutoff)
    applied += this.mergeAssessmentProgress(data, remote.assessment_progress ?? [], pendingKeys, cutoff)
    applied += this.mergeLogsAndSessions(data, remote)
    applied += this.mergeSettings(remote.settings ?? [])

    syncStatusService.set('merging', { phase: 'merge', done: DOWNLOAD_TABLES.length, total: DOWNLOAD_TABLES.length, percent: 100 })

    if (applied > 0) {
      await this.deps.persist(data)
      this.deps.notifyRemoteMerge(data)
    }
    return applied
  }

  private mergeTopicProgress(
    data: TrainingData,
    rows: Record<string, unknown>[],
    pendingKeys: Set<string>,
    cutoff: number,
  ): number {
    let applied = 0
    const subs = collectSubtopics(data)
    for (const row of rows) {
      const subId = String(row.subtopic_id ?? '')
      if (!subId) continue
      const key = `topic_progress:${subId}`
      // Local-first: an unsent local change always wins over a download.
      if (pendingKeys.has(key)) continue
      const updatedAt = new Date(String(row.updated_at ?? '')).getTime()
      if (!Number.isFinite(updatedAt) || updatedAt <= cutoff) continue
      const sub = subs.get(subId)
      if (!sub) continue
      const remoteCompleted = Boolean(row.completed)
      const remoteHours = Number(row.hours_spent ?? 0)
      const remoteLast = row.last_studied_at ? String(row.last_studied_at) : ''
      let changed = false
      if (remoteCompleted && !sub.completed) { sub.completed = true; changed = true }
      if (remoteHours > sub.hoursSpent) { sub.hoursSpent = Math.round(remoteHours * 100) / 100; changed = true }
      if (remoteLast && remoteLast > (sub.lastStudied ?? '')) { sub.lastStudied = remoteLast; changed = true }
      if (changed) applied++
    }
    return applied
  }

  private mergeAssessmentProgress(
    data: TrainingData,
    rows: Record<string, unknown>[],
    pendingKeys: Set<string>,
    cutoff: number,
  ): number {
    let applied = 0
    const assessments = collectAssessments(data)
    for (const row of rows) {
      const id = String(row.assessment_id ?? '')
      if (!id) continue
      const key = `assessment_progress:${id}`
      if (pendingKeys.has(key)) continue
      const updatedAt = new Date(String(row.updated_at ?? '')).getTime()
      if (!Number.isFinite(updatedAt) || updatedAt <= cutoff) continue
      const a = assessments.get(id)
      if (!a) continue
      const remoteCompleted = Boolean(row.completed)
      const remoteScore = row.score != null ? Number(row.score) : undefined
      let changed = false
      if (remoteCompleted && !a.completed) { a.completed = true; changed = true }
      if (remoteScore != null && Number.isFinite(remoteScore) && a.score !== remoteScore) { a.score = remoteScore; changed = true }
      if (changed) applied++
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

  /** Settings: single row per user — apply theme if it changed remotely. */
  private mergeSettings(rows: Record<string, unknown>[]): number {
    let applied = 0
    for (const row of rows) {
      const theme = String(row.theme ?? '')
      if (!theme) continue
      if (theme !== this.deps.getTheme()) {
        this.deps.applyTheme(theme)
        applied++
      }
    }
    return applied
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
    })
  }
  return engineSingleton
}
