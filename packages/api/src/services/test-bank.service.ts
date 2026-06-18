/**
 * Test-bank management — CRUD + QA coverage over the platform's benchmark tasks
 * (the `test_bank` table). Platform content (not org-scoped); callers are gated to
 * super-admin at the route layer.
 */
import { eq, and, desc, count } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { testBank, type TestBankTask, type InsertTestBankTask } from '../db/schema'
import { generateId } from '../utils/crypto'

export const LANGUAGES = ['typescript', 'python', 'csharp', 'java', 'go', 'ruby', 'rust'] as const
export const SCENARIOS = [
  'code-generation',
  'test-generation',
  'code-review',
  'refactoring',
  'debugging',
  'security-scanning',
  'documentation-generation',
] as const
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

type Schema = typeof import('../db/schema')

export interface CreateTaskInput {
  language: string
  scenario: string
  difficulty: string
  title: string
  description: string
  prompt: string
  solution: string
  testSuite: string | Record<string, unknown> | unknown[]
  starterCode?: string
  primaryRole?: string
  tags?: string[]
  source?: string
  createdBy?: string
}

const REQUIRED = ['language', 'scenario', 'difficulty', 'title', 'description', 'prompt', 'solution'] as const

function validateEnums(input: Partial<CreateTaskInput>): string[] {
  const errors: string[] = []
  if (input.language && !(LANGUAGES as readonly string[]).includes(input.language)) {
    errors.push(`invalid language: ${input.language}`)
  }
  if (input.scenario && !(SCENARIOS as readonly string[]).includes(input.scenario)) {
    errors.push(`invalid scenario: ${input.scenario}`)
  }
  if (input.difficulty && !(DIFFICULTIES as readonly string[]).includes(input.difficulty)) {
    errors.push(`invalid difficulty: ${input.difficulty}`)
  }
  return errors
}

function serializeTestSuite(ts: CreateTaskInput['testSuite']): string {
  if (ts === undefined || ts === null) {
    throw new Error('testSuite is required')
  }
  if (typeof ts === 'string') {
    try {
      JSON.parse(ts)
      return ts
    } catch {
      throw new Error('testSuite must be valid JSON')
    }
  }
  return JSON.stringify(ts)
}

export class TestBankService {
  constructor(private readonly db: DrizzleD1Database<Schema>) {}

  async createTask(input: CreateTaskInput): Promise<TestBankTask> {
    for (const field of REQUIRED) {
      if (!input[field] || String(input[field]).trim() === '') {
        throw new Error(`${field} is required`)
      }
    }
    const errors = validateEnums(input)
    if (errors.length) throw new Error(errors.join('; '))

    const id = generateId()
    const row: InsertTestBankTask = {
      id,
      language: input.language,
      scenario: input.scenario,
      difficulty: input.difficulty,
      title: input.title,
      description: input.description,
      prompt: input.prompt,
      solution: input.solution,
      testSuite: serializeTestSuite(input.testSuite),
      starterCode: input.starterCode ?? null,
      primaryRole: input.primaryRole ?? 'developer',
      tags: input.tags ? JSON.stringify(input.tags) : null,
      source: input.source ?? null,
      createdBy: input.createdBy ?? null,
    }
    await this.db.insert(testBank).values(row)
    const created = await this.db.select().from(testBank).where(eq(testBank.id, id)).get()
    if (!created) throw new Error('Failed to create task')
    return created
  }

  async getTask(id: string): Promise<TestBankTask | null> {
    const task = await this.db.select().from(testBank).where(eq(testBank.id, id)).get()
    return task ?? null
  }

  async listTasks(
    filters: {
      language?: string
      scenario?: string
      difficulty?: string
      limit?: number
      offset?: number
    } = {},
  ): Promise<{ tasks: TestBankTask[]; total: number }> {
    const conditions = []
    if (filters.language) conditions.push(eq(testBank.language, filters.language))
    if (filters.scenario) conditions.push(eq(testBank.scenario, filters.scenario))
    if (filters.difficulty) conditions.push(eq(testBank.difficulty, filters.difficulty))
    const where = conditions.length ? and(...conditions) : undefined

    const limit = filters.limit ?? 50
    const offset = filters.offset ?? 0

    // Count without selecting every column; paginate at the DB (limit/offset).
    const totalRows = where
      ? await this.db.select({ value: count() }).from(testBank).where(where)
      : await this.db.select({ value: count() }).from(testBank)
    const total = totalRows[0]?.value ?? 0

    const tasks = where
      ? await this.db
          .select()
          .from(testBank)
          .where(where)
          .orderBy(desc(testBank.createdAt))
          .limit(limit)
          .offset(offset)
      : await this.db
          .select()
          .from(testBank)
          .orderBy(desc(testBank.createdAt))
          .limit(limit)
          .offset(offset)

    return { tasks, total }
  }

  async updateTask(id: string, updates: Partial<CreateTaskInput>): Promise<TestBankTask> {
    const existing = await this.getTask(id)
    if (!existing) throw new Error('Task not found')
    const errors = validateEnums(updates)
    if (errors.length) throw new Error(errors.join('; '))

    const patch: Partial<InsertTestBankTask> = {}
    const direct = [
      'language',
      'scenario',
      'difficulty',
      'title',
      'description',
      'prompt',
      'solution',
      'starterCode',
      'primaryRole',
      'source',
    ] as const
    for (const f of direct) {
      if (updates[f] !== undefined) (patch as Record<string, unknown>)[f] = updates[f]
    }
    if (updates.testSuite !== undefined) patch.testSuite = serializeTestSuite(updates.testSuite)
    if (updates.tags !== undefined) patch.tags = JSON.stringify(updates.tags)

    await this.db.update(testBank).set(patch).where(eq(testBank.id, id))
    const updated = await this.getTask(id)
    if (!updated) throw new Error('Task not found')
    return updated
  }

  async deleteTask(id: string): Promise<void> {
    await this.db.delete(testBank).where(eq(testBank.id, id))
  }

  /** QA coverage report: counts by language / scenario / difficulty (target is 50 per combo). */
  async getStats(): Promise<{
    total: number
    byLanguage: Record<string, number>
    byScenario: Record<string, number>
    byDifficulty: Record<string, number>
  }> {
    const all = await this.db
      .select({
        language: testBank.language,
        scenario: testBank.scenario,
        difficulty: testBank.difficulty,
      })
      .from(testBank)
    const tally = (key: 'language' | 'scenario' | 'difficulty') =>
      all.reduce<Record<string, number>>((acc, t) => {
        acc[t[key]] = (acc[t[key]] ?? 0) + 1
        return acc
      }, {})
    return {
      total: all.length,
      byLanguage: tally('language'),
      byScenario: tally('scenario'),
      byDifficulty: tally('difficulty'),
    }
  }
}
