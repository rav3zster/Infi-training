import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryDriver } from '../database/memoryDriver'
import type { DatabaseDriver } from '../database/driver'
import { SyncEngine, type SyncEngineDeps, type SyncRunReport } from './syncEngine'
import { enqueueOp } from './outboxRepository'
import { createSeedData } from '../../data/curriculum'
import type { TrainingData } from '../../types'
import type { SyncHistoryEntry, SyncStats } from '../database/LocalDatabase'

type Table =
  | 'profiles' | 'topic_progress' | 'assessment_progress' | 'daily_logs'
  | 'study_sessions' | 'study_events' | 'settings' | 'backups'

/** In-memory fake Supabase server for engine tests. */
class FakeSupabase {
  tables: Record<string, Record<string, Record<string, unknown>>> = {}
  failUpserts: string[] = []
  failUpsertsWith: Record<string, string> = {}
  upsertCalls: { table: string; rows: Record<string, unknown>[]; onConflict?: string }[] = []
  deleteCalls: { table: string; userId: string; key: string; value: string }[] = []
  selectCalls: { table: string; userId: string; gt?: { key: string; value: string } }[] = []
  insertCalls: { table: string; rows: Record<string, unknown>[] }[] = []
  uid = 'user-123'

  seed(table: string, rows: Record<string, unknown>[]): void {
    const store = this.tables[table] ?? (this.tables[table] = {})
    for (const row of rows) {
      const key = String(row.client_id ?? row.subtopic_id ?? row.assessment_id ?? row.user_id ?? row.name ?? Object.values(row)[0] ?? 'x')
      store[key] = row
    }
  }

  get(table: string): Record<string, unknown>[] {
    return Object.values(this.tables[table] ?? {})
  }

  async upsert(table: string, input: Record<string, unknown> | Record<string, unknown>[], onConflict?: string) {
    const rows = Array.isArray(input) ? input : [input]
    this.upsertCalls.push({ table, rows, onConflict })
    if (this.failUpsertsWith[table]) return { error: { message: this.failUpsertsWith[table] } }
    if (this.failUpserts.includes(table)) return { error: { message: `fake error on ${table}` } }
    const store = this.tables[table] ?? (this.tables[table] = {})
    for (const row of rows) {
      const key = String(row.client_id ?? row.subtopic_id ?? row.assessment_id ?? row.user_id ?? row.name ?? 'x')
      store[key] = { ...row, updated_at: new Date().toISOString() }
    }
    return { error: null }
  }

  async insert(table: string, input: Record<string, unknown> | Record<string, unknown>[]) {
    const rows = Array.isArray(input) ? input : [input]
    this.insertCalls.push({ table, rows })
    if (this.failUpserts.includes(table)) return { error: { message: `fake error on ${table}` } }
    const store = this.tables[table] ?? (this.tables[table] = {})
    for (const row of rows) {
      const key = String(row.client_id ?? row.subtopic_id ?? row.name ?? 'x')
      store[key] = { ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    }
    return { error: null }
  }

  async delete(table: string, userId: string, key: string, value: string) {
    this.deleteCalls.push({ table, userId, key, value })
    const store = this.tables[table] ?? (this.tables[table] = {})
    for (const k of Object.keys(store)) {
      if (String((store[k] as Record<string, unknown>)[key]) === value) delete store[k]
    }
    return { error: null }
  }

  client(): any {
    const self = this
    return {
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: self.uid } } } }),
      },
      from: (table: Table) => ({
        upsert: (rows: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) =>
          self.upsert(table, rows, opts?.onConflict),
        insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => self.insert(table, rows),
        select: () => {
          // Chainable builder — supports .eq().eq().limit(), .eq().gt(), .eq().order().
          const chain: Record<string, unknown> = {
            eq: (_key: string, value: string) => {
              self.selectCalls.push({ table, userId: value })
              return chain
            },
            gt: (k2: string, v2: string) => {
              self.selectCalls.push({ table, userId: self.uid, gt: { key: k2, value: v2 } })
              return chain
            },
            order: () => chain,
            limit: () => chain,
          }
          Object.defineProperty(chain, 'data', { get: () => self.get(table) })
          Object.defineProperty(chain, 'error', { get: () => null })
          return chain
        },
        delete: () => ({
          eq: (_key: string, value: string) => ({
            eq: (key2: string, value2: string) => self.delete(table, value, key2, value2),
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              self.delete(table, value, _key, value).then(onFulfilled, onRejected),
          }),
        }),
      }),
    }
  }
}

