import { useMemo } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useTraining } from '../context/TrainingContext'
import { useConfirm } from '../context/ConfirmContext'
import { useLayout } from '../App'
import TimeLogger from '../components/TimeLogger'
import { Sun, Moon, Clock, RotateCcw, History } from 'lucide-react'
import type { DailyLogEntry } from '../types'
import { formatDate } from '../data/curriculum'

function SessionHistoryTable({ logs }: { logs: DailyLogEntry[] }) {
  const groupedLogs = useMemo(() => {
    const groups = new Map<string, DailyLogEntry[]>()
    for (const log of logs) {
      const existing = groups.get(log.date) ?? []; existing.push(log); groups.set(log.date, existing)
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [logs])

  return (
    <div className="r-card r-p-card">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><History size={14} className="text-bg-primary" /></div>
        <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Session History</span>
        <span className="r-text-tiny text-text-secondary ml-auto">{logs.length} entries</span>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-8">
          <History size={24} className="mx-auto text-border-color mb-2" />
          <p className="r-text-small text-text-secondary">No study sessions logged yet.</p>
          <p className="r-text-tiny text-text-secondary mt-1">Use the logger above to record your first session.</p>
        </div>
      ) : (
        <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
          {groupedLogs.map(([date, entries]) => {
            const dateObj = new Date(date + 'T00:00:00')
            const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            // Compare using local dates (formatDate) — toISOString() is UTC and
            // would mislabel today in non-UTC timezones.
            const isToday = date === formatDate(new Date())
            const dayTotal = entries.reduce((s, e) => s + e.hours, 0)
            return (
              <div key={date}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`r-text-small font-medium ${isToday ? 'text-text-primary' : 'text-text-secondary'}`}>{isToday ? 'Today' : formattedDate}</span>
                  <span className="r-text-tiny text-text-secondary tabular-nums">{dayTotal.toFixed(1)}h total</span>
                </div>
                <div className="space-y-1">
                  {entries.map((entry, idx) => (
                    <div key={`${entry.date}-${entry.subtopicId}-${idx}`}
                      className="flex items-center justify-between px-3 py-2 rounded-md bg-bg-primary border border-border-color/50">
                      <div className="flex items-center gap-2 min-w-0">
                        <Clock size={11} className="text-text-secondary flex-shrink-0" />
                        <span className="r-text-small text-text-primary truncate">{entry.subtopicName}</span>
                      </div>
                      <span className="r-text-small font-medium text-text-primary tabular-nums flex-shrink-0 ml-2">{entry.hours.toFixed(1)}h</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function LogWorkScreen() {
  const { isDark, toggleTheme } = useTheme()
  const { data, metrics, resetLogs } = useTraining()
  const confirm = useConfirm()
  const layout = useLayout()

  return (
    <div className="space-y-6" style={{ gap: `${layout.sectionGap}px` }}>
      {/* Header */}
      <header className="r-card p-4 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-text-primary flex items-center justify-center"><Clock size={18} className="text-bg-primary" /></div>
          <div><h1 className="r-text-h1 font-semibold text-text-primary">Log Work</h1><p className="r-text-small text-text-secondary hidden sm:block">Record your study sessions</p></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="r-text-small font-medium text-text-primary">{metrics.todayHours.toFixed(1)}h today</div>
            <div className="r-text-tiny text-text-secondary">Target: {metrics.adaptiveDailyTarget.toFixed(1)}h</div>
          </div>
          <button onClick={toggleTheme} className="relative w-12 h-6 rounded-full border border-border-color bg-bg-primary cursor-pointer hover:border-text-secondary flex-shrink-0">
            <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-text-primary flex items-center justify-center transition-all duration-200 ${isDark ? 'translate-x-6' : 'translate-x-0.5'}`}>
              {isDark ? <Moon size={10} className="text-bg-primary" /> : <Sun size={10} className="text-bg-primary" />}
            </span>
          </button>
        </div>
      </header>

      {/* Logger + History — side-by-side on spacious layouts */}
      <div
        className={layout.isSpacious ? 'grid' : 'space-y-6'}
        style={{
          gridTemplateColumns: layout.isSpacious ? '1fr 1fr' : undefined,
          gap: layout.isSpacious ? `${layout.cardGap}px` : undefined,
        }}
      >
        <TimeLogger />
        <SessionHistoryTable logs={data.dailyLogs} />
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between pt-4 border-t border-border-color">
        <span className="r-text-tiny text-text-secondary">{data.dailyLogs.length} total sessions</span>
        <button type="button" onClick={async () => {
          const ok = await confirm({
            title: 'Clear all study logs?',
            message: 'All logged sessions will be removed. Your curriculum progress will be kept.',
            confirmLabel: 'Clear Logs',
            danger: true,
          })
          if (ok) resetLogs()
        }}
          className="flex items-center gap-1 r-text-tiny text-text-secondary hover:text-text-primary transition-colors cursor-pointer"><RotateCcw size={10} /> Clear Logs</button>
      </footer>
    </div>
  )
}
