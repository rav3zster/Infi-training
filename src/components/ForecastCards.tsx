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
    <div className="r-card p-4 flex flex-col justify-between transition-all duration-200 hover:border-text-secondary/40 hover:shadow-md">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}18`, color }}
        >
          <Icon size={14} />
        </div>
        <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider truncate">{label}</span>
      </div>
      <div>
        <div className="text-xl sm:text-2xl font-extrabold text-text-primary tabular-nums tracking-tight">
          {value}
        </div>
        <p className="text-xs text-text-secondary mt-1 font-medium">{description}</p>
      </div>
    </div>
  )
}

export default function ForecastCards({ forecast }: ForecastCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* If user stops now */}
      <ForecastCard
        icon={TrendingDown}
        label="If You Stop Now"
        value={`${forecast.ifStopNow.toFixed(1)}h`}
        description={`Tomorrow's target: ${forecast.ifStopNow.toFixed(2)}h`}
        color="#f43f5e"
      />

      {/* If user studies 30 more minutes */}
      <ForecastCard
        icon={Timer}
        label="+30 Minutes More"
        value={`${forecast.ifExtra30.toFixed(1)}h`}
        description={`Tomorrow's target: ${forecast.ifExtra30.toFixed(2)}h`}
        color="#f97316"
      />

      {/* If user finishes target */}
      <ForecastCard
        icon={Target}
        label="Finish Today's Goal"
        value={`${forecast.ifFinishTarget.toFixed(1)}h`}
        description={`Tomorrow's target: ${forecast.ifFinishTarget.toFixed(2)}h`}
        color="#10b981"
      />
    </div>
  )
}
