/**
 * AchievementsPanel — Premium milestone tracking with badge cards,
 * progress rings, and unlock animations.
 */

import { useState } from 'react'
import { Award, Star, Trophy, Flame, Code, Database, Sparkles, Lock } from 'lucide-react'
import type { Achievement } from '../types'

interface AchievementsPanelProps {
  achievements: Achievement[]
}

const ICON_MAP: Record<string, typeof Star> = {
  Star, Trophy, Award, Flame, Code, Database, Sparkles,
}

export default function AchievementsPanel({ achievements }: AchievementsPanelProps) {
  const [showAll, setShowAll] = useState(false)
  const unlockedCount = achievements.filter(a => a.unlocked).length
  const displayAchievements = showAll ? achievements : achievements.filter(a => !a.unlocked)

  return (
    <div className="rounded-xl border border-border-color bg-bg-card p-4 sm:p-5 transition-all duration-200 hover:shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-md bg-text-primary flex items-center justify-center">
          <Award size={14} className="text-bg-primary" />
        </div>
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
          Achievements
        </span>
        <span className="text-[10px] text-text-secondary ml-auto tabular-nums">
          {unlockedCount}/{achievements.length} unlocked
        </span>
      </div>

      {/* Summary bar */}
      <div className="relative h-1.5 rounded-full bg-border-color/60 overflow-hidden mb-3">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-text-primary transition-all duration-700 ease-out"
          style={{ width: `${(unlockedCount / Math.max(achievements.length, 1)) * 100}%` }}
        />
      </div>

      {/* Achievement cards */}
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
        {(showAll ? achievements : achievements.filter(a => !a.unlocked)).map(a => {
          const IconComponent = ICON_MAP[a.icon] || Award
          const progress = a.requirement > 0
            ? Math.min((a.current / a.requirement) * 100, 100)
            : a.unlocked ? 100 : 0

          return (
            <div
              key={a.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-300
                ${a.unlocked
                  ? 'bg-bg-primary border-text-primary/30 scale-100'
                  : 'bg-bg-primary/50 border-border-color/60 opacity-70'
                }`}
            >
              {/* Icon */}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                ${a.unlocked ? 'bg-text-primary' : 'bg-border-color/60'}`}
              >
                {a.unlocked ? (
                  <IconComponent size={14} className="text-bg-primary" />
                ) : (
                  <Lock size={12} className="text-text-secondary" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-medium ${a.unlocked ? 'text-text-primary' : 'text-text-secondary'}`}>
                    {a.name}
                  </span>
                  {a.unlocked && <Sparkles size={10} className="text-text-primary" />}
                </div>
                <span className="text-[10px] text-text-secondary block">{a.description}</span>

                {/* Progress bar for achievements with numeric requirements */}
                {a.requirement > 0 && (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-border-color/60 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out
                          ${a.unlocked ? 'bg-green-500' : 'bg-text-primary'}`}
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-text-secondary tabular-nums flex-shrink-0">
                      {a.unlocked ? 'Done!' : `${a.current}/${a.requirement}`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Toggle button */}
      {displayAchievements.length === 0 && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="text-[10px] text-text-secondary hover:text-text-primary underline underline-offset-2 cursor-pointer mt-1"
        >
          Show pending only
        </button>
      )}
      {!showAll && achievements.some(a => a.unlocked) && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[10px] text-text-secondary hover:text-text-primary underline underline-offset-2 cursor-pointer mt-2"
        >
          Show all ({achievements.length})
        </button>
      )}
    </div>
  )
}
