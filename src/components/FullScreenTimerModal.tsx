import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Minimize2,
  Volume2,
  VolumeX,
  Clock,
  Target,
  Sparkles,
  CheckCircle2,
  BookOpen,
} from 'lucide-react'
import { useTimer } from '../context/TimerContext'
import { useTraining } from '../context/TrainingContext'
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

export default function FullScreenTimerModal() {
  const {
    timerRunning,
    timerElapsedSeconds,
    timerSubTopicId,
    timerType,
    isFullScreenOpen,
    closeFullScreenTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    cancelTimer,
  } = useTimer()

  const { allSubtopics, data } = useTraining()

  const [zenMode, setZenMode] = useState(false)
  const [ambientSound, setAmbientSound] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const noiseNodeRef = useRef<AudioNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)

  // Find active subtopic details & base estimate
  const activeSubtopic = useMemo(() => {
    return allSubtopics.find(s => s.id === timerSubTopicId)
  }, [allSubtopics, timerSubTopicId])

  const activeModule = useMemo(() => {
    if (!timerSubTopicId || !data) return null
    return data.modules.find(m =>
      m.topics.some(t => t.subtopics.some(s => s.id === timerSubTopicId))
    )
  }, [data, timerSubTopicId])

  const estimateMinutes = activeSubtopic?.baseEstimateMinutes ?? 30
  const estimateSeconds = estimateMinutes * 60
  const progressPercent = Math.min(100, Math.round((timerElapsedSeconds / Math.max(1, estimateSeconds)) * 100))
  const isTargetMet = timerElapsedSeconds >= estimateSeconds

  // Haptic feedback & target reached chime
  const hasVibrated = useRef(false)
  useEffect(() => {
    if (isTargetMet && !hasVibrated.current && timerRunning) {
      hasVibrated.current = true
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([150, 100, 150])
      }
    }
    if (timerElapsedSeconds === 0) {
      hasVibrated.current = false
    }
  }, [isTargetMet, timerRunning, timerElapsedSeconds])

  // Synthetic Ambient Noise Generator (Web Audio API)
  useEffect(() => {
    if (ambientSound && timerRunning) {
      try {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioContextClass()
        audioCtxRef.current = ctx

        // Create brown/pink noise buffer
        const bufferSize = ctx.sampleRate * 2
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
        const output = noiseBuffer.getChannelData(0)
        let lastOut = 0.0
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1
          output[i] = (lastOut + 0.02 * white) / 1.02
          lastOut = output[i]
          output[i] *= 3.5 // boost gain
        }

        const whiteNoise = ctx.createBufferSource()
        whiteNoise.buffer = noiseBuffer
        whiteNoise.loop = true

        const gainNode = ctx.createGain()
        gainNode.gain.setValueAtTime(0.08, ctx.currentTime)

        whiteNoise.connect(gainNode)
        gainNode.connect(ctx.destination)
        whiteNoise.start()

        noiseNodeRef.current = whiteNoise
        gainNodeRef.current = gainNode
      } catch (err) {
        console.warn('[AmbientSound] Web Audio initialization failed:', err)
      }
    } else {
      if (noiseNodeRef.current) {
        try {
          (noiseNodeRef.current as AudioBufferSourceNode).stop()
        } catch { /* ignored */ }
        noiseNodeRef.current = null
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close()
        } catch { /* ignored */ }
        audioCtxRef.current = null
      }
    }

    return () => {
      if (noiseNodeRef.current) {
        try {
          (noiseNodeRef.current as AudioBufferSourceNode).stop()
        } catch { /* ignored */ }
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close()
        } catch { /* ignored */ }
      }
    }
  }, [ambientSound, timerRunning])

  if (!isFullScreenOpen) return null

  // SVG Ring Calculations
  const size = 260
  const strokeWidth = 12
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg-primary/95 backdrop-blur-xl transition-all duration-300 ease-out overflow-y-auto"
      style={{
        paddingTop: 'env(safe-area-inset-top, 16px)',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
      }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-color/40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-text-primary flex items-center justify-center text-bg-primary">
            <Clock size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary tracking-tight">Full Screen Timer</h3>
            <p className="text-[11px] text-text-secondary">
              {activeModule ? activeModule.name : 'Focus Mode'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Ambient Sound Toggle */}
          <button
            type="button"
            onClick={() => setAmbientSound(!ambientSound)}
            title={ambientSound ? 'Mute Ambient Focus Sound' : 'Play Ambient Focus Sound'}
            className={`p-2 rounded-lg border transition-all cursor-pointer ${
              ambientSound
                ? 'bg-text-primary text-bg-primary border-text-primary'
                : 'border-border-color text-text-secondary hover:text-text-primary'
            }`}
          >
            {ambientSound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {/* Zen Mode Toggle */}
          <button
            type="button"
            onClick={() => setZenMode(!zenMode)}
            title={zenMode ? 'Exit Zen Mode' : 'Enter Zen Mode'}
            className={`p-2 rounded-lg border transition-all cursor-pointer ${
              zenMode
                ? 'bg-text-primary text-bg-primary border-text-primary'
                : 'border-border-color text-text-secondary hover:text-text-primary'
            }`}
          >
            <Sparkles size={16} />
          </button>

          {/* Exit Fullscreen */}
          <button
            type="button"
            onClick={closeFullScreenTimer}
            title="Minimize Timer"
            className="p-2 rounded-lg border border-border-color text-text-secondary hover:text-text-primary hover:border-text-secondary transition-all cursor-pointer"
          >
            <Minimize2 size={16} />
          </button>
        </div>
      </div>

      {/* ── Main Content Body (Responsive: Portrait Stacked, Landscape Side-by-Side) ── */}
      <div className="flex-1 flex flex-col md:flex-row landscape:flex-row items-center justify-center p-6 gap-8 max-w-6xl mx-auto w-full">
        {/* Left / Center Column: Large Progress Ring & Running Digits */}
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="relative inline-flex items-center justify-center my-4">
            <svg width={size} height={size} className="transform -rotate-90">
              {/* Background Ring */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                className="text-border-color/40"
              />
              {/* Animated Progress Ring */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={isTargetMet ? '#10b981' : '#3b82f6'}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-500 ease-out"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
              <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-1">
                {timerRunning ? (
                  <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" />
                    In Progress
                  </span>
                ) : (
                  'Paused / Ready'
                )}
              </span>

              {/* Large Display Digits */}
              <div className="text-4xl sm:text-5xl md:text-6xl font-black tabular-nums tracking-tight text-text-primary font-mono my-1">
                {formatElapsed(timerElapsedSeconds)}
              </div>

              {/* Subtopic Estimate & Target Badge */}
              <div className="flex items-center gap-1.5 mt-2 bg-bg-card border border-border-color/60 px-3 py-1 rounded-full">
                <Target size={12} className={isTargetMet ? 'text-emerald-500' : 'text-text-secondary'} />
                <span className="text-xs font-semibold text-text-primary">
                  Est: {formatDuration(estimateMinutes)}
                </span>
                {isTargetMet && (
                  <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-0.5">
                    <CheckCircle2 size={10} /> Target Met
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right / Details Column (Hidden in Zen Mode on mobile if compact) */}
        {!zenMode && (
          <div className="flex flex-col justify-center flex-1 max-w-md w-full bg-bg-card border border-border-color/60 rounded-2xl p-6 shadow-xl">
            {/* Active Subtopic Header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 text-xs font-bold text-text-secondary uppercase tracking-wider mb-1">
                <BookOpen size={13} /> Active Study Topic
              </div>
              <h2 className="text-lg sm:text-xl font-extrabold text-text-primary leading-snug">
                {activeSubtopic?.name ?? 'Select a Topic'}
              </h2>
              {activeSubtopic && (
                <p className="text-xs text-text-secondary mt-1">
                  Already logged: {formatHours(activeSubtopic.hoursSpent)} of {formatDuration(estimateMinutes)}
                </p>
              )}
            </div>

            {/* Session Type Chips */}
            <div className="mb-6">
              <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider block mb-2">
                Session Category
              </span>
              <div className="flex flex-wrap gap-2">
                {SESSION_TYPES.map(s => (
                  <span
                    key={s.type}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      timerType === s.type
                        ? 'bg-text-primary text-bg-primary border-text-primary font-bold shadow-sm'
                        : 'border-border-color/60 text-text-secondary opacity-60'
                    }`}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Target Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                <span className="text-text-secondary">Progress to Estimate</span>
                <span className="text-text-primary font-bold">{progressPercent}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-bg-primary overflow-hidden border border-border-color/40">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progressPercent}%`,
                    backgroundColor: isTargetMet ? '#10b981' : '#3b82f6',
                  }}
                />
              </div>
            </div>

            {/* Primary Action Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {!timerRunning ? (
                <>
                  <button
                    type="button"
                    onClick={resumeTimer}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold bg-text-primary text-bg-primary hover:opacity-90 active:scale-98 transition-all shadow-md cursor-pointer"
                  >
                    <Play size={16} /> Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stopTimer()
                      closeFullScreenTimer()
                    }}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold border border-border-color hover:border-text-secondary transition-all cursor-pointer text-text-primary"
                  >
                    <Square size={14} /> Stop & Log
                  </button>
                  {timerElapsedSeconds > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        cancelTimer()
                        closeFullScreenTimer()
                      }}
                      className="p-3 rounded-xl border border-border-color/60 text-text-secondary hover:text-red-500 hover:border-red-500/40 transition-all cursor-pointer"
                      title="Discard Session"
                    >
                      <RotateCcw size={16} />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={pauseTimer}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold border border-border-color hover:border-text-secondary text-text-primary transition-all cursor-pointer"
                  >
                    <Pause size={16} /> Pause
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stopTimer()
                      closeFullScreenTimer()
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold bg-text-primary text-bg-primary hover:opacity-90 active:scale-98 transition-all shadow-md cursor-pointer"
                  >
                    <Square size={14} /> Stop & Log
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
