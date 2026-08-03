import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useTraining } from '../context/TrainingContext'
import { useConfirm } from '../context/ConfirmContext'
import { useLayout } from '../App'
import TimeLogger from '../components/TimeLogger'
import {
  Sun, Moon, Clock, RotateCcw, History, Pencil, Trash2,
  Lock, ChevronDown, Check, X, Undo2, CalendarDays, Zap,
} from 'lucide-react'
import type { DailyLogEntry, SessionType } from '../types'
import { formatDate } from '../data/curriculum'

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const SOURCE_LABELS: Record<string, string> = {
  timer: 'Timer',
  completion: 'Auto',
  manual: 'Manual',
}

const TYPE_COLORS: Record<SessionType, string> = {
  learning: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  coding:   'bg-violet-500/10 text-violet-400 border-violet-500/20',
  revision: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  mock:     'bg-red-500/10 text-red-400 border-red-500/20',
  project:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  break:    'bg-gray-500/10 text-gray-400 border-gray-500/20',
}

// ─── Undo Toast ──────────────────────────────────────────────────────────────

interface UndoToastProps {
  message: string
  onUndo: () => void
  onDismiss: () => void
}
function UndoToast({ message, onUndo, onDismiss }: UndoToastProps) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-in-bottom">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border-color bg-bg-card shadow-xl shadow-black/20">
        <span className="r-text-small text-text-primary">{message}</span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md r-text-tiny font-medium
            bg-text-primary text-bg-primary hover:opacity-80 transition-opacity cursor-pointer"
        >
          <Undo2 size={11} />
          Undo
        </button>
        <button onClick={onDismiss} className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── Edit Log Modal ──────────────────────────────────────────────────────────

interface EditLogModalProps {
  log: DailyLogEntry
  topicGroups: { moduleId: string; moduleName: string; subtopics: { id: string; name: string; topicName: string }[] }[]
  onSave: (patch: { hours: number; subtopicId: string; date: string }) => void
  onClose: () => void
}

