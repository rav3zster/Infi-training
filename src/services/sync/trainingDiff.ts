import type { DatabaseDriver } from '../database/driver'
import type { TrainingData } from '../../types'
import { enqueueOp } from './outboxRepository'
import { mapTopicProgress, mapAssessmentProgress, mapDailyLog, mapStudySession } from './mappers'

/**
 * trainingDiff — turns a TrainingData change (prev → next) into outbox ops.
 *
 * Called by TrainingContext whenever its in-memory data changes, AFTER the
 * mutation math has run. It computes ONLY the delta so the engine uploads
 * changed records and never full snapshots:
 *   • subtopics whose completed / hoursSpent / lastStudied changed → topic_progress
 *   • assessments whose completed / score changed → assessment_progress
 *   • newly added logs/sessions → daily_logs / study_sessions
 *   • removed logs/sessions → delete ops
 *
 * The diff runs against the previous in-memory snapshot (prev), so a rapid
 * series of mutations collapses into one latest-state op per record
 * (outbox compression handles the rest). Returns the number of ops enqueued.
 */

export async function enqueueTrainingDiff(
  driver: DatabaseDriver,
  prev: TrainingData,
  next: TrainingData,
): Promise<number> {
  let ops = 0

  // ── Subtopics ──
  const prevSubs = collectSubtopics(prev)
  const nextSubs = collectSubtopics(next)
  for (const [id, sub] of nextSubs) {
    const prevSub = prevSubs.get(id)
    if (
      !prevSub ||
      prevSub.completed !== sub.completed ||
      prevSub.hoursSpent !== sub.hoursSpent ||
      (prevSub.lastStudied ?? '') !== (sub.lastStudied ?? '')
    ) {
      await enqueueOp(driver, { table: 'topic_progress', clientId: id, action: 'upsert', payload: mapTopicProgress(sub) })
      ops++
    }
  }

  // ── Assessments ──
  const prevAssessments = collectAssessments(prev)
  const nextAssessments = collectAssessments(next)
  for (const [id, a] of nextAssessments) {
    const prevA = prevAssessments.get(id)
    if (!prevA || prevA.completed !== a.completed || prevA.score !== a.score) {
      await enqueueOp(driver, { table: 'assessment_progress', clientId: id, action: 'upsert', payload: mapAssessmentProgress(a) })
      ops++
    }
  }

  // ── daily_logs: new → upsert, removed → delete ──
  const prevLogIds = new Set(prev.dailyLogs.map(l => l.id))
  const nextLogIds = new Set(next.dailyLogs.map(l => l.id))
  for (const log of next.dailyLogs) {
    if (!prevLogIds.has(log.id)) {
      await enqueueOp(driver, { table: 'daily_logs', clientId: log.id, action: 'upsert', payload: mapDailyLog(log) })
      ops++
    }
  }
  for (const log of prev.dailyLogs) {
    if (!nextLogIds.has(log.id)) {
      await enqueueOp(driver, { table: 'daily_logs', clientId: log.id, action: 'delete' })
      ops++
    }
  }

  // ── study_sessions: new → upsert, removed → delete ──
  const prevSessions = prev.studySessions ?? []
  const nextSessions = next.studySessions ?? []
  const prevSessionIds = new Set(prevSessions.map(s => s.id))
  const nextSessionIds = new Set(nextSessions.map(s => s.id))
  for (const session of nextSessions) {
    if (!prevSessionIds.has(session.id)) {
      await enqueueOp(driver, { table: 'study_sessions', clientId: session.id, action: 'upsert', payload: mapStudySession(session) })
      ops++
    }
  }
  for (const session of prevSessions) {
    if (!nextSessionIds.has(session.id)) {
      await enqueueOp(driver, { table: 'study_sessions', clientId: session.id, action: 'delete' })
      ops++
    }
  }

  return ops
}

function collectSubtopics(data: TrainingData): Map<string, TrainingData['modules'][number]['topics'][number]['subtopics'][number]> {
  const map = new Map<string, TrainingData['modules'][number]['topics'][number]['subtopics'][number]>()
  for (const mod of data.modules) {
    for (const topic of mod.topics) {
      for (const sub of topic.subtopics) map.set(sub.id, sub)
    }
  }
  return map
}

function collectAssessments(data: TrainingData): Map<string, NonNullable<TrainingData['modules'][number]['assessments']>[number]> {
  const map = new Map<string, NonNullable<TrainingData['modules'][number]['assessments']>[number]>()
  for (const mod of data.modules) {
    for (const a of mod.assessments ?? []) map.set(a.id, a)
  }
  return map
}
