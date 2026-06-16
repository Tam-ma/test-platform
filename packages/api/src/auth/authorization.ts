/**
 * Authorization resolution — pure functions over roles + permissions.
 *
 * A request carries two roles: an optional platform `systemRole` (from
 * users.systemRole) and the active organization role (from the membership).
 * Effective permissions are the union of both, hierarchy-expanded. SUPER_ADMIN
 * short-circuits to "allowed" everywhere.
 */
import { Role, Permission, getRolePermissions } from './permissions'

const ROLE_VALUES = new Set<string>(Object.values(Role))

/** Coerce a stored role string into a Role, or null if absent/unknown. */
export function parseRole(value: string | null | undefined): Role | null {
  if (!value) return null
  return ROLE_VALUES.has(value) ? (value as Role) : null
}

/** Union of the system role's and org role's permissions, each hierarchy-expanded. */
export function effectivePermissions(
  systemRole: Role | null,
  orgRole: Role | null,
): Permission[] {
  const set = new Set<Permission>()
  if (systemRole) getRolePermissions(systemRole).forEach((p) => set.add(p))
  if (orgRole) getRolePermissions(orgRole).forEach((p) => set.add(p))
  return Array.from(set)
}

export function hasPermission(
  systemRole: Role | null,
  orgRole: Role | null,
  permission: Permission,
): boolean {
  if (systemRole === Role.SUPER_ADMIN) return true
  return effectivePermissions(systemRole, orgRole).includes(permission)
}

export function hasAnyPermission(
  systemRole: Role | null,
  orgRole: Role | null,
  permissions: Permission[],
): boolean {
  if (systemRole === Role.SUPER_ADMIN) return true
  const perms = new Set(effectivePermissions(systemRole, orgRole))
  return permissions.some((p) => perms.has(p))
}

export function hasAllPermissions(
  systemRole: Role | null,
  orgRole: Role | null,
  permissions: Permission[],
): boolean {
  if (systemRole === Role.SUPER_ADMIN) return true
  const perms = new Set(effectivePermissions(systemRole, orgRole))
  return permissions.every((p) => perms.has(p))
}
