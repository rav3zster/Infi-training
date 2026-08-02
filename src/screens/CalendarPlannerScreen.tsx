import { useMemo } from 'react'
import { Calendar, Clock, Flag } from 'lucide-react'
import { useTraining } from '../context/TrainingContext'
import { JOINING_DATE, formatDate } from '../engine/adaptiveEngine'

export default function CalendarPlannerScreen() {
  const { data, metrics } = useTraining()

  const daysRemaining = metrics.daysRemaining
  const remainingHours = metrics.remainingHours
  const dailyTarget = Math.round(metrics.adaptiveDailyTarget * 100) / 100

  const schedule = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const list: Array<{
      dateStr: string
      displayDate: string
      dayOfWeek: string
      targetHours: number
      moduleFocus: string
      isJoiningDay: boolean
      isPast: boolean
      isToday: boolean
    }> = []

    let currentWork = remainingHours
    const uncompletedModules = data.modules.filter(m => {
      const analytics = metrics.moduleAnalytics.find(ma => ma.id === m.id)
      return (analytics?.masteryPercentage ?? 0) < 100
    })

    let modIdx = 0

    for (let i = 0; i <= Math.min(daysRemaining, 60); i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)

      const dateStr = formatDate(d)
      const isToday = i === 0
      const isJoiningDay = d.getTime() >= JOINING_DATE.getTime() - 86400000 && d.getTime() <= JOINING_DATE.getTime() + 86400000

      const activeMod = uncompletedModules[modIdx % Math.max(1, uncompletedModules.length)]
      const moduleFocus = activeMod ? activeMod.name : 'Revision & Mock Exams'

      if (i > 0 && i % 14 === 0 && uncompletedModules.length > 1) {
        modIdx++
      }

      list.push({
        dateStr,
        displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dayOfWeek: d.toLocaleDateString('en-US', { weekday: 'short' }),
        targetHours: dailyTarget,
        moduleFocus,
        isJoiningDay,
        isPast: false,
        isToday,
      })

      currentWork = Math.max(0, currentWork - dailyTarget)
    }

    return list
  }, [daysRemaining, remainingHours, dailyTarget, data.modules, metrics.moduleAnalytics])

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-border-color bg-bg-card p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-text-primary flex items-center justify-center">
              <Calendar size={20} className="text-bg-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">Infosys Joining Planner</h1>
              <p className="text-xs text-text-secondary">Target Joining Date: <span className="font-semibold text-text-primary">September 21, 2026</span></p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-2xl font-extrabold text-text-primary tabular-nums tracking-tight">{daysRemaining}</span>
              <span className="text-[10px] text-text-secondary font-medium block">Days Left</span>
            </div>
            <div className="w-px h-8 bg-border-color" />
            <div className="text-right">
              <span className="text-2xl font-extrabold text-text-primary tabular-nums tracking-tight">{dailyTarget}h</span>
              <span className="text-[10px] text-text-secondary font-medium block">Daily Target</span>
            </div>
          </div>
        </div>
      </div>

      {/* Module Timeline Roadmap */}
      <div className="rounded-xl border border-border-color bg-bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Flag size={14} className="text-text-primary" />
          Module Milestone Allocation
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {metrics.moduleAnalytics.map((mod, idx) => (
            <div key={mod.id} className="p-3.5 rounded-lg border border-border-color bg-bg-primary space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Phase {idx + 1}</span>
                <span className="text-xs font-bold text-text-primary tabular-nums">{mod.masteryPercentage}%</span>
              </div>
              <h4 className="text-xs font-semibold text-text-primary truncate">{mod.name}</h4>
              <div className="relative h-1.5 rounded-full bg-border-color/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-text-primary transition-all duration-500"
                  style={{ width: `${mod.masteryPercentage}%` }}
                />
              </div>
              <p className="text-[10px] text-text-secondary">
                {mod.completedSubtopics} / {mod.totalSubtopics} subtopics · {mod.hours}h spent
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Daily Planner Schedule */}
      <div className="rounded-xl border border-border-color bg-bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Clock size={14} className="text-text-primary" />
            Upcoming Daily Schedule (Target Sept 21)
          </h3>
          <span className="text-xs text-text-secondary font-medium">{schedule.length} Days View</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[500px] overflow-y-auto pr-1">
          {schedule.map(day => (
            <div
              key={day.dateStr}
              className={`p-3 rounded-lg border transition-all duration-150 ${
                day.isJoiningDay
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : day.isToday
                    ? 'border-text-primary bg-text-primary/5'
                    : 'border-border-color/60 bg-bg-primary'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-text-primary">{day.displayDate}</span>
                  <span className="text-[10px] text-text-secondary font-medium">({day.dayOfWeek})</span>
                </div>
                {day.isJoiningDay ? (
                  <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20">
                    Joining Day 🎉
                  </span>
                ) : day.isToday ? (
                  <span className="text-[9px] font-bold text-text-primary uppercase tracking-wider px-1.5 py-0.5 rounded bg-text-primary/10">
                    Today
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-text-primary tabular-nums">
                    {day.targetHours}h
                  </span>
                )}
              </div>

              <p className="text-[11px] text-text-secondary truncate">{day.moduleFocus}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
