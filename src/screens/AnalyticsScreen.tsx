import { useMemo, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useTraining } from '../context/TrainingContext'
import { useLayout } from '../App'
import {
  Sun, Moon, RotateCcw, BarChart3, TrendingUp,
  Clock, Calendar, Target, BrainCircuit,
  TrendingDown, Sparkles, Award,
} from 'lucide-react'

function Sparkline({ data, height = 40, color }: { data: number[]; height?: number; color?: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const width = Math.min(data.length * 8, 200)

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * height * 0.8 - height * 0.1
    return `${x},${y}`
  })

  return (
    <svg width={width} height={height} className="flex-shrink-0 max-w-full" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`sg-${color || 'default'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color || 'currentColor'} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color || 'currentColor'} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={`M${points.join(' L')} L${width},${height} L0,${height} Z`} fill={`url(#sg-${color || 'default'})`} />
      <path d={`M${points.join(' L')}`} fill="none" stroke={color || 'currentColor'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatBlock({ label, value, sublabel, icon: Icon }: { label: string; value: string; sublabel?: string; icon: typeof Clock }) {
  return (
    <div className="r-card p-3 sm:p-4 transition-all duration-200 hover:shadow-sm">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={11} className="text-text-secondary" />
        <span className="r-text-tiny text-text-secondary uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className="r-text-data font-bold text-text-primary tabular-nums tracking-tight">{value}</div>
      {sublabel && <div className="r-text-tiny text-text-secondary mt-0.5">{sublabel}</div>}
    </div>
  )
}

function WeeklyBarChart({ logs }: { logs: { date: string; hours: number }[] }) {
  const weeklyData = useMemo(() => {
    const weeks = new Map<string, number>()
    for (const log of logs) {
      const d = new Date(log.date + 'T00:00:00')
      const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay())
      const key = weekStart.toISOString().slice(0, 10)
      weeks.set(key, (weeks.get(key) ?? 0) + log.hours)
    }
    return Array.from(weeks.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
  }, [logs])

  if (weeklyData.length === 0) return (
    <div className="text-center py-6"><BarChart3 size={20} className="mx-auto text-border-color mb-2" /><p className="r-text-small text-text-secondary">No weekly data yet</p></div>
  )

  const maxHours = Math.max(...weeklyData.map(([, v]) => v), 1)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between r-text-tiny text-text-secondary">
        <span>Hours per Week</span>
        <span>Total: {weeklyData.reduce((s, [, v]) => s + v, 0).toFixed(1)}h</span>
      </div>
      <div className="flex items-end gap-1 h-24">
        {weeklyData.map(([week, hours]) => {
          const pct = (hours / maxHours) * 100
          return (
            <div key={week} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              <div className="w-full rounded-t-sm transition-all duration-300 group-hover:opacity-80"
                style={{ height: `${Math.max(pct, 4)}%`, backgroundColor: hours >= maxHours * 0.8 ? '#16a34a' : hours >= maxHours * 0.5 ? '#ea580c' : '#6b7280' }} />
              <span className="text-[7px] text-text-secondary mt-0.5">{new Date(week + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-text-primary text-bg-primary text-[9px] px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">{hours.toFixed(1)}h</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AnalyticsScreen() {
  const { isDark, toggleTheme } = useTheme()
  const { data, metrics, resetData } = useTraining()
  const layout = useLayout()
  const [showReset, setShowReset] = useState(false)

  const monthlyHours = useMemo(() => {
    const months = new Map<string, number>()
    for (const log of data.dailyLogs) {
      const month = log.date.slice(0, 7)
      months.set(month, (months.get(month) ?? 0) + log.hours)
    }
    return Array.from(months.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [data.dailyLogs])

  const burndownData = useMemo(() => {
    const totalEst = metrics.totalEstimatedHours
    const currentRemaining = metrics.remainingEstimatedWork
    const workReduced = Math.max(0, totalEst - currentRemaining)
    const dailyHours = data.dailyLogs.reduce((acc, log) => {
      acc.set(log.date, (acc.get(log.date) ?? 0) + log.hours); return acc
    }, new Map<string, number>())
    const totalHoursLogged = data.dailyLogs.reduce((s, l) => s + l.hours, 0)
    const sortedDates = Array.from(dailyHours.keys()).sort()
    const points: number[] = [totalEst]
    let cumulativeReduction = 0
    for (const date of sortedDates) {
      const dayHours = dailyHours.get(date) ?? 0
      const dayReduction = totalHoursLogged > 0 ? workReduced * (dayHours / totalHoursLogged) : workReduced / sortedDates.length
      cumulativeReduction += dayReduction
      points.push(Math.max(totalEst - cumulativeReduction, currentRemaining))
    }
    if (points.length > 0) points[points.length - 1] = currentRemaining
    return points
  }, [data.dailyLogs, metrics.totalEstimatedHours, metrics.remainingEstimatedWork])

  const burnupData = useMemo(() => {
    const dailyHours = data.dailyLogs.reduce((acc, log) => {
      acc.set(log.date, (acc.get(log.date) ?? 0) + log.hours); return acc
    }, new Map<string, number>())
    const sortedDates = Array.from(dailyHours.keys()).sort()
    let cumulative = 0
    const points: number[] = [cumulative]
    for (const date of sortedDates) { cumulative += dailyHours.get(date) ?? 0; points.push(cumulative) }
    return points
  }, [data.dailyLogs])

  // Stat cards columns: based on layout columns * 2 for the 8 stat blocks
  const statCols = Math.min(layout.columns * 2, 8)

  return (
    <div className="space-y-5" style={{ gap: `${layout.sectionGap}px` }}>
      {/* Header */}
      <header className="r-card p-4 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-text-primary flex items-center justify-center"><BarChart3 size={18} className="text-bg-primary" /></div>
          <div><h1 className="r-text-h1 font-semibold text-text-primary">Analytics</h1><p className="r-text-tiny text-text-secondary hidden sm:block">Deep insights & trends</p></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="r-text-tiny text-text-secondary hidden sm:block">{data.dailyLogs.length} sessions</span>
          <button onClick={toggleTheme} className="relative w-12 h-6 rounded-full border border-border-color bg-bg-primary cursor-pointer hover:border-text-secondary flex-shrink-0">
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-text-primary flex items-center justify-center transition-all duration-200 ${isDark ? 'translate-x-6' : 'translate-x-0.5'}`}>
              {isDark ? <Moon size={10} className="text-bg-primary" /> : <Sun size={10} className="text-bg-primary" />}
            </span>
          </button>
        </div>
      </header>

      {/* Stats grid — columns derived from layout.columns */}
      <section
        className="grid gap-2 sm:gap-3"
        style={{
          gridTemplateColumns: `repeat(${statCols}, 1fr)`,
        }}
      >
        <StatBlock label="Sessions" value={String(data.dailyLogs.length)} icon={Clock} />
        <StatBlock label="Hours" value={metrics.totalHoursSpent.toFixed(1)} sublabel={`of ${metrics.totalEstimatedHours.toFixed(0)}h`} icon={Target} />
        <StatBlock label="Avg Daily" value={metrics.averageDailyHours.toFixed(2)} icon={TrendingUp} />
        <StatBlock label="Deep Work" value={metrics.deepWorkHours.toFixed(1)} sublabel="≥1.5h" icon={BrainCircuit} />
        <StatBlock label="Longest" value={`${metrics.longestSession.toFixed(1)}h`} icon={Sparkles} />
        <StatBlock label="Perfect Days" value={String(metrics.perfectDays)} icon={Award} />
        <StatBlock label="Partial" value={String(metrics.partialDays)} icon={TrendingDown} />
        <StatBlock label="Missed" value={String(metrics.missedDays)} icon={Calendar} />
      </section>

      {/* Burndown / Burnup — side-by-side when columns >= 2 */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: layout.columns >= 2 ? '1fr 1fr' : '1fr',
        }}
      >
        <div className="r-card r-p-card">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={12} className="text-text-secondary" />
            <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Burndown</span>
          </div>
          <div className="flex items-center justify-center overflow-hidden"><Sparkline data={burndownData} height={50} color="#dc2626" /></div>
          <div className="flex items-center justify-between r-text-tiny text-text-secondary mt-2">
            <span>Start: {metrics.totalEstimatedHours.toFixed(0)}h</span>
            <span>Remaining: {metrics.remainingEstimatedWork.toFixed(1)}h</span>
          </div>
        </div>
        <div className="r-card r-p-card">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={12} className="text-text-secondary" />
            <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Burnup</span>
          </div>
          <div className="flex items-center justify-center overflow-hidden"><Sparkline data={burnupData} height={50} color="#16a34a" /></div>
          <div className="flex items-center justify-between r-text-tiny text-text-secondary mt-2">
            <span>Completed: {metrics.totalHoursSpent.toFixed(1)}h</span>
            <span>Target: {metrics.totalEstimatedHours.toFixed(0)}h</span>
          </div>
        </div>
      </div>

      {/* Weekly chart */}
      <div className="r-card r-p-card"><WeeklyBarChart logs={data.dailyLogs} /></div>

      {/* Subject Distribution + Monthly Hours — side-by-side when columns >= 2 */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: layout.columns >= 2 ? '1fr 1fr' : '1fr',
        }}
      >
        <div className="r-card r-p-card">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={12} className="text-text-secondary" />
            <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Subject Distribution</span>
          </div>
          <div className="space-y-2">
            {metrics.moduleAnalytics.map(m => {
              const pct = metrics.totalHoursSpent > 0 ? (m.hours / metrics.totalHoursSpent) * 100 : 0
              return (
                <div key={m.id}>
                  <div className="flex items-center justify-between r-text-small mb-0.5">
                    <span className="text-text-primary truncate mr-2">{m.name}</span>
                    <span className="text-text-primary font-medium tabular-nums flex-shrink-0">{m.hours.toFixed(1)}h <span className="text-text-secondary">({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div className="r-progress rounded-full bg-border-color/60 overflow-hidden">
                    <div className="h-full rounded-full bg-text-primary transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="r-card r-p-card">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={12} className="text-text-secondary" />
            <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Monthly Hours</span>
          </div>
          {monthlyHours.length > 0 ? (
            <div className="space-y-1">
              {monthlyHours.map(([month, hours]) => {
                const maxH = Math.max(...monthlyHours.map(([, v]) => v))
                const pct = (hours / maxH) * 100
                return (
                  <div key={month} className="flex items-center gap-2">
                    <span className="r-text-tiny text-text-secondary w-20 sm:w-24 flex-shrink-0">
                      {new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                    <div className="flex-1 r-progress rounded-full bg-border-color/60 overflow-hidden">
                      <div className="h-full rounded-full bg-text-primary transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span className="r-text-tiny text-text-primary tabular-nums w-12 text-right font-medium">{hours.toFixed(1)}h</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-6"><Calendar size={20} className="mx-auto text-border-color mb-2" /><p className="r-text-small text-text-secondary">No monthly data yet</p></div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between pt-2 border-t border-border-color">
        <span className="r-text-tiny text-text-secondary">{data.dailyLogs.length} sessions</span>
        {!showReset ? (
          <button type="button" onClick={() => setShowReset(true)} className="flex items-center gap-1 r-text-tiny text-text-secondary hover:text-text-primary cursor-pointer"><RotateCcw size={10} /> Reset</button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="r-text-tiny text-red-500 dark:text-red-400 font-medium">Confirm?</span>
            <button type="button" onClick={() => { resetData(); setShowReset(false) }} className="r-text-tiny text-red-500 hover:text-red-600 cursor-pointer">Yes</button>
            <button type="button" onClick={() => setShowReset(false)} className="r-text-tiny text-text-secondary hover:text-text-primary cursor-pointer">Cancel</button>
          </div>
        )}
      </footer>
    </div>
  )
}
