import type { DatabaseDriver } from '../database/driver'

/**
 * outboxRepository — the local sync outbox.
 *
 * Every local mutation writes an OutboxOp here (append-only queue on the
 * sync_outbox store). The Sync Engine drains it in the background and ships
 * rows to Supabase. Compression: ops are keyed by `${table}:${clientId}` so
 * rapid successive changes to the same record collapse into one entry.
 *
 * Row shape in the store: { id, data: OutboxOp }.
 */

export type SyncTable =
  | 'profiles'
  | 'topic_progress'
  | 'assessment_progress'
  | 'daily_logs'
  | 'study_sessions'
  | 'study_events'
  | 'settings'

export interface OutboxOp {
  /** Stable op id = `${table}:${clientId}` — the compression key. */
  id: string
  table: SyncTable
  /** The client id of the affected record (subtopic id, log id, …). */
  clientId: string
  action: 'upsert' | 'delete'
  /** Full row payload (without user_id — added at upload time). Null for deletes. */
  payload: Record<string, unknown> | null
  attempts: number
  lastError: string | null
  /** Epoch ms — ops are not eligible until this time (null = ready now). */
  nextRetryAt: number | null
  createdAt: number
  updatedAt: number
}

export interface EnqueueInput {
  table: SyncTable
  clientId: string
  action: 'upsert' | 'delete'
  payload?: Record<string, unknown> | null
}

const MAX_ATTEMPTS = 8

function opId(table: SyncTable, clientId: string): string {
  return `${table}:${clientId}`
}

/** Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, capped at 60s. */
export function backoffDelayMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempts - 1), 60_000)
}

/**
 * Enqueue (or compress) an outbox op. Fire-and-forget from the UI layer;
 * callers never await this for correctness. Never throws.
 */
export async function enqueueOp(
  driver: DatabaseDriver,
  input: EnqueueInput,
): Promise<void> {
  try {
    const id = opId(input.table, input.clientId)
    const now = Date.now()
    const existing = await readOp(driver, id)

    if (!existing) {
      await driver.put('sync_outbox', {
        id,
        data: {
          id,
          table: input.table,
          clientId: input.clientId,
          action: input.action,
          payload: input.action === 'upsert' ? (input.payload ?? {}) : null,
          attempts: 0,
          lastError: null,
          nextRetryAt: null,
          createdAt: now,
          updatedAt: now,
        } satisfies OutboxOp,
      })
      return
    }

    if (input.action === 'upsert') {
      // Compression: latest payload wins, retry eligibility resets, but the
      // attempt counter survives so a hot record can't loop forever.
      await driver.put('sync_outbox', {
        id,
        data: {
          ...existing,
          action: 'upsert',
          payload: input.payload ?? {},
          lastError: null,
          nextRetryAt: null,
          updatedAt: now,
        } satisfies OutboxOp,
      })
      return
    }

    // Delete op.
    if (existing.action === 'upsert' && existing.attempts === 0) {
      // The record was created but never uploaded — deleting it locally means
      // it never needs to exist remotely. Drop the op entirely.
      await driver.delete('sync_outbox', id)
      return
    }
    // Otherwise mark the deletion so the engine removes the remote row.
    await driver.put('sync_outbox', {
      id,
      data: {
        ...existing,
        action: 'delete',
        payload: null,
        nextRetryAt: null,
        updatedAt: now,
      } satisfies OutboxOp,
    })
  } catch {
    // The outbox must never break the study flow.
  }
}

/** Pending ops eligible for upload (attempts < cap, retry window open). */
export async function listPendingOps(driver: DatabaseDriver): Promise<OutboxOp[]> {
  try {
    const rows = await driver.getAll('sync_outbox')
    const now = Date.now()
    return rows
      .map(r => r.data as unknown as OutboxOp)
      .filter(
        op =>
          op &&
          op.attempts < MAX_ATTEMPTS &&
          (op.nextRetryAt == null || op.nextRetryAt <= now),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

/** All ops including failed ones (for diagnostics + failed-op counts). */
export async function listAllOps(driver: DatabaseDriver): Promise<OutboxOp[]> {
  try {
    const rows = await driver.getAll('sync_outbox')
    return rows.map(r => r.data as unknown as OutboxOp)
  } catch {
    return []
  }
}

/** Number of pending (upload-eligible) ops. */
export async function countPendingOps(driver: DatabaseDriver): Promise<number> {
  return (await listPendingOps(driver)).length
}

/** Remove an op after successful upload (or a cancelled delete). */
export async function removeOp(driver: DatabaseDriver, id: string): Promise<void> {
  try {
    await driver.delete('sync_outbox', id)
  } catch {
    // best-effort
  }
}

/** Record a failure with exponential backoff scheduling. */
export async function markOpFailed(
  driver: DatabaseDriver,
  id: string,
  error: string,
): Promise<void> {
  try {
    const existing = await readOp(driver, id)
    if (!existing) return
    const attempts = existing.attempts + 1
    await driver.put('sync_outbox', {
      id,
      data: {
        ...existing,
        attempts,
        lastError: error,
        nextRetryAt: Date.now() + backoffDelayMs(attempts),
        updatedAt: Date.now(),
      } satisfies OutboxOp,
    })
  } catch {
    // best-effort
  }
}

/** Wipe the outbox (used by factory reset + full purge). */
export async function clearOutbox(driver: DatabaseDriver): Promise<void> {
  try {
    await driver.clear('sync_outbox')
  } catch {
    // best-effort
  }
}

async function readOp(driver: DatabaseDriver, id: string): Promise<OutboxOp | null> {
  try {
    const row = await driver.get('sync_outbox', id)
    return row ? (row.data as unknown as OutboxOp) : null
  } catch {
    return null
  }
}
