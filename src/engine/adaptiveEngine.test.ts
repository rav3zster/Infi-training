import { describe, it, expect } from 'vitest'
import {
  calculateRecommendedHours,
  calculateSubTopicEstimate,
  calculateSubTopicEstimateMinutes,
  calculateCompletionTopUp,
  calculateLearningSpeedFactor,
  calculateRemainingEstimatedWork,
  calculateTotalEstimatedHours,
  calculateTopicEffectiveProgress,
  calculateForecast,
  calculateStreak,
  calculateLongestStreak,
  calculateDayClassification,
  formatDuration,
  formatHours,
  getAchievements,
  calculateMetrics,
  formatDate,
} from './adaptiveEngine'
import { createSeedData } from '../data/curriculum'
import type { TrainingData, Topic, SubTopic } from '../types'

function makeTopic(subtopics: { minutes?: number; completed?: boolean; hoursSpent?: number }[], estimatedHours = 1): Topic {
  return {
    id: 't1',
    name: 'Topic',
    subtopics: subtopics.map((s, i) => ({
      id: `t1-s${i + 1}`,
      name: `Sub ${i + 1}`,
      completed: s.completed ?? false,
      hoursSpent: s.hoursSpent ?? 0,
      lastStudied: '',
      baseEstimateMinutes: s.minutes ?? 30,
    })),
    meta: {
      difficulty: 'beginner',
      estimatedHours,
      learningObjectives: [],
      prerequisites: [],
      exercises: [],
    },
  }
}

function makeData(modules: { topics: Topic[] }[]): TrainingData {
  return {
    modules: modules.map((m, i) => ({
      id: `m${i + 1}`,
      name: `Module ${i + 1}`,
      weight: 50,
      topics: m.topics,
    })),
    dailyLogs: [],
    studySessions: [],
  }
}

// ─── Formatting ───

