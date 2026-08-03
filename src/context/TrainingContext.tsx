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
} from '../types'
import { calculateMetrics, getAllSubtopics, formatDate } from '../data/curriculum'
import SplashScreen from '../components/SplashScreen'
import { cloudRepository } from '../services/cloud/cloudRepository'
import { cloudRealtime } from '../services/cloud/cloudRealtime'

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

  // Realtime Live Cross-Device Synchronization
  useEffect(() => {
    if (!ready) return

    const handleRealtimePayload = () => {
      // Re-read snapshot on remote changes to guarantee 100% convergence across devices
      void refreshFromCloud()
    }

    cloudRealtime.subscribe(handleRealtimePayload, () => {
      void refreshFromCloud()
    })

    return () => {
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

  // Record Study Event (in-memory & direct cloud log)
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
              if (sub.hoursSpent === 0) {
                const estimateMinutes = sub.baseEstimateMinutes ?? 30
                const autoHours = Math.round((estimateMinutes / 60) * 100) / 100
                sub.hoursSpent = autoHours
                const logId = `auto-${sub.id}`
                const today = formatDate(new Date())
                newData.dailyLogs.push({
                  id: logId,
                  date: today,
                  subtopicId: sub.id,
                  subtopicName: sub.name,
                  hours: autoHours,
                  source: 'completion',
                })
                void cloudRepository.logSession({
                  id: logId,
                  subtopicId: sub.id,
                  subtopicName: sub.name,
                  moduleName: module.name,
                  durationHours: autoHours,
                  type: 'learning',
                  date: today,
                  source: 'completion',
                })
              }
            } else {
              sub.lastStudied = ''
              const autoLogIndex = newData.dailyLogs.findIndex(l => l.subtopicId === sub.id && l.source === 'completion')
              if (autoLogIndex !== -1) {
                const autoLog = newData.dailyLogs[autoLogIndex]
                sub.hoursSpent = Math.max(0, Math.round((sub.hoursSpent - autoLog.hours) * 100) / 100)
                newData.dailyLogs.splice(autoLogIndex, 1)
                void cloudRepository.deleteLog(autoLog.id)
              }
            }
            break
          }
        }
      }

      if (foundSub) {
        void cloudRepository.toggleSubtopic(foundSub.id, foundSub.completed, foundSub.hoursSpent, foundSub.lastStudied ?? '')
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
      const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

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
      const logId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

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
                newData.dailyLogs.filter(l => l.subtopicId === sub.id).reduce((s, l) => s + l.hours, 0) * 100
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
              newData.dailyLogs.filter(l => l.subtopicId === subtopicId).reduce((s, l) => s + l.hours, 0) * 100
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
              newData.dailyLogs.filter(l => l.subtopicId === s.id && l.source !== 'completion').reduce((a, l) => a + l.hours, 0) * 100
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
    void cloudRepository.resetUserData('all').then(() => {
      void refreshFromCloud()
    })
  }, [refreshFromCloud])

  const restoreData = useCallback((next: TrainingData) => {
    setData(next)
  }, [])

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

  return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>
}

export function useTraining(): TrainingContextType {
  const context = useContext(TrainingContext)
  if (!context) throw new Error('useTraining must be used within a TrainingProvider')
  return context
}
