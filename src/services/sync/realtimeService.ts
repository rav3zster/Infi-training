import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

/**
 * realtimeService — Supabase Realtime subscription for the sync tables.
 *
 * Single-user app: one channel, filtered to the authenticated user's rows
 * (`user_id=eq.<uid>`). Any INSERT/UPDATE/DELETE on a synced table fires a
 * `sync:realtime` CustomEvent carrying {table, eventType, occurredAt} that
 * SyncContext listens for — it then triggers a delta re-download + merge so
 * every online device converges within seconds. No refresh button needed.
 *
 * The service itself is UI-free: it only owns the channel lifecycle and the
 * event dispatch.
 */

export interface RealtimeEventDetail {
  table: string
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  occurredAt: string
}

/** Tables registered on the supabase_realtime publication (migration 0002). */
const REALTIME_TABLES = [
  'topic_progress',
  'assessment_progress',
  'daily_logs',
  'study_sessions',
  'study_events',
  'settings',
  'revision_queue',
] as const

class RealtimeService {
  private channel: RealtimeChannel | null = null

  /** Subscribe to postgres_changes for the user's rows. Idempotent. */
  subscribe(client: SupabaseClient, userId: string): void {
    if (this.channel) return
    const channel = client.channel('training-tracker-sync')
    for (const table of REALTIME_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
        payload => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent<RealtimeEventDetail>('sync:realtime', {
                detail: {
                  table,
                  eventType: payload.eventType as RealtimeEventDetail['eventType'],
                  occurredAt: new Date().toISOString(),
                },
              }),
            )
          }
        },
      )
    }
    channel.subscribe()
    this.channel = channel
  }

  /** Unsubscribe + close the channel. Idempotent. */
  unsubscribe(): void {
    if (!this.channel) return
    void this.channel.unsubscribe()
    this.channel = null
  }

  isActive(): boolean {
    return this.channel !== null
  }
}

export const realtimeService = new RealtimeService()
