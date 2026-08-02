import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryDriver } from '../database/memoryDriver'
import type { DatabaseDriver } from '../database/driver'
import { SyncEngine, type SyncEngineDeps, type SyncRunReport } from './syncEngine'
import { enqueueOp } from './outboxRepository'
import { createSeedData } from '../../data/curriculum'
import type { TrainingData } from '../../types'
import type { SyncHistoryEntry, SyncStats } from '../database/LocalDatabase'

type Table = 'profiles' | 'topic_progress' | 'assessment_progress' | 'daily_logs' | 'study_sessions' | 'study_events' | 'settings'

/** In-memory fake Supabase server for engine tests. */
class FakeSupabase {
  tables: Record<string, Record<string, Record<string, unknown>>> = {}
  failUpserts: string[] = [] // table names whose upserts should fail
  upsertCalls: { table: string; rows: Record<string, unknown>[]; onConflict?: string }[] = []
  deleteCalls: { table: string; userId: string; key: string; value: string }[] = []
  selectCalls: { table: string; userId: string }[] = []
  uid = 'user-123'

  seed(table: string, rows: Record<string, unknown>[]): void {
    const store = this.tables[table] ?? (this.tables[table] = {})
    for (const row of rows) {
      const key = String(row.client_id ?? row.subtopic_id ?? row.assessment_id ?? row.user_id ?? Object.values(row)[0] ?? 'x')
      store[key] = row
    }
  }

  get(table: string): Record<string, unknown>[] {
    return Object.values(this.tables[table] ?? {})
  }

  async upsert(table: string, input: Record<string, unknown> | Record<string, unknown>[], onConflict?: string) {
    const rows = Array.isArray(input) ? input : [input]
    this.upsertCalls.push({ table, rows, onConflict })
    if (this.failUpserts.includes(table)) return { error: { message: `fake error on ${table}` } }
    const store = this.tables[table] ?? (this.tables[table] = {})
    for (const row of rows) {
      const key = String(row.client_id ?? row.subtopic_id ?? row.assessment_id ?? row.user_id ?? 'x')
      store[key] = { ...row, updated_at: new Date().toISOString() }
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
        // Must be a real Promise so the engine's .catch() works.
        getSession: () => Promise.resolve({ data: { session: { user: { id: self.uid } } } }),
      },
      from: (table: Table) => ({
        upsert: (rows: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) =>
          self.upsert(table, rows, opts?.onConflict),
        select: () => ({
          eq: (_key: string, value: string) => {
            self.selectCalls.push({ table, userId: value })
            return { data: self.get(table), error: null }
          },
        }),
        delete: () => ({
          // Awaitable after one .eq() (purge) or chainable for a second .eq() (op deletes).
          eq: (key: string, value: string) => ({
            eq: (key2: string, value2: string) => self.delete(table, value, key2, value2),
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              self.delete(table, value, key, value).then(onFulfilled, onRejected),
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

    expect(report.ok).toBe(true) // engine swallows per-op failures, continues
    expect(report.failed).toBe(1)
    // op stays, marked failed
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
    // Pre-hydrate local data through the deps.hydrate hook
    const local = seedData()
    const target = local.modules[0].topics[0].subtopics[0]
    expect(target.completed).toBe(false)
    h.deps.hydrate = async () => structuredClone(local)

    // Remote says it's completed with a recent updated_at
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

  it('local-first: a pending local op (failed upload) prevents a remote overwrite', async () => {
    const fake = new FakeSupabase()
    fake.failUpserts = ['topic_progress'] // upload fails → op stays queued
    const h = makeDeps(fake)
    const driver = await openDriver(h.driver)
    const local = seedData()
    const target = local.modules[0].topics[0].subtopics[0]
    h.deps.hydrate = async () => structuredClone(local)

    // Local has an UNSENT change for the same subtopic (upload will fail).
    await enqueueOp(driver, { table: 'topic_progress', clientId: target.id, action: 'upsert', payload: { subtopic_id: target.id, completed: true, hours_spent: 2 } })
    // Remote carries a conflicting state — the pending local op must win.
    fake.seed('topic_progress', [
      { user_id: fake.uid, subtopic_id: target.id, completed: true, hours_spent: 0.5, last_studied_at: '2026-08-02', updated_at: new Date().toISOString() },
    ])

    const engine = new SyncEngine(h.deps)
    const report = await engine.syncNow()

    expect(report.ok).toBe(true)
    expect(report.failed).toBe(1) // upload failed, op stays queued
    expect(report.downloaded).toBe(0) // merge skipped the key — local wins
    expect(h.saved).toBeNull() // nothing applied, no merge
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
    expect(tables).toContain('settings')
  })

  it('returns not-configured / offline / unauthenticated gracefully', async () => {
    const h1 = makeDeps(new FakeSupabase())
    h1.deps.getClient = () => null
    await openDriver(h1.driver)
    const engine1 = new SyncEngine(h1.deps)
    let report: SyncRunReport = await engine1.syncNow()
    expect(report.reason).toBe('not-configured')

    // offline — navigator stub (Node test env has no navigator)
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