interface Harness {
  deps: SyncEngineDeps
  driver: DatabaseDriver
  saved: TrainingData | null
  historyLog: SyncHistoryEntry[]
  stats: SyncStats
}

function makeDeps(fake: FakeSupabase): Harness {
  const driver = new MemoryDriver()
  const harness: Harness = {
    deps: null as unknown as SyncEngineDeps,
    driver,
    saved: null,
    historyLog: [],
    stats: {
      lastUploadAt: null, lastDownloadAt: null, rowsUploaded: 0, rowsDownloaded: 0,
      failedOps: 0, retryCount: 0, avgSyncTimeMs: null, lastError: null,
      currentOp: null, queueSize: 0, latencyMs: null, lastSyncAt: null,
      deviceId: null, lastUploadedRecord: null, lastDownloadedRecord: null,
      lastRealtimeEvent: null, uploadSpeedRowsPerSec: null, downloadSpeedRowsPerSec: null,
      lastCloudBackupAt: null, cloudBackupCount: 0,
    },
  }
  harness.deps = {
    driver,
    getClient: () => fake.client(),
    history: async entry => { harness.historyLog.push({ ...entry, id: String(harness.historyLog.length) }) },
    stats: {
      load: async () => ({ ...harness.stats }),
      save: async patch => Object.assign(harness.stats, patch),
    },
    lastSyncAt: {
      get: async () => null,
      set: async () => {},
    },
    hydrate: async () => null,
    persist: async data => { harness.saved = structuredClone(data) },
    notifyRemoteMerge: () => {},
    getTheme: () => 'light',
    applyTheme: () => {},
    getDateOffset: () => 0,
    applyDateOffset: () => {},
    exportSnapshot: async () => JSON.stringify({ schemaVersion: 1, appVersion: 'test', exportedAt: new Date().toISOString(), tables: {} }),
  }
  return harness
}

function seedData(): TrainingData {
  const data = createSeedData()
  return { ...data, dailyLogs: [], studySessions: [] }
}

async function openDriver(driver: DatabaseDriver): Promise<DatabaseDriver> {
  await (driver as MemoryDriver).open()
  return driver
}

