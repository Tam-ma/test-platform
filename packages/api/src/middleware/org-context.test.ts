import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { createTestDb, type TestDbHandle } from '../test-utils/db'
import { users } from '../db/schema'
import { OrganizationService } from '../services/organization.service'
import { MembershipService } from '../services/membership.service'
import { loadOrgContext, requireRole, requireMinimumRole, requirePermission } from './org-context'
import { Role, Permission } from '../auth/permissions'

let h: TestDbHandle

beforeEach(() => {
  h = createTestDb()
})
afterEach(() => h.close())

async function makeUser(email: string): Promise<string> {
  const id = nanoid()
  await h.db.insert(users).values({ id, email: email.toLowerCase(), passwordHash: 'x' })
  return id
}

/** Build a tiny app that injects the test db + a fake authenticated user, then runs the guards. */
function buildApp(user: { userId: string; email: string; activeOrgId?: string } | null) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>()
  app.use('*', async (c, next) => {
    c.set('db', h.db)
    if (user) c.set('user', { ...user, type: 'access' })
    await next()
  })
  app.use('*', loadOrgContext as never)
  app.get('/owner', requireRole(Role.ORG_OWNER) as never, (c) => c.json({ ok: true }))
  app.get('/admin-min', requireMinimumRole(Role.ORG_ADMIN) as never, (c) => c.json({ ok: true }))
  app.get('/create-key', requirePermission(Permission.API_CREATE_KEYS) as never, (c) => c.json({ ok: true }))
  app.get('/whoami', (c) =>
    c.json({ userId: c.get('userId'), activeOrgId: c.get('activeOrgId'), orgRole: c.get('orgRole') }),
  )
  return app
}

describe('loadOrgContext', () => {
  it('401s when unauthenticated', async () => {
    const res = await buildApp(null).request('/whoami')
    expect(res.status).toBe(401)
  })

  it('resolves the default org + role for an owner', async () => {
    const uid = await makeUser('alice@example.com')
    const org = await new OrganizationService({ db: h.db }).createPersonalOrganization(uid, 'Alice')

    const res = await buildApp({ userId: uid, email: 'alice@example.com' }).request('/whoami')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: uid, activeOrgId: org.id, orgRole: Role.ORG_OWNER })
  })

  it('403s when the token targets an org the user does not belong to', async () => {
    const uid = await makeUser('alice@example.com')
    await new OrganizationService({ db: h.db }).createPersonalOrganization(uid, 'Alice')
    const res = await buildApp({ userId: uid, email: 'alice@example.com', activeOrgId: 'someone-elses-org' }).request(
      '/whoami',
    )
    expect(res.status).toBe(403)
  })
})

describe('role + permission guards', () => {
  it('lets an owner through requireRole(owner) and a member fail it', async () => {
    const owner = await makeUser('owner@example.com')
    const org = await new OrganizationService({ db: h.db }).createOrganization({ name: 'Acme', ownerId: owner })
    const member = await makeUser('member@example.com')
    await new MembershipService({ db: h.db }).addMember({
      organizationId: org.id,
      userId: member,
      role: Role.ORG_MEMBER,
    })

    const ownerRes = await buildApp({ userId: owner, email: 'owner@example.com', activeOrgId: org.id }).request('/owner')
    expect(ownerRes.status).toBe(200)

    const memberRes = await buildApp({ userId: member, email: 'member@example.com', activeOrgId: org.id }).request(
      '/owner',
    )
    expect(memberRes.status).toBe(403)
  })

  it('enforces requireMinimumRole(admin): owner ok, member denied', async () => {
    const owner = await makeUser('owner@example.com')
    const org = await new OrganizationService({ db: h.db }).createOrganization({ name: 'Acme', ownerId: owner })
    const member = await makeUser('member@example.com')
    await new MembershipService({ db: h.db }).addMember({ organizationId: org.id, userId: member, role: Role.ORG_MEMBER })

    expect(
      (await buildApp({ userId: owner, email: 'o@e.com', activeOrgId: org.id }).request('/admin-min')).status,
    ).toBe(200)
    expect(
      (await buildApp({ userId: member, email: 'm@e.com', activeOrgId: org.id }).request('/admin-min')).status,
    ).toBe(403)
  })

  it('enforces requirePermission(API_CREATE_KEYS): owner ok, viewer denied', async () => {
    const owner = await makeUser('owner@example.com')
    const org = await new OrganizationService({ db: h.db }).createOrganization({ name: 'Acme', ownerId: owner })
    const viewer = await makeUser('viewer@example.com')
    await new MembershipService({ db: h.db }).addMember({ organizationId: org.id, userId: viewer, role: Role.ORG_VIEWER })

    expect(
      (await buildApp({ userId: owner, email: 'o@e.com', activeOrgId: org.id }).request('/create-key')).status,
    ).toBe(200)
    expect(
      (await buildApp({ userId: viewer, email: 'v@e.com', activeOrgId: org.id }).request('/create-key')).status,
    ).toBe(403)
  })
})
