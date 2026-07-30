/**
 * ForecastCards — Real-time animated prediction cards.
 * Shows three scenarios: stop now, +30min, finish target.
 * Updates live as timer runs.
 */

import { TrendingDown, Timer, Target, TrendingUp } from 'lucide-react'
import type { ForecastData } from '../types'

interface ForecastCardsProps {
  forecast: ForecastData
}

function ForecastCard({
  icon: Icon,
  label,
  value,
  description,
  color,
}: {
  icon: typeof TrendingUp
  label: string
  value: string
  description: string
  color: string
}) {
  return (
    <div
      className="rounded-xl border border-border-color bg-bg-card p-3 sm:p-4 transition-all duration-200 hover:shadow-sm hover:scale-[1.02] cursor-default"
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon size={12} style={{ color }} />
        </div>
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg font-bold text-text-primary tabular-nums tracking-tight">
        {value}
      </div>
      <p className="text-[10px] text-text-secondary mt-0.5">{description}</p>
    </div>
  )
}

export default function ForecastCards({ forecast }: ForecastCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {/* If user stops now */}
      <ForecastCard
        icon={TrendingDown}
        label="If You Stop Now"
        value={`${forecast.ifStopNow.toFixed(1)}h`}
        description={`Tomorrow's target: ${forecast.ifStopNow.toFixed(2)}h`}
        color="#dc2626"
      />

      {/* If user studies 30 more minutes */}
      <ForecastCard
        icon={Timer}
        label="+30 Minutes More"
        value={`${forecast.ifExtra30.toFixed(1)}h`}
        description={`Tomorrow's target: ${forecast.ifExtra30.toFixed(2)}h`}
        color="#ea580c"
      />

      {/* If user finishes target */}
      <ForecastCard
        icon={Target}
        label="Finish Today's Goal"
        value={`${forecast.ifFinishTarget.toFixed(1)}h`}
        description={`Tomorrow's target: ${forecast.ifFinishTarget.toFixed(2)}h`}
        color="#16a34a"
      />
    </div>
  )
}
