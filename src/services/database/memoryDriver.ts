import type { DatabaseDriver, IntegrityCheckResult } from './driver'

/**
 * MemoryDriver — in-memory Map-backed driver.
 * Used by Vitest and as an SSR-safe fallback. Mirrors the IndexedDB/SQLite
 * semantics (rows keyed by `id`).
 */
export class MemoryDriver implements DatabaseDriver {
  readonly platform = 'memory' as const
  readonly engineName = 'memory'

  private stores = new Map<string, Map<string, Record<string, unknown>>>()
  private opened = false

  async open(): Promise<void> {
    this.opened = true
  }

  async close(): Promise<void> {
    this.opened = false
  }

  isOpen(): boolean {
    return this.opened
  }

  private store(name: string): Map<string, Record<string, unknown>> {
    let s = this.stores.get(name)
    if (!s) {
      s = new Map()
      this.stores.set(name, s)
    }
    return s
  }

  async getAll(store: string): Promise<Record<string, unknown>[]> {
    return Array.from(this.store(store).values())
  }

  async get(store: string, id: string): Promise<Record<string, unknown> | undefined> {
    return this.store(store).get(id)
  }

  async put(store: string, row: Record<string, unknown>): Promise<void> {
    const id = String(row.id)
    if (!id) throw new Error(`MemoryDriver: row for store "${store}" is missing id`)
    this.store(store).set(id, row)
  }

  async putMany(store: string, rows: Record<string, unknown>[]): Promise<void> {
    for (const row of rows) await this.put(store, row)
  }

  async delete(store: string, id: string): Promise<void> {
    this.store(store).delete(id)
  }

  async clear(store: string): Promise<void> {
    this.store(store).clear()
  }

  async count(store: string): Promise<number> {
    return this.store(store).size
  }

  async listStores(): Promise<string[]> {
    return Array.from(this.stores.keys())
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  async integrityCheck(_expectedStores: string[]): Promise<IntegrityCheckResult> {
    return { ok: true, checks: ['memory driver: no integrity constraints'], errors: [] }
  }

  async getVersion(): Promise<string> {
    return 'memory'
  }

  async exportAll(): Promise<Record<string, Record<string, unknown>[]>> {
    const out: Record<string, Record<string, unknown>[]> = {}
    for (const [name, store] of this.stores) {
      out[name] = Array.from(store.values())
    }
    return out
  }

  async importAll(tables: Record<string, Record<string, unknown>[]>): Promise<void> {
    this.stores.clear()
    for (const [name, rows] of Object.entries(tables)) {
      const s = new Map<string, Record<string, unknown>>()
      for (const row of rows) s.set(String(row.id), row)
      this.stores.set(name, s)
    }
  }
}
