import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { createTestDb, type TestDbHandle } from '../test-utils/db'
import { users, organizations, llmModels } from '../db/schema'
import { APIKeyService } from '../services/api-key.service'
import { v1Routes } from './v1.routes'

let h: TestDbHandle

function app() {
  const a = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>()
  a.use('*', async (c, next) => {
    c.set('db', h.db)
    await next()
  })
  a.route('/v1', v1Routes)
  return a
}

beforeEach(() => {
  h = createTestDb()
})
afterEach(() => h.close())

async function setup() {
  const userId = nanoid()
  const orgId = nanoid()
  await h.db.insert(users).values({ id: userId, email: `${userId}@e.com`, passwordHash: 'x' })
  await h.db.insert(organizations).values({ id: orgId, name: 'Acme', slug: `acme-${orgId}` })
  await h.db.insert(llmModels).values({
    id: 'prov/model',
    provider: 'prov',
    modelName: 'm',
    displayName: 'M',
    apiEndpoint: 'https://example.test',
    contextWindow: 1,
    maxOutputTokens: 1,
    inputPricePer1M: 1,
    outputPricePer1M: 1,
  })
  const { plainKey } = await new APIKeyService({ db: h.db }).generateKey({
    userId,
    organizationId: orgId,
    name: 'test-key',
    scopes: ['read:results', 'read:profile'],
  })
  return { userId, orgId, plainKey }
}

describe('v1 REST API (API-key auth)', () => {
  it('rejects requests with no key or a bogus key', async () => {
    expect((await app().request('/v1/models')).status).toBe(401)
    expect((await app().request('/v1/models', { headers: { 'X-API-Key': 'ak_bogus' } })).status).toBe(401)
  })

  it('serves the model catalog to a valid key', async () => {
    const { plainKey } = await setup()
    const res = await app().request('/v1/models', { headers: { 'X-API-Key': plainKey } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(1)
  })

  it('reports the key\'s organization on /v1/me', async () => {
    const { orgId, plainKey } = await setup()
    const res = await app().request('/v1/me', { headers: { 'X-API-Key': plainKey } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { organization: { id: string }; apiKey: { name: string } }
    expect(body.organization.id).toBe(orgId)
    expect(body.apiKey.name).toBe('test-key')
  })

  it('403s a valid key that is not associated with an organization (fail closed)', async () => {
    const userId = nanoid()
    await h.db.insert(users).values({ id: userId, email: `${userId}@e.com`, passwordHash: 'x' })
    // Key created WITHOUT an organizationId.
    const { plainKey } = await new APIKeyService({ db: h.db }).generateKey({
      userId,
      name: 'no-org-key',
      scopes: ['read:results'],
    })
    const res = await app().request('/v1/models', { headers: { 'X-API-Key': plainKey } })
    expect(res.status).toBe(403)
  })
})
