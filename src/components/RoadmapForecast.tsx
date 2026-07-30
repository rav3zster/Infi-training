/**
 * RoadmapForecast — Premium completion forecast panel.
 * Shows current pace, estimated completion, buffer/delay, and catch-up suggestions.
 */

import { Calendar, TrendingUp, AlertTriangle, Clock, Sparkles, Gauge } from 'lucide-react'
import type { ForecastData } from '../types'

interface RoadmapForecastProps {
  forecast: ForecastData
  remainingHours: number
  daysRemaining: number
  overallProgress: number
}

export default function RoadmapForecast({
  forecast,
  remainingHours,
  daysRemaining,
  overallProgress,
}: RoadmapForecastProps) {
  const pace = daysRemaining > 0 ? remainingHours / daysRemaining : remainingHours

  return (
    <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center">
          <Gauge size={14} className="text-bg-primary" />
        </div>
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
          Roadmap Forecast
        </span>
        <div className={`ml-auto flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full
          ${forecast.isAhead
            ? 'text-green-600 bg-green-600/10 dark:text-green-400 dark:bg-green-400/10'
            : 'text-red-600 bg-red-600/10 dark:text-red-400 dark:bg-red-400/10'
          }`}
        >
          {forecast.isAhead ? <Sparkles size={10} /> : <AlertTriangle size={10} />}
          {forecast.isAhead ? 'Ahead of Schedule' : 'Behind Schedule'}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Current Pace */}
        <div className="p-2.5 rounded-lg bg-bg-primary border border-border-color/60">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={10} className="text-text-secondary" />
            <span className="text-[9px] text-text-secondary uppercase tracking-wider">Pace</span>
          </div>
          <span className="text-sm font-bold text-text-primary tabular-nums">{pace.toFixed(2)}h</span>
          <span className="text-[10px] text-text-secondary ml-0.5">/day</span>
        </div>

        {/* Estimated Completion */}
        <div className="p-2.5 rounded-lg bg-bg-primary border border-border-color/60">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar size={10} className="text-text-secondary" />
            <span className="text-[9px] text-text-secondary uppercase tracking-wider">Finish By</span>
          </div>
          <span className="text-[11px] font-semibold text-text-primary leading-tight block">
            {forecast.estimatedCompletionDate}
          </span>
        </div>

        {/* Buffer / Delay */}
        <div className={`p-2.5 rounded-lg border
          ${forecast.isAhead
            ? 'bg-green-600/5 border-green-600/20 dark:bg-green-400/5 dark:border-green-400/20'
            : 'bg-red-600/5 border-red-600/20 dark:bg-red-400/5 dark:border-red-400/20'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Clock size={10} className={forecast.isAhead ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} />
            <span className="text-[9px] text-text-secondary uppercase tracking-wider">
              {forecast.isAhead ? 'Buffer' : 'Delay'}
            </span>
          </div>
          <span className={`text-sm font-bold tabular-nums
            ${forecast.isAhead ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {forecast.isAhead ? forecast.daysBuffer : forecast.estimatedDelayDays}
          </span>
          <span className="text-[10px] text-text-secondary ml-0.5">days</span>
        </div>

        {/* Suggested Daily */}
        <div className="p-2.5 rounded-lg bg-bg-primary border border-border-color/60">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={10} className="text-text-secondary" />
            <span className="text-[9px] text-text-secondary uppercase tracking-wider">Need</span>
          </div>
          <span className="text-sm font-bold text-text-primary tabular-nums">
            {forecast.suggestedDailyHours.toFixed(1)}h
          </span>
          <span className="text-[10px] text-text-secondary ml-0.5">/day</span>
        </div>
      </div>

      {/* Progress bar with status */}
      <div className="mt-3 pt-3 border-t border-border-color">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Curriculum Progress</span>
          <span className="text-xs font-semibold text-text-primary tabular-nums">{overallProgress.toFixed(1)}%</span>
        </div>
        <div className="relative h-2 rounded-full bg-border-color/60 overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out
              ${forecast.isAhead ? 'bg-green-500' : 'bg-orange-500'}`}
            style={{ width: `${Math.min(overallProgress, 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
