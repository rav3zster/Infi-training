import type { DatabaseDriver } from '../database/driver'
import type { StudyEvent } from '../../types'
import { genId } from '../../utils/id'

const STORE = 'study_events'
const MAX_EVENTS = 2000

/**
 * Append an immutable study event. Fire-and-forget: callers never await this
 * for UI correctness. Trimmed to MAX_EVENTS newest entries.
 */
export async function recordEvent(
  driver: DatabaseDriver,
  event: Omit<StudyEvent, 'id'>,
): Promise<void> {
  const full: StudyEvent = { ...event, id: genId('evt') }
  try {
    await driver.put(STORE, { id: full.id, data: full as unknown as Record<string, unknown> })
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
