import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabaseClient } from '../supabase/supabaseClient'

export type RealtimeChangePayload = {
  table: 'topic_progress' | 'assessment_progress' | 'daily_logs' | 'study_sessions' | 'settings'
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

export class CloudRealtime {
  private channel: RealtimeChannel | null = null

  subscribe(onPayload: (payload: RealtimeChangePayload) => void, onReconnect?: () => void): void {
    const client = getSupabaseClient()
    if (!client) return

    this.unsubscribe()

    void client.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id
      if (!uid) return

      this.channel = client
        .channel('cloud_realtime_v4')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', filter: `user_id=eq.${uid}` },
          payload => {
            const table = payload.table as RealtimeChangePayload['table']
            const eventType = payload.eventType as RealtimeChangePayload['eventType']
            onPayload({
              table,
              eventType,
              new: (payload.new as Record<string, unknown>) ?? {},
              old: (payload.old as Record<string, unknown>) ?? {},
            })
          },
        )
        .subscribe(status => {
          if (status === 'SUBSCRIBED' && onReconnect) {
            // Self-healing: pull latest on channel connect/reconnect
            onReconnect()
          }
        })
    })
  }

  unsubscribe(): void {
    if (this.channel) {
      const client = getSupabaseClient()
      if (client) void client.removeChannel(this.channel)
      this.channel = null
    }
  }
}

export const cloudRealtime = new CloudRealtime()
