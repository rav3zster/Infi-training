import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTraining } from './TrainingContext'
import type { SessionType } from '../types'
import FullScreenTimerModal from '../components/FullScreenTimerModal'

const STORAGE_KEY = 'tt-timer-state'

interface TimerContextType {
  timerRunning: boolean
  timerElapsedSeconds: number
  timerSubTopicId: string
  timerType: SessionType
  isFullScreenOpen: boolean
  openFullScreenTimer: () => void
  closeFullScreenTimer: () => void
  startTimer: (params: { subtopicId: string; subtopicName: string; moduleName: string; type: SessionType }) => void
  pauseTimer: () => void
  resumeTimer: () => void
  /** Stop + log elapsed time as a session (skipped if < 30 seconds) */
  stopTimer: () => void
  cancelTimer: () => void
}

const TimerContext = createContext<TimerContextType | null>(null)

export function TimerProvider({ children }: { children: ReactNode }) {
  const { logStudySession, recordEvent } = useTraining()

  const [timerRunning, setTimerRunning] = useState(false)
  const [timerElapsedSeconds, setTimerElapsedSeconds] = useState(0)
  const [timerSubTopicId, setTimerSubTopicId] = useState('')
  const [timerSubTopicName, setTimerSubTopicName] = useState('')
  const [timerModuleName, setTimerModuleName] = useState('')
  const [timerType, setTimerType] = useState<SessionType>('learning')
  const [isFullScreenOpen, setIsFullScreenOpen] = useState(false)

  // Wall-clock anchors — accumulatedMs holds completed segments before pause, segmentStartMs holds active segment start
  const accumulatedMs = useRef(0)
  const segmentStartMs = useRef<number | null>(null)

  // Refs that mirror state/callbacks for a stable stopTimer callback
  const subTopicIdRef = useRef('')
  const subTopicNameRef = useRef('')
  const moduleNameRef = useRef('')
  const timerTypeRef = useRef<SessionType>('learning')
  const logStudySessionRef = useRef(logStudySession)
  const recordEventRef = useRef(recordEvent)

  subTopicIdRef.current = timerSubTopicId
  subTopicNameRef.current = timerSubTopicName
  moduleNameRef.current = timerModuleName
  timerTypeRef.current = timerType
  logStudySessionRef.current = logStudySession
  recordEventRef.current = recordEvent

  const openFullScreenTimer = useCallback(() => setIsFullScreenOpen(true), [])
  const closeFullScreenTimer = useCallback(() => setIsFullScreenOpen(false), [])

  // Helper to get total elapsed ms
  const getTotalElapsedMs = useCallback(() => {
    const currentSegment = segmentStartMs.current !== null ? Date.now() - segmentStartMs.current : 0
    return accumulatedMs.current + currentSegment
  }, [])

  // Restore in-progress timer state on page reload
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved && saved.subtopicId) {
        setTimerSubTopicId(saved.subtopicId)
        setTimerSubTopicName(saved.subtopicName || '')
        setTimerModuleName(saved.moduleName || '')
        setTimerType(saved.type || 'learning')
        
        accumulatedMs.current = saved.accumulatedMs || 0
        if (saved.isRunning && saved.segmentStartMs) {
          segmentStartMs.current = saved.segmentStartMs
          setTimerRunning(true)
        } else {
          segmentStartMs.current = null
          setTimerRunning(false)
        }

        const totalSeconds = Math.floor((accumulatedMs.current + (segmentStartMs.current ? Date.now() - segmentStartMs.current : 0)) / 1000)
        setTimerElapsedSeconds(Math.max(0, totalSeconds))
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  // Interval updates display seconds using accurate wall-clock accumulation
  useEffect(() => {
    if (!timerRunning) return
    const update = () => {
      const seconds = Math.floor(getTotalElapsedMs() / 1000)
      setTimerElapsedSeconds(Math.max(0, seconds))
    }
    update()
    const iv = window.setInterval(update, 1000)
    return () => window.clearInterval(iv)
  }, [timerRunning, getTotalElapsedMs])

  const saveTimerState = useCallback((isRunning: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        accumulatedMs: accumulatedMs.current,
        segmentStartMs: segmentStartMs.current,
        isRunning,
        subtopicId: subTopicIdRef.current,
        subtopicName: subTopicNameRef.current,
        moduleName: moduleNameRef.current,
        type: timerTypeRef.current,
      }))
    } catch { /* best-effort */ }
  }, [])

  const startTimer = useCallback((params: {
    subtopicId: string
    subtopicName: string
    moduleName: string
    type: SessionType
  }) => {
    accumulatedMs.current = 0
    segmentStartMs.current = Date.now()
    setTimerSubTopicId(params.subtopicId)
    setTimerSubTopicName(params.subtopicName)
    setTimerModuleName(params.moduleName)
    setTimerType(params.type)
    setTimerElapsedSeconds(0)
    setTimerRunning(true)

    subTopicIdRef.current = params.subtopicId
    subTopicNameRef.current = params.subtopicName
    moduleNameRef.current = params.moduleName
    timerTypeRef.current = params.type

    saveTimerState(true)

    recordEventRef.current({
      type: 'timer.started',
      entityType: 'session',
      entityId: params.subtopicId,
      payload: { subtopicName: params.subtopicName, type: params.type },
      occurredAt: new Date().toISOString(),
    })
  }, [saveTimerState])

  const pauseTimer = useCallback(() => {
    if (segmentStartMs.current !== null) {
      accumulatedMs.current += Date.now() - segmentStartMs.current
      segmentStartMs.current = null
    }
    setTimerRunning(false)
    saveTimerState(false)
  }, [saveTimerState])

  const resumeTimer = useCallback(() => {
    segmentStartMs.current = Date.now()
    setTimerRunning(true)
    saveTimerState(true)
  }, [saveTimerState])

  const stopTimer = useCallback(() => {
    const elapsed = Math.floor(getTotalElapsedMs() / 1000)

    const subId = subTopicIdRef.current
    const subName = subTopicNameRef.current
    const modName = moduleNameRef.current
    const type = timerTypeRef.current

    accumulatedMs.current = 0
    segmentStartMs.current = null
    setTimerRunning(false)
    setTimerElapsedSeconds(0)
    setTimerSubTopicId('')
    setTimerSubTopicName('')
    setTimerModuleName('')
    setTimerType('learning')

    try { localStorage.removeItem(STORAGE_KEY) } catch { /* best-effort */ }

    if (elapsed >= 30 && subId) {
      const durationHours = Math.round((elapsed / 3600) * 100) / 100
      logStudySessionRef.current({
        subtopicId: subId,
        subtopicName: subName,
        moduleName: modName,
        durationHours,
        type,
      })
      recordEventRef.current({
        type: 'timer.stopped',
        entityType: 'session',
        entityId: subId,
        payload: { elapsedSeconds: elapsed, durationHours, type, subtopicName: subName },
        occurredAt: new Date().toISOString(),
      })
    }
  }, [getTotalElapsedMs])

  const cancelTimer = useCallback(() => {
    accumulatedMs.current = 0
    segmentStartMs.current = null
    setTimerRunning(false)
    setTimerElapsedSeconds(0)
    setTimerSubTopicId('')
    setTimerSubTopicName('')
    setTimerModuleName('')
    setTimerType('learning')
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* best-effort */ }
  }, [])

  return (
    <TimerContext.Provider
      value={{
        timerRunning,
        timerElapsedSeconds,
        timerSubTopicId,
        timerType,
        isFullScreenOpen,
        openFullScreenTimer,
        closeFullScreenTimer,
        startTimer,
        pauseTimer,
        resumeTimer,
        stopTimer,
        cancelTimer,
      }}
    >
      {children}
      <FullScreenTimerModal />
    </TimerContext.Provider>
  )
}

export function useTimer(): TimerContextType {
  const context = useContext(TimerContext)
  if (!context) throw new Error('useTimer must be used within a TimerProvider')
  return context
}
