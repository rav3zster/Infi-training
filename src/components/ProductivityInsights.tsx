import { useMemo } from 'react'
import { useTraining } from '../context/TrainingContext'
import {
  BarChart3,
  Lightbulb,
  ArrowRight,
  BookOpen,
  Target,
  GraduationCap,
  Sparkles,
  AlertTriangle,
  ListChecks,
} from 'lucide-react'

function PhaseProgress({ label, completed, total, hours }: { label: string; completed: number; total: number; hours: number }) {
  const pct = total > 0 ? (completed / total) * 100 : 0
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[11px] text-text-primary font-medium">{label}</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-secondary">{completed}/{total}</span>
            <span className="text-[10px] text-text-secondary tabular-nums">{hours.toFixed(1)}h</span>
          </div>
        </div>
        <div className="relative h-1.5 rounded-full bg-border-color/60 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-text-primary transition-all duration-700 ease-out"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default function ProductivityInsights() {
  const { metrics, data } = useTraining()

  // Module heatmap data
  const sortedModules = [...metrics.moduleAnalytics].sort((a, b) => a.masteryPercentage - b.masteryPercentage)
  const lowestModule = sortedModules[0]
  const highestModule = sortedModules[sortedModules.length - 1]

  // Phase grouping (by module phase)
  const phaseData = useMemo(() => {
    const phases = new Map<string, { completed: number; total: number; hours: number }>()
    for (const mod of data.modules) {
      const phase = mod.phase ?? mod.name
      const existing = phases.get(phase) ?? { completed: 0, total: 0, hours: 0 }
      const allSubs = mod.topics.flatMap(t => t.subtopics)
      phases.set(phase, {
        completed: existing.completed + allSubs.filter(s => s.completed).length,
        total: existing.total + allSubs.length,
        hours: existing.hours + allSubs.reduce((s, st) => s + st.hoursSpent, 0),
      })
    }
    return Array.from(phases.entries())
  }, [data.modules])

  // Suggested next topic
  const nextTopic = metrics.nextStudyTopic

  // Assessments
  const allAssessments = data.modules.flatMap(m => m.assessments ?? [])
  const pendingAssessments = allAssessments.filter(a => !a.completed)

  return (
    <div className="space-y-3">
      {/* Row: Next Study Topic + Assessment Quick Access */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Resume Learning Card */}
        <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-text-primary flex items-center justify-center">
              <Lightbulb size={12} className="text-bg-primary" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
              Resume Learning
            </span>
          </div>

          {nextTopic ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-bg-primary border border-border-color/60">
                <div className="w-7 h-7 rounded-md bg-text-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BookOpen size={12} className="text-text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-text-primary">{nextTopic.topicName}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded font-semibold uppercase tracking-wider
                      ${nextTopic.difficulty === 'advanced' || nextTopic.difficulty === 'intermediate-advanced'
                        ? 'bg-text-primary/20 text-text-primary'
                        : 'bg-border-color/60 text-text-secondary'
                      }`}>
                      {nextTopic.difficulty}
                    </span>
                  </div>
                  <span className="text-[10px] text-text-secondary block mt-0.5">{nextTopic.moduleName}</span>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center gap-1">
                      <Target size={9} className="text-text-secondary" />
                      <span className="text-[10px] text-text-secondary">~{nextTopic.estimatedHours}h</span>
                    </div>
                    <span className="text-text-secondary/30">·</span>
                    <div className="flex items-center gap-1">
                      <ListChecks size={9} className="text-text-secondary" />
                      <span className="text-[10px] text-text-secondary">{Math.round(nextTopic.progressPercent)}% complete</span>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-border-color/60 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-text-primary transition-all duration-700 ease-out"
                      style={{ width: `${Math.min(nextTopic.progressPercent, 100)}%` }}
                    />
                  </div>
                </div>
                <ArrowRight size={14} className="text-text-secondary flex-shrink-0 mt-1" />
              </div>
              <div className="text-[9px] text-text-secondary leading-relaxed pl-1">
                Continue where you left off. Focus on completing the remaining subtopics in this topic.
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <Sparkles size={20} className="mx-auto text-text-primary mb-2" />
              <p className="text-xs text-text-primary font-medium">All topics mastered!</p>
              <p className="text-[10px] text-text-secondary mt-1">Great work — you've completed the entire curriculum.</p>
            </div>
          )}
        </div>

        {/* Pending Assessments */}
        <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-text-primary flex items-center justify-center">
              <GraduationCap size={12} className="text-bg-primary" />
            </div>
            <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
              Pending Assessments
            </span>
            <span className="text-[9px] text-text-secondary ml-auto">
              {metrics.completedAssessments}/{metrics.totalAssessments} done
            </span>
          </div>

          {pendingAssessments.length > 0 ? (
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
              {pendingAssessments.slice(0, 5).map(a => (
                <div key={a.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-bg-primary border border-border-color/60">
                  <div className="w-5 h-5 rounded bg-border-color/60 flex items-center justify-center flex-shrink-0">
                    <span className="text-[8px] font-bold text-text-secondary uppercase">
                      {a.type === 'quiz' ? 'Q' : a.type === 'revision' ? 'R' : a.type === 'mini-project' ? 'MP' : a.type === 'mock' ? 'M' : 'C'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] text-text-primary truncate block">{a.name}</span>
                    <span className="text-[9px] text-text-secondary">~{a.estimatedHours}h estimated</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <Sparkles size={20} className="mx-auto text-text-primary mb-2" />
              <p className="text-xs text-text-primary font-medium">All assessments cleared!</p>
              <p className="text-[10px] text-text-secondary mt-1">Check the Syllabus tab for capstone project details.</p>
            </div>
          )}
        </div>
      </div>

      {/* Learning Path Progress */}
      <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-md bg-text-primary flex items-center justify-center">
            <BarChart3 size={12} className="text-bg-primary" />
          </div>
          <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
            Learning Path
          </span>
        </div>
        <div className="space-y-1">
          {phaseData.map(([phase, p]) => (
            <PhaseProgress key={phase} label={phase} completed={p.completed} total={p.total} hours={p.hours} />
          ))}
        </div>
      </div>

      {/* Module Heatmap */}
      <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-md bg-text-primary flex items-center justify-center">
            <BarChart3 size={12} className="text-bg-primary" />
          </div>
          <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Module Heatmap</span>
          {lowestModule && lowestModule.masteryPercentage < 100 && (
            <span className="text-[9px] text-text-secondary ml-auto flex items-center gap-0.5">
              <AlertTriangle size={9} />
              Focus: {lowestModule.name}
            </span>
          )}
        </div>

        <div className="space-y-2">
          {metrics.moduleAnalytics.map(m => {
            const isLowest = lowestModule && m.id === lowestModule.id && m.masteryPercentage < 100
            const isHighest = highestModule && m.id === highestModule.id && m.masteryPercentage === 100
            return (
              <div key={m.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs text-text-primary truncate">{m.name}</span>
                    {isHighest && <Sparkles size={10} className="text-text-primary flex-shrink-0" />}
                    {isLowest && <AlertTriangle size={10} className="text-text-secondary flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-xs font-medium text-text-primary tabular-nums">
                      {Math.round(m.masteryPercentage)}%
                    </span>
                    <span className="text-[10px] text-text-secondary w-12 text-right tabular-nums">{m.hours.toFixed(1)}h</span>
                  </div>
                </div>
                <div className="relative h-2 rounded-full bg-border-color/60 overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out
                      ${isLowest ? 'bg-text-secondary' : 'bg-text-primary'}`}
                    style={{ width: `${Math.min(m.masteryPercentage, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
