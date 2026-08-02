/**
 * StudyHeatmap — GitHub-style 90-day study intensity grid.
 * Columns are weeks, rows are days (Mon–Sun). Intensity 0–4 grayscale.
 */

import { useMemo, useState } from 'react'
import { Flame } from 'lucide-react'
import type { HeatmapData } from '../types'

interface StudyHeatmapProps {
  data: HeatmapData[]
}

const INTENSITY_STYLES: Record<number, string> = {
  0: 'bg-border-color/30',
  1: 'bg-text-secondary/25',
  2: 'bg-text-secondary/50',
  3: 'bg-text-primary/70',
  4: 'bg-text-primary',
}

function intensityLabel(intensity: number): string {
  if (intensity === 0) return 'No study'
  if (intensity === 1) return 'Light (≤ 0.5h)'
  if (intensity === 2) return 'Moderate (≤ 1.5h)'
  if (intensity === 3) return 'Strong (≤ 3h)'
  return 'Intense (3h+)'
}

export default function StudyHeatmap({ data }: StudyHeatmapProps) {
  const [hovered, setHovered] = useState<HeatmapData | null>(null)

  // Group into weeks: each week is 7 cells starting on Monday.
  // The last cell of each week is Sunday.
  const weeks = useMemo(() => {
    const cells: (HeatmapData | null)[] = []
    // 90 days starting from oldest. Align so that day 0 of the grid is Monday.
    const firstDate = new Date(data[0]?.date + 'T00:00:00')
    const offset = (firstDate.getDay() + 6) % 7 // days since Monday
    for (let i = 0; i < offset; i++) cells.push(null)
    for (const d of data) cells.push(d)
    // Pad the tail to complete the last week
    while (cells.length % 7 !== 0) cells.push(null)

    const weeks: (HeatmapData | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7))
    }
    return weeks
  }, [data])

  const totalHours = useMemo(() => data.reduce((s, d) => s + d.hours, 0), [data])
  const activeDays = useMemo(() => data.filter(d => d.hours > 0).length, [data])

  // Month labels along the top
  const monthLabels = useMemo(() => {
    const labels: { index: number; label: string }[] = []
    weeks.forEach((week, wi) => {
      const cell = week.find(Boolean)
      if (!cell) return
      const d = new Date(cell.date + 'T00:00:00')
      const month = d.toLocaleDateString('en-US', { month: 'short' })
      const prev = labels[labels.length - 1]
      if (!prev || prev.label !== month) {
        labels.push({ index: wi, label: month })
      }
    })
    return labels
  }, [weeks])

  return (
    <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center">
          <Flame size={14} className="text-bg-primary" />
        </div>
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
          Study Heatmap
        </span>
        <span className="text-[10px] text-text-secondary ml-auto tabular-nums">
          {totalHours.toFixed(1)}h · {activeDays} active days
        </span>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-max">
          {/* Month labels — absolutely positioned at week index × column pitch (13px + 2px gap) */}
          <div className="relative mb-1 h-3" style={{ marginLeft: 24 }}>
            {monthLabels.map(({ index, label }) => (
              <span
                key={`${index}-${label}`}
                className="absolute top-0 text-[8px] text-text-secondary whitespace-nowrap pointer-events-none"
                style={{ left: index * 15 }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap: 2 }}>
            {/* Day-of-week gutter */}
            <div className="flex flex-col mr-1" style={{ gap: 2 }}>
              {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((d, i) => (
                <span key={i} className="text-[7px] text-text-secondary h-[13px] leading-[13px] w-5 flex-shrink-0">
                  {d}
                </span>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: 2 }}>
                {week.map((cell, di) =>
                  cell ? (
                    <div
                      key={cell.date}
                      onMouseEnter={() => setHovered(cell)}
                      onMouseLeave={() => setHovered(null)}
                      className={`w-[13px] h-[13px] rounded-[3px] ${INTENSITY_STYLES[cell.intensity]}
                        transition-all duration-150 hover:scale-125 hover:ring-1 hover:ring-text-primary/40 cursor-pointer`}
                      title={`${cell.date}: ${cell.hours.toFixed(1)}h`}
                    />
                  ) : (
                    <div key={`empty-${wi}-${di}`} className="w-[13px] h-[13px] rounded-[3px] bg-transparent" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend + tooltip */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-text-secondary mr-1">Less</span>
          {[0, 1, 2, 3, 4].map(level => (
            <div key={level} className={`w-[11px] h-[11px] rounded-[2px] ${INTENSITY_STYLES[level]}`} />
          ))}
          <span className="text-[9px] text-text-secondary ml-1">More</span>
        </div>
        {hovered && (
          <span className="text-[10px] text-text-primary tabular-nums animate-fade-in">
            {hovered.date}: <strong>{hovered.hours.toFixed(1)}h</strong> · {intensityLabel(hovered.intensity)}
          </span>
        )}
      </div>
    </div>
  )
}
