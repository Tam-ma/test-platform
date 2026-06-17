import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nanoid } from 'nanoid'
import { createTestDb, type TestDbHandle } from '../test-utils/db'
import { users, organizations, llmModels } from '../db/schema'
import { ModelConfigService } from './model-config.service'

let h: TestDbHandle
let svc: ModelConfigService

async function seed() {
  const userId = nanoid()
  await h.db.insert(users).values({ id: userId, email: `${userId}@e.com`, passwordHash: 'x' })
  const orgId = nanoid()
  await h.db.insert(organizations).values({ id: orgId, name: 'Org', slug: `org-${orgId}` })
  const modelId = `prov/model-${nanoid()}`
  await h.db.insert(llmModels).values({
    id: modelId,
    provider: 'prov',
    modelName: 'm',
    displayName: 'M',
    apiEndpoint: 'https://example.test',
    contextWindow: 1000,
    maxOutputTokens: 100,
    inputPricePer1M: 1_000_000,
    outputPricePer1M: 2_000_000,
  })
  return { userId, orgId, modelId }
}

beforeEach(() => {
  h = createTestDb()
  svc = new ModelConfigService(h.db)
})
afterEach(() => h.close())

describe('ModelConfigService is org-scoped', () => {
  it('isolates model configs between organizations', async () => {
    const { userId, orgId, modelId } = await seed()
    const otherOrg = nanoid()
    await h.db.insert(organizations).values({ id: otherOrg, name: 'Other', slug: `other-${otherOrg}` })

    const cfg = await svc.createUserModelConfig(userId, orgId, { modelId, apiKey: 'sk-test-1234' })
    expect(cfg.organizationId).toBe(orgId)

    expect(await svc.getUserModelConfigs(orgId)).toHaveLength(1)
    expect(await svc.getUserModelConfigs(otherOrg)).toHaveLength(0) // isolation

    expect(await svc.getUserModelConfig(orgId, cfg.id)).toBeTruthy()
    expect(await svc.getUserModelConfig(otherOrg, cfg.id)).toBeUndefined()
  })

  it('isolates usage stats between organizations', async () => {
    const { userId, orgId, modelId } = await seed()
    await svc.recordModelUsage({
      userId,
      organizationId: orgId,
      modelId,
      requestType: 'benchmark',
      inputTokens: 1000,
      outputTokens: 500,
      success: true,
    })

    const stats = await svc.getUserUsageStats(orgId)
    expect(stats.totalRequests).toBe(1)
    expect(stats.totalTokens).toBe(1500)

    const otherOrg = nanoid()
    await h.db.insert(organizations).values({ id: otherOrg, name: 'O2', slug: `o2-${otherOrg}` })
    expect((await svc.getUserUsageStats(otherOrg)).totalRequests).toBe(0)
  })

  it('stays org-isolated when a modelId filter is passed (regression: .where overwrite leak)', async () => {
    const { userId, orgId, modelId } = await seed()
    const otherOrg = nanoid()
    await h.db.insert(organizations).values({ id: otherOrg, name: 'B', slug: `b-${otherOrg}` })

    // Another org records usage of the same model.
    await svc.recordModelUsage({
      userId,
      organizationId: otherOrg,
      modelId,
      requestType: 'benchmark',
      inputTokens: 1000,
      outputTokens: 0,
      success: true,
    })

    // Our org filtering by that model must NOT see the other org's usage.
    const stats = await svc.getUserUsageStats(orgId, { modelId })
    expect(stats.totalRequests).toBe(0)
    expect(stats.totalTokens).toBe(0)
  })
})
