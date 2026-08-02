/**
 * SyncStatus — the status service for the sync engine.
 *
 * States: idle · syncing · uploading · downloading · offline · error · conflict
 * UI consumes this through SyncContext; the Sync Engine (Phase 3) drives it.
 * The service itself is UI-free and subscribable.
 */

export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'uploading'
  | 'downloading'
  | 'offline'
  | 'error'
  | 'conflict'

export type SyncStatusEvent =
  | { type: 'status'; status: SyncStatus }
  | { type: 'error'; error: string }

type Listener = (event: SyncStatusEvent) => void

class SyncStatusService {
  private status: SyncStatus = 'idle'
  private lastError: string | null = null
  private listeners = new Set<Listener>()

  get(): SyncStatus {
    return this.status
  }

  getLastError(): string | null {
    return this.lastError
  }

  set(status: SyncStatus): void {
    if (this.status === status) return
    this.status = status
    if (status !== 'error') this.lastError = null
    this.emit({ type: 'status', status })
  }

  setError(error: string): void {
    this.lastError = error
    this.status = 'error'
    this.emit({ type: 'error', error })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: SyncStatusEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

export const syncStatusService = new SyncStatusService()
