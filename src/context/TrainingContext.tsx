import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { TrainingData, SubTopic, DashboardMetrics, Assessment, StudySession, SessionType, Module, Topic } from '../types'
import { createSeedData, calculateMetrics, formatDate, getAllSubtopics, getAllAssessments, calculateCompletionTopUp } from '../data/curriculum'

interface TrainingContextType {
  data: TrainingData
  metrics: DashboardMetrics
  allSubtopics: SubTopic[]
  allAssessments: Assessment[]
  logSession: (subtopicId: string, hours: number) => void
  logStudySession: (params: {
    subtopicId: string
    subtopicName: string
    moduleName: string
    durationHours: number
    type: SessionType
    notes?: string
  }) => void
  toggleSubTopic: (subtopicId: string) => void
  toggleAssessment: (assessmentId: string) => void
  /** Reset curriculum progress only (subtopics, assessments, hoursSpent) — keeps logs */
  resetSyllabusProgress: () => void
  /** Reset study logs only (dailyLogs, studySessions) — keeps curriculum completion */
  resetLogs: () => void
  /** Full factory reset — wipes everything */
  resetData: () => void
}

const TrainingContext = createContext<TrainingContextType | null>(null)

const STORAGE_KEY = 'training-tracker-data'

function loadData(): TrainingData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed && Array.isArray(parsed.modules) && Array.isArray(parsed.dailyLogs)) {
        const fa1Module = parsed.modules.find((m: { id: string }) => m.id === 'm2')
        if (fa1Module && fa1Module.topics && fa1Module.topics.length < 10) {
          const seed = createSeedData()
          seed.dailyLogs = parsed.dailyLogs ?? []
          seed.studySessions = parsed.studySessions ?? []
          return seed
        }
        if (!parsed.studySessions) {
          parsed.studySessions = []
        }
        const data = parsed as TrainingData
        backfillSubTopicEstimates(data)
        return migrateCompletionCredits(data)
      }
    }
  } catch {
    // Ignore parse errors
  }
  return createSeedData()
}

/**
 * Backfill baseEstimateMinutes for subtopics saved before the per-subtopic
 * complexity estimates existed. Matches each stored subtopic to its seed
 * counterpart by id; falls back to an even split of the topic estimate.
 * Idempotent — skips subtopics that already carry the field.
 */
