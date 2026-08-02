import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryDriver } from '../database/memoryDriver'
import {
  enqueueOp,
  listPendingOps,
  listAllOps,
  removeOp,
  markOpFailed,
  backoffDelayMs,
  countPendingOps,
  clearOutbox,
  type OutboxOp,
} from './outboxRepository'
import type { DatabaseDriver } from '../database/driver'

describe('outboxRepository', () => {
  let driver: DatabaseDriver

  beforeEach(async () => {
    driver = new MemoryDriver()
    await driver.open()
  })

  it('enqueues an upsert op keyed by table:clientId', async () => {
    await enqueueOp(driver, { table: 'topic_progress', clientId: 'm2-t1-s1', action: 'upsert', payload: { completed: true } })
    const all = await listAllOps(driver)
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('topic_progress:m2-t1-s1')
    expect(all[0].action).toBe('upsert')
    expect(all[0].payload).toEqual({ completed: true })
    expect(all[0].attempts).toBe(0)
  })

  it('compresses repeated upserts to the same key (latest payload wins)', async () => {
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: { completed: false, hours_spent: 1 } })
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: { completed: true, hours_spent: 2 } })
    const all = await listAllOps(driver)
    expect(all).toHaveLength(1)
    expect(all[0].payload).toEqual({ completed: true, hours_spent: 2 })
    expect(await countPendingOps(driver)).toBe(1)
  })

  it('delete cancels an un-uploaded upsert entirely', async () => {
    await enqueueOp(driver, { table: 'daily_logs', clientId: 'log-1', action: 'upsert', payload: { hours: 1 } })
    await enqueueOp(driver, { table: 'daily_logs', clientId: 'log-1', action: 'delete' })
    expect(await listAllOps(driver)).toHaveLength(0)
  })

  it('delete converts an already-failed upsert into a delete op', async () => {
    await enqueueOp(driver, { table: 'daily_logs', clientId: 'log-1', action: 'upsert', payload: { hours: 1 } })
    await markOpFailed(driver, 'daily_logs:log-1', 'network')
    await enqueueOp(driver, { table: 'daily_logs', clientId: 'log-1', action: 'delete' })
    const all = await listAllOps(driver)
    expect(all).toHaveLength(1)
    expect(all[0].action).toBe('delete')
    expect(all[0].payload).toBeNull()
  })

  it('markOpFailed increments attempts and schedules exponential backoff', async () => {
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: { completed: true } })
    const before = Date.now()
    await markOpFailed(driver, 'topic_progress:s1', 'boom')
    let op = (await listAllOps(driver))[0]
    expect(op.attempts).toBe(1)
    expect(op.lastError).toBe('boom')
    expect(op.nextRetryAt).not.toBeNull()
    expect(op.nextRetryAt!).toBeGreaterThanOrEqual(before + backoffDelayMs(1) - 5)

    await markOpFailed(driver, 'topic_progress:s1', 'boom2')
    op = (await listAllOps(driver))[0]
    expect(op.attempts).toBe(2)
    // Second failure schedules the doubled backoff (2s) from the second failure time.
    const secondFailureAt = Date.now()
    expect(op.nextRetryAt!).toBeGreaterThanOrEqual(secondFailureAt + backoffDelayMs(2) - 5)
    expect(op.nextRetryAt!).toBeLessThanOrEqual(secondFailureAt + backoffDelayMs(2) + 5)
  })

  it('listPendingOps excludes ops inside their retry window', async () => {
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: {} })
    await markOpFailed(driver, 'topic_progress:s1', 'boom')
    expect(await listPendingOps(driver)).toHaveLength(0)

    // After the backoff window elapses, the op becomes eligible again.
    const op = (await listAllOps(driver))[0]
    op.nextRetryAt = Date.now() - 1
    await driver.put('sync_outbox', { id: op.id, data: op as unknown as Record<string, unknown> })
    const pending = await listPendingOps(driver)
    expect(pending).toHaveLength(1)
  })

  it('removeOp deletes a specific op', async () => {
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: {} })
    await removeOp(driver, 'topic_progress:s1')
    expect(await listAllOps(driver)).toHaveLength(0)
  })

  it('clearOutbox empties the queue', async () => {
    await enqueueOp(driver, { table: 'topic_progress', clientId: 's1', action: 'upsert', payload: {} })
    await enqueueOp(driver, { table: 'daily_logs', clientId: 'l1', action: 'upsert', payload: {} })
    await clearOutbox(driver)
    expect(await countPendingOps(driver)).toBe(0)
  })

  it('backoffDelayMs follows 1s,2s,4s,8s,16s,32s then caps at 60s', () => {
    expect(backoffDelayMs(1)).toBe(1000)
    expect(backoffDelayMs(2)).toBe(2000)
    expect(backoffDelayMs(3)).toBe(4000)
    expect(backoffDelayMs(4)).toBe(8000)
    expect(backoffDelayMs(5)).toBe(16000)
    expect(backoffDelayMs(6)).toBe(32000)
    expect(backoffDelayMs(7)).toBe(60000)
    expect(backoffDelayMs(12)).toBe(60000)
  })

  it('stores and reads the full op shape', async () => {
    await enqueueOp(driver, { table: 'study_events', clientId: 'evt-1', action: 'upsert', payload: { type: 'session.logged' } })
    const row = await driver.get('sync_outbox', 'study_events:evt-1')
    const op = row?.data as unknown as OutboxOp
    expect(op.id).toBe('study_events:evt-1')
    expect(op.createdAt).toBeGreaterThan(0)
    expect(op.updatedAt).toBeGreaterThanOrEqual(op.createdAt)
    expect(op.nextRetryAt).toBeNull()
  })
})
