/**
 * Test-bank management routes — super-admin only (platform content; the bank is
 * kept private to protect benchmark integrity / contamination prevention).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { TestBankService, LANGUAGES, SCENARIOS, DIFFICULTIES } from '../services/test-bank.service'
import { requireAuth } from '../middleware/auth.middleware'
import { loadOrgContext, requireRole } from '../middleware/org-context'
import { Role } from '../auth/permissions'
import type { HonoContext } from '../index'

const testBankRoutes = new Hono<HonoContext>()
testBankRoutes.use('*', requireAuth, loadOrgContext, requireRole(Role.SUPER_ADMIN))

const langEnum = z.enum(LANGUAGES as unknown as [string, ...string[]])
const scenarioEnum = z.enum(SCENARIOS as unknown as [string, ...string[]])
const difficultyEnum = z.enum(DIFFICULTIES as unknown as [string, ...string[]])

const createSchema = z.object({
  language: langEnum,
  scenario: scenarioEnum,
  difficulty: difficultyEnum,
  title: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
  solution: z.string().min(1),
  testSuite: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  starterCode: z.string().optional(),
  primaryRole: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
})
const updateSchema = createSchema.partial()
const listSchema = z.object({
  language: langEnum.optional(),
  scenario: scenarioEnum.optional(),
  difficulty: difficultyEnum.optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(200)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
})

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed')

/** GET /test-bank/stats — QA coverage report (registered before /:id). */
testBankRoutes.get('/stats', async (c) => {
  return c.json(await new TestBankService(c.get('db')).getStats())
})

/** GET /test-bank — list tasks with optional filters. */
testBankRoutes.get('/', zValidator('query', listSchema), async (c) => {
  const { tasks, total } = await new TestBankService(c.get('db')).listTasks(c.req.valid('query'))
  return c.json({ tasks, total })
})

/** GET /test-bank/:id — a single task. */
testBankRoutes.get('/:id', async (c) => {
  const task = await new TestBankService(c.get('db')).getTask(c.req.param('id'))
  if (!task) return c.json({ error: 'Task not found' }, 404)
  return c.json({ task })
})

/** POST /test-bank — create a task. */
testBankRoutes.post('/', zValidator('json', createSchema), async (c) => {
  try {
    const task = await new TestBankService(c.get('db')).createTask({
      ...c.req.valid('json'),
      createdBy: c.get('userId'),
    })
    return c.json({ task }, 201)
  } catch (e) {
    return c.json({ error: msg(e) }, 400)
  }
})

/** PATCH /test-bank/:id — update a task. */
testBankRoutes.patch('/:id', zValidator('json', updateSchema), async (c) => {
  try {
    const task = await new TestBankService(c.get('db')).updateTask(c.req.param('id'), c.req.valid('json'))
    return c.json({ task })
  } catch (e) {
    return c.json({ error: msg(e) }, msg(e) === 'Task not found' ? 404 : 400)
  }
})

/** DELETE /test-bank/:id — delete a task. */
testBankRoutes.delete('/:id', async (c) => {
  await new TestBankService(c.get('db')).deleteTask(c.req.param('id'))
  return c.json({ message: 'Task deleted' })
})

export { testBankRoutes }