describe('SyncEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('uploads pending outbox ops and removes them on success', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    const driver = await openDriver(h.driver)
    await enqueueOp(driver, { table: 'topic_progress', clientId: 'm1-t1-s1', action: 'upsert', payload: { subtopic_id: 'm1-t1-s1', completed: true, hours_spent: 0.5 } })
    await enqueueOp(driver, { table: 'daily_logs', clientId: 'log-1', action: 'upsert', payload: { client_id: 'log-1', study_date: '2026-08-02', hours: 0.5 } })

    const engine = new SyncEngine(h.deps)
    const report = await engine.syncNow()

    expect(report.ok).toBe(true)
    expect(report.uploaded).toBe(2)
    expect(fake.upsertCalls.length).toBeGreaterThanOrEqual(2)
    const tp = fake.upsertCalls.find(c => c.table === 'topic_progress')!
    expect(tp.rows[0].user_id).toBe('user-123')
    expect(tp.onConflict).toBe('user_id,subtopic_id')
    // outbox drained
    expect(await (driver as MemoryDriver).count('sync_outbox')).toBe(0)
  })

  it('stamps device_id + sync_version on every uploaded row (LWW provenance)', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    const driver = await openDriver(h.driver)
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: { subtopic_id: 's1', completed: true, hours_spent: 1 } })

    const engine = new SyncEngine(h.deps)
    await engine.syncNow()

    const tp = fake.upsertCalls.find(c => c.table === 'topic_progress')!
    expect(tp.rows[0].device_id).toBe('no-device') // node env has no localStorage
    expect(tp.rows[0].sync_version).toBe(1)
  })

  it('bootstraps the profile row before uploading (FK requirement)', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    const driver = await openDriver(h.driver)
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: { subtopic_id: 's1', completed: true, hours_spent: 0.5 } })

    const engine = new SyncEngine(h.deps)
    await engine.syncNow()

    const profileUpsert = fake.upsertCalls.find(c => c.table === 'profiles')!
    expect(profileUpsert).toBeDefined()
    expect(profileUpsert.rows[0]).toMatchObject({ user_id: 'user-123', joining_date: '2026-09-21' })
    expect(profileUpsert.onConflict).toBe('user_id')
  })

  it('marks failed uploads with backoff and keeps them queued', async () => {
    const fake = new FakeSupabase()
    fake.failUpserts = ['topic_progress']
    const h = makeDeps(fake)
    const driver = await openDriver(h.driver)
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: { subtopic_id: 's1', completed: true, hours_spent: 0.5 } })

    const engine = new SyncEngine(h.deps)
    const report = await engine.syncNow()

    expect(report.ok).toBe(true)
    expect(report.failed).toBe(1)
    const all = await (driver as MemoryDriver).getAll('sync_outbox')
    expect(all).toHaveLength(1)
    const op = all[0].data as { attempts: number; lastError: string; nextRetryAt: number | null }
    expect(op.attempts).toBe(1)
    expect(op.lastError).toContain('topic_progress')
    expect(op.nextRetryAt).toBeGreaterThan(Date.now())
    expect(h.stats.lastError).toContain('failed')
  })

  it('downloads remote topic_progress and merges completion into local data', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    await openDriver(h.driver)
    const local = seedData()
    const target = local.modules[0].topics[0].subtopics[0]
    expect(target.completed).toBe(false)
    h.deps.hydrate = async () => structuredClone(local)

    fake.seed('topic_progress', [
      { user_id: fake.uid, subtopic_id: target.id, completed: true, hours_spent: 0.67, last_studied_at: '2026-08-02', updated_at: new Date().toISOString() },
    ])

    const engine = new SyncEngine(h.deps)
    const report = await engine.syncNow()

    expect(report.ok).toBe(true)
    expect(report.downloaded).toBeGreaterThanOrEqual(1)
    expect(h.saved).not.toBeNull()
    const merged = h.saved!
    const mergedTarget = merged.modules[0].topics[0].subtopics[0]
    expect(mergedTarget.completed).toBe(true)
    expect(mergedTarget.hoursSpent).toBe(0.67)
  })

  it('strict LWW: a newer remote UN-check applies verbatim (no monotonic lock)', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    await openDriver(h.driver)
    const local = seedData()
    const target = local.modules[0].topics[0].subtopics[0]
    target.completed = true // locally done
    target.hoursSpent = 2
    h.deps.hydrate = async () => structuredClone(local)

    // Another device un-checked it with a NEWER updated_at → LWW must un-check.
    fake.seed('topic_progress', [
      { user_id: fake.uid, subtopic_id: target.id, completed: false, hours_spent: 1, last_studied_at: '2026-08-01', updated_at: new Date().toISOString() },
    ])

    const engine = new SyncEngine(h.deps)
    const report = await engine.syncNow()

    expect(report.downloaded).toBeGreaterThanOrEqual(1)
    const merged = h.saved!
    const mergedTarget = merged.modules[0].topics[0].subtopics[0]
    expect(mergedTarget.completed).toBe(false) // LWW: newer un-check applies
    // hoursSpent is a cumulative counter — max-guarded so it never regresses.
    expect(mergedTarget.hoursSpent).toBe(2)
  })

  it('delta download: sends a .gt(updated_at) filter when a watermark exists', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    await openDriver(h.driver)
    h.deps.lastSyncAt.get = async () => '2026-08-01T00:00:00.000Z'
    const local = seedData()
    h.deps.hydrate = async () => structuredClone(local)
    // Remote row OLDER than the watermark must NOT be merged.
    const target = local.modules[0].topics[0].subtopics[0]
    fake.seed('topic_progress', [
      { user_id: fake.uid, subtopic_id: target.id, completed: true, hours_spent: 0.3, updated_at: '2026-07-01T00:00:00.000Z' },
    ])

    const engine = new SyncEngine(h.deps)
    await engine.syncNow()

    const gtCalls = fake.selectCalls.filter(c => c.gt)
    expect(gtCalls.length).toBeGreaterThan(0)
    const tp = gtCalls.find(c => c.table === 'topic_progress')
    // Delta filter includes a 5-minute clock-safety overlap window.
    expect(tp?.gt).toEqual({ key: 'updated_at', value: '2026-07-31T23:55:00.000Z' })
    // Older-than-watermark row never applied.
    expect(h.saved).toBeNull()
  })

  it('delta download for study_events uses occurred_at (no updated_at column)', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    await openDriver(h.driver)
    h.deps.lastSyncAt.get = async () => '2026-08-01T00:00:00.000Z'
    const local = seedData()
    h.deps.hydrate = async () => structuredClone(local)
    fake.seed('study_events', [
      { client_id: 'evt-old', user_id: fake.uid, type: 'timer.stopped', entity_type: 'subtopic', entity_id: 's1', payload: {}, occurred_at: '2026-07-01T00:00:00.000Z' },
    ])

    const engine = new SyncEngine(h.deps)
    await engine.syncNow()

    const gtCalls = fake.selectCalls.filter(c => c.gt)
    const ev = gtCalls.find(c => c.table === 'study_events')
    expect(ev?.gt).toEqual({ key: 'occurred_at', value: '2026-07-31T23:55:00.000Z' })
  })

  it('local-first: a pending local op (failed upload) prevents a remote overwrite', async () => {
    const fake = new FakeSupabase()
    fake.failUpserts = ['topic_progress']
    const h = makeDeps(fake)
    const driver = await openDriver(h.driver)
    const local = seedData()
    const target = local.modules[0].topics[0].subtopics[0]
    h.deps.hydrate = async () => structuredClone(local)

    await enqueueOp(driver, { table: 'topic_progress', clientId: target.id, action: 'upsert', payload: { subtopic_id: target.id, completed: true, hours_spent: 2 } })
    fake.seed('topic_progress', [
      { user_id: fake.uid, subtopic_id: target.id, completed: true, hours_spent: 0.5, last_studied_at: '2026-08-02', updated_at: new Date().toISOString() },
    ])

    const engine = new SyncEngine(h.deps)
    const report = await engine.syncNow()

    expect(report.ok).toBe(true)
    expect(report.failed).toBe(1)
    expect(report.downloaded).toBe(0)
    expect(h.saved).toBeNull()
  })

  it('appends remote daily_logs / study_sessions without duplicating client ids', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    await openDriver(h.driver)
    const local = seedData()
    h.deps.hydrate = async () => structuredClone(local)

    fake.seed('daily_logs', [
      { client_id: 'log-remote-1', user_id: fake.uid, study_date: '2026-08-01', subtopic_id: 'm1-t1-s1', subtopic_name: 'Semantic elements', hours: 1.5, source: 'timer', updated_at: new Date().toISOString() },
    ])
    fake.seed('study_sessions', [
      { client_id: 'sess-remote-1', user_id: fake.uid, study_date: '2026-08-01', start_time: '10:00:00', end_time: '11:30:00', duration_hours: 1.5, type: 'learning', subtopic_id: 'm1-t1-s1', subtopic_name: 'Semantic elements', module_name: 'M1', source: 'timer', updated_at: new Date().toISOString() },
    ])

    const engine = new SyncEngine(h.deps)
    const report = await engine.syncNow()

    expect(report.downloaded).toBe(2)
    const merged = h.saved!
    expect(merged.dailyLogs.map(l => l.id)).toContain('log-remote-1')
    expect(merged.studySessions!.map(s => s.id)).toContain('sess-remote-1')
  })

  it('downloads remote study_events into the local event store (append-only)', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    const driver = await openDriver(h.driver)
    const local = seedData()
    h.deps.hydrate = async () => structuredClone(local)

    fake.seed('study_events', [
      { client_id: 'evt-remote-1', user_id: fake.uid, type: 'subtopic.completed', entity_type: 'subtopic', entity_id: 'm1-t1-s1', payload: { hours: 0.5 }, occurred_at: '2026-08-02T10:00:00Z', updated_at: new Date().toISOString() },
    ])

    const engine = new SyncEngine(h.deps)
    const report = await engine.syncNow()

    expect(report.downloaded).toBe(1)
    const events = await (driver as MemoryDriver).getAll('study_events')
    expect(events).toHaveLength(1)
    const ev = events[0].data as { id: string; type: string; entityId: string }
    expect(ev.id).toBe('evt-remote-1')
    expect(ev.type).toBe('subtopic.completed')
    expect(ev.entityId).toBe('m1-t1-s1')
  })

  it('creates exactly one daily cloud backup snapshot per day (idempotent upsert)', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    await openDriver(h.driver)
    const local = seedData()
    h.deps.hydrate = async () => structuredClone(local)

    const engine = new SyncEngine(h.deps)
    await engine.syncNow()
    await engine.syncNow() // same day → must NOT create a second snapshot

    // Backups now use a (user_id, name) idempotent upsert (migration 0002).
    const backupUpserts = fake.upsertCalls.filter(c => c.table === 'backups')
    expect(backupUpserts).toHaveLength(1)
    expect(backupUpserts[0].onConflict).toBe('user_id,name')
    expect(h.stats.cloudBackupCount).toBe(1)
    expect(h.stats.lastCloudBackupAt).not.toBeNull()
  })

  it('never drops an op that keeps failing (transient schema errors recover)', async () => {
    vi.useFakeTimers()
    try {
      const fake = new FakeSupabase()
      fake.failUpserts = ['topic_progress'] // schema/column error for a while
      const h = makeDeps(fake)
      const driver = await openDriver(h.driver)
      await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: { subtopic_id: 's1', completed: true, hours_spent: 1 } })

      const engine = new SyncEngine(h.deps)
      // 12 failing cycles, each with enough real time elapsed to pass the
      // exponential backoff window so every cycle actually re-attempts the
      // upload. Far past the 8-attempt cap — the op must survive.
      for (let i = 0; i < 12; i++) {
        await engine.syncNow()
        vi.advanceTimersByTime(70_000) // > 60s max backoff
      }

      // Op is still queued (never dropped) even after exceeding the cap.
      expect(await (driver as MemoryDriver).count('sync_outbox')).toBe(1)

      // Schema fixed → next cycle re-enables the op and uploads it.
      fake.failUpserts = []
      vi.advanceTimersByTime(70_000)
      const report = await engine.syncNow()
      expect(report.uploaded).toBe(1)
      expect(await (driver as MemoryDriver).count('sync_outbox')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to a plain insert when the backup unique index is missing (pre-0002 DB)', async () => {
    const fake = new FakeSupabase()
    // Simulate a pre-0002 database: the (user_id, name) unique index is absent,
    // so the idempotent upsert fails with PostgREST's ON CONFLICT error.
    fake.failUpsertsWith = { backups: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }
    const h = makeDeps(fake)
    await openDriver(h.driver)
    const local = seedData()
    h.deps.hydrate = async () => structuredClone(local)

    const engine = new SyncEngine(h.deps)
    await engine.syncNow()

    // The upsert failed but the fallback insert succeeded — backup still made.
    const backupInserts = fake.insertCalls.filter(c => c.table === 'backups')
    expect(backupInserts).toHaveLength(1)
    expect(h.stats.cloudBackupCount).toBe(1)
    expect(h.stats.lastCloudBackupAt).not.toBeNull()
    expect(h.historyLog.some(e => e.kind === 'error' && e.detail.includes('backup'))).toBe(false)
  })

  it('pre-0002 fallback never duplicates a same-day backup (idempotent check-then-insert)', async () => {
    const fake = new FakeSupabase()
    // Pre-0002 database: the unique index is absent, so the upsert fails.
    fake.failUpsertsWith = { backups: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }
    const h = makeDeps(fake)
    await openDriver(h.driver)
    const local = seedData()
    h.deps.hydrate = async () => structuredClone(local)

    // A previous run already wrote today's snapshot (the exact duplicate
    // scenario that broke migration 0002).
    const name = `auto-${new Date().toISOString().slice(0, 10)}`
    fake.seed('backups', [{ user_id: fake.uid, name, kind: 'auto', payload: { schemaVersion: 1 }, size_bytes: 10 }])

    const engine = new SyncEngine(h.deps)
    await engine.syncNow()

    // The upsert failed (pre-0002) but the check found the existing snapshot,
    // so no second insert — the duplicate row is never created.
    const backupInserts = fake.insertCalls.filter(c => c.table === 'backups')
    expect(backupInserts).toHaveLength(0)
    expect(fake.get('backups')).toHaveLength(1)
    // The snapshot still counts as backed up today (guard stays armed).
    expect(h.stats.lastCloudBackupAt).not.toBeNull()
    expect(h.stats.cloudBackupCount).toBe(0)
    expect(h.historyLog.some(e => e.kind === 'error' && e.detail.includes('backup'))).toBe(false)
  })

  it('purgeRemote deletes every synced table for the user', async () => {
    const fake = new FakeSupabase()
    const h = makeDeps(fake)
    await openDriver(h.driver)
    fake.seed('topic_progress', [{ user_id: fake.uid, subtopic_id: 's1', completed: true, hours_spent: 1 }])

    const engine = new SyncEngine(h.deps)
    await engine.purgeRemote()

    const tables = fake.deleteCalls.map(c => c.table)
    expect(tables).toContain('topic_progress')
    expect(tables).toContain('daily_logs')
    expect(tables).toContain('study_sessions')
    expect(tables).toContain('assessment_progress')
    expect(tables).toContain('study_events')
    expect(tables).toContain('settings')
  })

  it('returns not-configured / offline / unauthenticated gracefully', async () => {
    const h1 = makeDeps(new FakeSupabase())
    h1.deps.getClient = () => null
    await openDriver(h1.driver)
    const engine1 = new SyncEngine(h1.deps)
    let report: SyncRunReport = await engine1.syncNow()
    expect(report.reason).toBe('not-configured')

    const fake = new FakeSupabase()
    const h2 = makeDeps(fake)
    await openDriver(h2.driver)
    const engine2 = new SyncEngine(h2.deps)
    const origNavigator = (globalThis as Record<string, unknown>).navigator
    ;(globalThis as Record<string, unknown>).navigator = { onLine: false }
    report = await engine2.syncNow()
    expect(report.reason).toBe('offline')
    if (origNavigator === undefined) delete (globalThis as Record<string, unknown>).navigator
    else (globalThis as Record<string, unknown>).navigator = origNavigator
  })
})
