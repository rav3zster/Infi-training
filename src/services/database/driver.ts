/**
 * DatabaseDriver — the platform seam of the persistence layer.
 *
 * Two production implementations speak this contract:
 *   • IndexedDbDriver  — web / browser dev preview
 *   • NativeSqliteDriver — Android via @capacitor-community/sqlite
 *   • MemoryDriver     — in-memory (Vitest, SSR safety)
 *
 * Both are REAL databases, not placeholders. The repositories above this
 * interface speak pure table operations and never touch the platform.
 */

export interface DatabaseStats {
  /** Tables/stores present */
  storeCount: number
  /** Rows per store */
  rowsByStore: Record<string, number>
  totalRows: number
  /** Approximate size in bytes (sum of serialized rows) */
  estimatedBytes: number
  /** Largest table by row count */
  largestTable: { name: string; rows: number } | null
  /** Measured average query latency in ms */
  averageQueryTimeMs: number
  /** Pending outbox ops (0 until the sync engine writes) */
  pendingQueue: number
  /** Engine label */
  engine: string
  /** SQLite version or driver label */
  version: string
}

export interface IntegrityCheckResult {
  ok: boolean
  checks: string[]
  errors: string[]
}

export interface DatabaseDriver {
  readonly platform: 'web' | 'native' | 'memory'
  readonly engineName: string

  open(): Promise<void>
  close(): Promise<void>
  isOpen(): boolean

  /** All rows in a store/table (no ordering guarantee) */
  getAll(store: string): Promise<Record<string, unknown>[]>
  /** One row by id */
  get(store: string, id: string): Promise<Record<string, unknown> | undefined>
  /** Upsert a row (row must carry an `id` field) */
  put(store: string, row: Record<string, unknown>): Promise<void>
  /** Batch upsert */
  putMany(store: string, rows: Record<string, unknown>[]): Promise<void>
  /** Delete one row */
  delete(store: string, id: string): Promise<void>
  /** Empty a store */
  clear(store: string): Promise<void>
  /** Row count */
  count(store: string): Promise<number>
  /** List existing stores/tables */
  listStores(): Promise<string[]>

  /** Run a batch of ops atomically (best-effort on web) */
  transaction<T>(fn: () => Promise<T>): Promise<T>

  /** Database-level integrity check */
  integrityCheck(expectedStores: string[]): Promise<IntegrityCheckResult>
  /** Engine version string */
  getVersion(): Promise<string>
  /** Snapshot every store (for backup/export) */
  exportAll(): Promise<Record<string, Record<string, unknown>[]>>
  /** Restore a snapshot (wipe + write every store) */
  importAll(tables: Record<string, Record<string, unknown>[]>): Promise<void>
}
