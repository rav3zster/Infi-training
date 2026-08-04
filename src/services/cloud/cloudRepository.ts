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
        type: ((r.type ?? r.session_type) as SessionType) ?? 'learning',
        source: (r.source as 'timer' | 'completion' | 'manual') ?? 'manual',
      }))

      return seed
    } catch (err) {
      console.error('[CloudRepository] Failed to loadSnapshot:', err)
      return seed
    }
  }

  /** Toggle subtopic completion */
  async toggleSubtopic(subtopicId: string, completed: boolean, hoursSpent: number, lastStudied: string): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return false

      const { error } = await client.from('topic_progress').upsert({
        user_id: uid,
        subtopic_id: subtopicId,
        completed,
        hours_spent: hoursSpent,
        last_studied_at: lastStudied || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,subtopic_id' })

      if (error) {
        console.error('[CloudRepository] toggleSubtopic error:', error.message)
        return false
      }
      return true
    } catch (err) {
      console.error('[CloudRepository] toggleSubtopic failed:', err)
      return false
    }
  }

  /** Toggle assessment completion */
  async toggleAssessment(assessmentId: string, completed: boolean, score?: number): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return false

      const { error } = await client.from('assessment_progress').upsert({
        user_id: uid,
        assessment_id: assessmentId,
        completed,
        score: score ?? null,
        last_attempted: completed ? formatDate(new Date()) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,assessment_id' })

      if (error) {
        console.error('[CloudRepository] toggleAssessment error:', error.message)
        return false
      }
      return true
    } catch (err) {
      console.error('[CloudRepository] toggleAssessment failed:', err)
      return false
    }
  }

  /** Log a study session atomically */
  async logSession(params: {
    id: string
    subtopicId: string
    subtopicName: string
    moduleName: string
    durationHours: number
    type: SessionType
    date: string
    source: 'timer' | 'completion' | 'manual'
  }): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return false

      // Try atomic RPC log_work first
      const { error: rpcErr } = await client.rpc('log_work', {
        p_client_id: params.id,
        p_subtopic_id: params.subtopicId,
        p_subtopic_name: params.subtopicName,
        p_hours: params.durationHours,
        p_study_date: params.date,
        p_source: params.source,
        p_module_name: params.moduleName,
        p_session_type: params.type,
      })

      if (!rpcErr) {
        return true
      }

      console.warn('[CloudRepository] log_work RPC failed or unavailable, using direct upsert fallback:', rpcErr.message)

      // Fallback: direct table upserts (with fixed column name `type`)
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
        type: params.type,
        source: params.source,
        updated_at: new Date().toISOString(),
      }

      const [dlRes, ssRes] = await Promise.all([
        client.from('daily_logs').upsert(dailyLogRow, { onConflict: 'user_id,client_id' }),
        client.from('study_sessions').upsert(studySessionRow, { onConflict: 'user_id,client_id' }),
      ])

      if (dlRes.error || ssRes.error) {
        console.error('[CloudRepository] Fallback upsert error:', dlRes.error?.message || ssRes.error?.message)
        return false
      }

      return true
    } catch (err) {
      console.error('[CloudRepository] logSession failed:', err)
      return false
    }
  }

  /** Update an existing daily log entry */
  async updateLog(id: string, patch: { hours?: number; subtopicId?: string; date?: string; subtopicName?: string }): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return false

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

      const [dlRes, ssRes] = await Promise.all([
        client.from('daily_logs').update(logUpdate).eq('user_id', uid).eq('client_id', id),
        client.from('study_sessions').update(sessionUpdate).eq('user_id', uid).eq('client_id', id),
      ])

      if (dlRes.error || ssRes.error) {
        console.error('[CloudRepository] updateLog error:', dlRes.error?.message || ssRes.error?.message)
        return false
      }
      return true
    } catch (err) {
      console.error('[CloudRepository] updateLog failed:', err)
      return false
    }
  }

  /** Delete a daily log entry and its session */
  async deleteLog(id: string): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return false

      const [dlRes, ssRes] = await Promise.all([
        client.from('daily_logs').delete().eq('user_id', uid).eq('client_id', id),
        client.from('study_sessions').delete().eq('user_id', uid).eq('client_id', id),
      ])

      if (dlRes.error || ssRes.error) {
        console.error('[CloudRepository] deleteLog error:', dlRes.error?.message || ssRes.error?.message)
        return false
      }
      return true
    } catch (err) {
      console.error('[CloudRepository] deleteLog failed:', err)
      return false
    }
  }

  /** Reset User Data (scope: 'all' | 'syllabus' | 'logs') */
  async resetUserData(scope: 'all' | 'syllabus' | 'logs'): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return false

      // Try reset_user_data RPC first
      const { error } = await client.rpc('reset_user_data', { p_scope: scope })

      if (error) {
        console.warn('[CloudRepository] reset_user_data RPC error, using direct deletes fallback:', error.message)
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
      return true
    } catch (err) {
      console.error('[CloudRepository] resetUserData failed:', err)
      return false
    }
  }

  /** Create a safety/snapshot backup in Supabase */
  async createBackup(kind: 'manual' | 'auto' | 'pre-import' | 'pre-migration' | 'pre-reset', data: TrainingData, name?: string): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return false

      const backupName = name || `${kind}-${formatDate(new Date())}`
      const jsonString = JSON.stringify(data)
      const sizeBytes = new Blob([jsonString]).size

      const { error } = await client.from('backups').upsert({
        user_id: uid,
        name: backupName,
        kind,
        payload: data as unknown as Record<string, unknown>,
        size_bytes: sizeBytes,
        created_at: new Date().toISOString(),
      })

      if (error) {
        console.error('[CloudRepository] createBackup error:', error.message)
        return false
      }
      return true
    } catch (err) {
      console.error('[CloudRepository] createBackup failed:', err)
      return false
    }
  }

  /** Restore a full snapshot dataset to Supabase */
  async restoreSnapshot(data: TrainingData): Promise<boolean> {
    const client = getSupabaseClient()
    if (!client) return false
    try {
      const session = await client.auth.getSession().catch(() => ({ data: { session: null } }))
      const uid = session.data.session?.user?.id
      if (!uid) return false

      // 1. Wipe existing state first to match clean restore
      await this.resetUserData('all')

      // 2. Prepare subtopic progress rows
      const topicProgressRows: Record<string, unknown>[] = []
      for (const m of data.modules) {
        for (const t of m.topics) {
          for (const s of t.subtopics) {
            if (s.completed || s.hoursSpent > 0) {
              topicProgressRows.push({
                user_id: uid,
                subtopic_id: s.id,
                completed: s.completed,
                hours_spent: s.hoursSpent,
                last_studied_at: s.lastStudied || null,
                updated_at: new Date().toISOString(),
              })
            }
          }
        }
      }

      // 3. Prepare assessment progress rows
      const assessmentRows: Record<string, unknown>[] = []
      for (const m of data.modules) {
        for (const a of m.assessments ?? []) {
          if (a.completed || a.score != null) {
            assessmentRows.push({
              user_id: uid,
              assessment_id: a.id,
              completed: a.completed,
              score: a.score ?? null,
              last_attempted: a.lastAttempted || null,
              updated_at: new Date().toISOString(),
            })
          }
        }
      }

      // 4. Prepare daily logs rows
      const dailyLogRows = (data.dailyLogs ?? []).map(l => ({
        user_id: uid,
        client_id: l.id,
        study_date: l.date,
        subtopic_id: l.subtopicId,
        subtopic_name: l.subtopicName,
        hours: l.hours,
        source: l.source || 'manual',
        updated_at: new Date().toISOString(),
      }))

      // 5. Prepare study session rows
      const studySessionRows = (data.studySessions ?? []).map(s => ({
        user_id: uid,
        client_id: s.id,
        study_date: s.date,
        subtopic_id: s.subtopicId,
        subtopic_name: s.subtopicName,
        module_name: s.moduleName,
        duration_hours: s.durationHours,
        type: s.type || 'learning',
        source: s.source || 'manual',
        updated_at: new Date().toISOString(),
      }))

      // Execute upserts in parallel batches
      await Promise.all([
        topicProgressRows.length > 0 ? client.from('topic_progress').upsert(topicProgressRows) : Promise.resolve(),
        assessmentRows.length > 0 ? client.from('assessment_progress').upsert(assessmentRows) : Promise.resolve(),
        dailyLogRows.length > 0 ? client.from('daily_logs').upsert(dailyLogRows) : Promise.resolve(),
        studySessionRows.length > 0 ? client.from('study_sessions').upsert(studySessionRows) : Promise.resolve(),
      ])

      return true
    } catch (err) {
      console.error('[CloudRepository] restoreSnapshot failed:', err)
      return false
    }
  }
}

export const cloudRepository = new CloudRepository()
