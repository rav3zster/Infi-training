/**
 * Version registry — four independent versions tracked by the app.
 *   • Schema version      → local DB shape (PRAGMA user_version / app_meta)
 *   • Curriculum version  → content rows (re-seed only when this changes)
 *   • Sync protocol       → wire format; server rejects mismatches
 *   • Application         → release version (Diagnostics + Presets)
 */

export const SCHEMA_VERSION = 1
export const CURRICULUM_VERSION = 1
export const SYNC_PROTOCOL_VERSION = 1
export const APP_VERSION = '0.4.0'

export const META_KEYS = {
  schemaVersion: 'schema_version',
  curriculumVersion: 'curriculum_version',
  syncProtocol: 'sync_protocol_version',
  appVersion: 'app_version',
  lastSyncAt: 'last_sync_at',
  lastAutoBackup: 'last_auto_backup',
  userId: 'user_id',
  syncStats: 'sync_stats',
} as const

export interface VersionInfo {
  schemaVersion: number
  curriculumVersion: number
  syncProtocolVersion: number
  appVersion: string
}
