import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { getSupabaseClient } from '../supabase/supabaseClient'

export type RealtimeTable =
  | 'topic_progress'
  | 'assessment_progress'
  | 'daily_logs'
  | 'study_sessions'
  | 'settings'

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE'

export type RealtimeChangePayload = {
  table: RealtimeTable
  eventType: RealtimeEventType
  new: Record<string, unknown>
  old: Record<string, unknown>
}

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface RealtimeStats {
  status: RealtimeStatus
  connectedAt: number | null
  lastEventAt: number | null
  eventCount: number
  latencyMs: number | null
}

const WATCHED_TABLES: RealtimeTable[] = [
  'topic_progress',
  'assessment_progress',
  'daily_logs',
  'study_sessions',
]

/**
 * CloudRealtime — Production-grade Supabase Realtime subscription.
 *
 * - Subscribes to each table with a dedicated per-table filter so Supabase
 *   can use row-level filters correctly.
 * - Tracks connection status and event statistics for the Diagnostics screen.
 * - Self-healing: exposes onReconnect callback only when the channel
 *   transitions from a non-SUBSCRIBED state, not on first connect.
 * - Uses a unique channel name per session to prevent duplicate subscriptions
 *   during hot-module replacement in development.
 */
export class CloudRealtime {
  private channel: RealtimeChannel | null = null
  private _stats: RealtimeStats = {
    status: 'disconnected',
    connectedAt: null,
    lastEventAt: null,
    eventCount: 0,
    latencyMs: null,
  }
  private statsListeners: Set<(s: RealtimeStats) => void> = new Set()
  private wasConnected = false

  get stats(): RealtimeStats {
    return { ...this._stats }
  }

  onStats(cb: (s: RealtimeStats) => void): () => void {
    this.statsListeners.add(cb)
    cb(this._stats)
    return () => this.statsListeners.delete(cb)
  }

  private emitStats(patch: Partial<RealtimeStats>) {
    this._stats = { ...this._stats, ...patch }
    for (const cb of this.statsListeners) cb(this._stats)
  }

  subscribe(
    onPayload: (payload: RealtimeChangePayload) => void,
    onReconnect?: () => void,
  ): void {
    const client = getSupabaseClient()
    if (!client) return

    this.unsubscribe()
    this.wasConnected = false
    this.emitStats({ status: 'connecting', connectedAt: null })

    void client.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id
      if (!uid) {
        this.emitStats({ status: 'error' })
        return
      }

      // Unique channel name per session prevents duplicate subscriptions in HMR
      const sessionId = Math.random().toString(36).slice(2, 8)
      const channelName = `cr_${sessionId}`

      let ch = client.channel(channelName)

      // Subscribe each table individually with its own row-level filter
      for (const table of WATCHED_TABLES) {
        ch = ch.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            filter: `user_id=eq.${uid}`,
          },
          (raw: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            const eventType = raw.eventType as RealtimeEventType
            const newRow = (raw.new ?? {}) as Record<string, unknown>
            const oldRow = (raw.old ?? {}) as Record<string, unknown>

            this.emitStats({
              lastEventAt: Date.now(),
              eventCount: this._stats.eventCount + 1,
            })

            onPayload({ table, eventType, new: newRow, old: oldRow })
          },
        )
      }

      ch.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          const now = Date.now()
          const latencyMs = this._stats.connectedAt
            ? now - this._stats.connectedAt
            : null
          this.emitStats({ status: 'connected', connectedAt: now, latencyMs })

          // Self-healing: call onReconnect only when recovering from a drop,
          // not on the very first connection (which would cause a double-fetch).
          if (this.wasConnected && onReconnect) {
            onReconnect()
          }
          this.wasConnected = true
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.emitStats({ status: 'error' })
          if (err) console.warn('[CloudRealtime] channel error:', err)
        } else if (status === 'CLOSED') {
          this.emitStats({ status: 'disconnected' })
        } else {
          // JOINING state
          this.emitStats({ status: 'connecting', connectedAt: Date.now() })
        }
      })

      this.channel = ch
    })
  }

  unsubscribe(): void {
    if (this.channel) {
      const client = getSupabaseClient()
      if (client) void client.removeChannel(this.channel)
      this.channel = null
      this.wasConnected = false
      this.emitStats({ status: 'disconnected' })
    }
  }
}

export const cloudRealtime = new CloudRealtime()
