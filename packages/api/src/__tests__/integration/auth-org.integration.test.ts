/**
 * Live integration test for the multi-tenant auth flow: registration auto-creates
 * a personal org, login carries the active org, and the token drives the
 * organization routes (list / create / switch / current). Runs the real route
 * modules against an in-memory SQLite database.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDbHandle } from '../../test-utils/db'
import { authRoutes } from '../../routes/auth.routes'
import { orgRoutes } from '../../routes/organizations.routes'
import { users, organizations, userOrganizations } from '../../db/schema'

let h: TestDbHandle
const ENV = { JWT_SECRET: 'test-secret', ENVIRONMENT: 'development' }

function app() {
  const a = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>()
  a.use('*', async (c, next) => {
    c.set('db', h.db)
    await next()
  })
  a.route('/auth', authRoutes)
  a.route('/organizations', orgRoutes)
  return a
}

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...extra },
  body: JSON.stringify(body),
})

const register = (email: string, fullName?: string) =>
  app().request('/auth/register', json({ email, password: 'SecurePass123!', fullName }), ENV)

const login = (email: string) =>
  app().request('/auth/login', json({ email, password: 'SecurePass123!' }), ENV)

beforeEach(() => {
  h = createTestDb()
})
afterEach(() => h.close())

describe('registration creates a personal organization', () => {
  it('persists the user and a personal org with them as owner', async () => {
    const res = await register('alice@example.com', 'Alice')
    expect(res.status).toBe(201)

    const user = await h.db.select().from(users).where(eq(users.email, 'alice@example.com')).get()
    expect(user).toBeTruthy()

    const orgs = await h.db.select().from(organizations).where(eq(organizations.createdBy, user!.id))
    expect(orgs).toHaveLength(1)
    expect(orgs[0].isPersonal).toBe(true)

    const membership = await h.db
      .select()
      .from(userOrganizations)
      .where(eq(userOrganizations.userId, user!.id))
      .get()
    expect(membership!.role).toBe('owner')
    expect(membership!.status).toBe('active')
  })
})

describe('login + organization routes', () => {
  it('login returns activeOrgId and the token drives list/create/switch/current', async () => {
    await register('bob@example.com', 'Bob')

    const loginRes = await login('bob@example.com')
    expect(loginRes.status).toBe(200)
    const { accessToken, activeOrgId } = (await loginRes.json()) as {
      accessToken: string
      activeOrgId: string
    }
    expect(accessToken).toBeTruthy()
    expect(activeOrgId).toBeTruthy()
    const auth = { Authorization: `Bearer ${accessToken}` }

    // lists the personal org and echoes the active org
    const listRes = await app().request('/organizations', { headers: auth }, ENV)
    expect(listRes.status).toBe(200)
    const listed = (await listRes.json()) as { organizations: unknown[]; activeOrgId: string }
    expect(listed.organizations).toHaveLength(1)
    expect(listed.activeOrgId).toBe(activeOrgId)

    // create a second org
    const createRes = await app().request('/organizations', json({ name: 'Bob Team' }, auth), ENV)
    expect(createRes.status).toBe(201)
    const teamId = ((await createRes.json()) as { organization: { id: string } }).organization.id

    // switch to it → new token targets the new org
    const switchRes = await app().request('/organizations/switch', json({ organizationId: teamId }, auth), ENV)
    expect(switchRes.status).toBe(200)
    const switched = (await switchRes.json()) as {
      accessToken: string
      refreshToken: string
      activeOrgId: string
    }
    expect(switched.activeOrgId).toBe(teamId)
    expect(switched.refreshToken).toBeTruthy() // switch re-mints the refresh token too (survives refresh)

    // current org (with the switched token) reflects the new org + owner role
    const currentRes = await app().request(
      '/organizations/current',
      { headers: { Authorization: `Bearer ${switched.accessToken}` } },
      ENV,
    )
    expect(currentRes.status).toBe(200)
    const current = (await currentRes.json()) as { organization: { id: string }; role: string }
    expect(current.organization.id).toBe(teamId)
    expect(current.role).toBe('owner')
  })

  it('rejects switching to an org the user does not belong to', async () => {
    await register('carol@example.com', 'Carol')
    const { accessToken } = (await (await login('carol@example.com')).json()) as { accessToken: string }
    const res = await app().request(
      '/organizations/switch',
      json({ organizationId: 'not-my-org' }, { Authorization: `Bearer ${accessToken}` }),
      ENV,
    )
    expect(res.status).toBe(403)
  })
})