describe('formatDuration / formatHours', () => {
  it('renders natural durations — never decimal hours', () => {
    expect(formatDuration(15)).toBe('15m')
    expect(formatDuration(59)).toBe('59m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(-5)).toBe('0m')
  })

  it('formatHours converts hours to natural durations', () => {
    expect(formatHours(0.5)).toBe('30m')
    expect(formatHours(1.25)).toBe('1h 15m')
    expect(formatHours(2)).toBe('2h')
  })
})

// ─── Core formula ───

describe('calculateRecommendedHours', () => {
  it('divides remaining work by remaining days', () => {
    expect(calculateRecommendedHours(175, 50)).toBe(3.5)
    expect(calculateRecommendedHours(169, 49)).toBeCloseTo(3.449, 2)
    expect(calculateRecommendedHours(0, 10)).toBe(0)
  })

  it('returns all remaining work when days run out', () => {
    expect(calculateRecommendedHours(12, 0)).toBe(12)
  })
})

// ─── Per-subtopic estimates & top-up ───

describe('calculateSubTopicEstimate', () => {
  const topic = makeTopic([{ minutes: 45 }, { minutes: 15 }, { minutes: 60 }])

  it('uses the subtopic base estimate, not an even split', () => {
    expect(calculateSubTopicEstimate(topic, topic.subtopics[0])).toBe(0.75)
    expect(calculateSubTopicEstimate(topic, topic.subtopics[1])).toBe(0.25)
    expect(calculateSubTopicEstimate(topic, topic.subtopics[2])).toBe(1)
  })

  it('applies the learning-speed factor', () => {
    expect(calculateSubTopicEstimate(topic, topic.subtopics[0], 1.5)).toBe(1.13)
  })

  it('falls back to even split for legacy subtopics without estimates', () => {
    const legacy: Topic = {
      id: 't2',
      name: 'Legacy',
      subtopics: [
        { id: 's1', name: 'A', completed: false, hoursSpent: 0, lastStudied: '' },
        { id: 's2', name: 'B', completed: false, hoursSpent: 0, lastStudied: '' },
      ],
      meta: { difficulty: 'beginner', estimatedHours: 2, learningObjectives: [], prerequisites: [], exercises: [] },
    }
    expect(calculateSubTopicEstimate(legacy, legacy.subtopics[0])).toBe(1)
  })
})

describe('calculateSubTopicEstimateMinutes', () => {
  it('returns whole minutes', () => {
    const topic = makeTopic([{ minutes: 45 }])
    expect(calculateSubTopicEstimateMinutes(topic, topic.subtopics[0])).toBe(45)
  })
})

describe('calculateCompletionTopUp (Method 2 — duplicate protection)', () => {
  const topic = makeTopic([{ minutes: 45 }])
  const est = topic.subtopics[0] // 0.75h estimate

  it('credits the full estimate when nothing was logged', () => {
    expect(calculateCompletionTopUp(topic, est)).toBe(0.75)
  })

  it('credits only the remaining time when partially logged', () => {
    const partiallyLogged: SubTopic = { ...est, hoursSpent: 0.5 }
    expect(calculateCompletionTopUp(topic, partiallyLogged)).toBeCloseTo(0.25, 2)
  })

  it('credits nothing when actual time exceeds the estimate', () => {
    const overStudied: SubTopic = { ...est, hoursSpent: 1 }
    expect(calculateCompletionTopUp(topic, overStudied)).toBe(0)
  })
})

// ─── Effective progress ───

describe('calculateTopicEffectiveProgress', () => {
  it('combines hours and checklist signals', () => {
    const topic = makeTopic([{ completed: true }, { completed: true }, {}], 3)
    expect(calculateTopicEffectiveProgress(topic)).toBeCloseTo(2 / 3, 3)
  })

  it('caps hours-only progress at 0.9 (anti-abuse)', () => {
    const topic = makeTopic([{ hoursSpent: 10 }, { hoursSpent: 0 }, { hoursSpent: 0 }], 2)
    expect(calculateTopicEffectiveProgress(topic)).toBe(0.9)
  })
})

// ─── Learning-speed factor ───

/**
 * Helper: timer-sourced logs on subtopics t1-s1..sN, each with base 30m (0.5h).
 */
function makeTimerLogs(subtopicIds: string[], hours: number | number[]) {
  return subtopicIds.map((id, i) => ({
    id: `log-${i}`,
    date: formatDate(new Date()),
    subtopicId: id,
    subtopicName: id,
    hours: Array.isArray(hours) ? hours[i] : hours,
  }))
}

describe('calculateLearningSpeedFactor', () => {
  it('returns 1 with no timer logs', () => {
    const data = makeData([{ topics: [makeTopic([{}, {}])] }])
    expect(calculateLearningSpeedFactor(data)).toBe(1)
  })

  it('requires at least 3 sampled subtopics', () => {
    const data = makeData([{ topics: [makeTopic([{}, {}])] }])
    data.dailyLogs = makeTimerLogs(['t1-s1', 't1-s2'], 1)
    expect(calculateLearningSpeedFactor(data)).toBe(1)
  })

  it('learns the user is slower than estimates (factor > 1)', () => {
    const data = makeData([{ topics: [makeTopic([{}, {}, {}])] }]) // each est 0.5h
    data.dailyLogs = makeTimerLogs(['t1-s1', 't1-s2', 't1-s3'], 0.75) // 1.5× slower
    expect(calculateLearningSpeedFactor(data)).toBe(1.5)
  })

  it('learns the user is faster than estimates (factor < 1)', () => {
    const data = makeData([{ topics: [makeTopic([{}, {}, {}])] }]) // each est 0.5h
    data.dailyLogs = makeTimerLogs(['t1-s1', 't1-s2', 't1-s3'], 0.4) // 0.8× pace
    expect(calculateLearningSpeedFactor(data)).toBeCloseTo(0.8, 3)
  })

  it('clamps the factor so it can never spike beyond 1.5x', () => {
    const data = makeData([{ topics: [makeTopic([{}, {}, {}])] }])
    data.dailyLogs = makeTimerLogs(['t1-s1', 't1-s2', 't1-s3'], 5) // 10× raw, clamped
    expect(calculateLearningSpeedFactor(data)).toBe(1.5)
  })

  it('ignores completion-credit logs entirely', () => {
    const data = makeData([{ topics: [makeTopic([{}, {}, {}])] }])
    data.dailyLogs = makeTimerLogs(['t1-s1', 't1-s2', 't1-s3'], 1).map(l => ({ ...l, source: 'completion' as const }))
    expect(calculateLearningSpeedFactor(data)).toBe(1)
  })
})

// ─── Remaining work ───

describe('calculateRemainingEstimatedWork', () => {
  it('starts at the full estimate when nothing is done', () => {
    const data = makeData([{ topics: [makeTopic([{}, {}], 4)] }])
    expect(calculateRemainingEstimatedWork(data)).toBe(4)
  })

  it('reduces continuously as hours are logged', () => {
    const data = makeData([{ topics: [makeTopic([{ hoursSpent: 2 }, {}], 4)] }])
    // 2h logged on a 4h topic → 50% hours progress → 2h remaining
    expect(calculateRemainingEstimatedWork(data)).toBe(2)
  })

  it('reaches 0 when everything is completed', () => {
    const data = makeData([{ topics: [makeTopic([{ completed: true }, { completed: true }], 2)] }])
    expect(calculateRemainingEstimatedWork(data)).toBe(0)
  })
})

describe('calculateTotalEstimatedHours', () => {
  it('sums topic estimates across modules', () => {
    const data = makeData([{ topics: [makeTopic([{}, {}], 2)] }, { topics: [makeTopic([{}], 3)] }])
    expect(calculateTotalEstimatedHours(data)).toBe(5)
  })
})

// ─── Forecast ───

describe('calculateForecast', () => {
  it('produces coherent scenario values', () => {
    const forecast = calculateForecast(100, 40, 3, 122, 5)
    expect(forecast.ifStopNow).toBeCloseTo(100 / 39, 2)
    expect(forecast.ifExtra30).toBeLessThan(forecast.ifStopNow)
    expect(forecast.ifFinishTarget).toBeLessThanOrEqual(forecast.ifStopNow)
    expect(forecast.suggestedDailyHours).toBeCloseTo(100 / 40, 2)
    expect(forecast.daysBuffer).toBeGreaterThanOrEqual(-1000)
  })

  it('flags being ahead when completion precedes joining', () => {
    const forecast = calculateForecast(10, 50, 8, 122, 30)
    expect(typeof forecast.isAhead).toBe('boolean')
  })
})

// ─── Streak ───

describe('calculateStreak / calculateLongestStreak', () => {
  const today = formatDate(new Date())
  const day = 24 * 60 * 60 * 1000
  const dateStr = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }
  const prev1 = new Date(Date.now() - day)
  const prev2 = new Date(Date.now() - 2 * day)

  it('counts consecutive days with >= 0.5h', () => {
    const logs = [
      { id: 'a', date: dateStr(prev2), subtopicId: 'a', subtopicName: 'a', hours: 1 },
      { id: 'b', date: dateStr(prev1), subtopicId: 'a', subtopicName: 'a', hours: 1 },
      { id: 'c', date: today, subtopicId: 'a', subtopicName: 'a', hours: 1 },
    ]
    expect(calculateStreak(logs)).toBe(3)
  })

  it('breaks the streak when a day is skipped', () => {
    const logs = [
      { id: 'a', date: dateStr(prev2), subtopicId: 'a', subtopicName: 'a', hours: 1 },
      { id: 'b', date: today, subtopicId: 'a', subtopicName: 'a', hours: 1 },
    ]
    expect(calculateStreak(logs)).toBe(1)
  })

  it('requires >= 0.5h to count a day', () => {
    const logs = [
      { id: 'a', date: today, subtopicId: 'a', subtopicName: 'a', hours: 0.3 },
    ]
    expect(calculateStreak(logs)).toBe(0)
  })

  it('calculateLongestStreak handles multi-day history', () => {
    const logs = [
      { id: 'a', date: dateStr(prev2), subtopicId: 'a', subtopicName: 'a', hours: 1 },
      { id: 'b', date: dateStr(prev1), subtopicId: 'a', subtopicName: 'a', hours: 1 },
      { id: 'c', date: today, subtopicId: 'a', subtopicName: 'a', hours: 1 },
    ]
    expect(calculateLongestStreak(logs)).toBe(3)
  })
})

