/**
 * Adaptive Study Load Engine
 * ───────────────────────────────
 * Core intelligence layer of the Training Tracker.
 * All calculations derive from remaining estimated work ÷ remaining days.
 * No study banks, no fixed targets — always freshly computed.
 */

import type {
  TrainingData,
  DailyLogEntry,
  StudySession,
  TimeDistribution,
  ForecastData,
  Achievement,
  MotivationalInsight,
  HeatmapData,
  DashboardMetrics,
  ModuleAnalytics,
  DifficultyLevel,
  Topic,
} from '../types'

// ─── Constants ───

export const TOTAL_COURSE_HOURS = 100
export const JOINING_DATE = new Date('2026-09-21')

// ─── Core Formula ───

/**
 * The single source of truth for today's recommended study time.
 * Never fixed. Always: remainingWork / remainingDays.
 */
export function calculateRecommendedHours(
  remainingEstimatedWork: number,
  remainingDays: number,
): number {
  if (remainingDays <= 0) return remainingEstimatedWork
  if (remainingEstimatedWork <= 0) return 0
  return remainingEstimatedWork / remainingDays
}

// ─── Effective Progress Model ───

/**
 * Calculate a topic's effective progress using multiple signals:
 *  1. Hours logged (how many hours vs estimated)
 *  2. Subtopic checklist completion
 *
 * Design: multiple signals prevent gaming. You can't reach 100% progress
 * from hours alone — subtopic completion is required to cap at 100%.
 * This architecture supports adding signals later (quiz scores, practice
 * completion, confidence ratings) without refactoring.
 */
export function calculateTopicEffectiveProgress(topic: Topic): number {
  const estimated = topic.meta?.estimatedHours ?? 1

  // Signal 1: Hours-based progress
  const hoursLogged = topic.subtopics.reduce((sum, st) => sum + st.hoursSpent, 0)
  const hoursProgress = estimated > 0 ? Math.min(hoursLogged / estimated, 1) : 0

  // Signal 2: Subtopic checklist completion
  const subCount = topic.subtopics.length
  const completedCount = topic.subtopics.filter(st => st.completed).length
  const checklistProgress = subCount > 0 ? completedCount / subCount : 0

  // Combine signals: take the maximum of the two, but cap at 90%
  // if only hours progress is driving it (prevents timer-abuse).
  // Only allow 100% when all subtopics are completed.
  const rawProgress = Math.max(hoursProgress, checklistProgress)
  if (rawProgress >= 1 && checklistProgress < 1) {
    return 0.9
  }

  return Math.min(rawProgress, 1)
}

/**
 * Remaining estimated work using the continuous progress model.
 * Instead of binary (0% or 100%), each topic contributes:
 *   estimatedHours × (1 - effectiveProgress)
 *
 * So a topic estimated at 6h with 3h logged contributes ~3h remaining.
 * Sessions logged within a topic immediately reduce remaining work.
 */
export function calculateRemainingEstimatedWork(data: TrainingData): number {
  let total = 0
  for (const mod of data.modules) {
    for (const topic of mod.topics) {
      const effectiveProgress = calculateTopicEffectiveProgress(topic)
      const topicHours = topic.meta?.estimatedHours ?? 1
      total += topicHours * (1 - effectiveProgress)
    }
    // Assessments still use binary completion (can't partially complete a quiz)
    if (mod.assessments) {
      for (const a of mod.assessments) {
        if (!a.completed) {
          total += a.estimatedHours
        }
      }
    }
  }
  return Math.round(total * 100) / 100
}

/**
 * Total estimated hours of the entire curriculum (fixed baseline).
 */
export function calculateTotalEstimatedHours(data: TrainingData): number {
  let total = 0
  for (const mod of data.modules) {
    for (const topic of mod.topics) {
      total += topic.meta?.estimatedHours ?? 1
    }
    if (mod.assessments) {
      for (const a of mod.assessments) {
        total += a.estimatedHours
      }
    }
  }
  return total
}

// ─── Days Remaining ───

export function calculateDaysRemaining(dateOffset: number = 0): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (dateOffset) today.setDate(today.getDate() + dateOffset)

  const joiningDate = new Date(JOINING_DATE)
  joiningDate.setHours(0, 0, 0, 0)
  const diffMs = joiningDate.getTime() - today.getTime()
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

// ─── Forecast Engine ───

