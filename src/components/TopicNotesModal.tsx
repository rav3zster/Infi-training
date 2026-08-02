import { useState } from 'react'
import { X, Save, FileText, Check } from 'lucide-react'
import { useTraining } from '../context/TrainingContext'

interface Props {
  subtopicId: string
  subtopicName: string
  initialNotes?: string
  onClose: () => void
}

export default function TopicNotesModal({ subtopicId, subtopicName, initialNotes = '', onClose }: Props) {
  const { data, restoreData, recordEvent } = useTraining()
  const [notes, setNotes] = useState(initialNotes)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    const newData = structuredClone(data)
    let found = false

    for (const mod of newData.modules) {
      for (const topic of mod.topics) {
        const sub = topic.subtopics.find(s => s.id === subtopicId)
        if (sub) {
          (sub as unknown as Record<string, unknown>).notes = notes
          found = true
          break
        }
      }
      if (found) break
    }

    restoreData(newData)
    recordEvent({
      type: 'subtopic.completed', // metadata event
      entityType: 'subtopic',
      entityId: subtopicId,
      payload: { action: 'notes_updated', subtopicName },
      occurredAt: new Date().toISOString(),
    })

    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      onClose()
    }, 600)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-xl border border-border-color bg-bg-card p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-border-color pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-text-primary/10 flex items-center justify-center">
              <FileText size={14} className="text-text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Revision Notes</h3>
              <p className="text-[11px] text-text-secondary truncate max-w-xs">{subtopicName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md border border-border-color flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Write key code snippets, interview questions, or revision notes for this topic..."
            rows={8}
            className="w-full rounded-lg border border-border-color bg-bg-primary p-3 text-xs text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-text-primary transition-colors resize-none leading-relaxed font-mono"
          />
          <p className="text-[10px] text-text-secondary">Notes are saved locally and synced to your cloud backup.</p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-color">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border-color text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-text-primary text-bg-primary cursor-pointer hover:opacity-90 transition-opacity"
          >
            {saved ? <Check size={12} /> : <Save size={12} />}
            {saved ? 'Saved!' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  )
}