function EditLogModal({ log, topicGroups, onSave, onClose }: EditLogModalProps) {
  const [hours, setHours] = useState(String(log.hours))
  const [subtopicId, setSubtopicId] = useState(log.subtopicId)
  const [date, setDate] = useState(log.date)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const selectedName = useMemo(() => {
    for (const g of topicGroups) {
      const st = g.subtopics.find(s => s.id === subtopicId)
      if (st) return st.name
    }
    return log.subtopicName
  }, [subtopicId, topicGroups, log.subtopicName])

  const hoursNum = parseFloat(hours)
  const valid = !isNaN(hoursNum) && hoursNum > 0 && hoursNum <= 24 && date.length === 10

  const handleSave = () => {
    if (!valid) return
    onSave({ hours: hoursNum, subtopicId, date })
    onClose()
  }

  // Close on backdrop click
  const backdropRef = useRef<HTMLDivElement>(null)
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="w-full max-w-md mx-4 mb-4 sm:mb-0 animate-slide-in-bottom rounded-2xl border border-border-color bg-bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
          <div className="flex items-center gap-2">
            <Pencil size={15} className="text-text-secondary" />
            <span className="r-text-small font-semibold text-text-primary">Edit Session</span>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Subtopic selector */}
          <div className="relative">
            <label className="block r-text-tiny text-text-secondary mb-1.5 uppercase tracking-wider">Subtopic</label>
            <button
              type="button"
              onClick={() => setDropdownOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border-color
                bg-bg-primary text-text-primary hover:border-text-secondary transition-colors cursor-pointer r-text-small"
            >
              <span className="truncate">{selectedName}</span>
              <ChevronDown size={14} className={`text-text-secondary flex-shrink-0 ml-2 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-border-color bg-bg-card shadow-xl max-h-56 overflow-y-auto">
                  {topicGroups.map(g => (
                    <div key={g.moduleId}>
                      <div className="px-3 py-1.5 r-text-tiny uppercase tracking-wider text-text-secondary bg-bg-primary border-b border-border-color font-medium">
                        {g.moduleName}
                      </div>
                      {g.subtopics.map(st => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => { setSubtopicId(st.id); setDropdownOpen(false) }}
                          className={`w-full text-left px-3 py-2 r-text-small flex items-center justify-between
                            border-b border-border-color last:border-b-0 hover:bg-bg-primary transition-colors cursor-pointer
                            ${subtopicId === st.id ? 'bg-bg-primary font-medium' : ''}`}
                        >
                          <span className="text-text-primary">{st.name}</span>
                          {subtopicId === st.id && <Check size={13} className="text-text-secondary flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Hours */}
          <div>
            <label className="block r-text-tiny text-text-secondary mb-1.5 uppercase tracking-wider">Duration (hours)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0.1"
                max="24"
                step="0.25"
                value={hours}
                onChange={e => setHours(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                className="flex-1 px-3 py-2.5 rounded-lg border border-border-color bg-bg-primary text-text-primary
                  r-text-small focus:outline-none focus:ring-1 focus:ring-text-primary transition-colors
                  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <div className="flex gap-1">
                {[0.5, 1, 1.5, 2].map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setHours(String(q))}
                    className={`px-2 py-2.5 rounded-lg r-text-tiny border transition-all cursor-pointer
                      ${parseFloat(hours) === q
                        ? 'bg-text-primary text-bg-primary border-text-primary'
                        : 'border-border-color text-text-secondary hover:border-text-secondary'}`}
                  >
                    {q}h
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block r-text-tiny text-text-secondary mb-1.5 uppercase tracking-wider">Date</label>
            <input
              type="date"
              value={date}
              max={formatDate(new Date())}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border-color bg-bg-primary text-text-primary
                r-text-small focus:outline-none focus:ring-1 focus:ring-text-primary transition-colors cursor-pointer"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-border-color text-text-secondary
              r-text-small hover:text-text-primary hover:border-text-secondary transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!valid}
            className="flex-1 px-4 py-2.5 rounded-lg bg-text-primary text-bg-primary r-text-small font-medium
              hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Log Row ─────────────────────────────────────────────────────────────────

interface LogRowProps {
  entry: DailyLogEntry
  studyType?: SessionType
  onEdit: (log: DailyLogEntry) => void
  onDelete: (log: DailyLogEntry) => void
}

function LogRow({ entry, studyType, onEdit, onDelete }: LogRowProps) {
  const isLocked = entry.source === 'completion'
  const typeKey = (studyType ?? 'learning') as SessionType
  const typeColorClass = TYPE_COLORS[typeKey] ?? TYPE_COLORS.learning

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg bg-bg-primary border border-border-color/50
      hover:border-border-color transition-all duration-150">

      {/* Left: name + badges */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="r-text-small text-text-primary font-medium truncate max-w-[180px] sm:max-w-none">
            {entry.subtopicName}
          </span>
          {isLocked && (
            <span title="Auto-credited on topic completion" className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border
              bg-border-color/30 text-text-secondary border-border-color">
              <Lock size={8} />
              Auto
            </span>
          )}
          {!isLocked && entry.source && (
            <span className="px-1.5 py-0.5 rounded text-[9px] border bg-border-color/20 text-text-secondary border-border-color">
              {SOURCE_LABELS[entry.source] ?? entry.source}
            </span>
          )}
          {studyType && studyType !== 'learning' && (
            <span className={`px-1.5 py-0.5 rounded text-[9px] border ${typeColorClass}`}>
              {studyType.charAt(0).toUpperCase() + studyType.slice(1)}
            </span>
          )}
        </div>
      </div>

      {/* Right: hours + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="r-text-small font-semibold text-text-primary tabular-nums">
          {entry.hours.toFixed(1)}h
        </span>
        {!isLocked && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 sm:opacity-100 transition-opacity">
            <button
              onClick={() => onEdit(entry)}
              title="Edit session"
              className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-card
                border border-transparent hover:border-border-color transition-all cursor-pointer"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => onDelete(entry)}
              title="Delete session"
              className="p-1.5 rounded-md text-text-secondary hover:text-red-400 hover:bg-red-500/5
                border border-transparent hover:border-red-500/20 transition-all cursor-pointer"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Session History ──────────────────────────────────────────────────────────

interface SessionHistoryProps {
  logs: DailyLogEntry[]
  sessionTypeMap: Map<string, SessionType>
  onEdit: (log: DailyLogEntry) => void
  onDelete: (log: DailyLogEntry) => void
}

function SessionHistory({ logs, sessionTypeMap, onEdit, onDelete }: SessionHistoryProps) {
  const userLogs = logs.filter(l => l.source !== 'completion')
  const completionLogs = logs.filter(l => l.source === 'completion')
  const [showCompletion, setShowCompletion] = useState(false)

  const allVisible = showCompletion ? logs : userLogs

  const grouped = useMemo(() => {
    const groups = new Map<string, DailyLogEntry[]>()
    for (const log of allVisible) {
      const arr = groups.get(log.date) ?? []
      arr.push(log)
      groups.set(log.date, arr)
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [allVisible])

  const today = formatDate(new Date())

  return (
    <div className="r-card r-p-card flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center flex-shrink-0">
          <History size={14} className="text-bg-primary" />
        </div>
        <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Session History</span>
        <span className="r-text-tiny text-text-secondary ml-auto tabular-nums">
          {userLogs.length} session{userLogs.length !== 1 ? 's' : ''}
          {completionLogs.length > 0 && ` · ${completionLogs.length} auto`}
        </span>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-10">
          <History size={24} className="mx-auto text-border-color mb-3" />
          <p className="r-text-small text-text-secondary">No sessions logged yet.</p>
          <p className="r-text-tiny text-text-secondary mt-1 opacity-60">
            Use the timer or manual quick-log to record your first session.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4 max-h-[520px] overflow-y-auto pr-0.5">
            {grouped.map(([date, entries]) => {
              const isToday = date === today
              const dayTotal = entries.reduce((s, e) => s + e.hours, 0)
              return (
                <div key={date} className="space-y-1.5">
                  {/* Date header */}
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <CalendarDays size={11} className="text-text-secondary" />
                      <span className={`r-text-small font-semibold ${isToday ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {isToday ? 'Today' : fmtDate(date)}
                      </span>
                    </div>
                    <span className="r-text-tiny text-text-secondary tabular-nums">{dayTotal.toFixed(1)}h</span>
                  </div>
                  {/* Rows */}
                  {[...entries].reverse().map(entry => (
                    <LogRow
                      key={entry.id}
                      entry={entry}
                      studyType={sessionTypeMap.get(entry.id)}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              )
            })}
          </div>

          {/* Toggle auto-credited logs */}
          {completionLogs.length > 0 && (
            <button
              onClick={() => setShowCompletion(s => !s)}
              className="flex items-center gap-1.5 r-text-tiny text-text-secondary hover:text-text-primary
                transition-colors cursor-pointer pt-1 border-t border-border-color"
            >
              <Lock size={10} />
              {showCompletion ? 'Hide' : 'Show'} {completionLogs.length} auto-credited {completionLogs.length === 1 ? 'entry' : 'entries'}
              <ChevronDown size={11} className={`ml-auto transition-transform ${showCompletion ? 'rotate-180' : ''}`} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function LogWorkScreen() {
  const { isDark, toggleTheme } = useTheme()
  const { data, metrics, updateLog, deleteLog, resetLogs } = useTraining()
  const confirm = useConfirm()
  const layout = useLayout()

  // Edit modal state
  const [editingLog, setEditingLog] = useState<DailyLogEntry | null>(null)

  // Undo state — we stage deletes here for 5 s before committing
  const [pendingUndo, setPendingUndo] = useState<{
    log: DailyLogEntry
    timeoutId: number
  } | null>(null)
  const undoHandled = useRef(false)

  // Build a map from log id → session type using studySessions
  const sessionTypeMap = useMemo(() => {
    const map = new Map<string, SessionType>()
    for (const s of data.studySessions ?? []) {
      // Match by id (preferred) or by subtopicId+date fallback
      map.set(s.id, s.type)
    }
    // Also try matching logs whose id equals session id
    for (const log of data.dailyLogs) {
      if (!map.has(log.id)) {
        const session = (data.studySessions ?? []).find(
          s => s.subtopicId === log.subtopicId && s.date === log.date
        )
        if (session) map.set(log.id, session.type)
      }
    }
    return map
  }, [data.dailyLogs, data.studySessions])

  // Topic groups for the edit modal dropdown
  const topicGroups = useMemo(() => {
    return data.modules.map(m => ({
      moduleId: m.id,
      moduleName: m.name,
      subtopics: m.topics.flatMap(t =>
        t.subtopics.map(st => ({
          id: st.id,
          name: st.name,
          topicName: `${m.name} › ${t.name}`,
        }))
      ),
    }))
  }, [data.modules])

  // Commit a pending delete (called after 5s or on unmount)
  const commitDelete = useCallback((log: DailyLogEntry) => {
    deleteLog(log.id)
  }, [deleteLog])

  const handleDeleteClick = useCallback((log: DailyLogEntry) => {
    // Clear any previous pending undo first
    if (pendingUndo) {
      clearTimeout(pendingUndo.timeoutId)
      commitDelete(pendingUndo.log)
    }
    undoHandled.current = false
    const timeoutId = window.setTimeout(() => {
      if (!undoHandled.current) {
        commitDelete(log)
      }
      setPendingUndo(null)
    }, 5000)
    setPendingUndo({ log, timeoutId })
  }, [pendingUndo, commitDelete])

  const handleUndo = useCallback(() => {
    if (!pendingUndo) return
    undoHandled.current = true
    clearTimeout(pendingUndo.timeoutId)
    setPendingUndo(null)
  }, [pendingUndo])

  const handleDismissUndo = useCallback(() => {
    if (!pendingUndo) return
    clearTimeout(pendingUndo.timeoutId)
    commitDelete(pendingUndo.log)
    setPendingUndo(null)
  }, [pendingUndo, commitDelete])

  // Flush pending delete on unmount
  useEffect(() => {
    return () => {
      if (pendingUndo && !undoHandled.current) {
        clearTimeout(pendingUndo.timeoutId)
        commitDelete(pendingUndo.log)
      }
    }
  }, [pendingUndo, commitDelete])

  // Logs with pending-delete row hidden optimistically
  const visibleLogs = useMemo(() => {
    if (!pendingUndo) return data.dailyLogs
    return data.dailyLogs.filter(l => l.id !== pendingUndo.log.id)
  }, [data.dailyLogs, pendingUndo])

  const handleEdit = useCallback((log: DailyLogEntry) => {
    setEditingLog(log)
  }, [])

  const handleSaveEdit = useCallback((patch: { hours: number; subtopicId: string; date: string }) => {
    if (editingLog) {
      updateLog(editingLog.id, patch)
      setEditingLog(null)
    }
  }, [editingLog, updateLog])

  return (
    <div className="space-y-6 animate-fade-in" style={{ gap: `${layout.sectionGap}px` }}>

      {/* ── Header ── */}
      <header className="r-card p-4 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-text-primary flex items-center justify-center">
            <Clock size={18} className="text-bg-primary" />
          </div>
          <div>
            <h1 className="r-text-h1 font-semibold text-text-primary">Log Work</h1>
            <p className="r-text-tiny text-text-secondary hidden sm:block">Record and manage your study sessions</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Today summary */}
          <div className="text-right">
            <div className="r-text-small font-semibold text-text-primary">
              {metrics.todayHours.toFixed(1)}h
              <span className="r-text-tiny font-normal text-text-secondary ml-1">today</span>
            </div>
            <div className="r-text-tiny text-text-secondary flex items-center justify-end gap-1">
              <Zap size={9} />
              Target {metrics.adaptiveDailyTarget.toFixed(1)}h
            </div>
          </div>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="relative w-12 h-6 rounded-full border border-border-color bg-bg-primary cursor-pointer hover:border-text-secondary flex-shrink-0"
          >
            <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-text-primary flex items-center
              justify-center transition-all duration-200 ${isDark ? 'translate-x-6' : 'translate-x-0.5'}`}>
              {isDark ? <Moon size={10} className="text-bg-primary" /> : <Sun size={10} className="text-bg-primary" />}
            </span>
          </button>
        </div>
      </header>

      {/* ── Timer + History — side-by-side on spacious layouts ── */}
      <div
        className={layout.isSpacious ? 'grid' : 'space-y-5'}
        style={{
          gridTemplateColumns: layout.isSpacious ? '1fr 1fr' : undefined,
          gap: layout.isSpacious ? `${layout.cardGap}px` : undefined,
        }}
      >
        <TimeLogger />
        <SessionHistory
          logs={visibleLogs}
          sessionTypeMap={sessionTypeMap}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
        />
      </div>

      {/* ── Footer ── */}
      <footer className="flex items-center justify-between pt-4 border-t border-border-color">
        <span className="r-text-tiny text-text-secondary">
          {data.dailyLogs.filter(l => l.source !== 'completion').length} manual sessions
          {' · '}
          {data.dailyLogs.reduce((s, l) => s + l.hours, 0).toFixed(1)}h total
        </span>
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm({
              title: 'Clear all study logs?',
              message: 'All logged sessions and hours will be removed. Curriculum completion checkboxes are kept.',
              confirmLabel: 'Clear Logs',
              danger: true,
            })
            if (ok) resetLogs()
          }}
          className="flex items-center gap-1 r-text-tiny text-text-secondary hover:text-red-400 transition-colors cursor-pointer"
        >
          <RotateCcw size={10} />
          Clear Logs
        </button>
      </footer>

      {/* ── Edit Modal ── */}
      {editingLog && (
        <EditLogModal
          log={editingLog}
          topicGroups={topicGroups}
          onSave={handleSaveEdit}
          onClose={() => setEditingLog(null)}
        />
      )}

      {/* ── Undo Toast ── */}
      {pendingUndo && (
        <UndoToast
          message={`"${pendingUndo.log.subtopicName}" session deleted`}
          onUndo={handleUndo}
          onDismiss={handleDismissUndo}
        />
      )}
    </div>
  )
}
