/**
 * TimeDistribution — Premium stacked bar chart showing time by session type.
 * Four views: Today, Week, Month, Lifetime.
 */

import { useState } from 'react'
import { Clock, TrendingUp } from 'lucide-react'
import type { TimeDistribution as TimeDist } from '../types'

interface TimeDistributionProps {
  today: TimeDist
  weekly: TimeDist
  monthly: TimeDist
  lifetime: TimeDist
  todayHours: number
  targetHours: number
}

type ViewKey = 'today' | 'weekly' | 'monthly' | 'lifetime'

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'weekly', label: 'This Week' },
  { key: 'monthly', label: 'This Month' },
  { key: 'lifetime', label: 'All Time' },
]

const LABELS: Record<string, string> = {
  learning: 'Learning',
  coding: 'Coding',
  revision: 'Revision',
  mock: 'Mock Tests',
  project: 'Projects',
  break: 'Breaks',
}

const COLORS: Record<string, string> = {
  learning: '#000000',
  coding: '#333333',
  revision: '#555555',
  mock: '#777777',
  project: '#999999',
  break: '#cccccc',
}

export default function TimeDistribution({
  today, weekly, monthly, lifetime, todayHours, targetHours,
}: TimeDistributionProps) {
  const [activeView, setActiveView] = useState<ViewKey>('today')

  const dataMap: Record<ViewKey, TimeDist> = {
    today, weekly, monthly, lifetime,
  }

  const currentData = dataMap[activeView]
  const total = Object.values(currentData).reduce((s, v) => s + v, 0)
  const pct = targetHours > 0 ? Math.min((todayHours / targetHours) * 100, 100) : 0

  // Get entries sorted by value descending (non-zero first)
  const entries = Object.entries(currentData)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center">
          <Clock size={14} className="text-bg-primary" />
        </div>
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
          Time Distribution
        </span>
        <span className="text-[10px] text-text-secondary ml-auto tabular-nums">
          {total.toFixed(1)}h total
        </span>
      </div>

      {/* View switcher */}
      <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
        {VIEWS.map(v => (
          <button
            key={v.key}
            type="button"
            onClick={() => setActiveView(v.key)}
            className={`px-2.5 py-1 text-[10px] rounded-md font-medium transition-all duration-150 cursor-pointer whitespace-nowrap
              ${activeView === v.key
                ? 'bg-text-primary text-bg-primary'
                : 'text-text-secondary hover:text-text-primary bg-bg-primary border border-border-color/60'
              }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Bar chart */}
      {total > 0 ? (
        <div className="space-y-2">
          {entries.map(([key, value]) => {
            const pctOfTotal = (value / total) * 100
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: COLORS[key] || '#000' }}
                    />
                    <span className="text-[11px] text-text-primary">
                      {LABELS[key] || key}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-text-primary tabular-nums">
                      {value.toFixed(1)}h
                    </span>
                    <span className="text-[9px] text-text-secondary w-8 text-right">
                      {pctOfTotal.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-border-color/60 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.min(pctOfTotal, 100)}%`,
                      backgroundColor: COLORS[key] || '#000',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-6">
          <TrendingUp size={20} className="mx-auto text-border-color mb-2" />
          <p className="text-xs text-text-secondary">No time data yet.</p>
          <p className="text-[10px] text-text-secondary mt-0.5">Log your first study session to see distribution.</p>
        </div>
      )}

      {/* Target hours vs actual */}
      {activeView === 'today' && total > 0 && (
        <div className="mt-3 pt-3 border-t border-border-color">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-text-secondary">Today's progress vs target</span>
            <span className="text-text-primary font-medium tabular-nums">
              {total.toFixed(1)}h / {targetHours.toFixed(1)}h
            </span>
          </div>
          <div className="relative h-1.5 rounded-full bg-border-color/60 overflow-hidden mt-1">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${Math.min(pct, 100)}%`,
                background: pct >= 100
                  ? 'linear-gradient(90deg, #16a34a, #22c55e)'
                  : pct >= 50
                    ? 'linear-gradient(90deg, #ea580c, #f59e0b)'
                    : 'linear-gradient(90deg, #dc2626, #ef4444)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
