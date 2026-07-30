/**
 * MotivationalInsights — Premium intelligent insight cards.
 * Shows positive, warning, suggestion, and milestone messages.
 */

import { TrendingUp, AlertTriangle, Lightbulb, Flame, Sparkles, Award, Target, BarChart3, BrainCircuit } from 'lucide-react'
import type { MotivationalInsight } from '../types'

interface MotivationalInsightsProps {
  insights: MotivationalInsight[]
}

const ICON_MAP: Record<string, typeof Sparkles> = {
  TrendingUp, AlertTriangle, Lightbulb, Flame, Sparkles, Award, Target, BarChart3, BrainCircuit,
}

const TYPE_STYLES: Record<string, { bg: string; border: string; iconColor: string }> = {
  positive: {
    bg: 'bg-green-500/5 dark:bg-green-400/5',
    border: 'border-green-500/20 dark:border-green-400/20',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  warning: {
    bg: 'bg-red-500/5 dark:bg-red-400/5',
    border: 'border-red-500/20 dark:border-red-400/20',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  suggestion: {
    bg: 'bg-orange-500/5 dark:bg-orange-400/5',
    border: 'border-orange-500/20 dark:border-orange-400/20',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  milestone: {
    bg: 'bg-purple-500/5 dark:bg-purple-400/5',
    border: 'border-purple-500/20 dark:border-purple-400/20',
    iconColor: 'text-purple-600 dark:text-purple-400',
  },
}

export default function MotivationalInsights({ insights }: MotivationalInsightsProps) {
  if (insights.length === 0) return null

  return (
    <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center">
          <BrainCircuit size={14} className="text-bg-primary" />
        </div>
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
          Insights
        </span>
      </div>

      <div className="space-y-2">
        {insights.map(insight => {
          const IconComponent = ICON_MAP[insight.icon] || Sparkles
          const styles = TYPE_STYLES[insight.type] || TYPE_STYLES.positive

          return (
            <div
              key={insight.id}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${styles.bg} ${styles.border}
                transition-all duration-200 hover:scale-[1.01] animate-fade-in`}
            >
              <div className={`mt-0.5 flex-shrink-0 ${styles.iconColor}`}>
                <IconComponent size={14} />
              </div>
              <p className="text-xs text-text-primary leading-relaxed">{insight.message}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
