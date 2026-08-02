import type { SubTopic, Assessment, DailyLogEntry, StudySession, StudyEvent } from '../../types'
import type { SyncTable } from './outboxRepository'

/**
 * mappers — the ONLY place that knows how local models become Supabase rows.
 *
 * Each mapper returns the row WITHOUT user_id (the engine stamps it at upload
 * from the authenticated session). Column names mirror the SQL migration
 * (supabase/migrations/0001_initial_schema.sql) exactly.
 */

export interface TableConfig {
  /** PostgREST onConflict target for idempotent upserts. */
  onConflict: string
  /** Column used to target a single record for delete ops (null = no outbox deletes). */
  deleteKey: string | null
}

export const TABLE_CONFIG: Record<SyncTable, TableConfig> = {
  profiles: { onConflict: 'user_id', deleteKey: null },
  topic_progress: { onConflict: 'user_id,subtopic_id', deleteKey: 'subtopic_id' },
  assessment_progress: { onConflict: 'user_id,assessment_id', deleteKey: 'assessment_id' },
  daily_logs: { onConflict: 'user_id,client_id', deleteKey: 'client_id' },
  study_sessions: { onConflict: 'user_id,client_id', deleteKey: 'client_id' },
  study_events: { onConflict: 'user_id,client_id', deleteKey: 'client_id' },
  settings: { onConflict: 'user_id', deleteKey: null },
}

/** Tables the engine downloads and merges back into local data. */
export const DOWNLOAD_TABLES = [
  'topic_progress',
  'assessment_progress',
  'daily_logs',
  'study_sessions',
  'settings',
] as const satisfies readonly SyncTable[]

export function mapTopicProgress(sub: SubTopic): Record<string, unknown> {
  return {
    subtopic_id: sub.id,
    completed: sub.completed,
    hours_spent: sub.hoursSpent,
    last_studied_at: sub.lastStudied || null,
  }
}

export function mapAssessmentProgress(a: Assessment): Record<string, unknown> {
  return {
    assessment_id: a.id,
    completed: a.completed,
    score: a.score ?? null,
    last_attempted_at: a.lastAttempted || null,
  }
}

export function mapDailyLog(log: DailyLogEntry): Record<string, unknown> {
  return {
    client_id: log.id,
    study_date: log.date,
    subtopic_id: log.subtopicId,
    subtopic_name: log.subtopicName,
    hours: log.hours,
    source: log.source ?? 'timer',
  }
}

export function mapStudySession(s: StudySession): Record<string, unknown> {
  return {
    client_id: s.id,
    study_date: s.date,
    start_time: timeOnly(s.startTime),
    end_time: timeOnly(s.endTime),
    duration_hours: s.durationHours,
    type: s.type,
    subtopic_id: s.subtopicId,
    subtopic_name: s.subtopicName,
    module_name: s.moduleName,
    notes: s.notes ?? null,
    source: s.source ?? 'timer',
  }
}

export function mapStudyEvent(e: StudyEvent): Record<string, unknown> {
  return {
    client_id: e.id,
    type: e.type,
    entity_type: e.entityType,
    entity_id: e.entityId,
    payload: e.payload,
    occurred_at: e.occurredAt,
  }
}

export function mapSettings(theme: string, dateOffset = 0): Record<string, unknown> {
  return { theme, date_offset: dateOffset }
}

// ─── Remote row → local conversions (for the download/merge path) ───

export function remoteToDailyLog(row: Record<string, unknown>): DailyLogEntry | null {
  const id = String(row.client_id ?? '')
  if (!id) return null
  return {
    id,
    date: String(row.study_date ?? ''),
    subtopicId: row.subtopic_id ? String(row.subtopic_id) : '',
    subtopicName: row.subtopic_name ? String(row.subtopic_name) : '',
    hours: Number(row.hours ?? 0),
    source: row.source === 'completion' ? 'completion' : 'timer',
  }
}

export function remoteToStudySession(row: Record<string, unknown>): StudySession | null {
  const id = String(row.client_id ?? '')
  const date = String(row.study_date ?? '')
  if (!id) return null
  return {
    id,
    date,
    startTime: `${date}T${String(row.start_time ?? '00:00:00')}`,
    endTime: `${date}T${String(row.end_time ?? '00:00:00')}`,
    durationHours: Number(row.duration_hours ?? 0),
    type: (row.type as StudySession['type']) ?? 'learning',
    subtopicId: row.subtopic_id ? String(row.subtopic_id) : '',
    subtopicName: row.subtopic_name ? String(row.subtopic_name) : '',
    moduleName: row.module_name ? String(row.module_name) : '',
    notes: row.notes ? String(row.notes) : undefined,
    source: row.source === 'completion' ? 'completion' : 'timer',
  }
}

/** ISO datetime → 'HH:MM:SS' for the SQL `time` columns. */
function timeOnly(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '00:00:00'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
