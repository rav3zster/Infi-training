import { getSupabaseClient } from '../supabase/supabaseClient'
import { createSeedData, formatDate } from '../../data/curriculum'
import type { TrainingData, SessionType } from '../../types'

/**
 * cloudRepository — Pure Supabase Cloud Repository.
 *
 * Supabase is the SINGLE SOURCE OF TRUTH.
 * No local SQLite, IndexedDB, outbox, or merge diffing.
 * State is read from Supabase at startup, held in React memory, and written
 * directly to Supabase via typed queries & RPCs.
 */

export class CloudRepository {
  /**
   * Load the complete user dataset from Supabase and merge onto the bundled static curriculum.
   */
  async loadSnapshot(): Promise<TrainingData> {
    const seed = createSeedData()
    const client = getSupabaseClient()
    if (!client) return seed

    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return seed

      // Attempt 1: Call one-shot get_user_snapshot RPC
      const { data: snapshotData, error: rpcError } = await client.rpc('get_user_snapshot')

      let topicProgressRows: Record<string, unknown>[] = []
      let assessmentProgressRows: Record<string, unknown>[] = []
      let dailyLogRows: Record<string, unknown>[] = []
      let studySessionRows: Record<string, unknown>[] = []

      if (!rpcError && snapshotData && typeof snapshotData === 'object') {
        const snap = snapshotData as Record<string, unknown[]>
        topicProgressRows = (snap.topic_progress ?? []) as Record<string, unknown>[]
        assessmentProgressRows = (snap.assessment_progress ?? []) as Record<string, unknown>[]
        dailyLogRows = (snap.daily_logs ?? []) as Record<string, unknown>[]
        studySessionRows = (snap.study_sessions ?? []) as Record<string, unknown>[]
      } else {
        // Fallback: Parallel SELECT queries if RPC not deployed yet
        const [tpRes, apRes, dlRes, ssRes] = await Promise.all([
          client.from('topic_progress').select('*').eq('user_id', uid),
          client.from('assessment_progress').select('*').eq('user_id', uid),
          client.from('daily_logs').select('*').eq('user_id', uid),
          client.from('study_sessions').select('*').eq('user_id', uid),
        ])
        topicProgressRows = (tpRes.data ?? []) as Record<string, unknown>[]
        assessmentProgressRows = (apRes.data ?? []) as Record<string, unknown>[]
        dailyLogRows = (dlRes.data ?? []) as Record<string, unknown>[]
        studySessionRows = (ssRes.data ?? []) as Record<string, unknown>[]
      }

      // Merge topic_progress onto seed curriculum
      const tpMap = new Map(topicProgressRows.map(r => [String(r.subtopic_id), r]))
      for (const m of seed.modules) {
        for (const t of m.topics) {
          for (const s of t.subtopics) {
            const row = tpMap.get(s.id)
            if (row) {
              s.completed = Boolean(row.completed)
              s.hoursSpent = Number(row.hours_spent ?? 0)
              if (row.last_studied_at) s.lastStudied = String(row.last_studied_at)
            }
          }
        }
      }

      // Merge assessment_progress onto seed curriculum
      const apMap = new Map(assessmentProgressRows.map(r => [String(r.assessment_id), r]))
      for (const m of seed.modules) {
        for (const a of m.assessments ?? []) {
          const row = apMap.get(a.id)
          if (row) {
            a.completed = Boolean(row.completed)
            if (row.score != null) a.score = Number(row.score)
            if (row.last_attempted) a.lastAttempted = String(row.last_attempted)
          }
        }
      }

      // Map daily logs
      seed.dailyLogs = dailyLogRows.map(r => ({
        id: String(r.client_id ?? r.id ?? ''),
        date: String(r.study_date ?? ''),
        subtopicId: String(r.subtopic_id ?? ''),
        subtopicName: String(r.subtopic_name ?? ''),
        hours: Number(r.hours ?? 0),
        source: (r.source as 'timer' | 'completion' | 'manual') ?? 'manual',
      }))

      // Map study sessions
      seed.studySessions = studySessionRows.map(r => ({
        id: String(r.client_id ?? r.id ?? ''),
        date: String(r.study_date ?? ''),
        subtopicId: String(r.subtopic_id ?? ''),
        subtopicName: String(r.subtopic_name ?? ''),
        moduleName: String(r.module_name ?? ''),
        durationHours: Number(r.duration_hours ?? 0),
        type: (r.session_type as SessionType) ?? 'learning',
        source: (r.source as 'timer' | 'completion' | 'manual') ?? 'manual',
      }))

      return seed
    } catch {
      return seed
    }
  }

  /** Toggle subtopic completion */
  async toggleSubtopic(subtopicId: string, completed: boolean, hoursSpent: number, lastStudied: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return
    const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
    const uid = session.data.session?.user?.id
    if (!uid) return

    await client.from('topic_progress').upsert({
      user_id: uid,
      subtopic_id: subtopicId,
      completed,
      hours_spent: hoursSpent,
      last_studied_at: lastStudied || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,subtopic_id' })
  }

  /** Toggle assessment completion */
  async toggleAssessment(assessmentId: string, completed: boolean, score?: number): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return
    const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
    const uid = session.data.session?.user?.id
    if (!uid) return

    await client.from('assessment_progress').upsert({
      user_id: uid,
      assessment_id: assessmentId,
      completed,
      score: score ?? null,
      last_attempted: completed ? formatDate(new Date()) : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,assessment_id' })
  }

  /** Log a study session */
  async logSession(params: {
    id: string
    subtopicId: string
    subtopicName: string
    moduleName: string
    durationHours: number
    type: SessionType
    date: string
    source: 'timer' | 'completion' | 'manual'
  }): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return
    const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
    const uid = session.data.session?.user?.id
    if (!uid) return

    const dailyLogRow = {
      user_id: uid,
      client_id: params.id,
      study_date: params.date,
      subtopic_id: params.subtopicId,
      subtopic_name: params.subtopicName,
      hours: params.durationHours,
      source: params.source,
      updated_at: new Date().toISOString(),
    }

    const studySessionRow = {
      user_id: uid,
      client_id: params.id,
      study_date: params.date,
      subtopic_id: params.subtopicId,
      subtopic_name: params.subtopicName,
      module_name: params.moduleName,
      duration_hours: params.durationHours,
      session_type: params.type,
      source: params.source,
      updated_at: new Date().toISOString(),
    }

    await Promise.all([
      client.from('daily_logs').upsert(dailyLogRow, { onConflict: 'user_id,client_id' }),
      client.from('study_sessions').upsert(studySessionRow, { onConflict: 'user_id,client_id' }),
    ])
  }

  /** Update an existing daily log entry */
  async updateLog(id: string, patch: { hours?: number; subtopicId?: string; date?: string; subtopicName?: string }): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return
    const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
    const uid = session.data.session?.user?.id
    if (!uid) return

    const logUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const sessionUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (patch.hours != null) {
      logUpdate.hours = patch.hours
      sessionUpdate.duration_hours = patch.hours
    }
    if (patch.subtopicId != null) {
      logUpdate.subtopic_id = patch.subtopicId
      sessionUpdate.subtopic_id = patch.subtopicId
    }
    if (patch.subtopicName != null) {
      logUpdate.subtopic_name = patch.subtopicName
      sessionUpdate.subtopic_name = patch.subtopicName
    }
    if (patch.date != null) {
      logUpdate.study_date = patch.date
      sessionUpdate.study_date = patch.date
    }

    await Promise.all([
      client.from('daily_logs').update(logUpdate).eq('user_id', uid).eq('client_id', id),
      client.from('study_sessions').update(sessionUpdate).eq('user_id', uid).eq('client_id', id),
    ])
  }

  /** Delete a daily log entry and its session */
  async deleteLog(id: string): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return
    const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
    const uid = session.data.session?.user?.id
    if (!uid) return

    await Promise.all([
      client.from('daily_logs').delete().eq('user_id', uid).eq('client_id', id),
      client.from('study_sessions').delete().eq('user_id', uid).eq('client_id', id),
    ])
  }

  /** Reset User Data (scope: 'all' | 'syllabus' | 'logs') */
  async resetUserData(scope: 'all' | 'syllabus' | 'logs'): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return
    const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
    const uid = session.data.session?.user?.id
    if (!uid) return

    // Try reset_user_data RPC first
    const { error } = await client.rpc('reset_user_data', { p_scope: scope })

    if (error) {
      // Fallback: direct deletes
      if (scope === 'all' || scope === 'syllabus') {
        await client.from('topic_progress').delete().eq('user_id', uid)
        await client.from('assessment_progress').delete().eq('user_id', uid)
      }
      if (scope === 'all' || scope === 'logs') {
        await client.from('daily_logs').delete().eq('user_id', uid)
        await client.from('study_sessions').delete().eq('user_id', uid)
      }
      if (scope === 'all') {
        await client.from('study_events').delete().eq('user_id', uid)
        await client.from('settings').delete().eq('user_id', uid)
      }
    }
  }
}

export const cloudRepository = new CloudRepository()
