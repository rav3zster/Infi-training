import { useTraining } from '../context/TrainingContext'
import { Target, Gauge, TrendingUp, BarChart3, GraduationCap, Sparkles } from 'lucide-react'

function ProgressRing({ value, size = 48, strokeWidth = 3, animate = true }: { value: number; size?: number; strokeWidth?: number; animate?: boolean }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(value, 100) / 100) * circumference

  return (
    <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-border-color/80" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-text-primary"
        style={animate ? { transition: 'stroke-dashoffset 800ms ease-out' } : undefined}
      />
    </svg>
  )
}

function MiniProgressBar({ value, height = 3 }: { value: number; height?: number }) {
  return (
    <div className={`relative rounded-full bg-border-color/60 overflow-hidden`} style={{ height }}>
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-text-primary transition-all duration-700 ease-out"
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  )
}

export default function AnalyticsGrid() {
  const { metrics } = useTraining()
  const { overallProgress, adaptiveDailyTarget, todayHours, remainingHours, daysRemaining, totalHoursSpent, totalEstimatedHours, totalSubtopics, completedSubtopics, streakDays, moduleAnalytics } = metrics

  const dailyVelocityPercent = adaptiveDailyTarget > 0
    ? Math.min((todayHours / adaptiveDailyTarget) * 100, 100)
    : todayHours > 0 ? 100 : 0

  const studyRunwayPercent = totalHoursSpent > 0
    ? Math.min((totalHoursSpent / totalEstimatedHours) * 100, 100)
    : 0

  // Find the module with highest mastery


  return (
    <div className="space-y-3">
      {/* Primary metric: Overall Progress — large hero card */}
      <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Gauge size={14} className="text-text-secondary" />
              <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Overall Progress</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl sm:text-4xl font-bold text-text-primary tracking-tight">
                {Math.round(overallProgress)}<span className="text-lg font-normal text-text-secondary">%</span>
              </span>
              <span className="text-xs text-text-secondary">
                {completedSubtopics}/{totalSubtopics} subtopics
              </span>
            </div>
            <div className="mt-2 sm:mt-3">
              <MiniProgressBar value={overallProgress} height={4} />
            </div>
          </div>
          <div className="flex-shrink-0 ml-4">
            <ProgressRing value={overallProgress} size={56} strokeWidth={4} />
          </div>
        </div>
      </div>

      {/* Secondary metrics grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Daily Velocity */}
        <div className="rounded-xl border border-border-color bg-bg-card p-4 transition-all duration-200 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-text-primary/10 flex items-center justify-center">
              <TrendingUp size={12} className="text-text-primary" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Daily Velocity</span>
            {dailyVelocityPercent >= 100 && <Sparkles size={10} className="text-text-primary" />}
          </div>
          <div className="flex items-center gap-3">
            <ProgressRing value={dailyVelocityPercent} size={40} strokeWidth={3} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-text-primary tabular-nums">{todayHours.toFixed(1)}</span>
                <span className="text-[11px] text-text-secondary">/ {adaptiveDailyTarget.toFixed(1)} hrs</span>
              </div>
              {dailyVelocityPercent >= 100 ? (
                <span className="text-[10px] text-text-primary flex items-center gap-0.5 mt-0.5">
                  <Sparkles size={9} />
                  Target met today!
                </span>
              ) : (
                <span className="text-[10px] text-text-secondary mt-0.5 block">
                  {Math.round(dailyVelocityPercent)}% of daily goal
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Study Runway */}
        <div className="rounded-xl border border-border-color bg-bg-card p-4 transition-all duration-200 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-text-primary/10 flex items-center justify-center">
              <Target size={12} className="text-text-primary" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Study Runway</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-text-primary tabular-nums">{remainingHours.toFixed(1)}</span>
            <span className="text-xs text-text-secondary">hrs left</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-text-secondary">{totalHoursSpent.toFixed(1)}h done</span>
            <span className="text-text-secondary/30">·</span>
            <span className="text-[10px] text-text-secondary">{daysRemaining}d to go</span>
          </div>
          <div className="mt-2">
            <MiniProgressBar value={studyRunwayPercent} height={2} />
          </div>
        </div>

        {/* Streak & Milestones */}
        <div className="rounded-xl border border-border-color bg-bg-card p-4 transition-all duration-200 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-text-primary/10 flex items-center justify-center">
              <BarChart3 size={12} className="text-text-primary" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Streak</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center flex-shrink-0">
              <div className="text-xl font-bold text-text-primary tabular-nums leading-none">{streakDays}</div>
              <div className="text-[9px] text-text-secondary uppercase tracking-wider mt-0.5">days</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex gap-1">
                {Array.from({ length: 7 }).map((_, i) => {
                  const isActive = i < streakDays
                  return (
                    <div
                      key={i}
                      className={`flex-1 h-1.5 rounded-full transition-all duration-500
                        ${isActive ? 'bg-text-primary scale-y-110' : 'bg-border-color'}`}
                    />
                  )
                })}
              </div>
              {streakDays > 0 ? (
                <span className="text-[10px] text-text-primary mt-1 block">
                  {streakDays}-day streak — keep going!
                </span>
              ) : (
                <span className="text-[10px] text-text-secondary mt-1 block">
                  Study 0.5h+ today to start
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Module mastery mini-cards */}
      <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <GraduationCap size={14} className="text-text-secondary" />
          <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Module Mastery</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {moduleAnalytics.map(m => (
            <div key={m.id} className="p-3 rounded-lg bg-bg-primary border border-border-color/60">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-text-primary truncate mr-2">{m.name}</span>
                <span className="text-xs font-bold text-text-primary tabular-nums flex-shrink-0">
                  {Math.round(m.masteryPercentage)}%
                </span>
              </div>
              <MiniProgressBar value={m.masteryPercentage} height={3} />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] text-text-secondary">
                  {m.completedSubtopics}/{m.totalSubtopics} subtopics
                </span>
                <span className="text-[9px] text-text-secondary">{m.hours.toFixed(1)}h</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
