import { describe, it, expect } from 'vitest'
import { Role, Permission } from './permissions'
import {
  parseRole,
  effectivePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
} from './authorization'

describe('parseRole', () => {
  it('parses known roles and rejects unknown/empty', () => {
    expect(parseRole('owner')).toBe(Role.ORG_OWNER)
    expect(parseRole('super_admin')).toBe(Role.SUPER_ADMIN)
    expect(parseRole('nonsense')).toBeNull()
    expect(parseRole(null)).toBeNull()
    expect(parseRole(undefined)).toBeNull()
  })
})

describe('effectivePermissions', () => {
  it('unions system and org role permissions', () => {
    const perms = effectivePermissions(null, Role.ORG_VIEWER)
    expect(perms).toContain(Permission.ORG_READ)
    expect(perms).not.toContain(Permission.ORG_UPDATE)
  })

  it('returns nothing when both roles are null', () => {
    expect(effectivePermissions(null, null)).toEqual([])
  })
})

describe('hasPermission', () => {
  it('super_admin is allowed everything (even without an org role)', () => {
    expect(hasPermission(Role.SUPER_ADMIN, null, Permission.SYSTEM_BACKUP)).toBe(true)
    expect(hasPermission(Role.SUPER_ADMIN, null, Permission.BENCHMARK_DELETE)).toBe(true)
  })

  it('an org owner can create API keys but a viewer cannot', () => {
    expect(hasPermission(null, Role.ORG_OWNER, Permission.API_CREATE_KEYS)).toBe(true)
    expect(hasPermission(null, Role.ORG_VIEWER, Permission.API_CREATE_KEYS)).toBe(false)
  })

  it('denies when the user has no roles', () => {
    expect(hasPermission(null, null, Permission.ORG_READ)).toBe(false)
  })
})

describe('hasAnyPermission / hasAllPermissions', () => {
  it('any: true if at least one is held', () => {
    expect(
      hasAnyPermission(null, Role.ORG_VIEWER, [Permission.ORG_DELETE, Permission.ORG_READ]),
    ).toBe(true)
  })

  it('all: false if one is missing', () => {
    expect(
      hasAllPermissions(null, Role.ORG_VIEWER, [Permission.ORG_READ, Permission.ORG_DELETE]),
    ).toBe(false)
  })

  it('super_admin satisfies any/all', () => {
    expect(hasAnyPermission(Role.SUPER_ADMIN, null, [Permission.ORG_DELETE])).toBe(true)
    expect(hasAllPermissions(Role.SUPER_ADMIN, null, [Permission.ORG_DELETE, Permission.SYSTEM_ADMIN])).toBe(true)
  })
})
