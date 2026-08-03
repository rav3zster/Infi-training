import { useTheme } from '../context/ThemeContext'
import { useTraining } from '../context/TrainingContext'
import { useTimer } from '../context/TimerContext'
import { useConfirm } from '../context/ConfirmContext'
import { useLayout } from '../App'
import ReadinessWidget from '../components/ReadinessWidget'
import SmartProgressCircle from '../components/SmartProgressCircle'
import ForecastCards from '../components/ForecastCards'
import RoadmapForecast from '../components/RoadmapForecast'
import TimeDistribution from '../components/TimeDistribution'
import AchievementsPanel from '../components/AchievementsPanel'
import MotivationalInsights from '../components/MotivationalInsights'
import ProductivityInsights from '../components/ProductivityInsights'
import StudyHeatmap from '../components/StudyHeatmap'
import {
  Sun, Moon, RotateCcw, Sparkles,
  Clock, TrendingUp, Target, Calendar,
  Gauge, BarChart3, TrendingDown, Timer, ShieldAlert, CheckCircle2,
} from 'lucide-react'

function StatCard({
  icon: Icon, label, value, sublabel, trend, color,
}: {
  icon: typeof Clock; label: string; value: string; sublabel?: string
  trend?: 'up' | 'down' | 'neutral'; color?: string
}) {
  return (
    <div className="r-card p-3.5 sm:p-4 flex flex-col justify-between transition-all duration-200 hover:border-text-secondary/40 hover:shadow-md group">
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
            style={{ backgroundColor: color ? `${color}18` : 'rgba(59, 130, 246, 0.12)', color: color || '#3b82f6' }}>
            <Icon size={14} />
          </div>
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider truncate">{label}</span>
        </div>
        {trend && (
          <span className={`flex-shrink-0 ${trend === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>
            {trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-1 flex-wrap">
        <span className="text-xl sm:text-2xl font-bold text-text-primary tabular-nums tracking-tight">{value}</span>
        {sublabel && <span className="text-[11px] text-text-secondary whitespace-nowrap">{sublabel}</span>}
      </div>
    </div>
  )
}

export default function DashboardScreen() {
  const { isDark, toggleTheme } = useTheme()
  const { metrics, resetLogs } = useTraining()
  const { timerRunning, timerElapsedSeconds } = useTimer()
  const confirm = useConfirm()
  const layout = useLayout()

  // Live today hours — includes the running timer's elapsed time
  const liveTodayHours = metrics.todayHours + (timerRunning ? timerElapsedSeconds / 3600 : 0)

  const dailyVelocityPercent = metrics.adaptiveDailyTarget > 0
    ? Math.min((liveTodayHours / metrics.adaptiveDailyTarget) * 100, 100)
    : liveTodayHours > 0 ? 100 : 0

  const formatHours = (h: number) => {
    const hours = Math.floor(h); const minutes = Math.round((h - hours) * 60)
    if (hours === 0) return `${minutes}m`
    if (minutes === 0) return `${hours}h`
    return `${hours}h ${minutes}m`
  }

  const formatElapsed = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
    return `${m}m ${String(seconds % 60).padStart(2, '0')}s`
  }

  return (
    <div className="space-y-6 animate-fade-in" style={{ gap: `${layout.sectionGap}px` }}>

      {/* ── Header Bar ── */}
      <header className="r-card p-4 sm:px-6 sm:py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-text-primary flex items-center justify-center shadow-sm">
            <Gauge size={20} className="text-bg-primary" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-text-primary tracking-tight">Training Engine</h1>
            <p className="text-xs text-text-secondary hidden sm:block">Adaptive Study Load Engine · Infosys Prep</p>
          </div>
        </div>

        {/* Center Countdown Pill */}
        <div className="flex items-center gap-3 bg-bg-primary px-3.5 py-1.5 rounded-full border border-border-color/80">
          <div className="flex items-baseline gap-1">
            <span className="text-base font-extrabold text-text-primary tabular-nums">{metrics.daysRemaining}</span>
            <span className="text-xs text-text-secondary font-medium">days left</span>
          </div>
          <span className="text-text-secondary/40">·</span>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider
            ${metrics.forecast.isAhead
              ? 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20'
              : 'text-rose-500 bg-rose-500/10 border border-rose-500/20'}`}>
            {metrics.forecast.isAhead ? (
              <><CheckCircle2 size={10} /> Ahead</>
            ) : (
              <><ShieldAlert size={10} /> Behind Schedule</>
            )}
          </span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {timerRunning && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full
              bg-accent text-white dark:bg-accent dark:text-bg-primary shadow-sm animate-pulse-soft">
              <Timer size={13} />
              {formatElapsed(timerElapsedSeconds)}
            </span>
          )}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="relative w-12 h-6 rounded-full border border-border-color bg-bg-primary cursor-pointer hover:border-text-secondary transition-all duration-200 flex-shrink-0"
          >
            <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-text-primary flex items-center justify-center transition-all duration-200 ${isDark ? 'translate-x-6' : 'translate-x-0.5'}`}>
              {isDark ? <Moon size={10} className="text-bg-primary" /> : <Sun size={10} className="text-bg-primary" />}
            </span>
          </button>
        </div>
      </header>

      {/* ── Infosys FA1/FA2 Readiness Score Widget ── */}
      <ReadinessWidget />

      {/* ── Hero Grid: Smart Progress Circle + 6 Stat Cards ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">

        {/* Left: Progress Circle Card (5 cols on lg+) */}
        <div className="lg:col-span-5 r-card r-p-card flex flex-col items-center justify-center text-center">
          <SmartProgressCircle
            value={dailyVelocityPercent}
            todayHours={liveTodayHours}
            size={180}
            strokeWidth={10}
            label="today's progress"
          />
          <div className="mt-4">
            <div className="flex items-baseline gap-1.5 justify-center">
              <span className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight">
                {formatHours(metrics.adaptiveDailyTarget)}
              </span>
              <span className="text-xs text-text-secondary font-medium">recommended today</span>
            </div>
            <div className="flex items-center gap-3 justify-center mt-2 text-xs text-text-secondary">
              <span className="tabular-nums font-semibold text-text-primary">{liveTodayHours.toFixed(1)}h logged</span>
              <span className="text-text-secondary/40">·</span>
              <span className="tabular-nums font-semibold text-text-primary">{metrics.adaptiveDailyTarget.toFixed(1)}h target</span>
            </div>
          </div>
        </div>

        {/* Right: 6 Stat Cards (7 cols on lg+, clean 3-col or 2-col layout) */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          <StatCard icon={Calendar} label="Remaining Days" value={String(metrics.daysRemaining)} sublabel="until joining" color="#3b82f6" />
          <StatCard icon={Clock} label="Remaining Hours" value={metrics.remainingEstimatedWork.toFixed(1)} sublabel="est. workload" color="#ea580c" />
          <StatCard icon={Target} label="Completion" value={`${Math.round(metrics.overallProgress)}%`} sublabel={`${metrics.completedSubtopics}/${metrics.totalSubtopics}`} color="#10b981" />
          <StatCard icon={BarChart3} label="Streak" value={String(metrics.streakDays)} sublabel="consecutive days" trend={metrics.streakDays > 0 ? 'up' : 'neutral'} color="#8b5cf6" />
          <StatCard icon={TrendingUp} label="Avg. Daily" value={metrics.averageDailyHours.toFixed(1)} sublabel="hours/day" color="#06b6d4" />
          <StatCard
            icon={Sparkles}
            label="Tomorrow"
            value={formatHours(metrics.forecast.projectedTomorrow)}
            sublabel={metrics.forecast.projectedTomorrow > metrics.adaptiveDailyTarget ? '↑ higher' : metrics.forecast.projectedTomorrow < metrics.adaptiveDailyTarget ? '↓ lower' : 'same'}
            color="#ec4899"
          />
        </div>
      </section>

      {/* ── Real-time Scenario Forecast Cards ── */}
      <section><ForecastCards forecast={metrics.forecast} /></section>

      {/* ── Roadmap Forecast ── */}
      <section>
        <RoadmapForecast
          forecast={metrics.forecast}
          remainingHours={metrics.remainingEstimatedWork}
          daysRemaining={metrics.daysRemaining}
          overallProgress={metrics.overallProgress}
        />
      </section>

      {/* ── Insights + Achievements (side-by-side on wide) ── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
        <MotivationalInsights insights={metrics.insights} />
        <AchievementsPanel achievements={metrics.achievements} />
      </section>

      {/* ── Time Distribution ── */}
      <section>
        <TimeDistribution
          today={metrics.todayDistribution}
          weekly={metrics.weeklyDistribution}
          monthly={metrics.monthlyDistribution}
          lifetime={metrics.lifetimeDistribution}
          todayHours={metrics.todayHours}
          targetHours={metrics.adaptiveDailyTarget}
        />
      </section>

      {/* ── Study Heatmap ── */}
      <section>
        <StudyHeatmap data={metrics.heatmapData} />
      </section>

      {/* ── Productivity Insights (Resume Learning, Assessments, Path, Module Heatmap) ── */}
      <section>
        <ProductivityInsights />
      </section>

      {/* ── Footer ── */}
      <footer className="flex items-center justify-between pt-4 border-t border-border-color text-xs text-text-secondary">
        <span>v3.0 · {metrics.totalEstimatedHours.toFixed(0)}h curriculum · speed ×{metrics.learningSpeedFactor.toFixed(2)}</span>
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm({
              title: 'Clear all study logs?',
              message: 'All logged sessions will be removed. Your curriculum progress will be kept.',
              confirmLabel: 'Clear Logs',
              danger: true,
            })
            if (ok) resetLogs()
          }}
          className="flex items-center gap-1 hover:text-rose-500 transition-colors cursor-pointer"
        >
          <RotateCcw size={11} /> Clear Logs
        </button>
      </footer>
    </div>
  )
}
