/**
 * Organization + membership routes.
 *
 * Cross-org routes (list mine / create / switch / accept-invite) require only
 * auth. Routes that act on the *active* organization run loadOrgContext and are
 * guarded by the relevant permission. To manage a different org, switch to it.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { OrganizationService } from '../services/organization.service'
import { MembershipService } from '../services/membership.service'
import { requireAuth } from '../middleware/auth.middleware'
import { loadOrgContext, requirePermission } from '../middleware/org-context'
import { Permission, ORG_ROLES } from '../auth/permissions'
import { signToken } from '../utils/jwt'
import type { HonoContext } from '../index'

const orgRoutes = new Hono<HonoContext>()
orgRoutes.use('*', requireAuth)

const roleEnum = z.enum(ORG_ROLES as unknown as [string, ...string[]])

const createOrgSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(60).optional(),
})
const updateOrgSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  domain: z.string().max(255).optional(),
  email: z.email().optional(),
  website: z.string().max(500).optional(),
})
const switchOrgSchema = z.object({ organizationId: z.string().min(1) })
const inviteSchema = z.object({ email: z.email(), role: roleEnum.optional() })
const acceptInviteSchema = z.object({ invitationToken: z.string().min(1) })
const changeRoleSchema = z.object({ role: roleEnum })

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed')

/** GET /organizations — organizations the caller belongs to. */
orgRoutes.get('/', async (c) => {
  const orgs = new OrganizationService({ db: c.get('db') })
  const list = await orgs.listUserOrganizations(c.get('user')!.userId)
  return c.json({ organizations: list, activeOrgId: c.get('user')!.activeOrgId })
})

/** POST /organizations — create an org; the caller becomes its owner. */
orgRoutes.post('/', zValidator('json', createOrgSchema), async (c) => {
  try {
    const { name, slug } = c.req.valid('json')
    const orgs = new OrganizationService({ db: c.get('db') })
    const organization = await orgs.createOrganization({ name, slug, ownerId: c.get('user')!.userId })
    return c.json({ organization }, 201)
  } catch (e) {
    return c.json({ error: msg(e) }, 400)
  }
})

/** POST /organizations/switch — re-mint the access token against another org the caller belongs to. */
orgRoutes.post('/switch', zValidator('json', switchOrgSchema), async (c) => {
  try {
    const { organizationId } = c.req.valid('json')
    const user = c.get('user')!
    const members = new MembershipService({ db: c.get('db') })
    const membership = await members.getMembership(user.userId, organizationId)
    if (!membership || membership.status !== 'active') {
      return c.json({ error: 'Not an active member of that organization' }, 403)
    }
    const accessToken = await signToken(
      { userId: user.userId, email: user.email, type: 'access', activeOrgId: organizationId },
      c.env.JWT_SECRET,
      '15m',
    )
    return c.json({ accessToken, activeOrgId: organizationId })
  } catch (e) {
    return c.json({ error: msg(e) }, 400)
  }
})

/** POST /organizations/accept-invite — accept a pending invitation. */
orgRoutes.post('/accept-invite', zValidator('json', acceptInviteSchema), async (c) => {
  try {
    const { invitationToken } = c.req.valid('json')
    const members = new MembershipService({ db: c.get('db') })
    const membership = await members.acceptInvite({ userId: c.get('user')!.userId, invitationToken })
    return c.json({ membership })
  } catch (e) {
    return c.json({ error: msg(e) }, 400)
  }
})

/** GET /organizations/current — the active organization + the caller's role in it. */
orgRoutes.get('/current', loadOrgContext, async (c) => {
  const activeOrgId = c.get('activeOrgId')
  if (!activeOrgId) return c.json({ error: 'No active organization' }, 404)
  const orgs = new OrganizationService({ db: c.get('db') })
  const organization = await orgs.getOrganization(activeOrgId)
  if (!organization) return c.json({ error: 'Organization not found' }, 404)
  return c.json({ organization, role: c.get('orgRole') })
})

/** PATCH /organizations/current — update the active organization. */
orgRoutes.patch(
  '/current',
  loadOrgContext,
  requirePermission(Permission.ORG_UPDATE),
  zValidator('json', updateOrgSchema),
  async (c) => {
    try {
      const orgs = new OrganizationService({ db: c.get('db') })
      const organization = await orgs.updateOrganization(c.get('activeOrgId')!, c.req.valid('json'))
      return c.json({ organization })
    } catch (e) {
      return c.json({ error: msg(e) }, 400)
    }
  },
)

/** GET /organizations/current/members — list members of the active organization. */
orgRoutes.get('/current/members', loadOrgContext, requirePermission(Permission.ORG_READ), async (c) => {
  const members = new MembershipService({ db: c.get('db') })
  const list = await members.listMembers(c.get('activeOrgId')!)
  return c.json({ members: list })
})

/** POST /organizations/current/invites — invite an existing user to the active organization. */
orgRoutes.post(
  '/current/invites',
  loadOrgContext,
  requirePermission(Permission.ORG_MANAGE_MEMBERS),
  zValidator('json', inviteSchema),
  async (c) => {
    try {
      const { email, role } = c.req.valid('json')
      const members = new MembershipService({ db: c.get('db') })
      const result = await members.invite({
        organizationId: c.get('activeOrgId')!,
        email,
        role,
        invitedBy: c.get('userId')!,
      })
      return c.json(result, 201)
    } catch (e) {
      return c.json({ error: msg(e) }, 400)
    }
  },
)

/** PATCH /organizations/current/members/:userId — change a member's role. */
orgRoutes.patch(
  '/current/members/:userId',
  loadOrgContext,
  requirePermission(Permission.ORG_MANAGE_MEMBERS),
  zValidator('json', changeRoleSchema),
  async (c) => {
    try {
      const members = new MembershipService({ db: c.get('db') })
      const membership = await members.changeRole({
        organizationId: c.get('activeOrgId')!,
        userId: c.req.param('userId'),
        role: c.req.valid('json').role,
      })
      return c.json({ membership })
    } catch (e) {
      return c.json({ error: msg(e) }, 400)
    }
  },
)

/** DELETE /organizations/current/members/:userId — remove a member. */
orgRoutes.delete(
  '/current/members/:userId',
  loadOrgContext,
  requirePermission(Permission.ORG_MANAGE_MEMBERS),
  async (c) => {
    try {
      const members = new MembershipService({ db: c.get('db') })
      await members.removeMember({ organizationId: c.get('activeOrgId')!, userId: c.req.param('userId') })
      return c.json({ message: 'Member removed' })
    } catch (e) {
      return c.json({ error: msg(e) }, 400)
    }
  },
)

export { orgRoutes }
