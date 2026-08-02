import { useState, useMemo } from 'react'
import {
  ChevronDown,
  Check,
  BookOpen,
  Clock,
  Target,
  BarChart3,
  ListChecks,
  GraduationCap,
  Sparkles,
  FileText,
  BrainCircuit,
  Award,
  Code,
  HelpCircle,
} from 'lucide-react'
import { useTraining } from '../context/TrainingContext'
import { formatDuration, formatHours, calculateSubTopicEstimateMinutes } from '../data/curriculum'
import type { Module, Topic, Assessment, DifficultyLevel } from '../types'

// ─── Difficulty Badge ───

function DifficultyBadge({ level }: { level: DifficultyLevel }) {
  const colors: Record<DifficultyLevel, string> = {
    beginner: 'text-text-secondary bg-border-color/60',
    'beginner-intermediate': 'text-text-secondary bg-border-color/60',
    intermediate: 'text-text-primary bg-text-primary/10',
    'intermediate-advanced': 'text-text-primary bg-text-primary/15',
    advanced: 'text-text-primary bg-text-primary/20',
  }

  const labels: Record<DifficultyLevel, string> = {
    beginner: 'Beginner',
    'beginner-intermediate': 'Beginner+',
    intermediate: 'Intermediate',
    'intermediate-advanced': 'Int. Adv.',
    advanced: 'Advanced',
  }

  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${colors[level]}`}>
      {labels[level]}
    </span>
  )
}

// ─── Progress Donut ───

function ProgressDonut({ value, size = 16 }: { value: number; size?: number }) {
  const radius = (size - 4) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(value, 100) / 100) * circumference
  return (
    <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={3} className="text-border-color" />
      {value > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-text-primary transition-all duration-700 ease-out"
        />
      )}
    </svg>
  )
}

// ─── Assessment Card ───

function AssessmentCard({ assessment }: { assessment: Assessment }) {
  const { toggleAssessment } = useTraining()
  const [expanded, setExpanded] = useState(false)

  const iconMap = {
    quiz: HelpCircle,
    revision: BrainCircuit,
    'mini-project': Code,
    mock: Award,
    capstone: GraduationCap,
  }
  const Icon = iconMap[assessment.type]

  const labelMap = {
    quiz: 'Quiz',
    revision: 'Revision',
    'mini-project': 'Mini Project',
    mock: 'Mock Assessment',
    capstone: 'Capstone',
  }

  const isDone = assessment.completed

  return (
    <div
      className={`rounded-lg border transition-all duration-200
        ${isDone ? 'border-text-primary/20 bg-bg-primary/50' : 'border-border-color bg-bg-card'}
        ${expanded ? 'shadow-sm' : ''}`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors duration-100 hover:bg-bg-primary/50 rounded-lg text-left"
      >
        <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${isDone ? 'bg-text-primary' : 'bg-border-color'}`}>
          <Icon size={12} className={isDone ? 'text-bg-primary' : 'text-text-secondary'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${isDone ? 'text-text-secondary line-through' : 'text-text-primary'}`}>
              {assessment.name}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold
              ${isDone ? 'text-text-secondary bg-border-color/60' : 'text-text-primary bg-text-primary/10'}`}>
              {labelMap[assessment.type]}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Clock size={9} className="text-text-secondary" />
            <span className="text-[10px] text-text-secondary">{formatHours(assessment.estimatedHours)} estimated</span>
          </div>
        </div>
        <ChevronDown size={12} className={`text-text-secondary flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border-color/50 mt-1">
          <p className="text-[11px] text-text-secondary leading-relaxed">{assessment.description}</p>
          {assessment.prerequisites.length > 0 && (
            <div className="flex items-center gap-1.5">
              <ListChecks size={10} className="text-text-secondary flex-shrink-0" />
              <span className="text-[10px] text-text-secondary">
                Requires: {assessment.prerequisites.length} prerequisite topics
              </span>
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer group">
            <span
              onClick={(e) => { e.stopPropagation(); toggleAssessment(assessment.id) }}
              className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all duration-150 cursor-pointer
                ${assessment.completed
                  ? 'bg-text-primary border-text-primary'
                  : 'border-border-color group-hover:border-text-secondary'
                }`}
            >
              {assessment.completed && <Check size={10} className="text-bg-primary" />}
            </span>
            <span className={`text-xs ${assessment.completed ? 'text-text-secondary line-through' : 'text-text-primary'}`}>
              Mark as completed
            </span>
          </label>
        </div>
      )}
    </div>
  )
}

import TopicNotesModal from './TopicNotesModal'

// ... in TopicRow ...

