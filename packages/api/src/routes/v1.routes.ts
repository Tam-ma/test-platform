/**
 * Programmatic REST API (v1) — authenticated by API key (`X-API-Key` header).
 *
 * Each API key carries its organization, so every v1 request is tenant-scoped to
 * the key's org (set by `requireAPIKey`). Read-only to start; write surfaces land
 * as the underlying features come online.
 */
import { Hono } from 'hono'
import { requireAPIKey } from '../middleware/auth.middleware'
import { ModelConfigService } from '../services/model-config.service'
import { OrganizationService } from '../services/organization.service'
import type { HonoContext } from '../index'

const v1Routes = new Hono<HonoContext>()

// Authenticate every v1 request with an API key...
v1Routes.use('*', requireAPIKey)
// ...and fail closed if the key is not tied to an organization.
v1Routes.use('*', async (c, next) => {
  if (!c.get('activeOrgId')) {
    return c.json({ error: 'API key is not associated with an organization' }, 403)
  }
  return next()
})

const parseTags = <T extends { tags: string | null }>(m: T) => ({
  ...m,
  tags: m.tags ? (JSON.parse(m.tags) as string[]) : [],
})

/** GET /v1/me — the authenticated organization + key metadata. */
v1Routes.get('/me', async (c) => {
  const key = c.get('apiKey')
  const org = await new OrganizationService({ db: c.get('db') }).getOrganization(c.get('activeOrgId')!)
  return c.json({
    organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    apiKey: { name: key.name, prefix: key.keyPrefix, scopes: JSON.parse(key.scopes) },
  })
})

/** GET /v1/models — the model catalog. */
v1Routes.get('/models', async (c) => {
  const models = await new ModelConfigService(c.get('db')).getAllModels()
  return c.json({ data: models.map(parseTags) })
})

/** GET /v1/models/:id — a single model. */
v1Routes.get('/models/:id', async (c) => {
  const model = await new ModelConfigService(c.get('db')).getModelById(c.req.param('id'))
  if (!model) return c.json({ error: 'Model not found' }, 404)
  return c.json({ data: parseTags(model) })
})

/** GET /v1/usage — the organization's model-usage statistics. */
v1Routes.get('/usage', async (c) => {
  const stats = await new ModelConfigService(c.get('db')).getUserUsageStats(c.get('activeOrgId')!)
  return c.json({ data: stats })
})

export { v1Routes }
