import { SCHEMA_VERSION } from './versions'
import type { DatabaseDriver } from './driver'

export interface Migration {
  version: number
  name: string
  up: (driver: DatabaseDriver) => Promise<void>
}

/**
 * Ordered migration list. Each entry bumps schema_version.
 * Migration 1 creates the physical stores — handled by driver.open(),
 * so this list starts empty and grows with future DDL/data changes.
 */
const MIGRATIONS: Migration[] = [
  // v1 — initial schema: stores created by the driver on open().
  // Future migrations append here, e.g.:
  // { version: 2, name: 'add revision columns', up: async (d) => { ... } },
]

const META_KEY = 'schema_version'

/**
 * Read the stored schema version (0 when absent).
 */
export async function readSchemaVersion(driver: DatabaseDriver): Promise<number> {
  try {
    const row = await driver.get('app_meta', META_KEY)
    const v = Number(row?.value ?? 0)
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

/**
 * Run any pending migrations, then write back the target schema version.
 * Idempotent and safe to run on every boot.
 */
export async function runMigrations(driver: DatabaseDriver): Promise<void> {
  const current = await readSchemaVersion(driver)
  if (current >= SCHEMA_VERSION) return

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    if (migration.version > SCHEMA_VERSION) break
    await migration.up(driver)
    await driver.put('app_meta', { id: META_KEY, value: migration.version })
  }

  // Ensure the final version is recorded even with an empty migration list.
  const latest = await readSchemaVersion(driver)
  if (latest < SCHEMA_VERSION) {
    await driver.put('app_meta', { id: META_KEY, value: SCHEMA_VERSION })
  }
}
