import type { DatabaseDriver } from '../database/driver'
import type { StudyEvent } from '../../types'
import { genId } from '../../utils/id'
import { enqueueOp } from '../sync/outboxRepository'
import { mapStudyEvent } from '../sync/mappers'

const STORE = 'study_events'
const MAX_EVENTS = 2000

/**
 * Append an immutable study event. Fire-and-forget: callers never await this
 * for UI correctness. Trimmed to MAX_EVENTS newest entries.
 *
 * Phase 3: every event is also mirrored to the sync outbox so the Sync Engine
 * ships it to Supabase.study_events (append-only, deduped by client_id).
 */
export async function recordEvent(
  driver: DatabaseDriver,
  event: Omit<StudyEvent, 'id'>,
): Promise<void> {
  const full: StudyEvent = { ...event, id: genId('evt') }
  try {
    await driver.put(STORE, { id: full.id, data: full as unknown as Record<string, unknown> })
    await enqueueOp(driver, { table: 'study_events', clientId: full.id, action: 'upsert', payload: mapStudyEvent(full) })
    const count = await driver.count(STORE)
    if (count > MAX_EVENTS) {
      const all = await driver.getAll(STORE)
      const sorted = all
        .map(r => r.data as unknown as StudyEvent)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      const toRemove = sorted.slice(MAX_EVENTS)
      for (const ev of toRemove) await driver.delete(STORE, ev.id)
    }
  } catch {
    // Events must never break the study flow.
  }
}

/** Latest events, newest first. */
export async function listEvents(driver: DatabaseDriver, limit = 100): Promise<StudyEvent[]> {
  try {
    const all = await driver.getAll(STORE)
    return all
      .map(r => r.data as unknown as StudyEvent)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit)
  } catch {
    return []
  }
}
