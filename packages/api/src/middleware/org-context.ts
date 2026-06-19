/**
 * Multi-tenant request context + RBAC guards (Hono).
 *
 * Pipeline: requireAuth (sets `user`) → loadOrgContext (resolves the active org
 * + roles) → requireRole / requireMinimumRole / requirePermission guards.
 */
import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import type { HonoContext } from '../index'
import { users } from '../db/schema'
import { OrganizationService } from '../services/organization.service'
import { MembershipService } from '../services/membership.service'
import { parseRole, hasPermission, hasAnyPermission } from '../auth/authorization'
import { Role, Permission, isRoleHigherOrEqual } from '../auth/permissions'

type Ctx = Context<HonoContext>

/**
 * Resolves the active-organization context. Must run AFTER requireAuth.
 * Sets userId, systemRole, activeOrgId and orgRole on the context. Rejects
 * requests whose token targets an organization the user is not an active
 * member of.
 */
export async function loadOrgContext(c: Ctx, next: Next) {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Authentication required' }, 401)

  const db = c.get('db')
  c.set('userId', user.userId)

  const account = await db.select().from(users).where(eq(users.id, user.userId)).get()
  c.set('systemRole', parseRole(account?.systemRole ?? null))

  let activeOrgId = user.activeOrgId
  if (!activeOrgId) {
    const orgService = new OrganizationService({ db })
    activeOrgId = (await orgService.getDefaultOrganizationId(user.userId)) ?? undefined
  }

  if (!activeOrgId) {
    // Fail closed: an authenticated request with no active org must not reach
    // org-scoped handlers — they would otherwise run with an undefined org id
    // (silent empty reads, orphaned NULL-org writes).
    return c.json({ error: 'No active organization for this account' }, 403)
  }

  const memberships = new MembershipService({ db })
  const membership = await memberships.getMembership(user.userId, activeOrgId)
  if (!membership || membership.status !== 'active') {
    return c.json({ error: 'Not an active member of the selected organization' }, 403)
  }

  c.set('activeOrgId', activeOrgId)
  c.set('orgRole', parseRole(membership.role))
  return next()
}

function roles(c: Ctx): { systemRole: Role | null; orgRole: Role | null } {
  return { systemRole: c.get('systemRole') ?? null, orgRole: c.get('orgRole') ?? null }
}

/** Require the active org role to be exactly `role` (super_admin always passes). */
export function requireRole(role: Role) {
  return async (c: Ctx, next: Next) => {
    const { systemRole, orgRole } = roles(c)
    if (systemRole === Role.SUPER_ADMIN || orgRole === role) return next()
    return c.json({ error: `Role '${role}' is required` }, 403)
  }
}

/** Require the active org role to be at least `min` in the hierarchy. */
export function requireMinimumRole(min: Role) {
  return async (c: Ctx, next: Next) => {
    const { systemRole, orgRole } = roles(c)
    if (systemRole === Role.SUPER_ADMIN) return next()
    if (orgRole && isRoleHigherOrEqual(orgRole, min)) return next()
    return c.json({ error: `Minimum role '${min}' is required` }, 403)
  }
}

/** Require a specific permission (resolved from system + org roles). */
export function requirePermission(permission: Permission) {
  return async (c: Ctx, next: Next) => {
    const { systemRole, orgRole } = roles(c)
    if (hasPermission(systemRole, orgRole, permission)) return next()
    return c.json({ error: `Permission '${permission}' is required` }, 403)
  }
}

/** Require at least one of the given permissions. */
export function requireAnyPermission(permissions: Permission[]) {
  return async (c: Ctx, next: Next) => {
    const { systemRole, orgRole } = roles(c)
    if (hasAnyPermission(systemRole, orgRole, permissions)) return next()
    return c.json({ error: 'Insufficient permissions' }, 403)
  }
}
