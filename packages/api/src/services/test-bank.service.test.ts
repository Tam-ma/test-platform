import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDbHandle } from '../test-utils/db'
import { TestBankService, type CreateTaskInput } from './test-bank.service'

let h: TestDbHandle
let svc: TestBankService

const validTask: CreateTaskInput = {
  language: 'typescript',
  scenario: 'code-generation',
  difficulty: 'easy',
  title: 'Sum',
  description: 'Sum two numbers',
  prompt: 'Write add(a, b)',
  solution: 'const add = (a, b) => a + b',
  testSuite: { cases: [{ in: [1, 2], out: 3 }] },
}

beforeEach(() => {
  h = createTestDb()
  svc = new TestBankService(h.db)
})
afterEach(() => h.close())

describe('TestBankService', () => {
  it('creates a task and serializes the test suite', async () => {
    const t = await svc.createTask({ ...validTask })
    expect(t.language).toBe('typescript')
    expect(JSON.parse(t.testSuite)).toEqual({ cases: [{ in: [1, 2], out: 3 }] })
    expect(t.primaryRole).toBe('developer')
  })

  it('rejects invalid enums and missing required fields', async () => {
    await expect(svc.createTask({ ...validTask, language: 'cobol' })).rejects.toThrow(/invalid language/)
    await expect(svc.createTask({ ...validTask, scenario: 'nope' })).rejects.toThrow(/invalid scenario/)
    await expect(svc.createTask({ ...validTask, title: '' })).rejects.toThrow(/title is required/)
  })

  it('rejects a non-JSON string test suite', async () => {
    await expect(svc.createTask({ ...validTask, testSuite: 'not json {' })).rejects.toThrow(/valid JSON/)
  })

  it('lists with filters and pagination', async () => {
    await svc.createTask({ ...validTask, difficulty: 'easy' })
    await svc.createTask({ ...validTask, difficulty: 'hard' })
    await svc.createTask({ ...validTask, language: 'python', difficulty: 'easy' })

    expect((await svc.listTasks()).total).toBe(3)
    expect((await svc.listTasks({ language: 'python' })).total).toBe(1)
    expect((await svc.listTasks({ difficulty: 'easy' })).total).toBe(2)
    expect((await svc.listTasks({ limit: 1 })).tasks).toHaveLength(1)
  })

  it('updates and deletes', async () => {
    const t = await svc.createTask({ ...validTask })
    const u = await svc.updateTask(t.id, { title: 'Renamed', difficulty: 'medium' })
    expect(u.title).toBe('Renamed')
    expect(u.difficulty).toBe('medium')
    await expect(svc.updateTask('nope', { title: 'x' })).rejects.toThrow(/not found/)

    await svc.deleteTask(t.id)
    expect(await svc.getTask(t.id)).toBeNull()
  })

  it('reports QA coverage stats', async () => {
    await svc.createTask({ ...validTask, language: 'typescript', scenario: 'code-generation', difficulty: 'easy' })
    await svc.createTask({ ...validTask, language: 'python', scenario: 'debugging', difficulty: 'hard' })
    const stats = await svc.getStats()
    expect(stats.total).toBe(2)
    expect(stats.byLanguage).toEqual({ typescript: 1, python: 1 })
    expect(stats.byDifficulty).toEqual({ easy: 1, hard: 1 })
  })
})
