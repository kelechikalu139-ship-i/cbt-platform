export {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ALL_PERMISSION_KEYS,
  ROLE_CODES,
  ROLE_DEFINITIONS,
} from './permissions.js'
export type { PermissionKey, RoleCodeKey, RoleDefinition } from './permissions.js'

/** Sort order used when a collection has no explicit sort requested. */
export const DEFAULT_SORT = {
  createdAt: 'desc' as const,
}