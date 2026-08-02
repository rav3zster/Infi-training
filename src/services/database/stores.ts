/** Master list of stores/tables — single source of truth for the DB schema. */
export const STORE_NAMES = [
  'app_meta',
  'app_state',
  'daily_logs',
  'study_sessions',
  'study_events',
  'sync_outbox',
  'sync_history',
  'backups',
  'ai_cache',
  'coach_messages',
  'embeddings',
  'recommendations',
] as const

export type StoreName = (typeof STORE_NAMES)[number]

/**
 * Portable user data — the only stores included in backup export/import.
 * Infra stores (backups, outbox, sync history, AI tables) are client-local
 * bookkeeping and must never be wiped or resurrected by a restore.
 */
export const USER_STORES = [
  'app_meta',
  'app_state',
  'daily_logs',
  'study_sessions',
  'study_events',
] as const
