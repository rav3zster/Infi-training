import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { TrainingData, SubTopic, DashboardMetrics, Assessment, StudySession, SessionType } from '../types'
import { createSeedData, calculateMetrics, formatDate, getAllSubtopics, getAllAssessments } from '../data/curriculum'

export type ToastType = 'success' | 'info' | 'warning'

export interface Toast {
  id: string
  type: ToastType
  message: string
}

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
  resetData: () => void
  toasts: Toast[]
  addToast: (type: ToastType, message: string) => void
  dismissToast: (id: string) => void
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
        return parsed as TrainingData
      }
    }
  } catch {
    // Ignore parse errors
  }
  return createSeedData()
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
  const [toasts, setToasts] = useState<Toast[]>([])

  // Single source of truth for metrics — computed via useMemo, no double render
  const metrics = useMemo(() => calculateMetrics(data), [data])

  const allSubtopics = useMemo(() => getAllSubtopics(data), [data])
  const allAssessments = useMemo(() => getAllAssessments(data), [data])

  // Persist on every data change
  useEffect(() => {
    saveData(data)
  }, [data])

  // Auto-dismiss toasts after 3 seconds
  useEffect(() => {
    if (toasts.length === 0) return
    const timer = setTimeout(() => {
      setToasts(prev => prev.slice(1))
    }, 3000)
    return () => clearTimeout(timer)
  }, [toasts])

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = `toast-${Date.now()}`
    setToasts(prev => [...prev, { id, type, message }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

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
    addToast('success', `Logged ${hours.toFixed(1)}h of study`)
  }, [addToast])

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
    addToast(params.type === 'break' ? 'info' : 'success',
      `Logged ${params.durationHours.toFixed(1)}h of ${params.type}`)
  }, [addToast])

  const toggleSubTopic = useCallback((subtopicId: string) => {
    setData(prev => {
      const newData = structuredClone(prev)
      for (const module of newData.modules) {
        for (const topic of module.topics) {
          const subTopic = topic.subtopics.find(st => st.id === subtopicId)
          if (subTopic) {
            subTopic.completed = !subTopic.completed
            if (subTopic.completed && subTopic.lastStudied === '') {
              subTopic.lastStudied = formatDate(new Date())
            }
            addToast(subTopic.completed ? 'success' : 'info',
              subTopic.completed ? 'Subtopic mastered! ✓' : 'Subtopic unmarked')
            break
          }
        }
      }
      return newData
    })
  }, [addToast])

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
          addToast(assessment.completed ? 'success' : 'info',
            assessment.completed ? 'Assessment completed! 🎉' : 'Assessment unmarked')
          break
        }
      }
      return newData
    })
  }, [addToast])

  const resetData = useCallback(() => {
    const seed = createSeedData()
    setData(seed)
    saveData(seed)
    addToast('warning', 'All data has been reset')
  }, [addToast])

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
        resetData,
        toasts,
        addToast,
        dismissToast,
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
