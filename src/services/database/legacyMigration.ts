import type { TrainingData, DailyLogEntry, Module, Topic, SubTopic } from '../../types'
import { createSeedData, calculateCompletionTopUp, formatDate } from '../../data/curriculum'
import { genId } from '../../utils/id'

const STORAGE_KEY = 'training-tracker-data'

/**
 * Backfill stable ids onto daily log entries saved before the id field
 * existed (all pre-SQLite data). Idempotent.
 */
export function backfillLogIds(data: TrainingData): TrainingData {
  for (const log of data.dailyLogs) {
    if (!log.id) (log as DailyLogEntry & { id?: string }).id = genId('log')
  }
  return data
}

/**
 * Backfill baseEstimateMinutes for subtopics saved before the per-subtopic
 * complexity estimates existed. Matches each stored subtopic to its seed
 * counterpart by id; falls back to an even split of the topic estimate.
 * Idempotent — skips subtopics that already carry the field.
 */
export function backfillSubTopicEstimates(data: TrainingData): TrainingData {
  const seed = createSeedData()
  const seedById = new Map<string, number>()
  for (const mod of seed.modules) {
    for (const t of mod.topics) {
      for (const s of t.subtopics) {
        seedById.set(s.id, s.baseEstimateMinutes ?? 0)
      }
    }
  }
  for (const mod of data.modules) {
    for (const t of mod.topics) {
      const topicEstimate = t.meta?.estimatedHours ?? 1
      const count = Math.max(1, t.subtopics.length)
      for (const s of t.subtopics) {
        if (s.baseEstimateMinutes == null) {
          const seedMin = seedById.get(s.id)
          s.baseEstimateMinutes = seedMin && seedMin > 0
            ? seedMin
            : Math.round((topicEstimate / count) * 60)
        }
      }
    }
  }
  return data
}

/**
 * Shared credit routine (Method 2 — Topic Completion Logging):
 * add the remaining estimated time to hoursSpent, dailyLogs AND studySessions,
 * tagged source:'completion' so it can be reversed and never double-counted.
 * Returns the credited hours (0 if actual >= estimate).
 */
export function applyCompletionCredit(
  data: TrainingData,
  module: Module,
  topic: Topic,
  sub: SubTopic,
  date: string,
): number {
  const topUp = calculateCompletionTopUp(topic, sub)
  if (topUp <= 0) return 0
  sub.hoursSpent = Math.round((sub.hoursSpent + topUp) * 100) / 100
  data.dailyLogs.push({
    id: genId('log'),
    date,
    subtopicId: sub.id,
    subtopicName: sub.name,
    hours: topUp,
    source: 'completion',
  })
  if (!data.studySessions) data.studySessions = []
  data.studySessions.push({
    id: genId('session'),
    date,
    startTime: `${date}T00:00:00`,
    endTime: `${date}T00:00:00`,
    durationHours: topUp,
    type: 'learning',
    subtopicId: sub.id,
    subtopicName: sub.name,
    moduleName: module.name,
    source: 'completion',
  })
  return topUp
}

/**
 * One-time idempotent migration: subtopics completed before the completion
 * top-up feature existed were checked off with 0 recorded hours. Credit the
 * remaining estimate so completed work actually counts toward study history.
 * Safe to run repeatedly — completion-sourced logs are the guard.
 */
export function migrateCompletionCredits(data: TrainingData): TrainingData {
  for (const module of data.modules) {
    for (const topic of module.topics) {
      for (const sub of topic.subtopics) {
        if (!sub.completed) continue
        const alreadyCredited = data.dailyLogs.some(l => l.subtopicId === sub.id && l.source === 'completion')
        if (alreadyCredited) continue
        applyCompletionCredit(data, module, topic, sub, sub.lastStudied || formatDate(new Date()))
      }
    }
  }
  return data
}

/**
 * Read + normalize the legacy localStorage document. Returns null when
 * nothing valid is stored (fresh install) — the caller decides between
 * legacy migration and a brand-new seed.
 */
export function loadLegacyLocalStorage(): TrainingData | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (!parsed || !Array.isArray(parsed.modules) || !Array.isArray(parsed.dailyLogs)) return null

    // Old-schema reseed (pre-m2-expansion data)
    const fa1Module = parsed.modules.find((m: { id: string }) => m.id === 'm2')
    let data: TrainingData
    if (fa1Module && fa1Module.topics && fa1Module.topics.length < 10) {
      const seed = createSeedData()
      seed.dailyLogs = parsed.dailyLogs ?? []
      seed.studySessions = parsed.studySessions ?? []
      data = seed
    } else {
      if (!parsed.studySessions) parsed.studySessions = []
      data = parsed as TrainingData
    }

    backfillSubTopicEstimates(data)
    backfillLogIds(data)
    return migrateCompletionCredits(data)
  } catch {
    return null
  }
}
