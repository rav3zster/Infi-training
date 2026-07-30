import { useState, useMemo } from 'react'
import { Clock, Plus, ChevronDown } from 'lucide-react'
import { useTraining } from '../context/TrainingContext'

export default function TimeLogger() {
  const { data, allSubtopics, logSession, metrics } = useTraining()
  const [selectedTopic, setSelectedTopic] = useState('')
  const [hours, setHours] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  // Group subtopics by module for the dropdown
  const topicGroups = useMemo(() => {
    return data.modules.map(m => ({
      moduleId: m.id,
      moduleName: m.name,
      subtopics: m.topics.flatMap(t =>
        t.subtopics.map(st => ({
          id: st.id,
          name: st.name,
          topicName: `${m.name} › ${t.name}`,
          hoursSpent: st.hoursSpent,
        }))
      ),
    }))
  }, [data.modules])

  const selectedSubTopic = useMemo(() => {
    return allSubtopics.find(st => st.id === selectedTopic)
  }, [selectedTopic, allSubtopics])

  const handleLog = () => {
    const hoursNum = parseFloat(hours)
    if (!selectedTopic || isNaN(hoursNum) || hoursNum <= 0) return
    logSession(selectedTopic, hoursNum)
    setHours('')
    // Keep the same topic selected for quick consecutive logging
  }

  const validHours = hours === '' || (!isNaN(parseFloat(hours)) && parseFloat(hours) > 0)

  return (
    <div className="rounded-lg border border-border-color bg-bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center">
          <Clock size={14} className="text-bg-primary" />
        </div>
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          Daily Time Logger
        </span>
        <div className="ml-auto text-right">
          <span className="text-sm font-semibold text-text-primary">{metrics.todayHours.toFixed(1)}</span>
          <span className="text-xs text-text-secondary ml-1">hrs today</span>
        </div>
      </div>

      <div className="space-y-3">
        {/* Topic Selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-md
              border border-border-color bg-bg-primary text-text-primary
              hover:border-text-secondary focus:outline-none focus:ring-1 focus:ring-text-primary
              transition-colors duration-150 cursor-pointer"
          >
            <span className={selectedTopic ? 'text-text-primary' : 'text-text-secondary'}>
              {selectedSubTopic ? (
                <span className="flex items-center gap-2">
                  <span>{selectedSubTopic.name}</span>
                  <span className="text-[10px] text-text-secondary">
                    ({selectedSubTopic.hoursSpent.toFixed(1)}h logged)
                  </span>
                </span>
              ) : (
                'Select a subtopic to study...'
              )}
            </span>
            <ChevronDown size={14} className={`text-text-secondary transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
              <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border border-border-color bg-bg-card shadow-lg max-h-64 overflow-y-auto">
                {topicGroups.map(group => (
                  <div key={group.moduleId}>
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-secondary bg-bg-primary border-b border-border-color font-medium">
                      {group.moduleName}
                    </div>
                    {group.subtopics.map(st => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setSelectedTopic(st.id)
                          setIsOpen(false)
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-primary transition-colors duration-100
                          border-b border-border-color last:border-b-0 cursor-pointer flex items-center justify-between
                          ${selectedTopic === st.id ? 'bg-bg-primary font-medium' : ''}`}
                      >
                        <span className="text-text-primary">{st.name}</span>
                        <span className="text-[10px] text-text-secondary">{st.hoursSpent.toFixed(1)}h</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Hours Input + Log Button */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              min="0.5"
              step="0.5"
              placeholder="Hours (e.g. 1.5)"
              value={hours}
              onChange={e => setHours(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLog()}
              className="w-full px-3 py-2.5 text-sm rounded-md border border-border-color bg-bg-primary text-text-primary
                placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-text-primary
                transition-colors duration-150 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <button
            type="button"
            onClick={handleLog}
            disabled={!selectedTopic || !validHours || parseFloat(hours || '0') <= 0}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-md
              bg-text-primary text-bg-primary
              hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed
              transition-all duration-150 cursor-pointer"
          >
            <Plus size={14} />
            Log Session
          </button>
        </div>
      </div>

      {/* Quick actions - recent/relevant topics */}
      {selectedTopic && (
        <div className="mt-3 pt-3 border-t border-border-color">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-text-secondary">
              Selected: {selectedSubTopic?.name}
            </span>
            <span className="text-[10px] text-text-secondary">
              Total logged: {selectedSubTopic?.hoursSpent.toFixed(1)}h
            </span>
          </div>
          <div className="flex gap-1.5 mt-2">
            {[1, 1.5, 2].map(quick => (
              <button
                key={quick}
                type="button"
                onClick={() => setHours(String(quick))}
                className={`px-2.5 py-1 text-xs rounded border transition-colors duration-100 cursor-pointer
                  ${parseFloat(hours || '0') === quick
                    ? 'border-text-primary bg-text-primary text-bg-primary'
                    : 'border-border-color text-text-secondary hover:border-text-secondary'
                  }`}
              >
                {quick}h
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
