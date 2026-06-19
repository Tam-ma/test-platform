import { describe, it, expect, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createTestDb, type TestDbHandle } from './db'
import { organizations, users, userOrganizations } from '../db/schema'

describe('in-memory test db harness', () => {
  let h: TestDbHandle | undefined
  afterEach(() => h?.close())

  it('applies migrations and supports awaited Drizzle CRUD via the D1-typed cast', async () => {
    h = createTestDb()
    const userId = nanoid()
    await h.db.insert(users).values({ id: userId, email: 'a@b.com', passwordHash: 'x' })

    const orgId = nanoid()
    await h.db.insert(organizations).values({
      id: orgId,
      name: 'Acme',
      slug: `acme-${orgId}`,
      createdBy: userId,
      isPersonal: true,
    })

    await h.db.insert(userOrganizations).values({
      id: nanoid(),
      userId,
      organizationId: orgId,
      role: 'owner',
      status: 'active',
    })

    const rows = await h.db.select().from(organizations).where(eq(organizations.id, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Acme')
    expect(rows[0].isPersonal).toBe(true) // boolean mode round-trips

    const memberships = await h.db
      .select()
      .from(userOrganizations)
      .where(eq(userOrganizations.userId, userId))
    expect(memberships[0].role).toBe('owner')
  })
})
