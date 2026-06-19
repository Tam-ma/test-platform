/**
 * Data backfill for the multi-tenant migration.
 *
 * Ensures every existing user has a personal organization (owner membership),
 * then stamps their org-less resources with it. Idempotent — safe to run more
 * than once. New users get all of this at registration, so this only matters for
 * accounts created before the migration.
 *
 * Run against D1 via a one-off Worker route or `wrangler d1 execute`-style entry
 * that hands this function a Drizzle client.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from './schema'
import { users, apiKeys, userModelConfigs, modelUsage } from './schema'
import { OrganizationService } from '../services/organization.service'

export async function backfillPersonalOrgs(
  db: DrizzleD1Database<typeof schema>,
): Promise<{ usersProcessed: number; orgsCreated: number }> {
  const orgService = new OrganizationService({ db })
  const allUsers = await db.select().from(users)
  let orgsCreated = 0

  for (const user of allUsers) {
    let orgId = await orgService.getDefaultOrganizationId(user.id)
    if (!orgId) {
      const org = await orgService.createPersonalOrganization(
        user.id,
        user.fullName ?? user.email.split('@')[0],
      )
      orgId = org.id
      orgsCreated++
    }

    // Stamp this user's org-less resources with their personal org.
    await db
      .update(apiKeys)
      .set({ organizationId: orgId })
      .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.organizationId)))
    await db
      .update(userModelConfigs)
      .set({ organizationId: orgId })
      .where(and(eq(userModelConfigs.userId, user.id), isNull(userModelConfigs.organizationId)))
    await db
      .update(modelUsage)
      .set({ organizationId: orgId })
      .where(and(eq(modelUsage.userId, user.id), isNull(modelUsage.organizationId)))
  }

  return { usersProcessed: allUsers.length, orgsCreated }
}
