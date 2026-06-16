/**
 * API Key management routes
 *
 * Keys belong to the caller's active organization (tenant); `userId` is recorded
 * as the creator. Every route runs requireAuth → loadOrgContext and is guarded by
 * the relevant API permission.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { APIKeyService } from '../services/api-key.service'
import { requireAuth } from '../middleware/auth.middleware'
import { loadOrgContext, requirePermission } from '../middleware/org-context'
import { Permission } from '../auth/permissions'
import type { HonoContext } from '../index'

const apiKeyRoutes = new Hono<HonoContext>()

// Every API-key route is authenticated and scoped to an active organization.
apiKeyRoutes.use('*', requireAuth, loadOrgContext)

// Validation schemas
const generateKeySchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1),
  rateLimit: z.number().int().min(0).max(1000000).optional().default(1000),
  expiresAt: z.iso.datetime().optional(),
  ipWhitelist: z.array(z.string()).optional(),
})

const updateKeySchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1).optional(),
  rateLimit: z.number().int().min(0).max(1000000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  ipWhitelist: z.array(z.string()).optional(),
})

const listKeysSchema = z.object({
  status: z.enum(['active', 'inactive', 'expired', 'revoked']).optional(),
  search: z.string().optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
})

const usageQuerySchema = z.object({
  startDate: z.iso.datetime().optional(),
  endDate: z.iso.datetime().optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(1000)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
})

/**
 * POST /api-keys — generate a new API key for the active organization
 */
apiKeyRoutes.post(
  '/',
  requirePermission(Permission.API_CREATE_KEYS),
  zValidator('json', generateKeySchema),
  async (c) => {
    try {
      const { name, description, scopes, rateLimit, expiresAt, ipWhitelist } = c.req.valid('json')

      const apiKeyService = new APIKeyService({ db: c.get('db') })

      const { key, plainKey } = await apiKeyService.generateKey({
        userId: c.get('userId')!,
        organizationId: c.get('activeOrgId')!,
        name,
        description,
        scopes,
        rateLimit,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        ipWhitelist,
      })

      const { keyHash, ...keyResponse } = key

      return c.json(
        {
          message: 'API key generated successfully',
          key: keyResponse,
          apiKey: plainKey,
          warning: 'Please save this API key. You will not be able to see it again.',
        },
        201
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate API key'
      return c.json({ error: message }, 400)
    }
  }
)

/**
 * GET /api-keys — list the active organization's API keys
 */
apiKeyRoutes.get(
  '/',
  requirePermission(Permission.API_READ_KEYS),
  zValidator('query', listKeysSchema),
  async (c) => {
    try {
      const { status, search, limit = 20, offset = 0 } = c.req.valid('query')

      const apiKeyService = new APIKeyService({ db: c.get('db') })

      const { keys, total } = await apiKeyService.listKeys({
        organizationId: c.get('activeOrgId')!,
        status,
        search,
        limit,
        offset,
      })

      const sanitizedKeys = keys.map(({ keyHash, ...key }) => key)

      return c.json({
        keys: sanitizedKeys,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list API keys'
      return c.json({ error: message }, 500)
    }
  }
)

/**
 * GET /api-keys/:id — get a specific API key in the active organization
 */
apiKeyRoutes.get('/:id', requirePermission(Permission.API_READ_KEYS), async (c) => {
  try {
    const keyId = c.req.param('id')
    const apiKeyService = new APIKeyService({ db: c.get('db') })

    const key = await apiKeyService.getKey(keyId, c.get('activeOrgId')!)
    if (!key) {
      return c.json({ error: 'API key not found' }, 404)
    }

    const { keyHash, ...keyResponse } = key
    return c.json({ key: keyResponse })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get API key'
    return c.json({ error: message }, 500)
  }
})

/**
 * PUT /api-keys/:id — update an API key
 */
apiKeyRoutes.put(
  '/:id',
  requirePermission(Permission.API_UPDATE_KEYS),
  zValidator('json', updateKeySchema),
  async (c) => {
    try {
      const keyId = c.req.param('id')
      const updates = c.req.valid('json')

      const apiKeyService = new APIKeyService({ db: c.get('db') })
      const updatedKey = await apiKeyService.updateKey(keyId, c.get('activeOrgId')!, updates)

      const { keyHash, ...keyResponse } = updatedKey
      return c.json({ message: 'API key updated successfully', key: keyResponse })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update API key'
      return c.json({ error: message }, 400)
    }
  }
)

/**
 * DELETE /api-keys/:id — revoke an API key
 */
apiKeyRoutes.delete('/:id', requirePermission(Permission.API_DELETE_KEYS), async (c) => {
  try {
    const keyId = c.req.param('id')
    const apiKeyService = new APIKeyService({ db: c.get('db') })
    await apiKeyService.revokeKey(keyId, c.get('activeOrgId')!)
    return c.json({ message: 'API key revoked successfully' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to revoke API key'
    return c.json({ error: message }, 400)
  }
})

/**
 * GET /api-keys/:id/usage — usage statistics for an API key
 */
apiKeyRoutes.get(
  '/:id/usage',
  requirePermission(Permission.API_VIEW_USAGE),
  zValidator('query', usageQuerySchema),
  async (c) => {
    try {
      const keyId = c.req.param('id')
      const { startDate, endDate, limit = 100, offset = 0 } = c.req.valid('query')

      const apiKeyService = new APIKeyService({ db: c.get('db') })

      const { usage, total } = await apiKeyService.getKeyUsage(keyId, c.get('activeOrgId')!, {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        limit,
        offset,
      })

      const stats = {
        totalRequests: total,
        successRate:
          usage.length > 0
            ? (usage.filter((u) => u.statusCode >= 200 && u.statusCode < 300).length / usage.length) * 100
            : 0,
        averageResponseTime:
          usage.length > 0
            ? usage.reduce((acc, u) => acc + (u.responseTime || 0), 0) / usage.length
            : 0,
        endpointBreakdown: usage.reduce((acc, u) => {
          const key = `${u.method} ${u.endpoint}`
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {} as Record<string, number>),
      }

      return c.json({
        usage,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        stats,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get API key usage'
      return c.json({ error: message }, 500)
    }
  }
)

export { apiKeyRoutes }
