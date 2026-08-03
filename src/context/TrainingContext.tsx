import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import type { TrainingData, SubTopic, DashboardMetrics, Assessment, StudySession, SessionType, StudyEvent } from '../types'
import { createSeedData, calculateMetrics, formatDate, getAllSubtopics, getAllAssessments } from '../data/curriculum'
import { localDatabase } from '../services/database/LocalDatabase'
import { loadLegacyLocalStorage, applyCompletionCredit, backfillLogIds } from '../services/database/legacyMigration'
import { recordEvent as recordStudyEvent } from '../services/repositories/eventRepository'
import { enqueueTrainingDiff } from '../services/sync/trainingDiff'
import { latestTrainingData } from '../services/sync/latestData'
import { genId } from '../utils/id'
import SplashScreen from '../components/SplashScreen'

interface TrainingContextType {
  data: TrainingData
  metrics: DashboardMetrics
  allSubtopics: SubTopic[]
  allAssessments: Assessment[]
  ready: boolean
  logSession: (subtopicId: string, hours: number) => void
  logStudySession: (params: {
    subtopicId: string
    subtopicName: string
    moduleName: string
    durationHours: number
    type: SessionType
    notes?: string
  }) => void
  /**
   * Update an existing daily log entry (and its matching study session).
   * hoursSpent on the affected subtopic(s) is recalculated from scratch
   * by summing all remaining logs — no drift possible.
   */
  updateLog: (id: string, patch: { hours?: number; subtopicId?: string; date?: string }) => void
  /**
   * Delete a daily log entry and its matching study session by id.
   * The subtopic hoursSpent is recalculated from remaining logs.
   * The outbox receives a delete op so the record is removed from Supabase.
   */
  deleteLog: (id: string) => void
  toggleSubTopic: (subtopicId: string) => void
  toggleAssessment: (assessmentId: string) => void
  /** Replace all data (backup import / cloud restore) */
  restoreData: (next: TrainingData) => void
  /** Append an immutable study event (future analytics substrate) */
  recordEvent: (event: Omit<StudyEvent, 'id'>) => void
  /** Reset curriculum progress only (subtopics, assessments, hoursSpent) — keeps logs */
  resetSyllabusProgress: () => void
  /** Reset study logs only (dailyLogs, studySessions) — keeps curriculum completion */
  resetLogs: () => void
  /** Full factory reset — wipes everything */
  resetData: () => void
}

const TrainingContext = createContext<TrainingContextType | null>(null)

/**
 * TrainingProvider
 *
 * Local-first: boots the SQLite/IndexedDB store, hydrates TrainingData from
 * it, migrates any legacy localStorage data on first run, and persists every
 * change through the LocalDatabase facade (debounced write-through + flush on
 * hide). All mutation math is byte-identical to the previous localStorage
 * implementation — the Adaptive Study Load Engine is untouched.
 */
