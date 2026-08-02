import { localDatabase } from '../database/LocalDatabase'
import { enqueueOp } from './outboxRepository'
import { mapSettings } from './mappers'
import { readTheme, readDateOffset } from './clientSettings'

/**
 * settingsSync — enqueue the current settings snapshot for upload and request
 * a sync cycle. Called by the UI whenever theme or the simulated date offset
 * changes (ThemeContext toggle, PresetsScreen slider), so the single
 * `settings` row converges across devices via last-write-wins.
 */
export async function enqueueSettingsSync(): Promise<void> {
  // Ensure the local DB is open before writing to the outbox (the driver may
  // not be initialized on very early theme/offset changes). Idempotent.
  await localDatabase.init().catch(() => {})
  await enqueueOp(localDatabase.getDriver(), {
    table: 'settings',
    clientId: 'user', // single-row table keyed on user_id
    action: 'upsert',
    payload: mapSettings(readTheme(), readDateOffset()),
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync:request'))
  }
}