// ─── Day classification ───


describe('calculateDayClassification', () => {
  it('classifies partial and missed days — today is excluded (not yet elapsed)', () => {
    const todayStr = formatDate(new Date())
    const day = 24 * 60 * 60 * 1000
    const dateStr = (d: Date) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${dd}`
    }
    const prev1 = new Date(Date.now() - day)
    const logs = [
      // today: should be IGNORED — the day has not elapsed yet
      { id: 'a', date: todayStr, subtopicId: 'a', subtopicName: 'a', hours: 1 },
      // yesterday: partial (0.2h < 3h target)
      { id: 'b', date: dateStr(prev1), subtopicId: 'a', subtopicName: 'a', hours: 0.2 },
    ]
    const { partialDays, missedDays } = calculateDayClassification(logs, 3, 30)
    // Window covers yesterday … 30 days ago (30 days, today excluded).
    // 1 partial day (yesterday), 29 missed days.
    expect(partialDays).toBe(1)
    expect(missedDays).toBe(29)
  })
})


// ─── Achievements (module-scoped) ───

describe('getAchievements', () => {
  const moduleAnalytics = [
    { name: 'Web', id: 'm1', hours: 0, weight: 15, completedSubtopics: 3, totalSubtopics: 3, masteryPercentage: 100 },
    { name: 'Java', id: 'm2', hours: 0, weight: 45, completedSubtopics: 20, totalSubtopics: 24, masteryPercentage: 83 },
    { name: 'SQL', id: 'm3', hours: 0, weight: 40, completedSubtopics: 5, totalSubtopics: 5, masteryPercentage: 100 },
  ]

  it('unlocks SQL Master when SQL is complete even if Java is not', () => {
    const achievements = getAchievements(100, 10, moduleAnalytics)
    const sql = achievements.find(a => a.id === 'all-sql')!
    const java = achievements.find(a => a.id === 'all-java')!
    expect(sql.unlocked).toBe(true)
    expect(java.unlocked).toBe(false)
  })

  it('roadmap requires every module complete', () => {
    const achievements = getAchievements(100, 10, moduleAnalytics)
    expect(achievements.find(a => a.id === 'roadmap')!.unlocked).toBe(false)
  })

  it('unlocks hour milestones', () => {
    const achievements = getAchievements(120, 1, moduleAnalytics)
    expect(achievements.find(a => a.id === 'hours-50')!.unlocked).toBe(true)
    expect(achievements.find(a => a.id === 'hours-100')!.unlocked).toBe(true)
    expect(achievements.find(a => a.id === 'hours-250')!.unlocked).toBe(false)
  })
})

// ─── Master metrics ───

describe('calculateMetrics', () => {
  it('derives all dashboard metrics from seed data', () => {
    const data = createSeedData()
    const metrics = calculateMetrics(data)
    expect(metrics.totalSubtopics).toBeGreaterThan(100)
    expect(metrics.totalEstimatedHours).toBeGreaterThan(100)
    expect(metrics.remainingEstimatedWork).toBeCloseTo(metrics.totalEstimatedHours, 0)
    expect(metrics.overallProgress).toBe(0)
    expect(metrics.learningSpeedFactor).toBe(1)
    expect(metrics.adaptiveDailyTarget).toBeGreaterThan(0)
    expect(metrics.daysRemaining).toBeGreaterThan(0)
  })

  it('completion credit flows into remaining work', () => {
    const data = createSeedData()
    const sub = data.modules[0].topics[0].subtopics[0]
    sub.completed = true
    sub.hoursSpent = calculateCompletionTopUp(data.modules[0].topics[0], sub)
    data.dailyLogs.push({ id: 'credit-1', date: formatDate(new Date()), subtopicId: sub.id, subtopicName: sub.name, hours: sub.hoursSpent, source: 'completion' })
    const metrics = calculateMetrics(data)
    expect(metrics.completedSubtopics).toBe(1)
    expect(metrics.remainingEstimatedWork).toBeLessThan(metrics.totalEstimatedHours)
    expect(metrics.totalHoursSpent).toBeGreaterThan(0)
  })
})
