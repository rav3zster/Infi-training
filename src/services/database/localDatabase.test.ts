import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryDriver } from './memoryDriver'
import { LocalDatabase } from './LocalDatabase'
import { loadTrainingData, saveTrainingData } from '../repositories/trainingRepository'
import { recordEvent, listEvents } from '../repositories/eventRepository'
import { loadLegacyLocalStorage, backfillLogIds, backfillSubTopicEstimates, migrateCompletionCredits } from './legacyMigration'
import { createSeedData } from '../../data/curriculum'
import type { TrainingData, DailyLogEntry } from '../../types'

// ─── localStorage shim (Node test env has no DOM storage) ───
const storage = new Map<string, string>()
const fakeLocalStorage: Storage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, String(v)) },
  removeItem: (k: string) => { storage.delete(k) },
  clear: () => storage.clear(),
  key: (i: number) => Array.from(storage.keys())[i] ?? null,
  get length() { return storage.size },
}
;(globalThis as Record<string, unknown>).localStorage = fakeLocalStorage

function makeData(): TrainingData {
  const seed = createSeedData()
  return {
    ...seed,
    dailyLogs: [],
    studySessions: [],
  }
}

describe('MemoryDriver', () => {
  let driver: MemoryDriver

  beforeEach(() => {
    driver = new MemoryDriver()
  })

  it('round-trips rows keyed by id', async () => {
    await driver.open()
    await driver.put('app_meta', { id: 'schema_version', value: 1 })
    await driver.putMany('daily_logs', [
      { id: 'a', data: { hours: 1 } },
      { id: 'b', data: { hours: 2 } },
    ])
    expect(await driver.count('app_meta')).toBe(1)
    expect(await driver.count('daily_logs')).toBe(2)
    const all = await driver.getAll('daily_logs')
    expect(all).toHaveLength(2)
    await driver.delete('daily_logs', 'a')
    expect(await driver.count('daily_logs')).toBe(1)
    await driver.clear('daily_logs')
    expect(await driver.count('daily_logs')).toBe(0)
  })

  it('exportAll/importAll round-trips every store', async () => {
    await driver.open()
    await driver.put('app_meta', { id: 'x', value: 'y' })
    await driver.put('study_events', { id: 'e1', data: { type: 'session.logged' } })
    const snap = await driver.exportAll()
    const driver2 = new MemoryDriver()
    await driver2.open()
    await driver2.importAll(snap)
    expect(await driver2.get('app_meta', 'x')).toEqual({ id: 'x', value: 'y' })
    expect(await driver2.get('study_events', 'e1')).toEqual({ id: 'e1', data: { type: 'session.logged' } })
  })
})

describe('trainingRepository', () => {
  let driver: MemoryDriver

  beforeEach(() => {
    driver = new MemoryDriver()
  })

  it('persists and hydrates TrainingData through the document store', async () => {
    await driver.open()
    const data = makeData()
    data.dailyLogs.push({
      id: 'log-1',
      date: '2026-08-02',
      subtopicId: 's1',
      subtopicName: 'Variables',
      hours: 0.5,
    })
    await saveTrainingData(driver, data)
    const loaded = await loadTrainingData(driver)
    expect(loaded).not.toBeNull()
    expect(loaded!.modules.length).toBe(data.modules.length)
    expect(loaded!.dailyLogs).toHaveLength(1)
    expect(loaded!.dailyLogs[0].id).toBe('log-1')
  })

  it('returns null when the store is empty', async () => {
    await driver.open()
    expect(await loadTrainingData(driver)).toBeNull()
  })
})

describe('eventRepository', () => {
  let driver: MemoryDriver

  beforeEach(() => {
    driver = new MemoryDriver()
  })

  it('records and lists immutable study events newest-first', async () => {
    await driver.open()
    await recordEvent(driver, {
      type: 'subtopic.completed',
      entityType: 'subtopic',
      entityId: 's1',
      payload: { name: 'Variables' },
      occurredAt: '2026-08-02T10:00:00Z',
    })
    await recordEvent(driver, {
      type: 'session.logged',
      entityType: 'session',
      entityId: 's1',
      payload: { hours: 0.5 },
      occurredAt: '2026-08-02T11:00:00Z',
    })
    const events = await listEvents(driver)
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('session.logged')
    expect(events[1].type).toBe('subtopic.completed')
  })
})

