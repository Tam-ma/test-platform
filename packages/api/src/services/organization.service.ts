/**
 * Organization service — tenant accounts and the membership that ties users to them.
 */
import { eq, and } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import slugify from 'slugify'
import {
  organizations,
  userOrganizations,
  type Organization,
  type InsertOrganization,
} from '../db/schema'
import { generateId } from '../utils/crypto'
import { Role } from '../auth/permissions'

type Schema = typeof import('../db/schema')

export interface OrganizationServiceContext {
  db: DrizzleD1Database<Schema>
}

export class OrganizationService {
  private db: DrizzleD1Database<Schema>

  constructor({ db }: OrganizationServiceContext) {
    this.db = db
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = (slugify(base || 'org', { lower: true, strict: true }) || 'org').slice(0, 40)
    let candidate = root
    for (let i = 0; i < 5; i++) {
      const existing = await this.db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, candidate))
        .get()
      if (!existing) return candidate
      candidate = `${root}-${generateId().slice(0, 8)}`
    }
    return `${root}-${generateId()}`
  }

  /**
   * Create an organization and make `ownerId` its owner in a single step.
   */
  async createOrganization(input: {
    name: string
    ownerId: string
    slug?: string
    isPersonal?: boolean
  }): Promise<Organization> {
    const id = generateId()
    const slug = await this.uniqueSlug(input.slug ?? input.name)
    const now = new Date()

    const org: InsertOrganization = {
      id,
      name: input.name,
      slug,
      isPersonal: input.isPersonal ?? false,
      status: 'active',
      subscriptionTier: 'free',
      createdBy: input.ownerId,
      createdAt: now,
      updatedAt: now,
    }
    await this.db.insert(organizations).values(org)

    await this.db.insert(userOrganizations).values({
      id: generateId(),
      userId: input.ownerId,
      organizationId: id,
      role: Role.ORG_OWNER,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    const created = await this.db.select().from(organizations).where(eq(organizations.id, id)).get()
    if (!created) throw new Error('Failed to create organization')
    return created
  }

  /** Auto-created on registration so every user always has an active tenant. */
  async createPersonalOrganization(ownerId: string, displayName?: string): Promise<Organization> {
    const name = displayName ? `${displayName}'s Workspace` : 'Personal Workspace'
    return this.createOrganization({ name, ownerId, isPersonal: true })
  }

  async getOrganization(orgId: string): Promise<Organization | null> {
    const org = await this.db.select().from(organizations).where(eq(organizations.id, orgId)).get()
    return org ?? null
  }

  /** Active organizations the user belongs to. */
  async listUserOrganizations(userId: string): Promise<Organization[]> {
    const rows = await this.db
      .select({ org: organizations })
      .from(userOrganizations)
      .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
      .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.status, 'active')))
    return rows.map((r) => r.org)
  }

  /** The org a request defaults to: the user's personal org, else their first active membership. */
  async getDefaultOrganizationId(userId: string): Promise<string | null> {
    const rows = await this.db
      .select({ org: organizations })
      .from(userOrganizations)
      .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
      .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.status, 'active')))
    if (rows.length === 0) return null
    const personal = rows.find((r) => r.org.isPersonal)
    return (personal ?? rows[0]).org.id
  }

  async updateOrganization(
    orgId: string,
    patch: Partial<
      Pick<Organization, 'name' | 'domain' | 'email' | 'website' | 'status' | 'subscriptionTier'>
    >,
  ): Promise<Organization> {
    await this.db
      .update(organizations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
    const org = await this.getOrganization(orgId)
    if (!org) throw new Error('Organization not found')
    return org
  }
}
