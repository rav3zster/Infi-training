import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTraining } from './TrainingContext'
import type { SessionType } from '../types'

/**
 * TimerContext — the live count-up study timer, isolated in its own provider
 * so the per-second tick re-renders ONLY consumers of this context (the
 * TimeLogger and the Dashboard chip/circle) instead of the whole app tree.
 */

interface TimerContextType {
  timerRunning: boolean
  timerElapsedSeconds: number
  timerSubTopicId: string
  timerType: SessionType
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

  // Refs that mirror the state values above.  stopTimer reads from these refs
  // so it never needs the state variables in its useCallback dependency array.
  // Without refs, stopTimer would be rebuilt every second (timerElapsedSeconds
  // changes every second), making TimerContext.Provider emit a new value each
  // tick and forcing all consumers to re-render unnecessarily.
  const elapsedRef = useRef(0)
  const subTopicIdRef = useRef('')
  const subTopicNameRef = useRef('')
  const moduleNameRef = useRef('')
  const timerTypeRef = useRef<SessionType>('learning')
  const logStudySessionRef = useRef(logStudySession)
  const recordEventRef = useRef(recordEvent)

  // Keep refs in sync with latest state / callbacks on every render.
  // This is safe because the refs are only read inside event handlers (stopTimer),
  // never during render.
  elapsedRef.current = timerElapsedSeconds
  subTopicIdRef.current = timerSubTopicId
  subTopicNameRef.current = timerSubTopicName
  moduleNameRef.current = timerModuleName
  timerTypeRef.current = timerType
  logStudySessionRef.current = logStudySession
  recordEventRef.current = recordEvent

  // Tick every second while running
  useEffect(() => {
    if (!timerRunning) return
    const interval = window.setInterval(() => {
      setTimerElapsedSeconds(s => s + 1)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [timerRunning])

  const startTimer = useCallback((params: {
    subtopicId: string
    subtopicName: string
    moduleName: string
    type: SessionType
  }) => {
    setTimerSubTopicId(params.subtopicId)
    setTimerSubTopicName(params.subtopicName)
    setTimerModuleName(params.moduleName)
    setTimerType(params.type)
    setTimerElapsedSeconds(0)
    setTimerRunning(true)
    recordEventRef.current({
      type: 'timer.started',
      entityType: 'session',
      entityId: params.subtopicId,
      payload: { subtopicName: params.subtopicName, type: params.type },
      occurredAt: new Date().toISOString(),
    })
  }, [])

  const pauseTimer = useCallback(() => setTimerRunning(false), [])
  const resumeTimer = useCallback(() => setTimerRunning(true), [])

  /**
   * Stop the timer, log elapsed time as a study session (sub-30-second
   * accidental starts are discarded), and fully clear timer state.
   *
   * Reads timer values from refs (not captured state) so this callback has
   * an empty dep array and is created exactly once — preventing a new
   * Provider value (and consumer re-renders) on every tick.
   */
  const stopTimer = useCallback(() => {
    const elapsed = elapsedRef.current
    const subId = subTopicIdRef.current
    const subName = subTopicNameRef.current
    const modName = moduleNameRef.current
    const type = timerTypeRef.current

    setTimerRunning(false)
    setTimerElapsedSeconds(0)
    setTimerSubTopicId('')
    setTimerSubTopicName('')
    setTimerModuleName('')
    setTimerType('learning')

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
  }, []) // stable — reads all values from refs, never from captured state

  const cancelTimer = useCallback(() => {
    setTimerRunning(false)
    setTimerElapsedSeconds(0)
    setTimerSubTopicId('')
    setTimerSubTopicName('')
    setTimerModuleName('')
    setTimerType('learning')
  }, [])

  return (
    <TimerContext.Provider
      value={{
        timerRunning,
        timerElapsedSeconds,
        timerSubTopicId,
        timerType,
        startTimer,
        pauseTimer,
        resumeTimer,
        stopTimer,
        cancelTimer,
      }}
    >
      {children}
    </TimerContext.Provider>
  )
}

export function useTimer(): TimerContextType {
  const context = useContext(TimerContext)
  if (!context) throw new Error('useTimer must be used within a TimerProvider')
  return context
}
