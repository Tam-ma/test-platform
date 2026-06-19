import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { createTestDb, type TestDbHandle } from '../test-utils/db'
import { users } from '../db/schema'
import { OrganizationService } from '../services/organization.service'
import { signToken } from '../utils/jwt'
import { testBankRoutes } from './test-bank.routes'

let h: TestDbHandle
const SECRET = 'test-secret'
const ENV = { JWT_SECRET: SECRET }

function app() {
  const a = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>()
  a.use('*', async (c, next) => {
    c.set('db', h.db)
    await next()
  })
  a.route('/test-bank', testBankRoutes)
  return a
}

async function userWithOrg(opts: { superAdmin?: boolean } = {}) {
  const userId = nanoid()
  await h.db.insert(users).values({
    id: userId,
    email: `${userId}@e.com`,
    passwordHash: 'x',
    systemRole: opts.superAdmin ? 'super_admin' : null,
  })
  const org = await new OrganizationService({ db: h.db }).createPersonalOrganization(userId, 'U')
  const token = await signToken(
    { userId, email: `${userId}@e.com`, type: 'access', activeOrgId: org.id },
    SECRET,
    '15m',
  )
  return { userId, token }
}

const validBody = {
  language: 'typescript',
  scenario: 'code-generation',
  difficulty: 'easy',
  title: 'Sum',
  description: 'Sum two numbers',
  prompt: 'add',
  solution: 'a + b',
  testSuite: { cases: [] },
}

beforeEach(() => {
  h = createTestDb()
})
afterEach(() => h.close())

describe('test-bank routes (super-admin only)', () => {
  it('403s a non-super-admin', async () => {
    const { token } = await userWithOrg()
    const res = await app().request(
      '/test-bank',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      },
      ENV,
    )
    expect(res.status).toBe(403)
  })

  it('lets a super-admin create and list', async () => {
    const { token } = await userWithOrg({ superAdmin: true })
    const auth = { Authorization: `Bearer ${token}` }

    const create = await app().request(
      '/test-bank',
      { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) },
      ENV,
    )
    expect(create.status).toBe(201)

    const list = await app().request('/test-bank', { headers: auth }, ENV)
    expect(list.status).toBe(200)
    expect(((await list.json()) as { total: number }).total).toBe(1)
  })
})
