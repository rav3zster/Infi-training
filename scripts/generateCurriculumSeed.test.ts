import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createSeedData } from '../src/data/curriculum'

/**
 * Curriculum seed generator.
 *
 * The app's curriculum (modules/topics/subtopics/assessments) is STATIC seed
 * data that the client CANNOT write under RLS (SELECT-only policies). It must
 * be seeded into Supabase once via the SQL editor or the service role.
 *
 * Run:  npx vitest run scripts/generateCurriculumSeed.test.ts
 * Writes:  supabase/seed_curriculum.sql  (idempotent, ON CONFLICT DO NOTHING)
 */

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/seed_curriculum.sql')

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function sqlArray(arr: string[] | undefined): string {
  if (!arr || arr.length === 0) return "'{}'::text[]"
  return `ARRAY[${arr.map(sqlStr).join(', ')}]`
}

function sqlDate(d: string | null): string {
  return d ? sqlStr(d) : 'NULL'
}

describe('curriculum seed generator', () => {
  it('writes supabase/seed_curriculum.sql from the app curriculum', () => {
    const data = createSeedData()
    expect(data.modules.length).toBe(3)

    const lines: string[] = []
    lines.push('-- ============================================================================')
    lines.push('-- seed_curriculum.sql — generated from src/data/curriculum.ts (createSeedData)')
    lines.push('--')
    lines.push('-- The client cannot write curriculum tables under RLS (SELECT-only policies).')
    lines.push('-- Run this ONCE in the Supabase SQL Editor (or via the service role) so the')
    lines.push('-- app can reference module/topic/subtopic ids when syncing user progress.')
    lines.push('-- Safe to re-run: all inserts use ON CONFLICT (id) DO NOTHING.')
    lines.push('-- ============================================================================')
    lines.push('')
    lines.push('BEGIN;')
    lines.push('')

    let moduleOrder = 0
    for (const mod of data.modules) {
      moduleOrder += 1
      lines.push(`-- Module: ${mod.name}`)
      lines.push(
        `INSERT INTO public.modules (id, name, weight, phase, phase_order, curriculum_version) VALUES (` +
          `${sqlStr(mod.id)}, ${sqlStr(mod.name)}, ${mod.weight}, ` +
          `${mod.phase ? sqlStr(mod.phase) : 'NULL'}, ${mod.phaseOrder ?? moduleOrder}, 1) ` +
          `ON CONFLICT (id) DO NOTHING;`,
      )

      let topicOrder = 0
      for (const topic of mod.topics) {
        topicOrder += 1
        lines.push(
          `INSERT INTO public.topics (id, module_id, name, difficulty, estimated_hours, learning_objectives, prerequisites, exercises, sort_order) VALUES (` +
            `${sqlStr(topic.id)}, ${sqlStr(mod.id)}, ${sqlStr(topic.name)}, ` +
            `${sqlStr(topic.meta?.difficulty ?? 'beginner')}, ${topic.meta?.estimatedHours ?? 1}, ` +
            `${sqlArray(topic.meta?.learningObjectives)}, ${sqlArray(topic.meta?.prerequisites)}, ` +
            `${sqlArray(topic.meta?.exercises)}, ${topicOrder}) ` +
            `ON CONFLICT (id) DO NOTHING;`,
        )
        topic.subtopics.forEach((sub, i) => {
          lines.push(
            `INSERT INTO public.subtopics (id, topic_id, name, base_estimate_minutes, sort_order) VALUES (` +
              `${sqlStr(sub.id)}, ${sqlStr(topic.id)}, ${sqlStr(sub.name)}, ` +
              `${sub.baseEstimateMinutes ?? 0}, ${i + 1}) ` +
              `ON CONFLICT (id) DO NOTHING;`,
          )
        })
      }

      for (const a of mod.assessments ?? []) {
        lines.push(
          `INSERT INTO public.assessments (id, module_id, name, type, estimated_hours, description, prerequisites, sort_order) VALUES (` +
            `${sqlStr(a.id)}, ${sqlStr(mod.id)}, ${sqlStr(a.name)}, ${sqlStr(a.type)}, ` +
            `${a.estimatedHours}, ${a.description ? sqlStr(a.description) : 'NULL'}, ` +
            `${sqlArray(a.prerequisites)}, 0) ` +
            `ON CONFLICT (id) DO NOTHING;`,
        )
      }
      lines.push('')
    }

    lines.push('COMMIT;')
    lines.push('')
    lines.push('-- ── Verification ──')
    lines.push("SELECT 'modules' AS tbl, count(*) FROM public.modules")
    lines.push('UNION ALL SELECT \'topics\', count(*) FROM public.topics')
    lines.push('UNION ALL SELECT \'subtopics\', count(*) FROM public.subtopics')
    lines.push('UNION ALL SELECT \'assessments\', count(*) FROM public.assessments;')

    const sql = lines.join('\n')
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, sql, 'utf8')

    // Sanity: every subtopic has a positive estimate; every FK target exists.
    const subIds = new Set<string>()
    const topicIds = new Set<string>()
    const moduleIds = new Set<string>()
    for (const mod of data.modules) {
      moduleIds.add(mod.id)
      for (const topic of mod.topics) {
        topicIds.add(topic.id)
        for (const sub of topic.subtopics) {
          subIds.add(sub.id)
          expect(sub.baseEstimateMinutes ?? 0).toBeGreaterThan(0)
          expect(sub.id.startsWith(topic.id)).toBe(true)
        }
        for (const p of topic.meta?.prerequisites ?? []) expect(topicIds.has(p) || p === mod.id).toBe(true)
      }
    }
    for (const mod of data.modules) {
      for (const a of mod.assessments ?? []) {
        expect(a.id.startsWith(mod.id)).toBe(true)
        for (const p of a.prerequisites) expect(topicIds.has(p)).toBe(true)
      }
    }

    expect(sql).toContain('INSERT INTO public.modules')
    expect(sql).toContain('INSERT INTO public.subtopics')
    expect(sql).toContain('COMMIT;')
    expect(sql.length).toBeGreaterThan(5000)
  })
})
