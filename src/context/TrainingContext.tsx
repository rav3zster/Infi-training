import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  TrainingData,
  DashboardMetrics,
  SubTopic,
  Assessment,
  SessionType,
  DailyLogEntry,
  StudySession,
} from '../types'
import { calculateMetrics, getAllSubtopics, formatDate } from '../data/curriculum'
import SplashScreen from '../components/SplashScreen'
import { cloudRepository } from '../services/cloud/cloudRepository'
import { cloudRealtime, type RealtimeChangePayload } from '../services/cloud/cloudRealtime'
import { genId } from '../utils/id'

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
  updateLog: (id: string, patch: { hours?: number; subtopicId?: string; date?: string }) => void
  deleteLog: (id: string) => void
  toggleSubTopic: (subtopicId: string) => void
  toggleAssessment: (assessmentId: string) => void
  restoreData: (next: TrainingData) => void
  recordEvent: (event: { type: string; entityType: string; entityId: string; payload: Record<string, unknown>; occurredAt: string }) => void
  resetSyllabusProgress: () => void
  resetLogs: () => void
  resetData: () => void
}

const TrainingContext = createContext<TrainingContextType | null>(null)

// ─── Realtime Patch Helpers ───────────────────────────────────────────────────

/**
 * Apply a single Realtime CDC payload onto the in-memory TrainingData without
 * a network round-trip. Falls back gracefully for unknown shapes.
 */
function applyRealtimePatch(
  prev: TrainingData,
  payload: RealtimeChangePayload,
): TrainingData {
  const { table, eventType, new: row, old } = payload

  // ── daily_logs ────────────────────────────────────────────────────────────
  if (table === 'daily_logs') {
    const data = structuredClone(prev)
    const clientId = String(row.client_id ?? old.client_id ?? '')
    const oldClientId = String(old.client_id ?? '')

    if (eventType === 'INSERT') {
      const entry: DailyLogEntry = {
        id: clientId,
        date: String(row.study_date ?? ''),
        subtopicId: String(row.subtopic_id ?? ''),
        subtopicName: String(row.subtopic_name ?? ''),
        hours: Number(row.hours ?? 0),
        source: (row.source as DailyLogEntry['source']) ?? 'manual',
      }
      // Guard: skip if we already have this entry (our own optimistic write)
      if (!data.dailyLogs.some(l => l.id === entry.id)) {
        data.dailyLogs.push(entry)
        recalcSubtopicHours(data, entry.subtopicId)
      }
      return data
    }

    if (eventType === 'UPDATE') {
      const idx = data.dailyLogs.findIndex(l => l.id === clientId)
      if (idx !== -1) {
        const oldSubtopicId = data.dailyLogs[idx].subtopicId
        data.dailyLogs[idx] = {
          ...data.dailyLogs[idx],
          hours: Number(row.hours ?? data.dailyLogs[idx].hours),
          subtopicId: String(row.subtopic_id ?? data.dailyLogs[idx].subtopicId),
          subtopicName: String(row.subtopic_name ?? data.dailyLogs[idx].subtopicName),
          date: String(row.study_date ?? data.dailyLogs[idx].date),
        }
        recalcSubtopicHours(data, oldSubtopicId)
        recalcSubtopicHours(data, data.dailyLogs[idx].subtopicId)
      }
      return data
    }

    if (eventType === 'DELETE') {
      const removeId = oldClientId || clientId
      const idx = data.dailyLogs.findIndex(l => l.id === removeId)
      if (idx !== -1) {
        const subtopicId = data.dailyLogs[idx].subtopicId
        data.dailyLogs.splice(idx, 1)
        recalcSubtopicHours(data, subtopicId)
      }
      return data
    }
  }

  // ── study_sessions ────────────────────────────────────────────────────────
  if (table === 'study_sessions') {
    const data = structuredClone(prev)
    const clientId = String(row.client_id ?? old.client_id ?? '')
    const oldClientId = String(old.client_id ?? '')

    if (!data.studySessions) data.studySessions = []

    if (eventType === 'INSERT') {
      const session: StudySession = {
        id: clientId,
        date: String(row.study_date ?? ''),
        subtopicId: String(row.subtopic_id ?? ''),
        subtopicName: String(row.subtopic_name ?? ''),
        moduleName: String(row.module_name ?? ''),
        durationHours: Number(row.duration_hours ?? 0),
        type: (row.session_type as SessionType) ?? 'learning',
        source: (row.source as StudySession['source']) ?? 'manual',
      }
      if (!data.studySessions.some(s => s.id === session.id)) {
        data.studySessions.push(session)
      }
      return data
    }

    if (eventType === 'UPDATE') {
      const idx = data.studySessions.findIndex(s => s.id === clientId)
      if (idx !== -1) {
        data.studySessions[idx] = {
          ...data.studySessions[idx],
          durationHours: Number(row.duration_hours ?? data.studySessions[idx].durationHours),
          subtopicId: String(row.subtopic_id ?? data.studySessions[idx].subtopicId),
          subtopicName: String(row.subtopic_name ?? data.studySessions[idx].subtopicName),
          date: String(row.study_date ?? data.studySessions[idx].date),
        }
      }
      return data
    }

    if (eventType === 'DELETE') {
      const removeId = oldClientId || clientId
      const idx = data.studySessions.findIndex(s => s.id === removeId)
      if (idx !== -1) data.studySessions.splice(idx, 1)
      return data
    }
  }

  // ── topic_progress ────────────────────────────────────────────────────────
  if (table === 'topic_progress') {
    const data = structuredClone(prev)
    const subtopicId = String(row.subtopic_id ?? old.subtopic_id ?? '')

    for (const m of data.modules) {
      for (const t of m.topics) {
        const sub = t.subtopics.find(s => s.id === subtopicId)
        if (sub) {
          if (eventType === 'DELETE') {
            sub.completed = false
            sub.hoursSpent = 0
            sub.lastStudied = ''
          } else {
            // INSERT or UPDATE
            sub.completed = Boolean(row.completed)
            sub.hoursSpent = Number(row.hours_spent ?? sub.hoursSpent)
            if (row.last_studied_at) sub.lastStudied = String(row.last_studied_at)
          }
          break
        }
      }
    }
    return data
  }

  // ── assessment_progress ───────────────────────────────────────────────────
  if (table === 'assessment_progress') {
    const data = structuredClone(prev)
    const assessmentId = String(row.assessment_id ?? old.assessment_id ?? '')

    for (const m of data.modules) {
      const a = m.assessments?.find(x => x.id === assessmentId)
      if (a) {
        if (eventType === 'DELETE') {
          a.completed = false
          a.score = undefined
          a.lastAttempted = ''
        } else {
          a.completed = Boolean(row.completed)
          if (row.score != null) a.score = Number(row.score)
          if (row.last_attempted) a.lastAttempted = String(row.last_attempted)
        }
        break
      }
    }
    return data
  }

  // Unknown table — return unchanged
  return prev
}

