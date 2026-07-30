import { useState, useMemo } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useTraining } from '../context/TrainingContext'
import { useLayout } from '../App'
import SyllabusTree from '../components/SyllabusTree'
import {
  Sun, Moon, BookOpen, RotateCcw,
  Search, Filter, X, GraduationCap, Clock,
} from 'lucide-react'
import type { DifficultyLevel } from '../types'

type DifficultyFilter = DifficultyLevel | 'all'
const DIFFICULTIES: { value: DifficultyFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'beginner-intermediate', label: 'Beginner+' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'intermediate-advanced', label: 'Int. Adv.' },
  { value: 'advanced', label: 'Advanced' },
]

export default function SyllabusScreen() {
  const { isDark, toggleTheme } = useTheme()
  const { data, metrics, resetData } = useTraining()
  const layout = useLayout()

  const [searchQuery, setSearchQuery] = useState('')
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all')
  const [showFilters, setShowFilters] = useState(false)

  const filters = useMemo(() => ({ query: searchQuery, difficulty: difficultyFilter, phase: 'all' as const }), [searchQuery, difficultyFilter])
  const totalEstimatedHours = useMemo(() =>
    data.modules.reduce((sum, m) => sum + m.topics.reduce((s, t) => s + (t.meta?.estimatedHours ?? 1), 0), 0), [data.modules])

  return (
    <div className="space-y-4 sm:space-y-5" style={{ gap: `${layout.sectionGap}px` }}>
      {/* Header */}
      <header className="r-card p-4 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-text-primary flex items-center justify-center"><BookOpen size={18} className="text-bg-primary" /></div>
          <div>
            <h1 className="r-text-h1 font-semibold text-text-primary">Syllabus</h1>
            <p className="r-text-tiny text-text-secondary hidden sm:block">{metrics.completedSubtopics}/{metrics.totalSubtopics} subtopics mastered</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {layout.isWide && (
            <div className="text-right">
              <div className="r-text-small font-medium text-text-primary">{metrics.overallProgress.toFixed(0)}% complete</div>
              <div className="r-text-tiny text-text-secondary flex items-center gap-1 justify-end"><Clock size={9} />~{totalEstimatedHours}h curriculum</div>
            </div>
          )}
          <button onClick={toggleTheme} className="relative w-12 h-6 rounded-full border border-border-color bg-bg-primary cursor-pointer hover:border-text-secondary flex-shrink-0">
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-text-primary flex items-center justify-center transition-all duration-200 ${isDark ? 'translate-x-6' : 'translate-x-0.5'}`}>
              {isDark ? <Moon size={10} className="text-bg-primary" /> : <Sun size={10} className="text-bg-primary" />}
            </span>
          </button>
        </div>
      </header>

      {/* Search & Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1" style={{ maxWidth: layout.isWide ? '480px' : '100%' }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          <input type="text" placeholder="Search topics, subtopics, learning objectives..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2.5 r-text-small rounded-lg border border-border-color bg-bg-card text-text-primary
              placeholder:text-text-secondary/60 focus:outline-none focus:ring-1 focus:ring-text-primary transition-all duration-150" />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary cursor-pointer"><X size={14} /></button>
          )}
        </div>
        <button type="button" onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border transition-all duration-150 cursor-pointer
            ${showFilters ? 'bg-text-primary text-bg-primary border-text-primary' : 'border-border-color text-text-secondary hover:border-text-secondary hover:text-text-primary'}`}>
          <Filter size={14} /><span className="r-text-tiny hidden sm:inline">Filter</span>
        </button>
      </div>

      {/* Filter chips */}
      {showFilters && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="r-text-tiny text-text-secondary uppercase tracking-wider font-medium mr-1">Difficulty:</span>
          {DIFFICULTIES.map(d => (
            <button key={d.value} type="button" onClick={() => setDifficultyFilter(d.value)}
              className={`px-2.5 py-1 r-text-tiny rounded-md border font-medium transition-all duration-150 cursor-pointer
                ${difficultyFilter === d.value ? 'bg-text-primary text-bg-primary border-text-primary' : 'border-border-color text-text-secondary hover:border-text-secondary hover:text-text-primary'}`}>
              {d.label}
            </button>
          ))}
          {(searchQuery || difficultyFilter !== 'all') && (
            <button type="button" onClick={() => { setSearchQuery(''); setDifficultyFilter('all') }}
              className="ml-2 r-text-tiny text-text-secondary hover:text-text-primary underline underline-offset-2 cursor-pointer">Clear all</button>
          )}
        </div>
      )}

      {/* Results indicator */}
      {(searchQuery || difficultyFilter !== 'all') && (
        <div className="flex items-center gap-1.5">
          <GraduationCap size={11} className="text-text-secondary" />
          <span className="r-text-tiny text-text-secondary">Filtered results{difficultyFilter !== 'all' && ` — ${difficultyFilter.replace('-', ' ')}`}</span>
        </div>
      )}

      {/* Syllabus Tree */}
      <SyllabusTree filters={filters} />

      {/* Footer */}
      <footer className="flex items-center justify-between pt-4 border-t border-border-color">
        <span className="r-text-tiny text-text-secondary">{data.modules.length} modules · {metrics.totalSubtopics} subtopics</span>
        <button type="button" onClick={() => { if (window.confirm('Reset all training data?')) resetData() }}
          className="flex items-center gap-1 r-text-tiny text-text-secondary hover:text-text-primary cursor-pointer"><RotateCcw size={10} /> Reset</button>
      </footer>
    </div>
  )
}