function TopicRow({ topic }: { topic: Topic }) {
  const { toggleSubTopic } = useTraining()
  const [expanded, setExpanded] = useState(false)
  const [notesModalSubtopic, setNotesModalSubtopic] = useState<{ id: string; name: string; notes?: string } | null>(null)

  const completedCount = topic.subtopics.filter(s => s.completed).length
  const totalHours = topic.subtopics.reduce((sum, s) => sum + s.hoursSpent, 0)
  const allDone = completedCount === topic.subtopics.length
  const progressPercent = topic.subtopics.length > 0 ? (completedCount / topic.subtopics.length) * 100 : 0
  const meta = topic.meta
  const totalEstimateMinutes = topic.subtopics.reduce(
    (sum, s) => sum + calculateSubTopicEstimateMinutes(topic, s),
    0,
  )

  return (
    <div
      className={`rounded-lg border transition-all duration-200
        ${allDone ? 'border-text-primary/15 bg-bg-primary/30' : 'border-border-color bg-bg-card'}
        ${expanded ? 'shadow-sm' : ''}`}
    >
      {/* Header button */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors duration-100 hover:bg-bg-primary/50 rounded-lg text-left"
      >
        {/* Progress ring */}
        <ProgressDonut value={progressPercent} size={20} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${allDone ? 'text-text-secondary line-through' : 'text-text-primary'}`}>
              {topic.name}
            </span>
            {meta && <DifficultyBadge level={meta.difficulty} />}
            {allDone && <span className="text-[9px] text-text-secondary flex items-center gap-0.5"><Check size={9} />Done</span>}
          </div>
          <div className="flex items-center gap-2.5 mt-0.5">
            <span className="text-[10px] text-text-secondary">
              {completedCount}/{topic.subtopics.length} subtopics
            </span>
            <span className="text-[10px] text-text-secondary flex items-center gap-0.5">
              <Clock size={9} />
              {formatDuration(totalEstimateMinutes)} est.
            </span>
            {totalHours > 0 && (
              <span className="text-[10px] text-text-secondary flex items-center gap-0.5">
                <Target size={9} />
                {formatHours(totalHours)} logged
              </span>
            )}
          </div>
        </div>

        <ChevronDown
          size={12}
          className={`text-text-secondary flex-shrink-0 transition-transform duration-200
            ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-border-color/50 mt-1">
          {/* Subtopics checklist */}
          <div className="space-y-0.5">
            {topic.subtopics.map(sub => (
              <label
                key={sub.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-primary transition-colors duration-100 cursor-pointer group"
              >
              <button
                type="button"
                onClick={() => toggleSubTopic(sub.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSubTopic(sub.id) } }}
                aria-checked={sub.completed}
                role="checkbox"
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-all duration-150 cursor-pointer
                  ${sub.completed
                    ? 'bg-text-primary border-text-primary'
                    : 'border-border-color group-hover:border-text-secondary'
                  }`}
              >
                {sub.completed && <Check size={8} className="text-bg-primary" />}
              </button>
                <span
                  className={`text-xs flex-1 transition-all duration-150
                    ${sub.completed ? 'text-text-secondary line-through' : 'text-text-primary'}`}
                >
                  {sub.name}
                </span>
                {sub.completed ? (
                  <span
                    className="text-[10px] tabular-nums flex items-center gap-0.5 text-text-primary font-medium"
                    title={`${formatDuration(calculateSubTopicEstimateMinutes(topic, sub))} estimated · ${formatHours(sub.hoursSpent)} logged`}
                  >
                    <Check size={9} />
                    {formatDuration(Math.max(sub.hoursSpent * 60, calculateSubTopicEstimateMinutes(topic, sub)))} done
                  </span>
                ) : (
                  <span
                    className="text-[10px] tabular-nums flex items-center gap-0.5 text-text-secondary"
                    title="Estimated study time for this subtopic"
                  >
                    <Clock size={9} />
                    {formatDuration(calculateSubTopicEstimateMinutes(topic, sub))}
                  </span>
                )}
              </label>
            ))}
          </div>

          {/* Learning Objectives */}
          {meta && meta.learningObjectives.length > 0 && (
            <div className="p-2.5 rounded-md bg-bg-primary border border-border-color/50">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Target size={10} className="text-text-secondary" />
                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Learning Objectives</span>
              </div>
              <ul className="space-y-1">
                {meta.learningObjectives.map((obj, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-text-primary leading-relaxed">
                    <span className="text-text-secondary mt-0.5 flex-shrink-0">•</span>
                    {obj}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Practical Exercises */}
          {meta && meta.exercises.length > 0 && (
            <div className="p-2.5 rounded-md bg-bg-primary border border-border-color/50">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Code size={10} className="text-text-secondary" />
                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">Practical Exercises</span>
              </div>
              <ul className="space-y-1">
                {meta.exercises.map((ex, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-text-secondary leading-relaxed">
                    <span className="text-text-primary mt-0.5 flex-shrink-0">{i + 1}.</span>
                    {ex}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {notesModalSubtopic && (
        <TopicNotesModal
          subtopicId={notesModalSubtopic.id}
          subtopicName={notesModalSubtopic.name}
          initialNotes={notesModalSubtopic.notes}
          onClose={() => setNotesModalSubtopic(null)}
        />
      )}
    </div>
  )
}

// ─── Module Section ───

function ModuleSection({ module: mod }: { module: Module }) {
  const [expanded, setExpanded] = useState(false)

  const totalTopics = mod.topics.length
  const totalSubtopics = mod.topics.reduce((sum, t) => sum + t.subtopics.length, 0)
  const completedSubtopics = mod.topics.reduce((sum, t) => sum + t.subtopics.filter(s => s.completed).length, 0)
  const totalHours = mod.topics.reduce((sum, t) => sum + t.subtopics.reduce((s, st) => s + st.hoursSpent, 0), 0)
  const progressPercent = totalSubtopics > 0 ? (completedSubtopics / totalSubtopics) * 100 : 0
  const assessments = mod.assessments ?? []
  const completedAssessments = assessments.filter(a => a.completed).length

  return (
    <div className="border border-border-color rounded-xl overflow-hidden bg-bg-card transition-all duration-200 hover:shadow-sm">
      {/* Module header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-bg-primary/50 transition-colors duration-150"
      >
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
          ${progressPercent === 100 ? 'bg-text-primary' : 'bg-text-primary/10'}`}>
          <BookOpen size={16} className={progressPercent === 100 ? 'text-bg-primary' : 'text-text-primary'} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-text-primary">{mod.name}</h3>
            <span className="text-[9px] text-text-secondary bg-bg-primary px-1.5 py-0.5 rounded border border-border-color">
              {mod.weight}%
            </span>
            {progressPercent === 100 && (
              <span className="text-[9px] text-text-primary flex items-center gap-0.5">
                <Sparkles size={10} />
                Mastered
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-text-secondary">
              {totalTopics} topics • {completedSubtopics}/{totalSubtopics} done
            </span>
            {totalHours > 0 && (
              <span className="text-[10px] text-text-secondary flex items-center gap-0.5">
                <Clock size={9} />
                {formatHours(totalHours)} logged
              </span>
            )}
            {assessments.length > 0 && (
              <span className="text-[10px] text-text-secondary flex items-center gap-0.5">
                <FileText size={9} />
                {completedAssessments}/{assessments.length} assessments
              </span>
            )}
          </div>
        </div>

        {/* Module progress bar (vertical) */}
        <div className="flex items-center gap-2 ml-2">
          <div className="text-right">
            <div className="text-sm font-bold text-text-primary">{Math.round(progressPercent)}%</div>
            <div className="text-[9px] text-text-secondary">mastery</div>
          </div>
          <ChevronDown
            size={14}
            className={`text-text-secondary flex-shrink-0 transition-transform duration-200
              ${expanded ? 'rotate-0' : '-rotate-90'}`}
          />
        </div>
      </button>

      {/* Module progress bar */}
      <div className="h-1 bg-border-color/60">
        <div
          className="h-full bg-text-primary transition-all duration-700 ease-out"
          style={{ width: `${Math.min(progressPercent, 100)}%` }}
        />
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 pt-3 space-y-2">

          {/* Topics */}
          <div className="space-y-1.5">
            {mod.topics.map(topic => (
              <TopicRow key={topic.id} topic={topic} />
            ))}
          </div>

          {/* Assessments section */}
          {assessments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border-color">
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <BarChart3 size={11} className="text-text-secondary" />
                <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
                  Assessments & Milestones
                </span>
                <span className="text-[9px] text-text-secondary ml-auto">
                  {completedAssessments}/{assessments.length} completed
                </span>
              </div>
              <div className="space-y-1.5">
                {assessments.map(a => (
                  <AssessmentCard key={a.id} assessment={a} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Search & Filter ───

interface SearchFilters {
  query: string
  difficulty: DifficultyLevel | 'all'
  phase: string | 'all'
}

// ─── Main Export ───

export default function SyllabusTree({ filters }: { filters?: SearchFilters }) {
  const { data } = useTraining()

  const filteredModules = useMemo(() => {
    if (!filters) return data.modules
    return data.modules
      .map(mod => {
        const topics = mod.topics.filter(t => {
          // Text search
          if (filters.query) {
            const q = filters.query.toLowerCase()
            const matchesName = t.name.toLowerCase().includes(q)
            const matchesSub = t.subtopics.some(s => s.name.toLowerCase().includes(q))
            const matchesObj = t.meta?.learningObjectives?.some(o => o.toLowerCase().includes(q)) ?? false
            if (!matchesName && !matchesSub && !matchesObj) return false
          }
          // Difficulty filter
          if (filters.difficulty !== 'all' && t.meta?.difficulty !== filters.difficulty) {
            return false
          }
          return true
        })
        return { ...mod, topics }
      })
      .filter(mod => mod.topics.length > 0)
  }, [data.modules, filters])

  return (
    <div className="space-y-2">
      {filteredModules.map(mod => (
        <ModuleSection key={mod.id} module={mod} />
      ))}
      {filteredModules.length === 0 && (
        <div className="text-center py-12 border border-border-color rounded-xl bg-bg-card">
          <BookOpen size={24} className="mx-auto text-border-color mb-2" />
          <p className="text-sm text-text-secondary">No topics match your filters.</p>
          <p className="text-xs text-text-secondary mt-1">Try adjusting your search or filter criteria.</p>
        </div>
      )}
    </div>
  )
}
