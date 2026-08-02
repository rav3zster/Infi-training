import { describe, it, expect } from 'vitest'
import { calculateReadinessScore } from './readinessEngine'
import { createSeedData, calculateMetrics } from '../data/curriculum'

describe('readinessEngine', () => {
  it('calculates 0% readiness on fresh seed data', () => {
    const data = createSeedData()
    const metrics = calculateMetrics(data)
    const report = calculateReadinessScore(data, metrics)

    expect(report.overallReadiness).toBe(0)
    expect(report.fa1Score).toBe(0)
    expect(report.fa2Score).toBe(0)
    expect(report.genericScore).toBe(0)
    expect(report.status).toBe('not-ready')
    expect(report.moduleBreakdown).toHaveLength(3)
    expect(report.recommendations.length).toBeGreaterThan(0)
  })

  it('calculates 100% readiness when all subtopics are completed', () => {
    const data = createSeedData()
    for (const m of data.modules) {
      for (const t of m.topics) {
        for (const s of t.subtopics) {
          s.completed = true
        }
      }
      for (const a of m.assessments ?? []) {
        a.completed = true
      }
    }

    const metrics = calculateMetrics(data)
    const report = calculateReadinessScore(data, metrics)

    expect(report.overallReadiness).toBe(100)
    expect(report.fa1Score).toBe(100)
    expect(report.fa2Score).toBe(100)
    expect(report.genericScore).toBe(100)
    expect(report.status).toBe('mastered')
  })
})
