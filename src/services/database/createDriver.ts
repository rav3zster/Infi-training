import { Capacitor } from '@capacitor/core'
import { IndexedDbDriver } from './indexedDbDriver'
import { NativeSqliteDriver } from './nativeSqliteDriver'
import type { DatabaseDriver } from './driver'

/**
 * Platform-aware driver factory.
 * Android (Capacitor native) → real SQLite via @capacitor-community/sqlite.
 * Web / dev preview → IndexedDB. Tests pass an explicit MemoryDriver.
 */
export function createDriver(): DatabaseDriver {
  if (Capacitor.isNativePlatform()) {
    return new NativeSqliteDriver()
  }
  return new IndexedDbDriver()
}
