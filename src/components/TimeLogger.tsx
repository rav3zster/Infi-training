import { useState, useMemo, useEffect } from 'react'
import {
  Plus, ChevronDown, Play, Pause, Square, Timer, X, Zap, Maximize2,
} from 'lucide-react'
import { useTraining } from '../context/TrainingContext'
import { useTimer } from '../context/TimerContext'
import { formatDuration, formatHours } from '../data/curriculum'
import type { SessionType } from '../types'

const SESSION_TYPES: { type: SessionType; label: string }[] = [
  { type: 'learning', label: 'Learning' },
  { type: 'coding', label: 'Coding' },
  { type: 'revision', label: 'Revision' },
  { type: 'mock', label: 'Mock Test' },
  { type: 'project', label: 'Project' },
  { type: 'break', label: 'Break' },
]

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function TimeLogger() {
  const { data, allSubtopics, logSession, metrics } = useTraining()
  const {
    timerRunning, timerElapsedSeconds, timerSubTopicId, timerType, openFullScreenTimer,
    startTimer, pauseTimer, resumeTimer, stopTimer, cancelTimer,
  } = useTimer()

  const [selectedTopic, setSelectedTopic] = useState('')
  const [hours, setHours] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [sessionType, setSessionType] = useState<SessionType>('learning')
  const [showManual, setShowManual] = useState(false)
  const [runningType, setRunningType] = useState<SessionType>('learning')

  // Reflect the currently running timer's type in the chips
  useEffect(() => {
    if (timerRunning) setRunningType(timerType)
  }, [timerRunning, timerType])

  // Group subtopics by module for the dropdown
  const topicGroups = useMemo(() => {
    return data.modules.map(m => ({
      moduleId: m.id,
      moduleName: m.name,
      subtopics: m.topics.flatMap(t =>
        t.subtopics.map(st => ({
          id: st.id,
          name: st.name,
          topicName: `${m.name} › ${t.name}`,
          hoursSpent: st.hoursSpent,
          baseEstimateMinutes: st.baseEstimateMinutes,
        }))
      ),
    }))
  }, [data.modules])

  const selectedSubTopic = useMemo(() => {
    return allSubtopics.find(st => st.id === selectedTopic)
  }, [selectedTopic, allSubtopics])

  const handleLog = () => {
    const hoursNum = parseFloat(hours)
    if (!selectedTopic || isNaN(hoursNum) || hoursNum <= 0) return
    logSession(selectedTopic, hoursNum)
    setHours('')
  }

  const handleStartTimer = () => {
    if (!selectedSubTopic) return
    const moduleName = data.modules
      .find(m => m.topics.some(t => t.subtopics.some(st => st.id === selectedTopic)))?.name ?? ''
    startTimer({
      subtopicId: selectedTopic,
      subtopicName: selectedSubTopic.name,
      moduleName,
      type: sessionType,
    })
    setRunningType(sessionType)
  }

  const validHours = hours === '' || (!isNaN(parseFloat(hours)) && parseFloat(hours) > 0)

  return (
    <div className="rounded-lg border border-border-color bg-bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center">
          <Timer size={14} className="text-bg-primary" />
        </div>
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          Study Timer
        </span>
        <div className="ml-auto text-right">
          <span className="text-sm font-semibold text-text-primary">{metrics.todayHours.toFixed(1)}</span>
          <span className="text-xs text-text-secondary ml-1">hrs today</span>
        </div>
      </div>

      {/* ── Live timer display (Clickable to open Full Screen Timer) ── */}
      <div
        onClick={() => openFullScreenTimer()}
        className={`rounded-lg border p-4 text-center transition-all duration-300 mb-3 cursor-pointer group relative hover:border-text-secondary/60
          ${timerRunning
            ? 'border-text-primary/40 bg-bg-primary shadow-sm animate-pulse-soft'
            : 'border-border-color bg-bg-primary'}`}
        title="Click to open full screen flip-up timer"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openFullScreenTimer()
          }}
          className="absolute top-2.5 right-2.5 p-1 rounded border border-border-color/60 text-text-secondary hover:text-text-primary hover:border-text-primary transition-all"
          title="Open Full Screen Timer"
        >
          <Maximize2 size={12} />
        </button>
        <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-text-secondary mb-1">
          {timerRunning ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
              {runningType === 'break' ? 'Break in progress' : 'Session in progress'}
            </>
          ) : (
            'Ready'
          )}
          {!timerRunning && !timerSubTopicId && (
            <span className="text-text-secondary">· select a subtopic to begin</span>
          )}
        </div>
        <div className="text-4xl font-bold tabular-nums text-text-primary tracking-tight font-mono group-hover:scale-105 transition-transform">
          {formatElapsed(timerElapsedSeconds)}
        </div>
        {timerSubTopicId && (
          <div className="text-[10px] text-text-secondary mt-1 truncate">
            {allSubtopics.find(s => s.id === timerSubTopicId)?.name ?? ''}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-2 mt-3">
          {!timerRunning ? (
            <>
              <button
                type="button"
                onClick={handleStartTimer}
                disabled={!selectedSubTopic}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md
                  bg-text-primary text-bg-primary hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed
                  transition-all duration-150 cursor-pointer"
              >
                <Play size={14} />
                Start
              </button>
              {timerElapsedSeconds > 0 && (
                <button
                  type="button"
                  onClick={resumeTimer}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-border-color text-text-primary hover:border-text-secondary transition-colors cursor-pointer"
                >
                  <Play size={14} />
                  Resume
                </button>
              )}
              {timerElapsedSeconds > 0 && (
                <button
                  type="button"
                  onClick={cancelTimer}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-border-color text-text-secondary hover:text-red-500 hover:border-red-500/40 transition-colors cursor-pointer"
                >
                  <X size={14} />
                  Discard
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={pauseTimer}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md border border-border-color text-text-primary hover:border-text-secondary transition-colors cursor-pointer"
              >
                <Pause size={14} />
                Pause
              </button>
              <button
                type="button"
                onClick={stopTimer}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md
                  bg-text-primary text-bg-primary hover:opacity-80 transition-all duration-150 cursor-pointer"
              >
                <Square size={12} />
                Stop & Log
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Subtopic selector ── */}
      <div className="relative mb-3">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={timerRunning}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-md
            border border-border-color bg-bg-primary text-text-primary
            hover:border-text-secondary focus:outline-none focus:ring-1 focus:ring-text-primary
            transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className={selectedTopic ? 'text-text-primary' : 'text-text-secondary'}>
            {selectedSubTopic ? (
              <span className="flex items-center gap-2">
                <span>{selectedSubTopic.name}</span>
                <span className="text-[10px] text-text-secondary">
                  {formatDuration(selectedSubTopic.baseEstimateMinutes ?? 0)} est.
                </span>
              </span>
            ) : (
              'Select a subtopic to study...'
            )}
          </span>
          <ChevronDown size={14} className={`text-text-secondary transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
            <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border border-border-color bg-bg-card shadow-lg max-h-64 overflow-y-auto">
              {topicGroups.map(group => (
                <div key={group.moduleId}>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-secondary bg-bg-primary border-b border-border-color font-medium">
                    {group.moduleName}
                  </div>
                  {group.subtopics.map(st => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        setSelectedTopic(st.id)
                        setIsOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-primary transition-colors duration-100
                        border-b border-border-color last:border-b-0 cursor-pointer flex items-center justify-between
                        ${selectedTopic === st.id ? 'bg-bg-primary font-medium' : ''}`}
                    >
                      <span className="text-text-primary">{st.name}</span>
                      <span className="text-[10px] text-text-secondary flex items-center gap-1">
                        {formatDuration(st.baseEstimateMinutes ?? 0)}
                        {st.hoursSpent > 0 && (
                          <span className="text-text-primary">· {formatHours(st.hoursSpent)} logged</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Session type chips ── */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <Zap size={11} className="text-text-secondary flex-shrink-0" />
        {SESSION_TYPES.map(t => {
          const active = timerRunning ? runningType === t.type : sessionType === t.type
          return (
            <button
              key={t.type}
              type="button"
              disabled={timerRunning}
              onClick={() => setSessionType(t.type)}
              className={`px-2.5 py-1 text-[10px] rounded-md font-medium border transition-all duration-150 cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed
                ${active
                  ? 'bg-text-primary text-bg-primary border-text-primary'
                  : 'border-border-color text-text-secondary hover:border-text-secondary hover:text-text-primary'}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── Manual quick-log (collapsible) ── */}
      <div className="border-t border-border-color pt-2.5">
        <button
          type="button"
          onClick={() => setShowManual(!showManual)}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <Plus size={11} className={`transition-transform duration-200 ${showManual ? 'rotate-45' : ''}`} />
          {showManual ? 'Hide manual log' : 'Manual quick-log (without timer)'}
        </button>

        {showManual && (
          <div className="mt-2.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  placeholder="Hours (e.g. 1.5)"
                  value={hours}
                  onChange={e => setHours(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLog()}
                  className="w-full px-3 py-2 text-sm rounded-md border border-border-color bg-bg-primary text-text-primary
                    placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-text-primary
                    transition-colors duration-150 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <button
                type="button"
                onClick={handleLog}
                disabled={!selectedTopic || !validHours || parseFloat(hours || '0') <= 0}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md
                  bg-text-primary text-bg-primary
                  hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed
                  transition-all duration-150 cursor-pointer"
              >
                <Plus size={14} />
                Log Session
              </button>
            </div>

            {selectedTopic && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-text-secondary">
                  Selected: {selectedSubTopic?.name}
                </span>
                <span className="text-[10px] text-text-secondary">
                  {formatHours(selectedSubTopic?.hoursSpent ?? 0)} logged of {formatDuration(selectedSubTopic?.baseEstimateMinutes ?? 0)}
                </span>
              </div>
            )}

            <div className="flex gap-1.5">
              {[1, 1.5, 2].map(quick => (
                <button
                  key={quick}
                  type="button"
                  onClick={() => setHours(String(quick))}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors duration-100 cursor-pointer
                    ${parseFloat(hours || '0') === quick
                      ? 'border-text-primary bg-text-primary text-bg-primary'
                      : 'border-border-color text-text-secondary hover:border-text-secondary'
                    }`}
                >
                  {quick}h
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
