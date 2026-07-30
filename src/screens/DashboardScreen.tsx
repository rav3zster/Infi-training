import { useTheme } from '../context/ThemeContext'
import { useTraining } from '../context/TrainingContext'
import { useLayout } from '../App'
import SmartProgressCircle from '../components/SmartProgressCircle'
import ForecastCards from '../components/ForecastCards'
import RoadmapForecast from '../components/RoadmapForecast'
import TimeDistribution from '../components/TimeDistribution'
import AchievementsPanel from '../components/AchievementsPanel'
import MotivationalInsights from '../components/MotivationalInsights'
import {
  Sun, Moon, RotateCcw, Sparkles,
  Clock, TrendingUp, Target, Calendar,
  Gauge, BarChart3, TrendingDown,
} from 'lucide-react'

function StatCard({
  icon: Icon, label, value, sublabel, trend, color,
}: {
  icon: typeof Clock; label: string; value: string; sublabel?: string
  trend?: 'up' | 'down' | 'neutral'; color?: string
}) {
  return (
    <div className="r-card r-p-card transition-all duration-200 hover:shadow-sm hover:scale-[1.02] group">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center transition-colors duration-200 group-hover:bg-text-primary group-hover:text-bg-primary"
          style={{ backgroundColor: color ? `${color}15` : undefined, color }}>
          <Icon size={12} />
        </div>
        <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">{label}</span>
        {trend && <span className={`ml-auto ${trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
          {trend === 'up' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
        </span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="r-text-data font-bold text-text-primary tabular-nums tracking-tight">{value}</span>
        {sublabel && <span className="r-text-tiny text-text-secondary">{sublabel}</span>}
      </div>
    </div>
  )
}

export default function DashboardScreen() {
  const { isDark, toggleTheme } = useTheme()
  const { metrics, resetData } = useTraining()
  const layout = useLayout()

  const dailyVelocityPercent = metrics.adaptiveDailyTarget > 0
    ? Math.min((metrics.todayHours / metrics.adaptiveDailyTarget) * 100, 100)
    : metrics.todayHours > 0 ? 100 : 0

  const formatHours = (h: number) => {
    const hours = Math.floor(h); const minutes = Math.round((h - hours) * 60)
    if (hours === 0) return `${minutes}m`
    if (minutes === 0) return `${hours}h`
    return `${hours}h ${minutes}m`
  }

  // Hero section: progress circle column = 2 if wide, else full width
  const heroCircleSpan = layout.isWide ? 'col-span-2' : 'col-span-1'
  const heroStatsCols = layout.isWide
    ? `grid grid-cols-${Math.min(layout.columns + 1, 3)}`
    : 'grid grid-cols-2 sm:grid-cols-3'

  return (
    <div className="space-y-5 sm:space-y-6"
      style={{ gap: `${layout.sectionGap}px` }}
    >
      {/* Responsive Header */}
      <header className="r-card p-4 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-text-primary flex items-center justify-center">
            <Gauge size={18} className="text-bg-primary" />
          </div>
          <div>
            <h1 className="r-text-h1 font-semibold text-text-primary">Training Engine</h1>
            <p className="r-text-tiny text-text-secondary hidden sm:block">Adaptive Study Load Engine · Infosys Prep</p>
          </div>
        </div>

        {/* Center countdown (visible on expanded+) */}
        {layout.isWide && (
          <div className="text-center">
            <div className="flex items-baseline gap-1 justify-center">
              <span className="r-text-hero font-bold text-text-primary tabular-nums">{metrics.daysRemaining}</span>
              <span className="r-text-small text-text-secondary">days to joining</span>
            </div>
            <span className={`inline-flex items-center gap-1 r-text-tiny font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider mt-0.5
              ${metrics.forecast.isAhead
                ? 'text-green-600 bg-green-600/10 dark:text-green-400 dark:bg-green-400/10'
                : 'text-red-600 bg-red-600/10 dark:text-red-400 dark:bg-red-400/10'}`}>
              {metrics.forecast.isAhead ? 'Ahead of Schedule' : 'Behind Schedule'}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={toggleTheme}
            className="relative w-12 h-6 rounded-full border border-border-color bg-bg-primary cursor-pointer hover:border-text-secondary transition-all duration-200 flex-shrink-0">
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-text-primary flex items-center justify-center transition-all duration-200 ${isDark ? 'translate-x-6' : 'translate-x-0.5'}`}>
              {isDark ? <Moon size={10} className="text-bg-primary" /> : <Sun size={10} className="text-bg-primary" />}
            </span>
          </button>
        </div>
      </header>

      {/* ── Hero: Progress Circle + Stats ── */}
      <section className={`grid grid-cols-1 ${layout.isComfortable ? 'sm:grid-cols-2' : ''} ${layout.isWide ? `lg:grid-cols-${layout.columns + 2}` : ''}`}
        style={{ gap: `${layout.cardGap}px` }}
      >
        <div className={layout.isWide ? 'col-span-2' : ''}
          style={{
            maxWidth: layout.isUltra ? '400px' : layout.isExpanded ? '360px' : '100%',
          }}
        >
          <div className="r-card flex flex-col items-center justify-center r-p-card">
            <SmartProgressCircle
              value={dailyVelocityPercent}
              todayHours={metrics.todayHours}
              size={layout.isUltra ? 200 : layout.isExpanded ? 180 : layout.isComfortable ? 160 : 140}
              strokeWidth={8}
              label="today's progress"
            />
            <div className="mt-3 text-center">
              <div className="flex items-baseline gap-1 justify-center">
                <span className="r-text-hero font-bold text-text-primary tracking-tight">{formatHours(metrics.adaptiveDailyTarget)}</span>
                <span className="r-text-small text-text-secondary">recommended today</span>
              </div>
              <div className="flex items-center gap-3 justify-center mt-1.5 flex-wrap">
                <span className="r-text-tiny text-text-secondary tabular-nums">{metrics.todayHours.toFixed(1)}h logged</span>
                <span className="text-text-secondary/30">·</span>
                <span className="r-text-tiny text-text-secondary tabular-nums">{metrics.adaptiveDailyTarget.toFixed(1)}h target</span>
              </div>
            </div>
          </div>
        </div>

        <div className={`grid gap-2 sm:gap-3 ${layout.isComfortable ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}
          style={{ gap: `${layout.cardGap}px` }}
        >
          <StatCard icon={Calendar} label="Remaining Days" value={String(metrics.daysRemaining)} sublabel="until joining" />
          <StatCard icon={Clock} label="Remaining Hours" value={metrics.remainingEstimatedWork.toFixed(1)} sublabel="est. workload" color="#ea580c" />
          <StatCard icon={Target} label="Completion" value={`${Math.round(metrics.overallProgress)}%`} sublabel={`${metrics.completedSubtopics}/${metrics.totalSubtopics}`} />
          <StatCard icon={BarChart3} label="Streak" value={String(metrics.streakDays)} sublabel="consecutive days" trend={metrics.streakDays > 0 ? 'up' : 'neutral'} />
          <StatCard icon={TrendingUp} label="Avg. Daily" value={metrics.averageDailyHours.toFixed(1)} sublabel="hours/day" />
          <StatCard icon={Sparkles} label="Tomorrow" value={formatHours(metrics.forecast.projectedTomorrow)}
            sublabel={metrics.forecast.projectedTomorrow > metrics.adaptiveDailyTarget ? '↑ higher' : metrics.forecast.projectedTomorrow < metrics.adaptiveDailyTarget ? '↓ lower' : 'same'} />
        </div>
      </section>

      {/* ── Forecast ── */}
      <section><ForecastCards forecast={metrics.forecast} /></section>

      {/* ── Roadmap Forecast ── */}
      <section>
        <RoadmapForecast forecast={metrics.forecast} remainingHours={metrics.remainingEstimatedWork}
          daysRemaining={metrics.daysRemaining} overallProgress={metrics.overallProgress} />
      </section>

      {/* ── Insights + Achievements (side-by-side on wide) ── */}
      <section className={`grid grid-cols-1 ${layout.isComfortable ? 'sm:grid-cols-2' : ''}`}
        style={{ gap: `${layout.cardGap}px` }}
      >
        <MotivationalInsights insights={metrics.insights} />
        <AchievementsPanel achievements={metrics.achievements} />
      </section>

      {/* ── Time Distribution ── */}
      <section>
        <TimeDistribution today={metrics.todayDistribution} weekly={metrics.weeklyDistribution}
          monthly={metrics.monthlyDistribution} lifetime={metrics.lifetimeDistribution}
          todayHours={metrics.todayHours} targetHours={metrics.adaptiveDailyTarget} />
      </section>

      {/* ── Footer ── */}
      <footer className="flex items-center justify-between pt-2 border-t border-border-color">
        <span className="r-text-tiny text-text-secondary">v3.0 · {metrics.totalEstimatedHours.toFixed(0)}h curriculum</span>
        <button type="button" onClick={() => { if (window.confirm('Reset all training data?')) resetData() }}
          className="flex items-center gap-1 r-text-tiny text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
          <RotateCcw size={10} /> Reset
        </button>
      </footer>
    </div>
  )
}