/** Recalculate hoursSpent for a subtopic from the current dailyLogs array */
function recalcSubtopicHours(data: TrainingData, subtopicId: string): void {
  const total = Math.round(
    data.dailyLogs
      .filter(l => l.subtopicId === subtopicId)
      .reduce((s, l) => s + l.hours, 0) * 100,
  ) / 100

  for (const m of data.modules) {
    for (const t of m.topics) {
      const sub = t.subtopics.find(s => s.id === subtopicId)
      if (sub) {
        sub.hoursSpent = total
        return
      }
    }
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TrainingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TrainingData | null>(null)
  const [ready, setReady] = useState(false)

  // Initial Cloud Hydration at Startup
  const refreshFromCloud = useCallback(async () => {
    try {
      const snapshot = await cloudRepository.loadSnapshot()
      setData(snapshot)
      setReady(true)
    } catch {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refreshFromCloud()
  }, [refreshFromCloud])

  // Realtime Live Cross-Device Synchronization — surgical in-memory patches
  useEffect(() => {
    if (!ready) return

    const handleRealtimePatch = (payload: RealtimeChangePayload) => {
      setData(prev => {
        if (!prev) return prev
        return applyRealtimePatch(prev, payload)
      })
    }

    const handleReconnect = () => {
      // Full re-fetch ONLY when recovering from a dropped connection
      void refreshFromCloud()
    }

    cloudRealtime.subscribe(handleRealtimePatch, handleReconnect)

    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        cloudRealtime.subscribe(handleRealtimePatch, handleReconnect)
        void refreshFromCloud()
      }
    }

    document.addEventListener('visibilitychange', handleResume)

    return () => {
      document.removeEventListener('visibilitychange', handleResume)
      cloudRealtime.unsubscribe()
    }
  }, [ready, refreshFromCloud])

  // Derived metrics recalculated via pure engine logic over in-memory state
  const metrics = useMemo(() => {
    if (!data) return null
    return calculateMetrics(data)
  }, [data])

  const allSubtopics = useMemo(() => {
    if (!data) return []
    return getAllSubtopics(data)
  }, [data])

  const allAssessments = useMemo(() => {
    if (!data) return []
    return data.modules.flatMap(m => m.assessments ?? [])
  }, [data])

  // Record Study Event (no-op in cloud-first; events tracked server-side)
  const recordEvent = useCallback(() => {}, [])

  // ── Mutators ──

  const toggleSubTopic = useCallback((subtopicId: string) => {
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      let foundSub: SubTopic | null = null

      for (const module of newData.modules) {
        for (const topic of module.topics) {
          const sub = topic.subtopics.find(s => s.id === subtopicId)
          if (sub) {
            foundSub = sub
            sub.completed = !sub.completed
            if (sub.completed) {
              sub.lastStudied = formatDate(new Date())

              const estimateMinutes = sub.baseEstimateMinutes ?? 30
              const estimateHours = Math.round((estimateMinutes / 60) * 100) / 100

              const loggedHours = Math.round(
                newData.dailyLogs
                  .filter(l => l.subtopicId === sub.id && l.source !== 'completion')
                  .reduce((sum, l) => sum + l.hours, 0) * 100,
              ) / 100

              const topUpHours = Math.max(0, Math.round((estimateHours - loggedHours) * 100) / 100)
              sub.hoursSpent = Math.round((loggedHours + topUpHours) * 100) / 100

              if (topUpHours > 0) {
                const logId = `auto-${sub.id}`
                const today = formatDate(new Date())

                const existingIdx = newData.dailyLogs.findIndex(l => l.id === logId)
                if (existingIdx !== -1) {
                  newData.dailyLogs[existingIdx].hours = topUpHours
                  newData.dailyLogs[existingIdx].date = today
                } else {
                  newData.dailyLogs.push({
                    id: logId,
                    date: today,
                    subtopicId: sub.id,
                    subtopicName: sub.name,
                    hours: topUpHours,
                    source: 'completion',
                  })
                }

                void cloudRepository.logSession({
                  id: logId,
                  subtopicId: sub.id,
                  subtopicName: sub.name,
                  moduleName: module.name,
                  durationHours: topUpHours,
                  type: 'learning',
                  date: today,
                  source: 'completion',
                })
              }
            } else {
              sub.lastStudied = ''
              const autoLogIndex = newData.dailyLogs.findIndex(
                l => l.subtopicId === sub.id && l.source === 'completion',
              )
              if (autoLogIndex !== -1) {
                const autoLog = newData.dailyLogs[autoLogIndex]
                newData.dailyLogs.splice(autoLogIndex, 1)
                void cloudRepository.deleteLog(autoLog.id)
              }
              sub.hoursSpent = Math.round(
                newData.dailyLogs
                  .filter(l => l.subtopicId === sub.id)
                  .reduce((sum, l) => sum + l.hours, 0) * 100,
              ) / 100
            }
            break
          }
        }
      }

      if (foundSub) {
        void cloudRepository.toggleSubtopic(
          foundSub.id,
          foundSub.completed,
          foundSub.hoursSpent,
          foundSub.lastStudied ?? '',
        )
      }

      return newData
    })
  }, [])

  const toggleAssessment = useCallback((assessmentId: string) => {
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      let foundA: Assessment | null = null

      for (const module of newData.modules) {
        const a = module.assessments?.find(item => item.id === assessmentId)
        if (a) {
          foundA = a
          a.completed = !a.completed
          if (a.completed && (!a.lastAttempted || a.lastAttempted === '')) {
            a.lastAttempted = formatDate(new Date())
          }
          break
        }
      }

      if (foundA) {
        void cloudRepository.toggleAssessment(foundA.id, foundA.completed, foundA.score)
      }

      return newData
    })
  }, [])

  const logSession = useCallback((subtopicId: string, hours: number) => {
    if (hours <= 0) return
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      const sub = getAllSubtopics(newData).find(s => s.id === subtopicId)
      if (!sub) return prev

      sub.hoursSpent = Math.round((sub.hoursSpent + hours) * 100) / 100
      sub.lastStudied = formatDate(new Date())
      const today = formatDate(new Date())
      const logId = genId('log')

      let moduleName = 'General'
      for (const m of newData.modules) {
        if (m.topics.some(t => t.subtopics.some(s => s.id === subtopicId))) {
          moduleName = m.name
          break
        }
      }

      newData.dailyLogs.push({
        id: logId,
        date: today,
        subtopicId: sub.id,
        subtopicName: sub.name,
        hours,
        source: 'manual',
      })

      void cloudRepository.logSession({
        id: logId,
        subtopicId: sub.id,
        subtopicName: sub.name,
        moduleName,
        durationHours: hours,
        type: 'learning',
        date: today,
        source: 'manual',
      })

      void cloudRepository.toggleSubtopic(sub.id, sub.completed, sub.hoursSpent, sub.lastStudied)

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
    if (params.durationHours <= 0) return
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      const sub = getAllSubtopics(newData).find(s => s.id === params.subtopicId)
      if (sub) {
        sub.hoursSpent = Math.round((sub.hoursSpent + params.durationHours) * 100) / 100
        sub.lastStudied = formatDate(new Date())
        void cloudRepository.toggleSubtopic(sub.id, sub.completed, sub.hoursSpent, sub.lastStudied)
      }

      const today = formatDate(new Date())
      const logId = genId('sess')

      newData.dailyLogs.push({
        id: logId,
        date: today,
        subtopicId: params.subtopicId,
        subtopicName: params.subtopicName,
        hours: params.durationHours,
        source: 'timer',
      })

      if (!newData.studySessions) newData.studySessions = []
      newData.studySessions.push({
        id: logId,
        date: today,
        subtopicId: params.subtopicId,
        subtopicName: params.subtopicName,
        moduleName: params.moduleName,
        durationHours: params.durationHours,
        type: params.type,
        source: 'timer',
      })

      void cloudRepository.logSession({
        id: logId,
        subtopicId: params.subtopicId,
        subtopicName: params.subtopicName,
        moduleName: params.moduleName,
        durationHours: params.durationHours,
        type: params.type,
        date: today,
        source: 'timer',
      })

      return newData
    })
  }, [])

  const updateLog = useCallback((id: string, patch: { hours?: number; subtopicId?: string; date?: string }) => {
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      const logIdx = newData.dailyLogs.findIndex(l => l.id === id)
      if (logIdx === -1) return newData

      const oldLog = newData.dailyLogs[logIdx]
      if (oldLog.source === 'completion') return newData

      const oldSubtopicId = oldLog.subtopicId
      const newSubtopicId = patch.subtopicId ?? oldLog.subtopicId
      const newSubtopicName = patch.subtopicId
        ? (getAllSubtopics(newData).find(st => st.id === patch.subtopicId)?.name ?? oldLog.subtopicName)
        : oldLog.subtopicName

      newData.dailyLogs[logIdx] = {
        ...oldLog,
        hours: patch.hours ?? oldLog.hours,
        subtopicId: newSubtopicId,
        subtopicName: newSubtopicName,
        date: patch.date ?? oldLog.date,
      }

      if (newData.studySessions) {
        const sessionIdx = newData.studySessions.findIndex(s => s.id === id)
        if (sessionIdx !== -1) {
          newData.studySessions[sessionIdx] = {
            ...newData.studySessions[sessionIdx],
            durationHours: patch.hours ?? newData.studySessions[sessionIdx].durationHours,
            subtopicId: newSubtopicId,
            subtopicName: newSubtopicName,
            date: patch.date ?? newData.studySessions[sessionIdx].date,
          }
        }
      }

      // Recalculate hoursSpent for affected subtopics
      const affectedIds = new Set([oldSubtopicId, newSubtopicId])
      for (const module of newData.modules) {
        for (const topic of module.topics) {
          for (const sub of topic.subtopics) {
            if (affectedIds.has(sub.id)) {
              sub.hoursSpent = Math.round(
                newData.dailyLogs.filter(l => l.subtopicId === sub.id).reduce((s, l) => s + l.hours, 0) * 100,
              ) / 100
              void cloudRepository.toggleSubtopic(sub.id, sub.completed, sub.hoursSpent, sub.lastStudied ?? '')
            }
          }
        }
      }

      void cloudRepository.updateLog(id, {
        hours: patch.hours,
        subtopicId: newSubtopicId,
        subtopicName: newSubtopicName,
        date: patch.date,
      })

      return newData
    })
  }, [])

  const deleteLog = useCallback((id: string) => {
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      const logIdx = newData.dailyLogs.findIndex(l => l.id === id)
      if (logIdx === -1) return newData

      const log = newData.dailyLogs[logIdx]
      if (log.source === 'completion') return newData

      const subtopicId = log.subtopicId
      newData.dailyLogs.splice(logIdx, 1)

      if (newData.studySessions) {
        const sessionIdx = newData.studySessions.findIndex(s => s.id === id)
        if (sessionIdx !== -1) newData.studySessions.splice(sessionIdx, 1)
      }

      // Recalculate hoursSpent for subtopic
      for (const module of newData.modules) {
        for (const topic of module.topics) {
          const sub = topic.subtopics.find(s => s.id === subtopicId)
          if (sub) {
            sub.hoursSpent = Math.round(
              newData.dailyLogs.filter(l => l.subtopicId === subtopicId).reduce((s, l) => s + l.hours, 0) * 100,
            ) / 100
            void cloudRepository.toggleSubtopic(sub.id, sub.completed, sub.hoursSpent, sub.lastStudied ?? '')
          }
        }
      }

      void cloudRepository.deleteLog(id)

      return newData
    })
  }, [])

  const resetSyllabusProgress = useCallback(() => {
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      for (const m of newData.modules) {
        for (const t of m.topics) {
          for (const s of t.subtopics) {
            s.completed = false
            s.lastStudied = ''
            s.hoursSpent = Math.round(
              newData.dailyLogs
                .filter(l => l.subtopicId === s.id && l.source !== 'completion')
                .reduce((a, l) => a + l.hours, 0) * 100,
            ) / 100
          }
        }
        for (const a of m.assessments ?? []) {
          a.completed = false
          a.score = undefined
          a.lastAttempted = ''
        }
      }
      newData.dailyLogs = newData.dailyLogs.filter(l => l.source !== 'completion')
      if (newData.studySessions) {
        newData.studySessions = newData.studySessions.filter(s => s.source !== 'completion')
      }
      void cloudRepository.resetUserData('syllabus')
      return newData
    })
  }, [])

  const resetLogs = useCallback(() => {
    setData(prev => {
      if (!prev) return prev
      const newData = structuredClone(prev)
      newData.dailyLogs = []
      newData.studySessions = []
      for (const m of newData.modules) {
        for (const t of m.topics) {
          for (const s of t.subtopics) {
            s.hoursSpent = 0
          }
        }
      }
      void cloudRepository.resetUserData('logs')
      return newData
    })
  }, [])

  const resetData = useCallback(() => {
    if (data) {
      void cloudRepository.createBackup('pre-reset', data)
    }
    void cloudRepository.resetUserData('all').then(() => {
      void refreshFromCloud()
    })
  }, [data, refreshFromCloud])

  const restoreData = useCallback((next: TrainingData) => {
    if (data) {
      void cloudRepository.createBackup('pre-import', data)
    }
    setData(next)
    void cloudRepository.restoreSnapshot(next)
  }, [data])

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
  }, [
    ready, data, metrics, allSubtopics, allAssessments,
    logSession, logStudySession, updateLog, deleteLog,
    toggleSubTopic, toggleAssessment, restoreData, recordEvent,
    resetSyllabusProgress, resetLogs, resetData,
  ])

  if (!value) {
    return <SplashScreen />
  }

  return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>
}

export function useTraining(): TrainingContextType {
  const context = useContext(TrainingContext)
  if (!context) throw new Error('useTraining must be used within a TrainingProvider')
  return context
}
