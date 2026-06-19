import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createTestDb, type TestDbHandle } from '../test-utils/db'
import { users, apiKeys } from './schema'
import { backfillPersonalOrgs } from './backfill-orgs'
import { OrganizationService } from '../services/organization.service'

let h: TestDbHandle
beforeEach(() => {
  h = createTestDb()
})
afterEach(() => h.close())

describe('backfillPersonalOrgs', () => {
  it('creates a personal org for an org-less user and stamps their api keys', async () => {
    const userId = nanoid()
    await h.db.insert(users).values({ id: userId, email: 'legacy@example.com', passwordHash: 'x' })
    const keyId = nanoid()
    await h.db.insert(apiKeys).values({
      id: keyId,
      userId,
      name: 'legacy key',
      keyHash: `hash-${keyId}`,
      keyPrefix: 'ak_legacy',
      scopes: '[]',
    })

    const result = await backfillPersonalOrgs(h.db)
    expect(result.orgsCreated).toBe(1)

    const orgId = await new OrganizationService({ db: h.db }).getDefaultOrganizationId(userId)
    expect(orgId).toBeTruthy()

    const key = await h.db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).get()
    expect(key!.organizationId).toBe(orgId)
  })

  it('is idempotent — a second run creates no new orgs', async () => {
    const userId = nanoid()
    await h.db.insert(users).values({ id: userId, email: 'legacy@example.com', passwordHash: 'x' })

    await backfillPersonalOrgs(h.db)
    const second = await backfillPersonalOrgs(h.db)
    expect(second.orgsCreated).toBe(0)
  })
})
