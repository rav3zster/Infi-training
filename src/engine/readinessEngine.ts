import type { TrainingData, DashboardMetrics } from '../types'
import { getAllAssessments } from '../data/curriculum'

export interface ModuleReadiness {
  moduleId: string
  moduleName: string
  weight: number
  masteryPercentage: number
  readinessContribution: number
}

export interface ReadinessReport {
  overallReadiness: number
  fa1Score: number
  fa2Score: number
  genericScore: number
  status: 'not-ready' | 'getting-there' | 'exam-ready' | 'mastered'
  moduleBreakdown: ModuleReadiness[]
  recommendations: Array<{
    title: string
    impact: string
    action: string
  }>
}

/**
 * Infosys FA1 / FA2 Readiness Score Engine
 * ──────────────────────────────────────────────
 * Computes an examination readiness score (0-100%) weighted by the official Infosys prep modules:
 *   • FA1 (Java Programming & OOPs): 45% weight
 *   • FA2 (Relational Databases & SQL): 40% weight
 *   • Generic Training (Web & Basics): 15% weight
 */
export function calculateReadinessScore(data: TrainingData, metrics: DashboardMetrics): ReadinessReport {
  const breakdown: ModuleReadiness[] = data.modules.map(mod => {
    const analytics = metrics.moduleAnalytics.find(m => m.id === mod.id)
    const masteryPercentage = analytics?.masteryPercentage ?? 0
    const weight = mod.weight ?? 33.33
    const readinessContribution = Math.round((masteryPercentage * weight) / 100 * 10) / 10

    return {
      moduleId: mod.id,
      moduleName: mod.name,
      weight,
      masteryPercentage,
      readinessContribution,
    }
  })

  // Module scores (1 decimal place consistency)
  const genericMod = breakdown.find(b => b.moduleId === 'm1')
  const javaMod = breakdown.find(b => b.moduleId === 'm2')
  const sqlMod = breakdown.find(b => b.moduleId === 'm3')

  const genericScore = Math.round((genericMod?.masteryPercentage ?? 0) * 10) / 10
  const fa1Score = Math.round((javaMod?.masteryPercentage ?? 0) * 10) / 10
  const fa2Score = Math.round((sqlMod?.masteryPercentage ?? 0) * 10) / 10

  // Overall weighted score
  const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0)
  const weightedSum = breakdown.reduce((s, b) => s + (b.masteryPercentage * b.weight), 0)
  const overallReadiness = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0

  let status: ReadinessReport['status'] = 'not-ready'
  if (overallReadiness >= 90) status = 'mastered'
  else if (overallReadiness >= 75) status = 'exam-ready'
  else if (overallReadiness >= 40) status = 'getting-there'

  // High-leverage dynamic recommendations
  const recommendations: ReadinessReport['recommendations'] = []

  if (fa1Score < 80 && javaMod) {
    const javaIncomplete = data.modules
      .find(m => m.id === 'm2')
      ?.topics.flatMap(t => t.subtopics)
      .filter(s => !s.completed) ?? []

    const topicList = javaIncomplete.slice(0, 3).map(s => s.name).join(', ')
    const actionText = topicList
      ? `Complete remaining subtopics in Module 2 (${topicList}).`
      : 'Complete remaining subtopics in Module 2 (Java & OOPs).'

    recommendations.push({
      title: 'Focus on FA1 — Java & OOPs',
      impact: '+45% Exam Weight',
      action: actionText,
    })
  }

  if (fa2Score < 80 && sqlMod) {
    const sqlIncomplete = data.modules
      .find(m => m.id === 'm3')
      ?.topics.flatMap(t => t.subtopics)
      .filter(s => !s.completed) ?? []

    const topicList = sqlIncomplete.slice(0, 3).map(s => s.name).join(', ')
    const actionText = topicList
      ? `Master remaining SQL subtopics (${topicList}).`
      : 'Master SQL Joins, Sub-queries, and Normalization in Module 3.'

    recommendations.push({
      title: 'Focus on FA2 — SQL & Relational Databases',
      impact: '+40% Exam Weight',
      action: actionText,
    })
  }

  const allAssessments = getAllAssessments(data)
  const pendingAssessments = allAssessments.filter(a => !a.completed)
  if (pendingAssessments.length > 0) {
    recommendations.push({
      title: `${pendingAssessments.length} Pending Assessments`,
      impact: 'Knowledge Verification',
      action: `Take pending ${pendingAssessments[0].type} assessment: "${pendingAssessments[0].name}".`,
    })
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Ready for Joining Date!',
      impact: 'Peak Preparation',
      action: 'Maintain your revision schedule and review key topics periodically.',
    })
  }

  return {
    overallReadiness,
    fa1Score,
    fa2Score,
    genericScore,
    status,
    moduleBreakdown: breakdown,
    recommendations,
  }
}
