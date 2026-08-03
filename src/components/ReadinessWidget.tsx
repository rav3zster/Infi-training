import { useMemo } from 'react'
import { Award, Zap } from 'lucide-react'
import { useTraining } from '../context/TrainingContext'
import { calculateReadinessScore } from '../engine/readinessEngine'

export default function ReadinessWidget() {
  const { data, metrics } = useTraining()

  const readiness = useMemo(
    () => calculateReadinessScore(data, metrics),
    [data, metrics],
  )

  const daysToJoining = metrics.daysRemaining

  const isReady = readiness.overallReadiness >= 75
  const isModerate = readiness.overallReadiness >= 40

  const statusBadge = isReady
    ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30'
    : isModerate
      ? 'text-amber-500 bg-amber-500/10 border-amber-500/30'
      : 'text-rose-500 bg-rose-500/10 border-rose-500/30'

  return (
    <div className="r-card r-p-card transition-all duration-200 hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Award size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-text-primary">Infosys Readiness Score</h3>
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border uppercase tracking-wider ${statusBadge}`}>
                {readiness.status.replace('-', ' ')}
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              Prep Target: <span className="text-text-primary font-semibold">Sept 21, 2026</span> ({daysToJoining} days remaining)
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-3xl font-extrabold text-text-primary tabular-nums tracking-tight">
            {readiness.overallReadiness}%
          </div>
          <p className="text-[11px] text-text-secondary font-semibold uppercase tracking-wider">Exam Readiness</p>
        </div>
      </div>

      {/* Main Readiness Gauge Bar */}
      <div className="relative h-2.5 rounded-full bg-border-color overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${
            isReady
              ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
              : isModerate
                ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                : 'bg-gradient-to-r from-rose-500 to-amber-500'
          }`}
          style={{ width: `${Math.min(readiness.overallReadiness, 100)}%` }}
        />
      </div>

      {/* FA1 (Java 45%), FA2 (SQL 40%), Generic (15%) Cards with Progress Bars */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {/* FA1 */}
        <div className="p-3 rounded-xl border border-border-color bg-bg-primary/60 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">FA1 (Java 45%)</span>
            <span className="text-sm font-extrabold text-text-primary tabular-nums">{readiness.fa1Score}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-border-color overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${Math.min(readiness.fa1Score, 100)}%` }} />
          </div>
        </div>

        {/* FA2 */}
        <div className="p-3 rounded-xl border border-border-color bg-bg-primary/60 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">FA2 (SQL 40%)</span>
            <span className="text-sm font-extrabold text-text-primary tabular-nums">{readiness.fa2Score}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-border-color overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full transition-all duration-700" style={{ width: `${Math.min(readiness.fa2Score, 100)}%` }} />
          </div>
        </div>

        {/* Generic */}
        <div className="p-3 rounded-xl border border-border-color bg-bg-primary/60 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Generic (15%)</span>
            <span className="text-sm font-extrabold text-text-primary tabular-nums">{readiness.genericScore}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-border-color overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${Math.min(readiness.genericScore, 100)}%` }} />
          </div>
        </div>
      </div>

      {/* Top Recommendation */}
      {readiness.recommendations.length > 0 && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-bg-primary/80 border border-border-color">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Zap size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-text-primary truncate">{readiness.recommendations[0].title}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-border-color/80 text-text-secondary uppercase tracking-wider">
                {readiness.recommendations[0].impact}
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">{readiness.recommendations[0].action}</p>
          </div>
        </div>
      )}
    </div>
  )
}