export function TrainingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TrainingData | null>(null)
  const [ready, setReady] = useState(false)
  const dataRef = useRef<TrainingData | null>(null)
  const prevDataRef = useRef<TrainingData | null>(null)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Phase 3: mirror the freshest in-memory data for the Sync Engine's merge
  // base, and diff every change into sync outbox ops (upload only deltas).
  // The very first hydration sets the baseline without enqueuing anything.
  useEffect(() => {
    if (!data) return
    latestTrainingData.current = data
    if (prevDataRef.current === null) {
      prevDataRef.current = data
      return
    }
    const prev = prevDataRef.current
    prevDataRef.current = data
    void enqueueTrainingDiff(localDatabase.getDriver(), prev, data).then(ops => {
      if (ops > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('sync:request'))
      }
    })
  }, [data])

  // Phase 3: adopt remote-merged data pushed by the Sync Engine. prevDataRef
  // is set BEFORE setData so the diff effect sees no change and never
  // re-uploads what the engine just downloaded.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onRemoteMerge = (e: Event) => {
      const detail = (e as CustomEvent<TrainingData>).detail
      if (!detail) return
      prevDataRef.current = detail
      latestTrainingData.current = detail
      setData(detail)
    }
    window.addEventListener('training:remote-merge', onRemoteMerge)
    return () => window.removeEventListener('training:remote-merge', onRemoteMerge)
  }, [])

  // ─── Boot: open DB → migrate → hydrate → legacy migrate → seed ───
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await localDatabase.init()
        let loaded: TrainingData | null = null
        try {
          loaded = await localDatabase.hydrateTrainingData()
        } catch {
          loaded = null
        }
        if (!loaded) {
          const legacy = loadLegacyLocalStorage()
          loaded = legacy ?? createSeedData()
          backfillLogIds(loaded)
          await localDatabase.persistTrainingData(loaded)
        }
        if (!cancelled) {
          setData(loaded)
          setReady(true)
        }
      } catch {
        // Last-resort: never block the app from booting.
        const fallback = backfillLogIds(loadLegacyLocalStorage() ?? createSeedData())
        if (!cancelled) {
          setData(fallback)
          setReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ─── Debounced write-through persistence ───
  useEffect(() => {
    if (!data) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void localDatabase.persistTrainingData(data)
    }, 800)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [data])



  // Flush pending writes when the app is hidden (pagehide / visibilitychange)
  useEffect(() => {
    const flush = () => {
      const d = dataRef.current
      if (d) void localDatabase.persistTrainingData(d)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const metrics = useMemo<DashboardMetrics | null>(
    () => (data ? calculateMetrics(data) : null),
    [data],
  )

  const allSubtopics = useMemo<SubTopic[]>(
    () => (data ? getAllSubtopics(data) : []),
    [data],
  )

  const allAssessments = useMemo<Assessment[]>(
    () => (data ? getAllAssessments(data) : []),
    [data],
  )

  const recordEvent = useCallback((event: Omit<StudyEvent, 'id'>) => {
    void recordStudyEvent(localDatabase.getDriver(), event)
  }, [])

  const logSession = useCallback((subtopicId: string, hours: number) => {
    const subTopic = dataRef.current ? getAllSubtopics(dataRef.current).find(st => st.id === subtopicId) : undefined
    setData(prev => {
      const newData = structuredClone(prev!)
      const todayStr = formatDate(new Date())

      for (const module of newData.modules) {
        for (const topic of module.topics) {
          const st = topic.subtopics.find(x => x.id === subtopicId)
          if (st) {
            st.hoursSpent = Math.round((st.hoursSpent + hours) * 100) / 100
            st.lastStudied = todayStr
            break
          }
        }
      }

      newData.dailyLogs.push({
        id: genId('log'),
        date: todayStr,
        subtopicId,
        subtopicName: subTopic?.name ?? subtopicId,
        hours,
      })

      const now = new Date()
      const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000)
      const session: StudySession = {
        id: genId('session'),
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
    recordEvent({
      type: 'session.logged',
      entityType: 'session',
      entityId: subtopicId,
      payload: { hours, source: 'timer' },
      occurredAt: new Date().toISOString(),
    })
  }, [recordEvent])

  const logStudySession = useCallback((params: {
    subtopicId: string
    subtopicName: string
    moduleName: string
    durationHours: number
    type: SessionType
    notes?: string
  }) => {
    setData(prev => {
      const newData = structuredClone(prev!)
      const todayStr = formatDate(new Date())
      const now = new Date()
      const startTime = new Date(now.getTime() - params.durationHours * 60 * 60 * 1000)

      const session: StudySession = {
        id: genId('session'),
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
          id: genId('log'),
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
    recordEvent({
      type: 'session.logged',
      entityType: 'session',
      entityId: params.subtopicId,
      payload: { hours: params.durationHours, type: params.type, notes: params.notes },
      occurredAt: new Date().toISOString(),
    })
  }, [recordEvent])

  const toggleSubTopic = useCallback((subtopicId: string) => {
    const sub = dataRef.current ? getAllSubtopics(dataRef.current).find(st => st.id === subtopicId) : undefined
    const wasCompleted = sub?.completed ?? false
    const name = sub?.name ?? subtopicId

    setData(prev => {
      const newData = structuredClone(prev!)
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

    recordEvent({
      type: wasCompleted ? 'subtopic.uncompleted' : 'subtopic.completed',
      entityType: 'subtopic',
      entityId: subtopicId,
      payload: { name, moduleName: findModuleName(dataRef.current, subtopicId) },
      occurredAt: new Date().toISOString(),
    })
  }, [recordEvent])

  const toggleAssessment = useCallback((assessmentId: string) => {
    const prevAssessment = dataRef.current
      ? getAllAssessments(dataRef.current).find(a => a.id === assessmentId)
      : undefined
    const wasCompleted = prevAssessment?.completed ?? false

    setData(prev => {
      const newData = structuredClone(prev!)
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

    recordEvent({
      type: wasCompleted ? 'assessment.uncompleted' : 'assessment.completed',
      entityType: 'assessment',
      entityId: assessmentId,
      payload: { name: prevAssessment?.name ?? assessmentId },
      occurredAt: new Date().toISOString(),
    })
  }, [recordEvent])

  /**
   * Reset curriculum progress only: uncheck every subtopic (reversing its
   * completion credit — the same math toggleSubTopic uses on uncheck),
   * and clear all assessment state. Timer-logged sessions and study
   * history are fully preserved.
   */
  const resetSyllabusProgress = useCallback(() => {
    setData(prev => {
      const newData = structuredClone(prev!)
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
    recordEvent({
      type: 'syllabus.reset',
      entityType: 'roadmap',
      entityId: 'all',
      payload: {},
      occurredAt: new Date().toISOString(),
    })
  }, [recordEvent])

  /**
   * Update a daily log entry (and its matching study session) in-place.
   * Recalculates the affected subtopic's hoursSpent by summing all logs.
   */
  const updateLog = useCallback((id: string, patch: { hours?: number; subtopicId?: string; date?: string }) => {
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      const logIdx = newData.dailyLogs.findIndex(l => l.id === id)
      if (logIdx === -1) return newData

      const oldLog = newData.dailyLogs[logIdx]
      // Completion-credited logs must not be edited — they are auto-managed.
      if (oldLog.source === 'completion') return newData

      const oldSubtopicId = oldLog.subtopicId
      const newSubtopicId = patch.subtopicId ?? oldLog.subtopicId

      // Apply patch to the log entry
      newData.dailyLogs[logIdx] = {
        ...oldLog,
        hours: patch.hours ?? oldLog.hours,
        subtopicId: newSubtopicId,
        subtopicName: patch.subtopicId
          ? (getAllSubtopics(newData).find(st => st.id === patch.subtopicId)?.name ?? oldLog.subtopicName)
          : oldLog.subtopicName,
        date: patch.date ?? oldLog.date,
      }

      // Also update the matching study session if it exists
      if (newData.studySessions) {
        // Match by log id (preferred) or fall back to first session for same subtopic on same date
        const sessionIdx = newData.studySessions.findIndex(s => s.id === id)
        if (sessionIdx !== -1) {
          const sess = newData.studySessions[sessionIdx]
          if (sess.source !== 'completion') {
            newData.studySessions[sessionIdx] = {
              ...sess,
              durationHours: patch.hours ?? sess.durationHours,
              subtopicId: newSubtopicId,
              subtopicName: newData.dailyLogs[logIdx].subtopicName,
              date: patch.date ?? sess.date,
            }
          }
        }
      }

      // Recalculate hoursSpent for affected subtopics from all remaining logs
      const affectedIds = new Set([oldSubtopicId, newSubtopicId])
      for (const module of newData.modules) {
        for (const topic of module.topics) {
          for (const sub of topic.subtopics) {
            if (affectedIds.has(sub.id)) {
              sub.hoursSpent = Math.round(
                newData.dailyLogs
                  .filter(l => l.subtopicId === sub.id)
                  .reduce((s, l) => s + l.hours, 0) * 100
              ) / 100
            }
          }
        }
      }

      return newData
    })
  }, [])

  /**
   * Delete a daily log entry and its matching study session.
   * Recalculates hoursSpent for the affected subtopic from remaining logs.
   */
  const deleteLog = useCallback((id: string) => {
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      const logIdx = newData.dailyLogs.findIndex(l => l.id === id)
      if (logIdx === -1) return newData

      const log = newData.dailyLogs[logIdx]
      if (log.source === 'completion') return newData // completion logs are auto-managed

      const subtopicId = log.subtopicId
      newData.dailyLogs.splice(logIdx, 1)

      // Remove the matching study session (matched by same id as log, or same subtopicId+date)
      if (newData.studySessions) {
        const sessionIdx = newData.studySessions.findIndex(s => s.id === id)
        if (sessionIdx !== -1 && newData.studySessions[sessionIdx].source !== 'completion') {
          newData.studySessions.splice(sessionIdx, 1)
        } else {
          // fallback: remove first non-completion session for same subtopic on same date
          const fallbackIdx = newData.studySessions.findIndex(
            s => s.subtopicId === subtopicId && s.date === log.date && s.source !== 'completion'
          )
          if (fallbackIdx !== -1) newData.studySessions.splice(fallbackIdx, 1)
        }
      }

      // Recalculate hoursSpent from remaining logs
      for (const module of newData.modules) {
        for (const topic of module.topics) {
          const sub = topic.subtopics.find(s => s.id === subtopicId)
          if (sub) {
            sub.hoursSpent = Math.round(
              newData.dailyLogs
                .filter(l => l.subtopicId === subtopicId)
                .reduce((s, l) => s + l.hours, 0) * 100
            ) / 100
          }
        }
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
      const newData = structuredClone(prev!)
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
    recordEvent({
      type: 'logs.reset',
      entityType: 'roadmap',
      entityId: 'all',
      payload: {},
      occurredAt: new Date().toISOString(),
    })
  }, [recordEvent])

  const resetData = useCallback(() => {
    const seed = createSeedData()
    setData(seed)
    // Record AFTER the wipe completes so the event survives the store clear
    // (resetToSeed wipes study_events; the roadmap.reset event must land last).
    void localDatabase.resetToSeed(seed).then(() => {
      recordEvent({
        type: 'roadmap.reset',
        entityType: 'roadmap',
        entityId: 'all',
        payload: {},
        occurredAt: new Date().toISOString(),
      })
      // Phase 3: factory reset must also clear the cloud copy.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('training:purge'))
      }
    })
  }, [recordEvent])

  const restoreData = useCallback((next: TrainingData) => {
    backfillLogIds(next)
    setData(next)
    void localDatabase.persistTrainingData(next)
    recordEvent({
      type: 'data.imported',
      entityType: 'system',
      entityId: 'backup',
      payload: {},
      occurredAt: new Date().toISOString(),
    })
  }, [recordEvent])

  const value = useMemo<TrainingContextType | null>(() => {
    if (!ready || !data || !metrics) return null
    return {
      data,
      metrics,
      allSubtopics,
      allAssessments,
      ready,
      logSession,
      logStudySession,
      updateLog,
      deleteLog,
      toggleSubTopic,
      toggleAssessment,
      restoreData,
      recordEvent,
      resetSyllabusProgress,
      resetLogs,
      resetData,
    }
  }, [ready, data, metrics, allSubtopics, allAssessments, logSession, logStudySession, updateLog, deleteLog, toggleSubTopic, toggleAssessment, restoreData, recordEvent, resetSyllabusProgress, resetLogs, resetData])

  if (!value) {
    return <SplashScreen />
  }

  return (
    <TrainingContext.Provider value={value}>
      {children}
    </TrainingContext.Provider>
  )
}

function findModuleName(data: TrainingData | null, subtopicId: string): string | undefined {
  if (!data) return undefined
  for (const mod of data.modules) {
    for (const t of mod.topics) {
      if (t.subtopics.some(st => st.id === subtopicId)) return mod.name
    }
  }
  return undefined
}

export function useTraining(): TrainingContextType {
  const context = useContext(TrainingContext)
  if (!context) throw new Error('useTraining must be used within a TrainingProvider')
  return context
}