function backfillSubTopicEstimates(data: TrainingData): TrainingData {
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
function applyCompletionCredit(
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
    date,
    subtopicId: sub.id,
    subtopicName: sub.name,
    hours: topUp,
    source: 'completion',
  })
  if (!data.studySessions) data.studySessions = []
  data.studySessions.push({
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
function migrateCompletionCredits(data: TrainingData): TrainingData {
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

function saveData(data: TrainingData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Ignore storage errors
  }
}

export function TrainingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TrainingData>(loadData)

  // Single source of truth for metrics — computed via useMemo, no double render
  const metrics = useMemo(() => calculateMetrics(data), [data])

  const allSubtopics = useMemo(() => getAllSubtopics(data), [data])
  const allAssessments = useMemo(() => getAllAssessments(data), [data])

  // Persist on every data change
  useEffect(() => {
    saveData(data)
  }, [data])

  const logSession = useCallback((subtopicId: string, hours: number) => {
    setData(prev => {
      const newData = structuredClone(prev)
      const todayStr = formatDate(new Date())

      for (const module of newData.modules) {
        for (const topic of module.topics) {
          const subTopic = topic.subtopics.find(st => st.id === subtopicId)
          if (subTopic) {
            subTopic.hoursSpent = Math.round((subTopic.hoursSpent + hours) * 100) / 100
            subTopic.lastStudied = todayStr
            break
          }
        }
      }

      const subTopic = getAllSubtopics(prev).find(st => st.id === subtopicId)
      newData.dailyLogs.push({
        date: todayStr,
        subtopicId,
        subtopicName: subTopic?.name ?? subtopicId,
        hours,
      })

      const now = new Date()
      const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000)
      const session: StudySession = {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: todayStr,
        startTime: startTime.toISOString(),
        endTime: now.toISOString(),
        durationHours: hours,
        type: 'learning',
        subtopicId,
        subtopicName: subTopic?.name ?? subtopicId,
        moduleName: '',
      }

      for (const mod of newData.modules) {
        for (const t of mod.topics) {
          if (t.subtopics.some(st => st.id === subtopicId)) {
            session.moduleName = mod.name
            break
          }
        }
        if (session.moduleName) break
      }

      if (!newData.studySessions) newData.studySessions = []
      newData.studySessions.push(session)

      return newData
    })
  }, [])

  const logStudySession = useCallback((params: {
    subtopicId: string
    subtopicName: string
    moduleName: string
    durationHours: number
    type: SessionType
    notes?: string
  }) => {
    setData(prev => {
      const newData = structuredClone(prev)
      const todayStr = formatDate(new Date())
      const now = new Date()
      const startTime = new Date(now.getTime() - params.durationHours * 60 * 60 * 1000)

      const session: StudySession = {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: todayStr,
        startTime: startTime.toISOString(),
        endTime: now.toISOString(),
        durationHours: params.durationHours,
        type: params.type,
        subtopicId: params.subtopicId,
        subtopicName: params.subtopicName,
        moduleName: params.moduleName,
        notes: params.notes,
      }

      if (!newData.studySessions) newData.studySessions = []
      newData.studySessions.push(session)

      if (params.type !== 'break') {
        newData.dailyLogs.push({
          date: todayStr,
          subtopicId: params.subtopicId,
          subtopicName: params.subtopicName,
          hours: params.durationHours,
        })

        for (const module of newData.modules) {
          for (const topic of module.topics) {
            const sub = topic.subtopics.find(st => st.id === params.subtopicId)
            if (sub) {
              sub.hoursSpent = Math.round((sub.hoursSpent + params.durationHours) * 100) / 100
              sub.lastStudied = todayStr
              break
            }
          }
        }
      }

      return newData
    })
  }, [])

  const toggleSubTopic = useCallback((subtopicId: string) => {
    setData(prev => {
      const newData = structuredClone(prev)
      const todayStr = formatDate(new Date())

      for (const module of newData.modules) {
        for (const topic of module.topics) {
          const subTopic = topic.subtopics.find(st => st.id === subtopicId)
          if (subTopic) {
            subTopic.completed = !subTopic.completed
            subTopic.lastStudied = todayStr

            if (subTopic.completed) {
              // Method 2: Topic Completion Logging — auto-credit the remaining
              // estimated time (never overwrite genuine over-study).
              applyCompletionCredit(newData, module, topic, subTopic, todayStr)
            } else {
              // Unchecking: reverse the completion credit (idempotent).
              const credited = newData.dailyLogs
                .filter(l => l.subtopicId === subtopicId && l.source === 'completion')
                .reduce((s, l) => s + l.hours, 0)
              if (credited > 0) {
                subTopic.hoursSpent = Math.max(0, Math.round((subTopic.hoursSpent - credited) * 100) / 100)
                newData.dailyLogs = newData.dailyLogs.filter(
                  l => !(l.subtopicId === subtopicId && l.source === 'completion'),
                )
                if (newData.studySessions) {
                  newData.studySessions = newData.studySessions.filter(
                    s => !(s.subtopicId === subtopicId && s.source === 'completion'),
                  )
                }
              }
            }
            break
          }
        }
      }
      return newData
    })
  }, [])

  const toggleAssessment = useCallback((assessmentId: string) => {
    setData(prev => {
      const newData = structuredClone(prev)
      for (const module of newData.modules) {
        const assessment = module.assessments?.find(a => a.id === assessmentId)
        if (assessment) {
          assessment.completed = !assessment.completed
          if (assessment.completed && assessment.lastAttempted === '') {
            assessment.lastAttempted = formatDate(new Date())
          }
          break
        }
      }
      return newData
    })
  }, [])

  /**
   * Reset curriculum progress only: uncheck every subtopic (reversing its
   * completion credit — the same math toggleSubTopic uses on uncheck),
   * and clear all assessment state. Timer-logged sessions and study
   * history are fully preserved.
   */
  const resetSyllabusProgress = useCallback(() => {
    setData(prev => {
      const newData = structuredClone(prev)
      for (const module of newData.modules) {
        for (const topic of module.topics) {
          for (const sub of topic.subtopics) {
            if (sub.completed) {
              sub.completed = false
              sub.lastStudied = ''
              // Reverse only the completion-credited hours, not timer hours.
              const credited = newData.dailyLogs
                .filter(l => l.subtopicId === sub.id && l.source === 'completion')
                .reduce((s, l) => s + l.hours, 0)
              if (credited > 0) {
                sub.hoursSpent = Math.max(0, Math.round((sub.hoursSpent - credited) * 100) / 100)
              }
            }
          }
        }
        for (const a of module.assessments ?? []) {
          a.completed = false
          a.score = undefined
          a.lastAttempted = ''
        }
      }
      // Remove auto-credited completion logs so hours don't linger
      // after their source completions are undone. Keep timer logs.
      newData.dailyLogs = newData.dailyLogs.filter(l => l.source !== 'completion')
      if (newData.studySessions) {
        newData.studySessions = newData.studySessions.filter(s => s.source !== 'completion')
      }
      return newData
    })
  }, [])

  /**
   * Reset study logs only: clear all dailyLogs, studySessions, and the
   * per-subtopic hoursSpent ledger they feed. Curriculum completion state
   * (checkboxes, assessments) is preserved.
   */
  const resetLogs = useCallback(() => {
    setData(prev => {
      const newData = structuredClone(prev)
      newData.dailyLogs = []
      newData.studySessions = []
      for (const module of newData.modules) {
        for (const topic of module.topics) {
          for (const sub of topic.subtopics) {
            sub.hoursSpent = 0
          }
        }
      }
      return newData
    })
  }, [])

  const resetData = useCallback(() => {
    const seed = createSeedData()
    setData(seed)
    saveData(seed)
  }, [])

  return (
    <TrainingContext.Provider
      value={{
        data,
        metrics,
        allSubtopics,
        allAssessments,
        logSession,
        logStudySession,
        toggleSubTopic,
        toggleAssessment,
        resetSyllabusProgress,
        resetLogs,
        resetData,
      }}
    >
      {children}
    </TrainingContext.Provider>
  )
}

export function useTraining(): TrainingContextType {
  const context = useContext(TrainingContext)
  if (!context) throw new Error('useTraining must be used within a TrainingProvider')
  return context
}
