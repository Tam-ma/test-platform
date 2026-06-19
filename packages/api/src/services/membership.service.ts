/**
 * Membership service — manages who belongs to an organization and with what role.
 * Enforces the (userId, organizationId) uniqueness that the schema leaves to the app layer.
 */
import { eq, and } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { userOrganizations, users, type UserOrganization } from '../db/schema'
import { generateId, generateToken } from '../utils/crypto'
import { Role, ORG_ROLES } from '../auth/permissions'

type Schema = typeof import('../db/schema')

export interface MembershipServiceContext {
  db: DrizzleD1Database<Schema>
}

export interface MemberSummary {
  userId: string
  email: string
  fullName: string | null
  role: string
  status: string
  jobTitle: string | null
}

function coerceOrgRole(role: string | undefined): Role {
  return role && (ORG_ROLES as readonly string[]).includes(role) ? (role as Role) : Role.ORG_MEMBER
}

export class MembershipService {
  private db: DrizzleD1Database<Schema>

  constructor({ db }: MembershipServiceContext) {
    this.db = db
  }

  async getMembership(userId: string, organizationId: string): Promise<UserOrganization | null> {
    const m = await this.db
      .select()
      .from(userOrganizations)
      .where(
        and(
          eq(userOrganizations.userId, userId),
          eq(userOrganizations.organizationId, organizationId),
        ),
      )
      .get()
    return m ?? null
  }

  async isActiveMember(userId: string, organizationId: string): Promise<boolean> {
    const m = await this.getMembership(userId, organizationId)
    return !!m && m.status === 'active'
  }

  async addMember(input: {
    organizationId: string
    userId: string
    role?: string
    status?: string
    invitedBy?: string
  }): Promise<UserOrganization> {
    const existing = await this.getMembership(input.userId, input.organizationId)
    if (existing) throw new Error('User is already a member of this organization')

    const now = new Date()
    const id = generateId()
    await this.db.insert(userOrganizations).values({
      id,
      userId: input.userId,
      organizationId: input.organizationId,
      role: coerceOrgRole(input.role),
      status: input.status ?? 'active',
      invitedBy: input.invitedBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    const m = await this.db.select().from(userOrganizations).where(eq(userOrganizations.id, id)).get()
    if (!m) throw new Error('Failed to add member')
    return m
  }

  async listMembers(organizationId: string): Promise<MemberSummary[]> {
    const rows = await this.db
      .select({
        userId: userOrganizations.userId,
        email: users.email,
        fullName: users.fullName,
        role: userOrganizations.role,
        status: userOrganizations.status,
        jobTitle: userOrganizations.jobTitle,
      })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(eq(userOrganizations.organizationId, organizationId))
    return rows
  }

  async changeRole(input: {
    organizationId: string
    userId: string
    role: string
  }): Promise<UserOrganization> {
    if (!(ORG_ROLES as readonly string[]).includes(input.role)) {
      throw new Error('Invalid organization role')
    }
    const membership = await this.getMembership(input.userId, input.organizationId)
    if (!membership) throw new Error('Membership not found')

    if (membership.role === Role.ORG_OWNER && input.role !== Role.ORG_OWNER) {
      const owners = await this.countOwners(input.organizationId)
      if (owners <= 1) throw new Error('Cannot change the role of the last owner')
    }

    await this.db
      .update(userOrganizations)
      .set({ role: input.role, updatedAt: new Date() })
      .where(
        and(
          eq(userOrganizations.userId, input.userId),
          eq(userOrganizations.organizationId, input.organizationId),
        ),
      )
    const updated = await this.getMembership(input.userId, input.organizationId)
    if (!updated) throw new Error('Membership not found')
    return updated
  }

  async removeMember(input: { organizationId: string; userId: string }): Promise<void> {
    const membership = await this.getMembership(input.userId, input.organizationId)
    if (!membership) return
    if (membership.role === Role.ORG_OWNER) {
      const owners = await this.countOwners(input.organizationId)
      if (owners <= 1) throw new Error('Cannot remove the last owner of an organization')
    }
    await this.db
      .delete(userOrganizations)
      .where(
        and(
          eq(userOrganizations.userId, input.userId),
          eq(userOrganizations.organizationId, input.organizationId),
        ),
      )
  }

  /**
   * Invite an existing user (by email) to the org with a pending membership.
   * Inviting users who don't yet have an account is deferred to Epic 1.3.
   */
  async invite(input: {
    organizationId: string
    email: string
    role?: string
    invitedBy: string
  }): Promise<{ membership: UserOrganization; invitationToken: string }> {
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.email, input.email.toLowerCase()))
      .get()
    if (!user) {
      throw new Error('No account exists for that email')
    }
    const existing = await this.getMembership(user.id, input.organizationId)
    if (existing) throw new Error('User is already a member of this organization')

    const invitationToken = generateToken(32)
    const now = new Date()
    const id = generateId()
    await this.db.insert(userOrganizations).values({
      id,
      userId: user.id,
      organizationId: input.organizationId,
      role: coerceOrgRole(input.role),
      status: 'invited',
      invitationToken,
      invitedBy: input.invitedBy,
      createdAt: now,
      updatedAt: now,
    })
    const membership = await this.db
      .select()
      .from(userOrganizations)
      .where(eq(userOrganizations.id, id))
      .get()
    if (!membership) throw new Error('Failed to create invitation')
    return { membership, invitationToken }
  }

  async acceptInvite(input: { userId: string; invitationToken: string }): Promise<UserOrganization> {
    const membership = await this.db
      .select()
      .from(userOrganizations)
      .where(eq(userOrganizations.invitationToken, input.invitationToken))
      .get()
    if (!membership || membership.userId !== input.userId) {
      throw new Error('Invalid invitation')
    }
    await this.db
      .update(userOrganizations)
      .set({ status: 'active', invitationToken: null, updatedAt: new Date() })
      .where(eq(userOrganizations.id, membership.id))
    const updated = await this.db
      .select()
      .from(userOrganizations)
      .where(eq(userOrganizations.id, membership.id))
      .get()
    if (!updated) throw new Error('Failed to accept invitation')
    return updated
  }

  private async countOwners(organizationId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(userOrganizations)
      .where(
        and(
          eq(userOrganizations.organizationId, organizationId),
          eq(userOrganizations.role, Role.ORG_OWNER),
        ),
      )
    return rows.length
  }
}
