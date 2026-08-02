import type { DatabaseDriver } from '../database/driver'
import type { TrainingData } from '../../types'

const APP_STATE_ID = 'main'

function isTrainingData(x: unknown): x is TrainingData {
  if (!x || typeof x !== 'object') return false
  const d = x as TrainingData
  return Array.isArray(d.modules) && Array.isArray(d.dailyLogs)
}

/**
 * Load the TrainingData document (the single source of truth snapshot).
 * Returns null when the store is empty (fresh install).
 */
export async function loadTrainingData(driver: DatabaseDriver): Promise<TrainingData | null> {
  try {
    const row = await driver.get('app_state', APP_STATE_ID)
    if (!row) return null
    const data = row.data as unknown
    if (isTrainingData(data)) return data as TrainingData
    return null
  } catch {
    return null
  }
}

/**
 * Persist the TrainingData document as a single app_state row, plus
 * projected append-only rows for daily_logs and study_sessions (the units
 * the future sync engine will ship to Supabase). Written together so they
 * can never diverge.
 */
export async function saveTrainingData(driver: DatabaseDriver, data: TrainingData): Promise<void> {
  await driver.transaction(async () => {
    await driver.put('app_state', { id: APP_STATE_ID, data: data as unknown as Record<string, unknown> })

    await driver.clear('daily_logs')
    await driver.putMany(
      'daily_logs',
      data.dailyLogs.map(log => ({ id: log.id, data: log as unknown as Record<string, unknown> })),
    )

    await driver.clear('study_sessions')
    await driver.putMany(
      'study_sessions',
      (data.studySessions ?? []).map(s => ({ id: s.id, data: s as unknown as Record<string, unknown> })),
    )
  })
}
