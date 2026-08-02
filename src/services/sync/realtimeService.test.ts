import { describe, it, expect, afterEach } from 'vitest'
import { realtimeService } from './realtimeService'

/**
 * Minimal fake Supabase client exposing just enough of the Realtime API
 * (channel().on().subscribe()) for the service tests.
 */
function fakeClient() {
  const handlers: { event: string; config: Record<string, unknown>; cb: (payload: unknown) => void }[] = []
  let subscribed = 0
  let unsubscribed = 0

  const channel = {
    on(event: string, config: Record<string, unknown>, cb: (payload: unknown) => void) {
      handlers.push({ event, config, cb })
      return channel
    },
    subscribe() {
      subscribed++
      return 'SUBSCRIBED'
    },
    unsubscribe() {
      unsubscribed++
      return Promise.resolve('UNSUBSCRIBED')
    },
  }

  const client = {
    channel: (name: string) => {
      expect(name).toBe('training-tracker-sync')
      return channel
    },
  }

  return { client, handlers, counters: () => ({ subscribed, unsubscribed }) }
}

describe('realtimeService', () => {
  afterEach(() => {
    realtimeService.unsubscribe()
  })

  it('subscribes to postgres_changes on every synced table with a user filter', () => {
    const { client, handlers } = fakeClient()
    realtimeService.subscribe(client as never, 'user-123')

    expect(handlers.length).toBe(7) // topic_progress, assessment_progress, daily_logs, study_sessions, study_events, settings, revision_queue
    for (const h of handlers) {
      expect(h.event).toBe('postgres_changes')
      expect(h.config).toMatchObject({ schema: 'public', event: '*' })
      expect(h.config.filter).toBe('user_id=eq.user-123')
    }
    const tables = handlers.map(h => (h.config as { table: string }).table)
    expect(tables).toContain('topic_progress')
    expect(tables).toContain('daily_logs')
    expect(tables).toContain('settings')
    expect(realtimeService.isActive()).toBe(true)
  })

  it('is idempotent — subscribing twice keeps a single channel', () => {
    const a = fakeClient()
    const b = fakeClient()
    realtimeService.subscribe(a.client as never, 'user-1')
    realtimeService.subscribe(b.client as never, 'user-1') // ignored

    expect(a.counters().subscribed).toBe(1)
    expect(b.counters().subscribed).toBe(0)
  })

  it('unsubscribe closes the channel and clears the active state', () => {
    const { client, counters } = fakeClient()
    realtimeService.subscribe(client as never, 'user-1')
    expect(realtimeService.isActive()).toBe(true)

    realtimeService.unsubscribe()

    expect(counters().unsubscribed).toBe(1)
    expect(realtimeService.isActive()).toBe(false)
  })

  it('dispatches a sync:realtime window event when a change payload arrives', () => {
    const { client, handlers } = fakeClient()
    let received: { table: string; eventType: string } | null = null
    const listener = (e: Event) => {
      received = (e as CustomEvent).detail as { table: string; eventType: string }
    }
    const win = globalThis as Record<string, unknown>
    const origWindow = win.window
    win.window = {
      dispatchEvent: (e: Event) => {
        listener(e)
        return true
      },
    } as unknown as Window

    try {
      realtimeService.subscribe(client as never, 'user-1')
      const tp = handlers.find(h => (h.config as { table: string }).table === 'topic_progress')!
      tp.cb({ eventType: 'UPDATE', new: { user_id: 'user-1', subtopic_id: 's1', completed: true } })

      expect(received).not.toBeNull()
      expect(received!.table).toBe('topic_progress')
      expect(received!.eventType).toBe('UPDATE')
    } finally {
      if (origWindow === undefined) delete win.window
      else win.window = origWindow
    }
  })
})
