import type { Permission, Role, User } from '../types'

/**
 * Permission checks.
 *
 * Grants come from the signed-in user's `permissions` array, which the server
 * computed from the role/permission join table. There is deliberately no local
 * copy of the grant matrix.
 *
 * A client-side table was previously the only source of truth here, and it was
 * both wrong (14 coarse permissions against the server's 29) and duplicated. The
 * failure mode was quiet: an unknown role name made every lookup return an empty
 * list, so the sidebar rendered with no links at all while the header still showed
 * the user's role.
 *
 * These helpers decide what to *render*. They are not a security boundary — the
 * API enforces every permission independently on every request.
 */

/** Unknown permissions are ignored rather than throwing, so a server-side grant
 * added in a later release cannot break the UI. */
function normalise(granted: readonly string[] | undefined): Set<string> {
  return new Set(granted ?? [])
}

/**
 * True when the user holds `permission`.
 *
 * Fails closed: an absent list means no permissions, which hides the control
 * rather than exposing it.
 */
export function hasPermission(
  user: Pick<User, 'permissions'> | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false
  return normalise(user.permissions).has(permission)
}

/** True when the user holds at least one of `permissions`. */
export function hasAnyPermission(
  user: Pick<User, 'permissions'> | null | undefined,
  permissions: readonly Permission[],
): boolean {
  if (!user) return false
  const granted = normalise(user.permissions)
  return permissions.some((permission) => granted.has(permission))
}

/** True when the user holds every one of `permissions`. */
export function hasAllPermissions(
  user: Pick<User, 'permissions'> | null | undefined,
  permissions: readonly Permission[],
): boolean {
  if (!user) return false
  const granted = normalise(user.permissions)
  return permissions.every((permission) => granted.has(permission))
}

/**
 * Grants for a role, for display only.
 *
 * Read from a user object; there is no way to ask "what can this role do?"
 * without one, because the answer now lives only in the database.
 */
export function permissionsForRole(role: Role | undefined, users: readonly User[] = []): Permission[] {
  if (!role) return []
  const match = users.find((user) => user.role === role)
  return (match?.permissions ?? []) as Permission[]
}

/**
 * Every distinct permission held across a set of users, grouped by role.
 *
 * Used by the permissions screen to show the effective matrix without
 * reintroducing a hardcoded copy of it.
 */
export function permissionsByRole(users: readonly User[]): Record<string, Permission[]> {
  const grouped: Record<string, Permission[]> = {}

  for (const user of users) {
    const existing = grouped[user.role] ?? (grouped[user.role] = [])
    for (const permission of user.permissions) {
      if (!existing.includes(permission)) existing.push(permission)
    }
  }

  return grouped
}