/**
 * Calculate the effective work-reduction rate from real study data.
 * This measures how efficiently the user's study time converts to
 * reduced estimated work. Starts at 0.5 (conservative) and converges
 * toward the user's actual efficiency over time.
 *
 * rate = (totalEstimated - remaining) / totalHoursLogged
 *
 * This makes the forecast accurate for each individual user's pace.
 */
export function calculateWorkReductionRate(
  totalEstimatedHours: number,
  remainingEstimatedWork: number,
  totalHoursSpent: number,
): number {
  if (totalHoursSpent <= 0) return 0.5 // conservative default
  const workCompleted = totalEstimatedHours - remainingEstimatedWork
  const rate = workCompleted / totalHoursSpent
  // Clamp between 0.1 and 1.0 — can't be more than 1:1
  return Math.max(0.1, Math.min(rate, 1.0))
}

export function calculateForecast(
  remainingEstimatedWork: number,
  remainingDays: number,
  todayHours: number,
  totalEstimatedHours: number,
  totalHoursSpent: number,
): ForecastData {
  const recommended = calculateRecommendedHours(remainingEstimatedWork, remainingDays)
  const reductionRate = calculateWorkReductionRate(
    totalEstimatedHours, remainingEstimatedWork, totalHoursSpent,
  )

  const remainingDaysAfterStop = Math.max(1, remainingDays - 1)

  // Projected tomorrow — what if user stops now
  // Remaining work reflects today's effort already, so just divide by fewer days
  const ifStopNow = calculateRecommendedHours(remainingEstimatedWork, remainingDaysAfterStop)

  // What if user studies 30 more minutes
  // 0.5h × reductionRate = effective work reduction
  const extraWorkReduction = 0.5 * reductionRate
  const remainingAfter30 = Math.max(0, remainingEstimatedWork - extraWorkReduction)
  const ifExtra30 = calculateRecommendedHours(remainingAfter30, remainingDaysAfterStop)

  // What if user finishes today's recommendation
  // Additional hours needed × reductionRate = effective work reduction
  const hoursNeeded = Math.max(0, recommended - todayHours)
  const targetWorkReduction = hoursNeeded * reductionRate
  const remainingAfterTarget = Math.max(0, remainingEstimatedWork - targetWorkReduction)
  const ifFinishTarget = calculateRecommendedHours(remainingAfterTarget, remainingDaysAfterStop)

  // Estimated completion date (using pace from real data)
  const pace = Math.max(0.1, todayHours > 0 ? todayHours : recommended)
  const daysToComplete = Math.ceil(remainingEstimatedWork / (pace * reductionRate))
  const estimatedCompletion = new Date()
  estimatedCompletion.setDate(estimatedCompletion.getDate() + daysToComplete)
  const joining = new Date(JOINING_DATE)
  const daysBuffer = Math.round((joining.getTime() - estimatedCompletion.getTime()) / (1000 * 60 * 60 * 24))

  const isAhead = daysBuffer >= 0
  const estimatedDelayDays = isAhead ? 0 : Math.abs(daysBuffer)

  // Suggested daily hours to catch up
  const catchUpRemaining = Math.max(1, remainingDays)
  const suggestedDailyHours = remainingEstimatedWork / catchUpRemaining

  return {
    projectedTomorrow: ifStopNow,
    ifStopNow,
    ifExtra30,
    ifFinishTarget,
    estimatedCompletionDate: estimatedCompletion.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    daysBuffer,
    isAhead,
    estimatedDelayDays,
    suggestedDailyHours: Math.round(suggestedDailyHours * 100) / 100,
  }
}

// ─── Time Distribution ───

export function calculateTimeDistribution(
  logs: DailyLogEntry[],
  sessions: StudySession[],
  dateMatcher: (date: Date) => boolean,
): TimeDistribution {
  const dist: TimeDistribution = { learning: 0, coding: 0, revision: 0, mock: 0, project: 0, break: 0 }

  // From study sessions (most accurate)
  for (const session of sessions) {
    const sessionDate = new Date(session.date + 'T00:00:00')
    if (dateMatcher(sessionDate)) {
      dist[session.type] += session.durationHours
    }
  }

  // Fallback: if no session data, estimate from logs (all counted as 'learning')
  if (sessions.length === 0) {
    for (const log of logs) {
      const logDate = new Date(log.date + 'T00:00:00')
      if (dateMatcher(logDate)) {
        dist.learning += log.hours
      }
    }
  }

  // Round to 2 decimals
  for (const key of Object.keys(dist) as (keyof TimeDistribution)[]) {
    dist[key] = Math.round(dist[key] * 100) / 100
  }

  return dist
}

