import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import type { DatabaseDriver, IntegrityCheckResult } from './driver'
import { STORE_NAMES } from './stores'

const DB_NAME = 'training-tracker'
const SCHEMA_VERSION = 1

const DDL = STORE_NAMES.map(
  s => `CREATE TABLE IF NOT EXISTS ${s} (id TEXT PRIMARY KEY, data TEXT);`,
).join('\n')

/**
 * NativeSqliteDriver — Android via @capacitor-community/sqlite.
 * Each logical store is a real SQLite table (id TEXT PRIMARY KEY, data TEXT).
 */
export class NativeSqliteDriver implements DatabaseDriver {
  readonly platform = 'native' as const
  readonly engineName = 'SQLite'

  private conn: SQLiteConnection
  private db: Awaited<ReturnType<SQLiteConnection['retrieveConnection']>> | null = null

  constructor() {
    this.conn = new SQLiteConnection(CapacitorSQLite)
  }

  isOpen(): boolean {
    return this.db !== null
  }

  async open(): Promise<void> {
    const exists = await CapacitorSQLite.isDBExists({ database: DB_NAME })
    if (!exists.result) {
      await this.conn.createConnection(DB_NAME, false, 'no-encryption', SCHEMA_VERSION, false)
    }
    this.db = await this.conn.retrieveConnection(DB_NAME, false)
    await this.db.open()
    await this.db.execute(DDL)
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close()
      this.db = null
    }
  }

  private requireDb() {
    if (!this.db) throw new Error('NativeSqliteDriver: database not open')
    return this.db
  }

  private parseRow(r: Record<string, unknown>): Record<string, unknown> {
    const parsed = JSON.parse(String(r.data ?? 'null'))
    return { id: String(r.id), data: parsed }
  }

  async getAll(store: string): Promise<Record<string, unknown>[]> {
    const res = await this.requireDb().query(`SELECT id, data FROM ${store}`)
    return (res.values ?? []).map(r => this.parseRow(r))
  }

  async get(store: string, id: string): Promise<Record<string, unknown> | undefined> {
    const res = await this.requireDb().query(`SELECT id, data FROM ${store} WHERE id = ?`, [id])
    const rows = res.values ?? []
    return rows.length ? this.parseRow(rows[0]) : undefined
  }

  async put(store: string, row: Record<string, unknown>): Promise<void> {
    const id = String(row.id)
    if (!id) throw new Error(`NativeSqliteDriver: row for "${store}" is missing id`)
    const value = 'data' in row ? row.data : row
    await this.requireDb().run(
      `INSERT OR REPLACE INTO ${store} (id, data) VALUES (?, ?)`,
      [id, JSON.stringify(value)],
    )
  }

  async putMany(store: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return
    const db = this.requireDb()
    await db.run('BEGIN TRANSACTION')
    try {
      for (const row of rows) {
        const id = String(row.id)
        if (!id) continue
        const value = 'data' in row ? row.data : row
        await db.run(
          `INSERT OR REPLACE INTO ${store} (id, data) VALUES (?, ?)`,
          [id, JSON.stringify(value)],
        )
      }
      await db.run('COMMIT')
    } catch (e) {
      await db.run('ROLLBACK')
      throw e
    }
  }

  async delete(store: string, id: string): Promise<void> {
    await this.requireDb().run(`DELETE FROM ${store} WHERE id = ?`, [id])
  }

  async clear(store: string): Promise<void> {
    await this.requireDb().run(`DELETE FROM ${store}`)
  }

  async count(store: string): Promise<number> {
    const res = await this.requireDb().query(`SELECT COUNT(*) as c FROM ${store}`)
    const rows = res.values ?? []
    return rows.length ? Number((rows[0] as Record<string, unknown>).c ?? 0) : 0
  }

  async listStores(): Promise<string[]> {
    const res = await this.requireDb().query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    return (res.values ?? []).map(r => String((r as Record<string, unknown>).name))
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.requireDb()
    await db.run('BEGIN TRANSACTION')
    try {
      const out = await fn()
      await db.run('COMMIT')
      return out
    } catch (e) {
      await db.run('ROLLBACK')
      throw e
    }
  }

  async integrityCheck(expectedStores: string[]): Promise<IntegrityCheckResult> {
    const checks: string[] = []
    const errors: string[] = []
    const db = this.requireDb()
    const integrity = await db.query('PRAGMA integrity_check')
    const row = (integrity.values ?? [])[0]
    // v8 query() may return row objects ({ integrity_check: 'ok' }) or arrays
    // (['ok']) depending on version — handle both explicitly.
    const status =
      typeof row === 'object' && row !== null
        ? String((row as Record<string, unknown>).integrity_check ?? (row as string[])[0] ?? '')
        : ''
    if (status === 'ok') checks.push('PRAGMA integrity_check: ok')
    else errors.push(`integrity_check: ${status || 'no result'}`)

    const existing = new Set(await this.listStores())
    for (const s of expectedStores) {
      if (existing.has(s)) checks.push(`table ${s}: present`)
      else errors.push(`table ${s}: MISSING`)
    }
    return { ok: errors.length === 0, checks, errors }
  }

  async getVersion(): Promise<string> {
    try {
      const res = await this.requireDb().query('SELECT sqlite_version() as v')
      const rows = res.values ?? []
      return String((rows[0] as Record<string, unknown>).v ?? 'unknown')
    } catch {
      return 'unknown'
    }
  }

  async exportAll(): Promise<Record<string, Record<string, unknown>[]>> {
    const out: Record<string, Record<string, unknown>[]> = {}
    for (const store of STORE_NAMES) {
      out[store] = await this.getAll(store)
    }
    return out
  }

  async importAll(tables: Record<string, Record<string, unknown>[]>): Promise<void> {
    const db = this.requireDb()
    // Only touch stores present in the snapshot — infra tables (backups,
    // sync_history, sync_outbox, AI) survive a restore untouched.
    const storeNames = Object.keys(tables).filter(s => STORE_NAMES.includes(s as (typeof STORE_NAMES)[number]))
    if (storeNames.length === 0) return
    await db.run('BEGIN TRANSACTION')
    try {
      for (const store of storeNames) {
        await db.run(`DELETE FROM ${store}`)
        for (const row of tables[store] ?? []) {
          const id = String(row.id)
          const { id: _drop, ...rest } = row
          await db.run(
            `INSERT OR REPLACE INTO ${store} (id, data) VALUES (?, ?)`,
            [id, JSON.stringify(rest)],
          )
        }
      }
      await db.run('COMMIT')
    } catch (e) {
      await db.run('ROLLBACK')
      throw e
    }
  }
}
