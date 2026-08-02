import { useMemo } from 'react'
import { Award, Target } from 'lucide-react'
import { useTraining } from '../context/TrainingContext'
import { calculateReadinessScore } from '../engine/readinessEngine'

export default function ReadinessWidget() {
  const { data, metrics } = useTraining()

  const readiness = useMemo(
    () => calculateReadinessScore(data, metrics),
    [data, metrics],
  )

  const daysToJoining = metrics.daysRemaining

  const statusColor =
    readiness.overallReadiness >= 75
      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      : readiness.overallReadiness >= 40
        ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30'
        : 'text-text-secondary bg-border-color/30 border-border-color'

  return (
    <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-text-primary flex items-center justify-center">
            <Award size={16} className="text-bg-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
              Infosys Readiness Score
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border uppercase tracking-wider ${statusColor}`}>
                {readiness.status.replace('-', ' ')}
              </span>
            </h3>
            <p className="text-[11px] text-text-secondary">
              Prep target: <span className="text-text-primary font-medium">Sept 21, 2026</span> ({daysToJoining} days left)
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-extrabold text-text-primary tabular-nums tracking-tight">
            {readiness.overallReadiness}%
          </div>
          <p className="text-[10px] text-text-secondary font-medium">Exam Readiness</p>
        </div>
      </div>

      {/* Readiness gauge bar */}
      <div className="relative h-2 rounded-full bg-border-color/60 overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${
            readiness.overallReadiness >= 75
              ? 'bg-emerald-500'
              : readiness.overallReadiness >= 40
                ? 'bg-amber-500'
                : 'bg-text-primary'
          }`}
          style={{ width: `${Math.min(readiness.overallReadiness, 100)}%` }}
        />
      </div>

      {/* FA1 vs FA2 vs Generic Cards */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="p-2.5 rounded-lg border border-border-color/60 bg-bg-primary">
          <span className="text-[9px] font-medium text-text-secondary uppercase tracking-wider block">FA1 (Java 45%)</span>
          <span className="text-sm font-bold text-text-primary tabular-nums">{readiness.fa1Score}%</span>
        </div>
        <div className="p-2.5 rounded-lg border border-border-color/60 bg-bg-primary">
          <span className="text-[9px] font-medium text-text-secondary uppercase tracking-wider block">FA2 (SQL 40%)</span>
          <span className="text-sm font-bold text-text-primary tabular-nums">{readiness.fa2Score}%</span>
        </div>
        <div className="p-2.5 rounded-lg border border-border-color/60 bg-bg-primary">
          <span className="text-[9px] font-medium text-text-secondary uppercase tracking-wider block">Generic (15%)</span>
          <span className="text-sm font-bold text-text-primary tabular-nums">{readiness.genericScore}%</span>
        </div>
      </div>

      {/* Top Recommendation */}
      {readiness.recommendations.length > 0 && (
        <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-bg-primary border border-border-color/60">
          <div className="w-6 h-6 rounded-md bg-text-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Target size={12} className="text-text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-text-primary truncate">{readiness.recommendations[0].title}</span>
              <span className="text-[9px] font-semibold text-text-secondary uppercase">{readiness.recommendations[0].impact}</span>
            </div>
            <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">{readiness.recommendations[0].action}</p>
          </div>
        </div>
      )}
    </div>
  )
}
