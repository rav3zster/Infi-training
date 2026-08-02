export type DifficultyLevel =
  | 'beginner'
  | 'beginner-intermediate'
  | 'intermediate'
  | 'intermediate-advanced'
  | 'advanced'

export type TopicType = 'core' | 'practice' | 'project'

export type SessionType = 'learning' | 'coding' | 'revision' | 'mock' | 'project' | 'break'

export interface TopicMeta {
  difficulty: DifficultyLevel
  estimatedHours: number
  learningObjectives: string[]
  prerequisites: string[]
  exercises: string[]
}

export interface SubTopic {
  id: string
  name: string
  completed: boolean
  hoursSpent: number
  lastStudied: string
  /**
   * Complexity-based estimated study time for THIS atomic subtopic (minutes).
   * Assigned per subtopic in the curriculum; never the same for every subtopic.
   * Backfilled on load for data saved before this field existed.
   */
  baseEstimateMinutes?: number
}

export interface Topic {
  id: string
  name: string
  subtopics: SubTopic[]
  /** Rich curriculum metadata */
  meta?: TopicMeta
}

export interface Assessment {
  id: string
  name: string
  type: 'quiz' | 'revision' | 'mini-project' | 'mock' | 'capstone'
  estimatedHours: number
  description: string
  prerequisites: string[]
  completed: boolean
  score?: number
  lastAttempted: string
}

export interface Module {
  id: string
  name: string
  weight: number
  topics: Topic[]
  /** Optional assessments/revision checkpoints for this module */
  assessments?: Assessment[]
  /** Learning phase label */
  phase?: string
  /** Phase order number */
  phaseOrder?: number
}

export interface DailyLogEntry {
  date: string
  subtopicId: string
  subtopicName: string
  hours: number
  /** How this time was recorded: 'timer' (manual logging) or 'completion' (auto-credited on topic completion) */
  source?: 'timer' | 'completion'
}

export interface StudySession {
  id: string
  date: string
  startTime: string
  endTime: string
  durationHours: number
  type: SessionType
  subtopicId: string
  subtopicName: string
  moduleName: string
  notes?: string
  /** How this session was recorded: 'timer' or 'completion' */
  source?: 'timer' | 'completion'
}

export interface TrainingData {
  modules: Module[]
  dailyLogs: DailyLogEntry[]
  studySessions?: StudySession[]
}

export interface ModuleAnalytics {
  name: string
  id: string
  hours: number
  weight: number
  completedSubtopics: number
  totalSubtopics: number
  masteryPercentage: number
}

export interface TimeDistribution {
  learning: number
  coding: number
  revision: number
  mock: number
  project: number
  break: number
}

export interface ForecastData {
  projectedTomorrow: number
  ifStopNow: number
  ifExtra30: number
  ifFinishTarget: number
  estimatedCompletionDate: string
  daysBuffer: number
  isAhead: boolean
  estimatedDelayDays: number
  suggestedDailyHours: number
}

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  requirement: number
  current: number
  unlocked: boolean
  unlockedAt?: string
}

export interface MotivationalInsight {
  id: string
  type: 'positive' | 'warning' | 'suggestion' | 'milestone'
  message: string
  icon: string
}

export interface HeatmapData {
  date: string
  hours: number
  intensity: 0 | 1 | 2 | 3 | 4
}

export interface DashboardMetrics {
  daysRemaining: number
  overallProgress: number
  totalSubtopics: number
  completedSubtopics: number
  totalHoursSpent: number
  remainingHours: number
  adaptiveDailyTarget: number
  todayHours: number
  streakDays: number
  moduleAnalytics: ModuleAnalytics[]

  /** Total assessments */
  totalAssessments: number
  completedAssessments: number

  /** Next topic to study recommendation */
  nextStudyTopic?: {
    topicId: string
    topicName: string
    moduleName: string
    estimatedHours: number
    difficulty: DifficultyLevel
    progressPercent: number
  }

  // ─── Adaptive Study Load Engine ───

  /** Total estimated hours of the entire curriculum */
  totalEstimatedHours: number
  /** Personalized learning-speed factor (base × factor = current estimate) */
  learningSpeedFactor: number
  /** Remaining estimated work (topics not completed lose their estimated hours) */
  remainingEstimatedWork: number
  /** Projected tomorrow's recommendation based on today's actual hours */
  forecast: ForecastData
  /** Time distribution for today */
  todayDistribution: TimeDistribution
  /** Time distribution for current week */
  weeklyDistribution: TimeDistribution
  /** Time distribution for current month */
  monthlyDistribution: TimeDistribution
  /** Lifetime time distribution */
  lifetimeDistribution: TimeDistribution
  /** Longest streak ever achieved */
  longestStreak: number
  /** Perfect days (met or exceeded target) */
  perfectDays: number
  /** Partial days (studied but below target) */
  partialDays: number
  /** Missed days (no study) in last 30 days */
  missedDays: number
  /** Heatmap data for last 90 days */
  heatmapData: HeatmapData[]
  /** Average daily study hours (lifetime) */
  averageDailyHours: number
  /** Deep work hours (sessions >= 1.5h) */
  deepWorkHours: number
  /** Longest single session */
  longestSession: number
  /** Total session count */
  sessionCount: number
  /** Unlocked achievements */
  achievements: Achievement[]
  /** Motivational insights */
  insights: MotivationalInsight[]
  /** Is the timer currently running */
  isTimerRunning: boolean
  /** Current timer elapsed seconds */
  timerElapsedSeconds: number
}
