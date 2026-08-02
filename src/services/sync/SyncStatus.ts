/**
 * SyncStatus — the status service for the sync engine.
 *
 * States: idle · syncing · preparing · uploading · downloading · merging ·
 * completed · retrying · offline · error · conflict
 *
 * UI consumes this through SyncContext; the Sync Engine drives it. The
 * service itself is UI-free and subscribable, and also carries a coarse
 * progress object (phase + done/total/percent) for the Diagnostics page.
 */

export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'preparing'
  | 'uploading'
  | 'downloading'
  | 'merging'
  | 'completed'
  | 'retrying'
  | 'offline'
  | 'error'
  | 'conflict'

export interface SyncProgress {
  phase: 'upload' | 'download' | 'merge'
  done: number
  total: number
  percent: number
}

export type SyncStatusEvent =
  | { type: 'status'; status: SyncStatus; progress: SyncProgress | null }
  | { type: 'error'; error: string }

type Listener = (event: SyncStatusEvent) => void

class SyncStatusService {
  private status: SyncStatus = 'idle'
  private lastError: string | null = null
  private progress: SyncProgress | null = null
  private listeners = new Set<Listener>()

  get(): SyncStatus {
    return this.status
  }

  getLastError(): string | null {
    return this.lastError
  }

  getProgress(): SyncProgress | null {
    return this.progress
  }

  set(status: SyncStatus, progress?: SyncProgress | null): void {
    const nextProgress = progress !== undefined ? progress : this.progress
    if (this.status === status && this.progress === nextProgress) return
    this.status = status
    this.progress = nextProgress
    if (status !== 'error') this.lastError = null
    this.emit({ type: 'status', status, progress: nextProgress })
  }

  setError(error: string): void {
    this.lastError = error
    this.status = 'error'
    this.emit({ type: 'error', error })
  }

  setProgress(progress: SyncProgress): void {
    this.progress = progress
    this.emit({ type: 'status', status: this.status, progress })
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