describe('legacyMigration', () => {
  it('backfills log ids on legacy data', () => {
    const data = makeData()
    data.dailyLogs.push({ date: '2026-08-01', subtopicId: 's1', subtopicName: 'X', hours: 1 } as DailyLogEntry)
    backfillLogIds(data)
    expect(data.dailyLogs[0].id).toBeTruthy()
    // idempotent
    const first = data.dailyLogs[0].id
    backfillLogIds(data)
    expect(data.dailyLogs[0].id).toBe(first)
  })

  it('backfills subtopic estimates idempotently', () => {
    const data = makeData()
    const sub = data.modules[0].topics[0].subtopics[0]
    sub.baseEstimateMinutes = undefined
    backfillSubTopicEstimates(data)
    expect(sub.baseEstimateMinutes).toBeGreaterThan(0)
    const first = sub.baseEstimateMinutes
    backfillSubTopicEstimates(data)
    expect(sub.baseEstimateMinutes).toBe(first)
  })

  it('credits completion hours once (idempotent migration)', () => {
    const data = makeData()
    const mod = data.modules[0]
    const topic = mod.topics[0]
    const sub = topic.subtopics[0]
    sub.completed = true
    sub.baseEstimateMinutes = 30
    const before = data.dailyLogs.length
    migrateCompletionCredits(data)
    const credited = data.dailyLogs.length - before
    expect(credited).toBe(1)
    const hours = data.dailyLogs[before].hours
    expect(hours).toBeGreaterThan(0)
    // Running again must not double-credit
    migrateCompletionCredits(data)
    expect(data.dailyLogs.length - before).toBe(1)
  })

  it('reads legacy localStorage when present', () => {
    const data = makeData()
    localStorage.setItem('training-tracker-data', JSON.stringify(data))
    const loaded = loadLegacyLocalStorage()
    expect(loaded).not.toBeNull()
    localStorage.removeItem('training-tracker-data')
  })

  it('returns null when localStorage is empty', () => {
    localStorage.removeItem('training-tracker-data')
    expect(loadLegacyLocalStorage()).toBeNull()
  })
})

describe('LocalDatabase (MemoryDriver)', () => {
  let db: LocalDatabase

  beforeEach(() => {
    db = new LocalDatabase(new MemoryDriver())
    localStorage.clear()
  })

  it('init runs migrations and marks schema version', async () => {
    await db.init()
    const versions = await db.getVersionInfo()
    expect(versions.schemaVersion).toBeGreaterThanOrEqual(1)
    expect(versions.appVersion).toBeTruthy()
  })

  it('persists + hydrates through the facade', async () => {
    await db.init()
    const data = makeData()
    data.dailyLogs.push({ id: 'l1', date: '2026-08-02', subtopicId: 's1', subtopicName: 'A', hours: 1 })
    await db.persistTrainingData(data)
    const hydrated = await db.hydrateTrainingData()
    expect(hydrated?.dailyLogs).toHaveLength(1)
  })

  it('export/import backup round-trips the full database', async () => {
    await db.init()
    const data = makeData()
    data.dailyLogs.push({ id: 'l1', date: '2026-08-02', subtopicId: 's1', subtopicName: 'A', hours: 1 })
    await db.persistTrainingData(data)

    const json = await db.exportBackup()
    expect(typeof json).toBe('string')

    // Fresh database, restore from backup
    const db2 = new LocalDatabase(new MemoryDriver())
    await db2.init()
    const restored = await db2.importBackup(json)
    expect(restored.dailyLogs).toHaveLength(1)
    expect(restored.dailyLogs[0].id).toBe('l1')
    expect(restored.modules.length).toBe(data.modules.length)
  })

  it('rejects invalid backup JSON', async () => {
    await db.init()
    await expect(db.importBackup('not-json')).rejects.toThrow()
    await expect(db.importBackup('{"nope":true}')).rejects.toThrow()
  })

  it('keeps only the latest 5 backups', async () => {
    await db.init()
    for (let i = 0; i < 8; i++) {
      await db.createBackup(`test-${i}`)
    }
    const backups = await db.listBackups()
    expect(backups.length).toBe(5)
  })

  it('integrity check passes on a healthy database', async () => {
    await db.init()
    const report = await db.integrityCheck()
    expect(report.ok).toBe(true)
  })

  it('records sync history and prunes past the cap', async () => {
    await db.init()
    for (let i = 0; i < 250; i++) {
      await db.recordSyncHistory({ timestamp: new Date().toISOString(), kind: 'info', detail: `e${i}` })
    }
    const history = await db.getSyncHistory(50)
    expect(history.length).toBeLessThanOrEqual(200)
  })

  it('health check reports database+storage healthy, auth/supabase not-configured', async () => {
    await db.init()
    const health = await db.healthCheck()
    expect(health.database).toBe('healthy')
    expect(health.storage).toBe('healthy')
    expect(health.auth).toBe('not-configured')
    expect(health.supabase).toBe('not-configured')
  })

  it('getStats reports row counts and engine label', async () => {
    await db.init()
    const data = makeData()
    data.dailyLogs.push({ id: 'l1', date: '2026-08-02', subtopicId: 's1', subtopicName: 'A', hours: 1 })
    await db.persistTrainingData(data)
    const stats = await db.getStats()
    expect(stats.engine).toBe('memory')
    expect(stats.rowsByStore.app_state).toBe(1)
    expect(stats.rowsByStore.daily_logs).toBe(1)
    expect(stats.totalRows).toBeGreaterThan(0)
  })
})