export function isToday(date: Date, offset: number = 0): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (offset) today.setDate(today.getDate() + offset)
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime() === today.getTime()
}

export function isThisWeek(date: Date): boolean {
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)

  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d >= startOfWeek && d < endOfWeek
}

export function isThisMonth(date: Date): boolean {
  const now = new Date()
  const d = new Date(date)
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

// ─── Streak Engine ───

export function calculateStreak(
  logs: DailyLogEntry[],
  dateOffset?: number,
): number {
  const hoursByDate = new Map<string, number>()
  for (const log of logs) {
    const current = hoursByDate.get(log.date) ?? 0
    hoursByDate.set(log.date, current + log.hours)
  }
  if (hoursByDate.size === 0) return 0

  const sortedDates = Array.from(hoursByDate.keys()).sort().reverse()

  let streak = 0
  let currentDate = new Date()
  currentDate.setHours(0, 0, 0, 0)
  if (dateOffset) currentDate.setDate(currentDate.getDate() + dateOffset)

  for (const dateStr of sortedDates) {
    const [year, month, day] = dateStr.split('-').map(Number)
    const checkDate = new Date(year, month - 1, day)
    checkDate.setHours(0, 0, 0, 0)

    const expectedDate = new Date(currentDate)
    expectedDate.setDate(expectedDate.getDate() - streak)
    expectedDate.setHours(0, 0, 0, 0)

    if (checkDate.getTime() !== expectedDate.getTime()) break
    const totalHours = hoursByDate.get(dateStr) ?? 0
    if (totalHours < 0.5) break
    streak++
  }

  return streak
}

export function calculateLongestStreak(logs: DailyLogEntry[]): number {
  const hoursByDate = new Map<string, number>()
  for (const log of logs) {
    const current = hoursByDate.get(log.date) ?? 0
    hoursByDate.set(log.date, current + log.hours)
  }

  const sortedDates = Array.from(hoursByDate.keys()).sort()
  if (sortedDates.length === 0) return 0

  let longest = 0
  let currentStreak = 0
  let prevDate: Date | null = null

  for (const dateStr of sortedDates) {
    const [year, month, day] = dateStr.split('-').map(Number)
    const checkDate = new Date(year, month - 1, day)
    checkDate.setHours(0, 0, 0, 0)
    const hours = hoursByDate.get(dateStr) ?? 0

    if (hours < 0.5) {
      currentStreak = 0
      prevDate = null
      continue
    }

    if (prevDate) {
      const diffDays = Math.round((checkDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays === 1) {
        currentStreak++
      } else {
        currentStreak = 1
      }
    } else {
      currentStreak = 1
    }

    prevDate = checkDate
    longest = Math.max(longest, currentStreak)
  }

  return longest
}

export function calculatePerfectDays(
  logs: DailyLogEntry[],
  targetHours: number,
): number {
  const hoursByDate = new Map<string, number>()
  for (const log of logs) {
    const current = hoursByDate.get(log.date) ?? 0
    hoursByDate.set(log.date, current + log.hours)
  }

  let perfect = 0
  for (const hours of hoursByDate.values()) {
    if (hours >= targetHours) perfect++
  }
  return perfect
}

export function calculateHeatmapData(
  logs: DailyLogEntry[],
  days: number = 90,
): HeatmapData[] {
  const hoursByDate = new Map<string, number>()
  for (const log of logs) {
    const current = hoursByDate.get(log.date) ?? 0
    hoursByDate.set(log.date, current + log.hours)
  }

  const data: HeatmapData[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().slice(0, 10)
    const hours = hoursByDate.get(dateStr) ?? 0

    let intensity: 0 | 1 | 2 | 3 | 4 = 0
    if (hours > 0) {
      if (hours <= 0.5) intensity = 1
      else if (hours <= 1.5) intensity = 2
      else if (hours <= 3) intensity = 3
      else intensity = 4
    }

    data.push({ date: dateStr, hours, intensity })
  }

  return data
}

// ─── Achievements Engine ───

export function getAchievements(
  totalHoursSpent: number,
  longestStreak: number,
  completedSubtopics: number,
  totalSubtopics: number,
): Achievement[] {
  const allAchievements: Omit<Achievement, 'current'>[] = [
    { id: 'hours-50', name: '50 Hours', description: 'Log 50 total study hours', icon: 'Star', requirement: 50, unlocked: false },
    { id: 'hours-100', name: '100 Hours', description: 'Log 100 total study hours', icon: 'Star', requirement: 100, unlocked: false },
    { id: 'hours-250', name: '250 Hours', description: 'Log 250 total study hours', icon: 'Trophy', requirement: 250, unlocked: false },
    { id: 'hours-500', name: '500 Hours', description: 'Log 500 total study hours', icon: 'Trophy', requirement: 500, unlocked: false },
    { id: 'hours-1000', name: '1000 Hours', description: 'Log 1000 total study hours', icon: 'Award', requirement: 1000, unlocked: false },
    { id: 'streak-7', name: '7-Day Streak', description: 'Study 0.5h+ for 7 consecutive days', icon: 'Flame', requirement: 7, unlocked: false },
    { id: 'streak-30', name: '30-Day Streak', description: 'Study 0.5h+ for 30 consecutive days', icon: 'Flame', requirement: 30, unlocked: false },
    { id: 'all-java', name: 'Java Master', description: 'Complete all FA1 Java topics', icon: 'Code', requirement: -1, unlocked: false },
    { id: 'all-sql', name: 'SQL Master', description: 'Complete all FA2 SQL topics', icon: 'Database', requirement: -1, unlocked: false },
    { id: 'roadmap', name: 'Roadmap Complete', description: 'Complete the entire curriculum', icon: 'Trophy', requirement: -1, unlocked: false },
  ]

  return allAchievements.map(a => {
    let current = 0
    let unlocked = false

    if (a.id.startsWith('hours-')) {
      current = totalHoursSpent
      unlocked = totalHoursSpent >= a.requirement
    } else if (a.id.startsWith('streak-')) {
      current = longestStreak
      unlocked = longestStreak >= a.requirement
    } else if (a.id === 'all-java') {
      current = completedSubtopics
      unlocked = completedSubtopics >= totalSubtopics // simplified
    } else if (a.id === 'all-sql') {
      current = completedSubtopics
      unlocked = completedSubtopics >= totalSubtopics
    } else if (a.id === 'roadmap') {
      current = completedSubtopics
      unlocked = completedSubtopics >= totalSubtopics && totalSubtopics > 0
    }

    return { ...a, current, unlocked }
  })
}

// ─── Motivational Insights ───

export function generateInsights(
  todayHours: number,
  recommended: number,
  remainingHours: number,
  remainingDays: number,
  streak: number,
  moduleAnalytics: ModuleAnalytics[],
  totalHoursSpent: number,
): MotivationalInsight[] {
  const insights: MotivationalInsight[] = []
  let id = 0

  // Ahead/behind schedule
  const diff = todayHours - recommended
  if (todayHours > 0 && diff > 0.5) {
    insights.push({
      id: `insight-${id++}`,
      type: 'positive',
      message: `You are ${diff.toFixed(1)} hours ahead of schedule today. Current pace predicts strong progress.`,
      icon: 'TrendingUp',
    })
  } else if (todayHours > 0 && diff < -0.5) {
    insights.push({
      id: `insight-${id++}`,
      type: 'warning',
      message: `You are ${Math.abs(diff).toFixed(1)} hours behind today's target. Consider extending your study session.`,
      icon: 'AlertTriangle',
    })
  }

  // Module balance
  const sortedMods = [...moduleAnalytics].sort((a, b) => a.masteryPercentage - b.masteryPercentage)
  const weakest = sortedMods[0]
  const strongest = sortedMods[sortedMods.length - 1]
  if (weakest && strongest && weakest.id !== strongest.id) {
    const gap = strongest.masteryPercentage - weakest.masteryPercentage
    if (gap > 30) {
      insights.push({
        id: `insight-${id++}`,
        type: 'suggestion',
        message: `${weakest.name} is progressing ${gap.toFixed(0)}% slower than ${strongest.name}. Redirect some study time to balance your knowledge.`,
        icon: 'BarChart3',
      })
    }
  }

  // Streak milestone
  if (streak > 0 && streak % 7 === 0) {
    insights.push({
      id: `insight-${id++}`,
      type: 'milestone',
      message: `🔥 ${streak}-day streak! You've maintained consistency for ${streak} consecutive days. Keep it up!`,
      icon: 'Flame',
    })
  }

  // Total hours milestone
  if (totalHoursSpent > 0) {
    const milestoneHours = [50, 100, 250, 500, 1000].find(h => totalHoursSpent >= h && totalHoursSpent - todayHours < h)
    if (milestoneHours) {
      insights.push({
        id: `insight-${id++}`,
        type: 'milestone',
        message: `🎉 You've crossed ${milestoneHours} total study hours! That's a significant achievement.`,
        icon: 'Award',
      })
    }
  }

  // General pace check
  if (remainingDays > 0 && remainingHours > 0) {
    const pace = remainingHours / remainingDays
    if (pace > 5) {
      insights.push({
        id: `insight-${id++}`,
        type: 'suggestion',
        message: `Your remaining workload requires ${pace.toFixed(1)}h/day. Consider prioritising high-weight topics or extending daily study time.`,
        icon: 'Target',
      })
    }
  }

  if (insights.length === 0) {
    insights.push({
      id: `insight-${id++}`,
      type: 'positive',
      message: 'Everything looks balanced. Keep up your consistent study routine!',
      icon: 'Sparkles',
    })
  }

  return insights
}

// ─── Session Tracking ───

export function calculateDeepWorkHours(sessions: StudySession[]): number {
  return sessions
    .filter(s => s.durationHours >= 1.5 && s.type !== 'break')
    .reduce((sum, s) => sum + s.durationHours, 0)
}

export function calculateLongestSession(sessions: StudySession[]): number {
  if (sessions.length === 0) return 0
  return Math.max(...sessions.filter(s => s.type !== 'break').map(s => s.durationHours))
}

export function calculateAverageDailyHours(
  logs: DailyLogEntry[],
): number {
  if (logs.length === 0) return 0

  // Find the first and last dates in the logs
  const sortedDates = Array.from(new Set(logs.map(l => l.date))).sort()
  if (sortedDates.length === 0) return 0

  const firstDate = new Date(sortedDates[0] + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Days since first study session (minimum 1)
  const diffMs = today.getTime() - firstDate.getTime()
  const daysSinceFirstLog = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))

  const total = logs.reduce((sum, log) => sum + log.hours, 0)
  return Math.round((total / daysSinceFirstLog) * 100) / 100
}

// ─── Count missed / partial days ───

export function calculateDayClassification(
  logs: DailyLogEntry[],
  targetHours: number,
  days: number = 30,
): { partialDays: number; missedDays: number } {
  const hoursByDate = new Map<string, number>()
  for (const log of logs) {
    const current = hoursByDate.get(log.date) ?? 0
    hoursByDate.set(log.date, current + log.hours)
  }

  let partial = 0
  let missed = 0
  const today = new Date()

  for (let i = 0; i < days; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().slice(0, 10)
    const hours = hoursByDate.get(dateStr) ?? 0

    if (hours === 0) {
      missed++
    } else if (hours < targetHours) {
      partial++
    }
  }

  return { partialDays: partial, missedDays: missed }
}

// ─── Format ───

export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ─── All Subtopics / Assessments ───

export function getAllSubtopics(data: TrainingData) {
  return data.modules.flatMap(m => m.topics.flatMap(t => t.subtopics))
}

export function getAllAssessments(data: TrainingData) {
  return data.modules.flatMap(m => m.assessments ?? [])
}

// ─── Next Study Topic ───

export function getNextStudyTopic(data: TrainingData) {
  for (const mod of data.modules) {
    for (const t of mod.topics) {
      const total = t.subtopics.length
      const completed = t.subtopics.filter(s => s.completed).length
      if (completed < total) {
        return {
          topicId: t.id,
          topicName: t.name,
          moduleName: mod.name,
          estimatedHours: t.meta?.estimatedHours ?? 1,
          difficulty: t.meta?.difficulty ?? 'beginner' as DifficultyLevel,
          progressPercent: total > 0 ? (completed / total) * 100 : 0,
        }
      }
    }
  }
  return undefined
}

// ─── Master Metrics Calculator ───

export function calculateMetrics(
  data: TrainingData,
  options?: { dateOffset?: number },
): DashboardMetrics {
  const offset = options?.dateOffset ?? 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (offset) today.setDate(today.getDate() + offset)

  // ─── Core counts ───

  const allSubtopics = getAllSubtopics(data)
  const totalSubtopics = allSubtopics.length
  const completedSubtopics = allSubtopics.filter(s => s.completed).length
  const overallProgress = totalSubtopics > 0 ? (completedSubtopics / totalSubtopics) * 100 : 100

  const totalHoursSpent = allSubtopics.reduce((sum, s) => sum + s.hoursSpent, 0)
  const totalEstimatedHours = calculateTotalEstimatedHours(data)
  const remainingEstimatedWork = calculateRemainingEstimatedWork(data)
  const daysRemaining = calculateDaysRemaining(offset)

  // ─── Adaptive target ───

  const adaptiveDailyTarget = calculateRecommendedHours(remainingEstimatedWork, daysRemaining)

  // ─── Today's hours ───

  const todayStr = formatDate(today)
  const todayHours = data.dailyLogs
    .filter(log => log.date === todayStr)
    .reduce((sum, log) => sum + log.hours, 0)

  // ─── Streak ───

  const streakDays = calculateStreak(data.dailyLogs, offset)
  const longestStreak = calculateLongestStreak(data.dailyLogs)

  // ─── Forecast ───

  const forecast = calculateForecast(
    remainingEstimatedWork, daysRemaining, todayHours,
    totalEstimatedHours, totalHoursSpent,
  )

  // ─── Time distribution ───

  const sessions = data.studySessions ?? []
  const todayDistribution = calculateTimeDistribution(
    data.dailyLogs, sessions,
    (d) => isToday(d, offset),
  )
  const weeklyDistribution = calculateTimeDistribution(
    data.dailyLogs, sessions, isThisWeek,
  )
  const monthlyDistribution = calculateTimeDistribution(
    data.dailyLogs, sessions, isThisMonth,
  )
  const lifetimeDistribution = calculateTimeDistribution(
    data.dailyLogs, sessions, () => true,
  )

  // ─── Module analytics ───

  const moduleAnalytics: ModuleAnalytics[] = data.modules.map(m => {
    const moduleSubtopics = m.topics.flatMap(t => t.subtopics)
    const mHours = moduleSubtopics.reduce((s, st) => s + st.hoursSpent, 0)
    const mTotal = moduleSubtopics.length
    const mCompleted = moduleSubtopics.filter(st => st.completed).length
    return {
      name: m.name,
      id: m.id,
      hours: mHours,
      weight: m.weight,
      completedSubtopics: mCompleted,
      totalSubtopics: mTotal,
      masteryPercentage: mTotal > 0 ? (mCompleted / mTotal) * 100 : 0,
    }
  })

  // ─── Heatmap ───

  const heatmapData = calculateHeatmapData(data.dailyLogs)

  // ─── Day classification ───

  const { partialDays, missedDays } = calculateDayClassification(data.dailyLogs, adaptiveDailyTarget)

  // ─── Session stats ───

  const deepWorkHours = calculateDeepWorkHours(sessions)
  const longestSession = calculateLongestSession(sessions)
  const averageDailyHours = calculateAverageDailyHours(data.dailyLogs)

  // ─── Assessments ───

  const allAssessments = getAllAssessments(data)
  const totalAssessments = allAssessments.length
  const completedAssessments = allAssessments.filter(a => a.completed).length

  // ─── Next topic ───

  const nextTopic = getNextStudyTopic(data)

  // ─── Achievements ───

  const achievements = getAchievements(totalHoursSpent, longestStreak, completedSubtopics, totalSubtopics)

  // ─── Insights ───

  const insights = generateInsights(
    todayHours, adaptiveDailyTarget,
    remainingEstimatedWork, daysRemaining,
    streakDays, moduleAnalytics, totalHoursSpent,
  )

  return {
    daysRemaining,
    overallProgress,
    totalSubtopics,
    completedSubtopics,
    totalHoursSpent,
    remainingHours: remainingEstimatedWork,
    adaptiveDailyTarget,
    todayHours,
    streakDays,
    moduleAnalytics,
    totalAssessments,
    completedAssessments,
    nextStudyTopic: nextTopic,

    // Adaptive Study Load Engine fields
    totalEstimatedHours,
    remainingEstimatedWork,
    forecast,
    todayDistribution,
    weeklyDistribution,
    monthlyDistribution,
    lifetimeDistribution,
    longestStreak,
    perfectDays: calculatePerfectDays(data.dailyLogs, adaptiveDailyTarget),
    partialDays,
    missedDays,
    heatmapData,
    averageDailyHours,
    deepWorkHours,
    longestSession,
    sessionCount: sessions.length,
    achievements,
    insights,
    isTimerRunning: false,
    timerElapsedSeconds: 0,
  }
}
