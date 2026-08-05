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

/* Flip-clock style digit box — remounts on value change so the tick-pop
 * animation replays (subtle “heartbeat” while the timer runs). */
function DigitBox({ value, unit, pop }: { value: string; unit: string; pop: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        key={pop ? value : undefined}
        className="rounded-xl border border-border-color/70 bg-bg-card px-2 sm:px-3 py-1.5 sm:py-2 min-w-[3.2rem] sm:min-w-[4rem] text-center shadow-sm"
        style={pop ? { animation: 'tick-pop 300ms ease-out' } : undefined}
      >
        <span className="text-4xl sm:text-5xl font-black tabular-nums font-mono text-text-primary">
          {value}
        </span>
      </div>
      <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-text-secondary">{unit}</span>
    </div>
  )
}

function Colon() {
  return <span className="text-3xl sm:text-4xl font-black text-text-secondary/40 mt-1">:</span>
}

/* Circular control button with a small label underneath */
function ControlButton({
  label,
  icon,
  primary,
  ghost,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  primary?: boolean
  ghost?: boolean
  onClick: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={`w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-90
          ${primary
            ? 'bg-text-primary text-bg-primary shadow-md hover:opacity-90'
            : ghost
              ? 'border border-border-color text-text-secondary hover:text-text-primary hover:border-text-secondary'
              : 'border border-border-color text-text-primary hover:border-text-secondary'}`}
      >
        {icon}
      </button>
      <span className="text-[10px] font-semibold text-text-secondary">{label}</span>
    </div>
  )
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-2 py-2 text-center ${highlight ? 'border-accent/40 bg-accent/10' : 'border-border-color/60 bg-bg-primary/50'}`}>
      <div className={`text-sm font-bold tabular-nums ${highlight ? 'text-accent' : 'text-text-primary'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-text-secondary mt-0.5">{label}</div>
    </div>
  )
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

  // Keyboard shortcuts — Space toggles, Escape minimizes
  useEffect(() => {
    if (!isFullScreenOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (timerRunning) pauseTimer()
        else if (timerElapsedSeconds > 0 || timerSubTopicId) resumeTimer()
      } else if (e.key === 'Escape') {
        closeFullScreenTimer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullScreenOpen, timerRunning, timerElapsedSeconds, timerSubTopicId, pauseTimer, resumeTimer, closeFullScreenTimer])

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
  const size = 250
  const strokeWidth = 12
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference

  const hours = Math.floor(timerElapsedSeconds / 3600)
  const minutes = Math.floor((timerElapsedSeconds % 3600) / 60)
  const seconds = timerElapsedSeconds % 60

  const stopAndClose = () => {
    stopTimer()
    closeFullScreenTimer()
  }
  const discardAndClose = () => {
    cancelTimer()
    closeFullScreenTimer()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg-primary/95 backdrop-blur-xl transition-all duration-300 ease-out overflow-y-auto"
      style={{
        paddingTop: 'env(safe-area-inset-top, 16px)',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
      }}
    >
      {/* Ambient color glow behind the ring */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full blur-3xl opacity-25 animate-pulse-soft"
          style={{ background: isTargetMet ? 'radial-gradient(circle, #10b981 0%, transparent 70%)' : 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
        />
      </div>

      {/* ── Header ── */}
      <div className="relative flex items-center justify-between px-6 py-4 border-b border-border-color/40">
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
      <div className="relative flex-1 flex flex-col md:flex-row landscape:flex-row items-center justify-center p-6 gap-8 max-w-6xl mx-auto w-full">
        {/* Left / Center Column: Progress Ring + Flip Clock + Controls */}
        <div className="flex flex-col items-center justify-center flex-1">
          {/* Progress Ring */}
          <div className="relative inline-flex items-center justify-center my-3">
            <svg width={size} height={size} className="transform -rotate-90">
              <defs>
                <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  {isTargetMet ? (
                    <>
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#84cc16" />
                    </>
                  ) : (
                    <>
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="50%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#22d3ee" />
                    </>
                  )}
                </linearGradient>
              </defs>

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

              {/* Progress Ring — gradient stroke with neon glow */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="url(#timerGrad)"
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-500 ease-out"
                style={{ animation: isTargetMet && timerRunning ? 'glow-pulse 2s ease-in-out infinite' : undefined }}
              />

              {/* Milestone dots at 25 / 50 / 75 / 100% */}
              {[25, 50, 75, 100].map(pct => {
                const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2
                const cx = size / 2 + radius * Math.cos(angle)
                const cy = size / 2 + radius * Math.sin(angle)
                const lit = progressPercent >= pct
                return (
                  <circle
                    key={pct}
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={lit ? '#10b981' : 'none'}
                    stroke={lit ? '#10b981' : 'currentColor'}
                    strokeWidth={2.5}
                    className={lit ? '' : 'text-border-color/40'}
                  />
                )
              })}
            </svg>

            {/* Ring Center: status + percentage + estimate */}
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

              <span className={`text-5xl sm:text-6xl font-black tabular-nums tracking-tight ${isTargetMet ? 'text-emerald-500' : 'text-text-primary'}`}>
                {progressPercent}%
              </span>

              <div className="flex items-center gap-1.5 mt-3 bg-bg-card border border-border-color/60 px-3 py-1 rounded-full">
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

          {/* Flip Clock — large segmented time display */}
          <div className="flex items-start justify-center mt-5">
            {hours > 0 && (
              <>
                <DigitBox value={String(hours).padStart(2, '0')} unit="hrs" pop />
                <Colon />
              </>
            )}
            <DigitBox value={String(minutes).padStart(2, '0')} unit="min" pop />
            <Colon />
            <DigitBox value={String(seconds).padStart(2, '0')} unit="sec" pop />
          </div>

          {/* Primary Controls */}
          <div className="flex items-end justify-center gap-4 sm:gap-5 mt-6">
            {!timerRunning ? (
              <>
                <ControlButton label="Resume" primary icon={<Play size={26} />} onClick={resumeTimer} />
                <ControlButton label="Stop & Log" icon={<Square size={22} />} onClick={stopAndClose} />
                {timerElapsedSeconds > 0 && (
                  <ControlButton label="Discard" ghost icon={<RotateCcw size={20} />} onClick={discardAndClose} />
                )}
              </>
            ) : (
              <>
                <ControlButton label="Pause" primary icon={<Pause size={26} />} onClick={pauseTimer} />
                <ControlButton label="Stop & Log" icon={<Square size={22} />} onClick={stopAndClose} />
              </>
            )}
          </div>

          <p className="text-[10px] text-text-secondary mt-4 hidden sm:block">
            Space to pause · Esc to minimize
          </p>
        </div>

        {/* Right / Details Column (Hidden in Zen Mode) */}
        {!zenMode && (
          <div className="flex flex-col justify-center flex-1 max-w-md w-full bg-bg-card border border-border-color/60 rounded-2xl p-6 shadow-xl">
            {/* Active Subtopic Header */}
            <div className="mb-5">
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

            {/* Mini Stats: Elapsed / Estimate / Remaining */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              <MiniStat label="Elapsed" value={formatElapsed(timerElapsedSeconds)} />
              <MiniStat label="Estimate" value={formatDuration(estimateMinutes)} />
              <MiniStat
                label="Remaining"
                value={formatDuration(Math.max(0, estimateMinutes - timerElapsedSeconds / 60))}
                highlight={isTargetMet}
              />
            </div>

            {/* Session Type Chips */}
            <div className="mb-5">
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
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                <span className="text-text-secondary">Progress to Estimate</span>
                <span className="text-text-primary font-bold">{progressPercent}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-bg-primary overflow-hidden border border-border-color/40">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progressPercent}%`,
                    background: isTargetMet
                      ? 'linear-gradient(90deg,#10b981,#84cc16)'
                      : 'linear-gradient(90deg,#3b82f6,#8b5cf6,#22d3ee)',
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
