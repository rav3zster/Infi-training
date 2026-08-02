import { useState, useMemo, useRef, useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useTraining } from '../context/TrainingContext'
import { useConfirm } from '../context/ConfirmContext'
import { useLayout } from '../App'
import { calculateMetrics } from '../data/curriculum'
import { localDatabase } from '../services/database/LocalDatabase'
import { readDateOffset, writeDateOffset } from '../services/sync/clientSettings'
import { enqueueSettingsSync } from '../services/sync/settingsSync'
import { Sun, Moon, Settings, RotateCcw, AlertTriangle, CalendarClock, Download, Upload } from 'lucide-react'

export default function PresetsScreen() {
  const { isDark, toggleTheme } = useTheme()
  const { data, metrics, resetData, restoreData } = useTraining()
  const confirm = useConfirm()
  const layout = useLayout()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const [dateOffset, setDateOffset] = useState(() => readDateOffset())
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Set true ONLY while adopting a remote offset pushed by the Sync Engine, so
  // the enqueue below doesn't echo the same value back to the cloud (no loop).
  const adoptingRemoteOffset = useRef(false)

  // Phase 3: persist + enqueue the offset for cloud sync whenever it changes.
  useEffect(() => {
    writeDateOffset(dateOffset)
    const wasRemote = adoptingRemoteOffset.current
    adoptingRemoteOffset.current = false
    if (!wasRemote) {
      void enqueueSettingsSync()
    }
  }, [dateOffset])

  // Phase 3: adopt a date offset synced from another device (Sync Engine download).
  useEffect(() => {
    const onRemoteOffset = (e: Event) => {
      adoptingRemoteOffset.current = true
      setDateOffset(Number((e as CustomEvent<number>).detail) || 0)
    }
    window.addEventListener('training:date-offset-applied', onRemoteOffset)
    return () => window.removeEventListener('training:date-offset-applied', onRemoteOffset)
  }, [])

  const previewMetrics = useMemo(() => calculateMetrics(data, { dateOffset }), [data, dateOffset])

  async function handleExport() {
    setBackupMsg(null)
    setBackupError(null)
    try {
      const json = await localDatabase.exportBackup()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `training-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setBackupMsg('Backup exported — check your downloads.')
    } catch (e) {
      setBackupError(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setBackupMsg(null)
    setBackupError(null)
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const ok = await confirm({
      title: 'Import backup?',
      message: `Restoring "${file.name}" will replace your current data. A safety backup of your current state is created first.`,
      confirmLabel: 'Import',
      danger: true,
    })
    if (!ok) return

    try {
      const text = await file.text()
      const restored = await localDatabase.importBackup(text)
      restoreData(restored)
      setBackupMsg('Backup restored successfully.')
    } catch (err) {
      setBackupError(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="space-y-6"
      style={{
        maxWidth: layout.isUltra ? '900px' : layout.isExpanded ? '800px' : '100%',
        gap: `${layout.sectionGap}px`,
      }}
    >
      {/* Header */}
      <header className="r-card p-4 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-text-primary flex items-center justify-center"><Settings size={18} className="text-bg-primary" /></div>
          <div><h1 className="r-text-h1 font-semibold text-text-primary">Presets</h1><p className="r-text-small text-text-secondary hidden sm:block">Configuration & tools</p></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="r-text-tiny text-text-secondary hidden sm:block">v3.0</span>
          <button onClick={toggleTheme} className="relative w-12 h-6 rounded-full border border-border-color bg-bg-primary cursor-pointer hover:border-text-secondary flex-shrink-0">
            <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-text-primary flex items-center justify-center transition-all duration-200 ${isDark ? 'translate-x-6' : 'translate-x-0.5'}`}>
              {isDark ? <Moon size={10} className="text-bg-primary" /> : <Sun size={10} className="text-bg-primary" />}
            </span>
          </button>
        </div>
      </header>

      {/* Date Offset */}
      <div className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><CalendarClock size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Simulated Date Offset</span>
        </div>
        <p className="r-text-small text-text-secondary mb-4">Shift the simulated system date forward or backward to preview how the adaptive engine recalculates daily targets.</p>

        <div className="space-y-3" style={{ maxWidth: layout.isWide ? '500px' : '100%' }}>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setDateOffset(prev => Math.max(-30, prev - 1))}
              className="px-3 py-1.5 r-text-small rounded-md border border-border-color text-text-primary hover:border-text-secondary transition-colors cursor-pointer">−1 day</button>
            <div className="flex-1 text-center">
              <span className="r-text-h1 font-bold text-text-primary tabular-nums">{dateOffset > 0 ? `+${dateOffset}` : dateOffset}</span>
              <span className="r-text-tiny text-text-secondary ml-1">days offset</span>
            </div>
            <button type="button" onClick={() => setDateOffset(prev => Math.min(30, prev + 1))}
              className="px-3 py-1.5 r-text-small rounded-md border border-border-color text-text-primary hover:border-text-secondary transition-colors cursor-pointer">+1 day</button>
          </div>

          <div className="flex items-center gap-2">
            <input type="range" min={-30} max={30} value={dateOffset} onChange={e => setDateOffset(parseInt(e.target.value))}
              className="flex-1 h-1.5 rounded-full appearance-none bg-border-color" />
            <button type="button" onClick={() => setDateOffset(0)}
              className="r-text-tiny text-text-secondary hover:text-text-primary underline underline-offset-2 cursor-pointer">Reset</button>
          </div>
        </div>

        {dateOffset !== 0 && (
          <div className="mt-4 p-3 rounded-md border border-border-color bg-bg-primary space-y-2">
            <p className="r-text-tiny uppercase tracking-wider text-text-secondary font-medium">Live Preview</p>
            <div className="grid grid-cols-2 gap-3"
              style={{ gridTemplateColumns: layout.isSpacious ? 'repeat(2, 1fr)' : '1fr' }}
            >
              <div className="space-y-1">
                <p className="r-text-tiny text-text-secondary">Days Remaining</p>
                <div className="flex items-baseline gap-2">
                  <span className="r-text-data font-bold text-text-primary tabular-nums">{metrics.daysRemaining}</span>
                  <span className="r-text-tiny text-text-secondary">→</span>
                  <span className="r-text-data font-bold text-text-primary tabular-nums">{previewMetrics.daysRemaining}</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="r-text-tiny text-text-secondary">Daily Target</p>
                <div className="flex items-baseline gap-2">
                  <span className="r-text-data font-bold text-text-primary tabular-nums">{metrics.adaptiveDailyTarget.toFixed(2)}h</span>
                  <span className="r-text-tiny text-text-secondary">→</span>
                  <span className="r-text-data font-bold text-text-primary tabular-nums">{previewMetrics.adaptiveDailyTarget.toFixed(2)}h</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hard Reset */}
      <div className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-md bg-text-secondary flex items-center justify-center"><AlertTriangle size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Danger Zone</span>
        </div>
        <p className="r-text-small text-text-secondary mb-4">Wipe all saved progress, logs, and settings. This action is irreversible.</p>

        {!showResetConfirm ? (
          <button type="button" onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-1.5 px-4 py-2 r-text-small font-medium rounded-md border border-text-secondary text-text-secondary
              hover:bg-text-primary hover:text-bg-primary hover:border-text-primary transition-all duration-150 cursor-pointer">
            <RotateCcw size={12} /> Reset All Data
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-md border border-text-secondary/30 bg-bg-primary">
              <AlertTriangle size={14} className="text-text-secondary flex-shrink-0" />
              <p className="r-text-small text-text-primary font-medium">Are you sure? This will permanently delete all your study data.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { resetData(); setShowResetConfirm(false) }}
                className="flex items-center gap-1.5 px-4 py-2 r-text-small font-medium rounded-md bg-text-primary text-bg-primary hover:opacity-80 transition-all cursor-pointer"><RotateCcw size={12} /> Confirm Reset</button>
              <button type="button" onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 r-text-small font-medium rounded-md border border-border-color text-text-secondary hover:text-text-primary transition-all cursor-pointer">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Backup & Restore */}
      <div className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><Download size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">Backup & Restore</span>
        </div>
        <p className="r-text-small text-text-secondary mb-4">Export your complete local database as JSON, or restore from a previous backup. Automatic daily backups are kept locally (latest 5).</p>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 r-text-small font-medium rounded-md bg-text-primary text-bg-primary hover:opacity-80 transition-all cursor-pointer">
            <Download size={12} /> Export Backup
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2 r-text-small font-medium rounded-md border border-border-color text-text-secondary hover:text-text-primary hover:border-text-secondary transition-all cursor-pointer">
            <Upload size={12} /> Import Backup
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>

        {backupMsg && <p className="r-text-tiny text-emerald-600 dark:text-emerald-400 mt-3">{backupMsg}</p>}
        {backupError && <p className="r-text-tiny text-red-600 dark:text-red-400 mt-3">{backupError}</p>}
      </div>

      {/* System Info — responsive grid */}
      <div className="r-card r-p-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center"><Settings size={14} className="text-bg-primary" /></div>
          <span className="r-text-tiny font-medium text-text-secondary uppercase tracking-wider">System Info</span>
        </div>
        <div className="r-text-small space-y-1.5"
          style={{
            display: 'grid',
            gridTemplateColumns: layout.isUltra ? 'repeat(3, 1fr)' : layout.isExpanded ? 'repeat(2, 1fr)' : '1fr',
            gap: '0.375rem',
          }}
        >
          <div className="flex justify-between"><span className="text-text-secondary">Engine</span><span className="text-text-primary font-medium">v3.0</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Modules</span><span className="text-text-primary font-medium">{data.modules.length}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Subtopics</span><span className="text-text-primary font-medium">{metrics.totalSubtopics}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Joining</span><span className="text-text-primary font-medium">Sep 21, 2026</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Est. Hours</span><span className="text-text-primary font-medium">{metrics.totalEstimatedHours.toFixed(0)}h</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">Theme</span><span className="text-text-primary font-medium">{isDark ? 'Dark' : 'Light'}</span></div>
        </div>
      </div>
    </div>
  )
}
