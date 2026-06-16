import { describe, it, expect } from 'vitest'
import {
  Role,
  Permission,
  ROLE_PERMISSIONS,
  ROLE_HIERARCHY,
  ORG_ROLES,
  roleHasPermission,
  getRolePermissions,
  isRoleHigherOrEqual,
} from './permissions'

describe('roleHasPermission', () => {
  it('grants super_admin the system.admin permission', () => {
    expect(roleHasPermission(Role.SUPER_ADMIN, Permission.SYSTEM_ADMIN)).toBe(true)
  })

  it('denies a viewer the ability to delete an organization', () => {
    expect(roleHasPermission(Role.ORG_VIEWER, Permission.ORG_DELETE)).toBe(false)
  })

  it('checks only direct grants, not inherited ones', () => {
    // owner is NOT directly granted BENCHMARK_READ in a way that... it is, so use a
    // permission a member has but that is only reachable via hierarchy expansion.
    // ORG_OWNER directly lists API_MANAGE_QUOTAS; ORG_ADMIN does not.
    expect(roleHasPermission(Role.ORG_ADMIN, Permission.API_MANAGE_QUOTAS)).toBe(false)
    expect(roleHasPermission(Role.ORG_OWNER, Permission.API_MANAGE_QUOTAS)).toBe(true)
  })
})

describe('getRolePermissions (hierarchy expansion)', () => {
  it('expands an owner to include viewer-level permissions', () => {
    const ownerPerms = getRolePermissions(Role.ORG_OWNER)
    // ORG_VIEWER has DATA_EXPORT; owner should inherit it via the hierarchy.
    expect(ownerPerms).toContain(Permission.DATA_EXPORT)
    expect(ownerPerms).toContain(Permission.ORG_DELETE) // owner's own
  })

  it('returns a de-duplicated set', () => {
    const perms = getRolePermissions(Role.ORG_OWNER)
    expect(new Set(perms).size).toBe(perms.length)
  })

  it('limits a viewer to read-style permissions only', () => {
    const viewerPerms = getRolePermissions(Role.ORG_VIEWER)
    expect(viewerPerms).toContain(Permission.ORG_READ)
    expect(viewerPerms).not.toContain(Permission.ORG_UPDATE)
    expect(viewerPerms).not.toContain(Permission.API_CREATE_KEYS)
  })

  it('gives super_admin every permission in the catalog', () => {
    const all = Object.values(Permission)
    const superPerms = new Set(getRolePermissions(Role.SUPER_ADMIN))
    for (const p of all) {
      expect(superPerms.has(p)).toBe(true)
    }
  })
})

describe('isRoleHigherOrEqual', () => {
  it('ranks owner above member', () => {
    expect(isRoleHigherOrEqual(Role.ORG_OWNER, Role.ORG_MEMBER)).toBe(true)
  })

  it('ranks member below admin', () => {
    expect(isRoleHigherOrEqual(Role.ORG_MEMBER, Role.ORG_ADMIN)).toBe(false)
  })

  it('treats a role as equal to itself', () => {
    expect(isRoleHigherOrEqual(Role.ORG_ADMIN, Role.ORG_ADMIN)).toBe(true)
  })
})

describe('catalog invariants', () => {
  it('defines a permission list for every role', () => {
    for (const role of Object.values(Role)) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true)
      expect(ROLE_HIERARCHY[role]).toBeDefined()
    }
  })

  it('excludes super_admin from assignable org roles', () => {
    expect(ORG_ROLES).not.toContain(Role.SUPER_ADMIN)
    expect(ORG_ROLES).toHaveLength(4)
  })
})
