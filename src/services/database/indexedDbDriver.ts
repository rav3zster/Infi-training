import type { DatabaseDriver, IntegrityCheckResult } from './driver'
import { STORE_NAMES } from './stores'

const DB_NAME = 'training-tracker-db'
const DB_VERSION = 1

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * IndexedDbDriver — browser/development persistence.
 * Real IndexedDB (object stores keyed by `id`), used on web + the dev preview
 * so the app runs fully offline without a WASM dependency.
 */
export class IndexedDbDriver implements DatabaseDriver {
  readonly platform = 'web' as const
  readonly engineName = 'IndexedDB'

  private db: IDBDatabase | null = null
  private openPromise: Promise<IDBDatabase> | null = null
  private activeTransaction: IDBTransaction | null = null

  isOpen(): boolean {
    return this.db !== null
  }

  private getDb(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db)
    if (!this.openPromise) {
      this.openPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          for (const store of STORE_NAMES) {
            if (!db.objectStoreNames.contains(store)) {
              db.createObjectStore(store, { keyPath: 'id' })
            }
          }
        }
        req.onsuccess = () => {
          this.db = req.result
          resolve(this.db)
        }
        req.onerror = () => reject(req.error)
      })
    }
    return this.openPromise
  }

  async open(): Promise<void> {
    await this.getDb()
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
      this.openPromise = null
    }
  }

  private withStore<T>(
    store: string,
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    if (this.activeTransaction) {
      // We are inside a transaction() call — route through the shared IDBTransaction.
      try {
        // Call fn synchronously so the request is issued before any async
        // boundary, then promisify it in the same microtask.
        return promisifyRequest(fn(this.activeTransaction.objectStore(store)))
      } catch {
        // The shared transaction may be finishing/committed (a race between a
        // concurrent reader and the engine's write transaction). Fall back to
        // an independent transaction instead of failing the caller.
      }
    }
    return this.getDb().then(db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
    )
  }

  async getAll(store: string): Promise<Record<string, unknown>[]> {
    return this.withStore(store, 'readonly', s => s.getAll())
  }

  async get(store: string, id: string): Promise<Record<string, unknown> | undefined> {
    return this.withStore(store, 'readonly', s => s.get(id))
  }

  async put(store: string, row: Record<string, unknown>): Promise<void> {
    await this.withStore(store, 'readwrite', s => s.put(row))
  }

  async putMany(store: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return
    if (this.activeTransaction) {
      try {
        const s = this.activeTransaction.objectStore(store)
        for (const row of rows) s.put(row)
        return
      } catch {
        // Shared transaction finishing — fall through to an independent write.
      }
    }
    const db = await this.getDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      const s = tx.objectStore(store)
      for (const row of rows) s.put(row)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async delete(store: string, id: string): Promise<void> {
    await this.withStore(store, 'readwrite', s => s.delete(id))
  }

  async clear(store: string): Promise<void> {
    await this.withStore(store, 'readwrite', s => s.clear())
  }

  async count(store: string): Promise<number> {
    return this.withStore(store, 'readonly', s => s.count())
  }

  async listStores(): Promise<string[]> {
    const db = await this.getDb()
    return Array.from(db.objectStoreNames)
  }

  /**
   * Execute fn inside a single, atomic multi-store IDB readwrite transaction.
   *
   * IDB requires all store names upfront.  We open a readwrite transaction over
   * ALL known stores so any combination of put/clear/putMany inside fn shares
   * one IDBTransaction and either all commits (oncomplete) or all rolls back.
   *
   * Previously this was a pass-through (return fn()) which meant each inner
   * write opened its own IDB transaction — a crash between clear() and putMany()
   * could leave a projected store permanently empty.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = await this.getDb()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite')
      this.activeTransaction = tx

      let fnResult: T
      let settled = false

      const fail = (err: unknown) => {
        if (settled) return
        settled = true
        this.activeTransaction = null
        try { tx.abort() } catch { /* already committed/aborted */ }
        reject(err)
      }

      tx.oncomplete = () => {
        this.activeTransaction = null
        if (!settled) {
          settled = true
          resolve(fnResult)
        }
      }
      tx.onerror = () => fail(tx.error)
      tx.onabort = () => fail(tx.error ?? new Error('IDB transaction aborted'))

      fn()
        .then(res => { fnResult = res })
        .catch(fail)
    })
  }

  async integrityCheck(expectedStores: string[]): Promise<IntegrityCheckResult> {
    const checks: string[] = []
    const errors: string[] = []
    const db = await this.getDb()
    const present = new Set(Array.from(db.objectStoreNames))
    for (const s of expectedStores) {
      if (present.has(s)) checks.push(`store ${s}: present`)
      else errors.push(`store ${s}: MISSING`)
    }
    try {
      const tx = db.transaction(expectedStores.length ? expectedStores : ['app_meta'], 'readonly')
      const probe = tx.objectStore('app_meta').count()
      await promisifyRequest(probe)
      checks.push('read probe: ok')
    } catch (e) {
      errors.push(`read probe failed: ${String(e)}`)
    }
    return { ok: errors.length === 0, checks, errors }
  }

  async getVersion(): Promise<string> {
    return 'IndexedDB (web dev driver)'
  }

  async exportAll(): Promise<Record<string, Record<string, unknown>[]>> {
    const out: Record<string, Record<string, unknown>[]> = {}
    for (const store of STORE_NAMES) {
      out[store] = await this.getAll(store)
    }
    return out
  }

  async importAll(tables: Record<string, Record<string, unknown>[]>): Promise<void> {
    const db = await this.getDb()
    // Only touch stores present in the snapshot — infra stores (backups,
    // sync_history, sync_outbox, AI) survive a restore untouched.
    const storeNames = Object.keys(tables).filter(s => db.objectStoreNames.contains(s))
    if (storeNames.length === 0) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite')
      for (const store of storeNames) {
        const s = tx.objectStore(store)
        s.clear()
        for (const row of tables[store] ?? []) s.put(row)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
