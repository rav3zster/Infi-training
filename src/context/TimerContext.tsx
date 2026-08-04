import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTraining } from './TrainingContext'
import type { SessionType } from '../types'

/**
 * TimerContext — wall-clock study timer.
 *
 * Elapsed is derived as  Date.now() - startedAtMs - accumulatedPauseMs
 * so Android background throttling or a slow interval cannot undercount
 * a session. The 1 Hz interval only forces a re-render; it never accumulates.
 *
 * startedAtMs is persisted to localStorage so a page reload can detect an
 * in-progress session (full resume is a follow-up task; at minimum the timer
 * won't silently reset to zero on reload).
 */

const STORAGE_KEY = 'tt-timer-state'

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

  // Wall-clock anchors — never reset on interval ticks.
  const startedAtMs = useRef<number | null>(null) // epoch ms when the running phase started
  const pausedMs = useRef(0)                       // total ms spent paused so far

  // Refs that mirror state/callbacks for a stable stopTimer callback
  // (avoids rebuilding the function every second as elapsed changes).
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

  // Restore in-progress timer state on page reload
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved && saved.startedAtMs && saved.subtopicId) {
        const elapsed = Math.floor((Date.now() - saved.startedAtMs) / 1000)
        if (elapsed > 0 && elapsed < 86400) {
          startedAtMs.current = saved.startedAtMs
          setTimerSubTopicId(saved.subtopicId)
          setTimerSubTopicName(saved.subtopicName || '')
          setTimerModuleName(saved.moduleName || '')
          setTimerType(saved.type || 'learning')
          setTimerElapsedSeconds(elapsed)
          setTimerRunning(true)
        } else {
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  // Interval forces a re-render so the displayed time refreshes; it does NOT
  // accumulate a counter. Elapsed is always computed from the wall clock.
  useEffect(() => {
    if (!timerRunning) return
    const update = () => {
      if (startedAtMs.current === null) return
      const elapsed = Math.floor((Date.now() - startedAtMs.current - pausedMs.current) / 1000)
      setTimerElapsedSeconds(Math.max(0, elapsed))
    }
    update() // immediate first frame
    const iv = window.setInterval(update, 1000)
    return () => window.clearInterval(iv)
  }, [timerRunning])

  const startTimer = useCallback((params: {
    subtopicId: string
    subtopicName: string
    moduleName: string
    type: SessionType
  }) => {
    startedAtMs.current = Date.now()
    pausedMs.current = 0
    setTimerSubTopicId(params.subtopicId)
    setTimerSubTopicName(params.subtopicName)
    setTimerModuleName(params.moduleName)
    setTimerType(params.type)
    setTimerElapsedSeconds(0)
    setTimerRunning(true)

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        startedAtMs: startedAtMs.current,
        subtopicId: params.subtopicId,
        subtopicName: params.subtopicName,
        moduleName: params.moduleName,
        type: params.type,
      }))
    } catch { /* best-effort */ }

    recordEventRef.current({
      type: 'timer.started',
      entityType: 'session',
      entityId: params.subtopicId,
      payload: { subtopicName: params.subtopicName, type: params.type },
      occurredAt: new Date().toISOString(),
    })
  }, [])

  const pauseTimer = useCallback(() => {
    // Accumulate the time spent in this running phase before pausing.
    if (startedAtMs.current !== null) {
      pausedMs.current += Date.now() - startedAtMs.current
      startedAtMs.current = null
    }
    setTimerRunning(false)
  }, [])

  const resumeTimer = useCallback(() => {
    // Start a new running phase from now; pausedMs already holds past paused time.
    startedAtMs.current = Date.now()
    setTimerRunning(true)
  }, [])

  /**
   * Stop the timer, log elapsed time as a study session (sub-30-second
   * accidental starts are discarded), and fully clear timer state.
   *
   * Reads all values from refs (never from captured state) so this callback
   * is created exactly once and never triggers consumer re-renders.
   */
  const stopTimer = useCallback(() => {
    // Compute final elapsed from wall clock before clearing anything.
    let elapsed = 0
    if (startedAtMs.current !== null) {
      // Timer was running when Stop was pressed.
      elapsed = Math.floor((Date.now() - startedAtMs.current - pausedMs.current) / 1000)
    } else {
      // Timer was paused — total elapsed is entirely in pausedMs.
      elapsed = Math.floor(pausedMs.current / 1000)
    }

    const subId = subTopicIdRef.current
    const subName = subTopicNameRef.current
    const modName = moduleNameRef.current
    const type = timerTypeRef.current

    startedAtMs.current = null
    pausedMs.current = 0
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
  }, []) // stable — reads all values from refs

  const cancelTimer = useCallback(() => {
    startedAtMs.current = null
    pausedMs.current = 0
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
