/**
 * Permission catalogue (§12).
 *
 * This file is the single source of truth for the RBAC model. Permissions are
 * named `<resource>.<action>`; roles are defined here as a set of permission
 * keys, and the seed writes both into the database.
 *
 * Authorisation is enforced by the API, never by the browser. The admin UI hides
 * what a user cannot do, but hiding a button is not a security control — every
 * route is additionally guarded by `requirePermission`.
 */

export const PERMISSIONS = {
  // Students
  STUDENTS_READ: 'students.read',
  STUDENTS_CREATE: 'students.create',
  STUDENTS_UPDATE: 'students.update',
  STUDENTS_DELETE: 'students.delete',

  // Categories & subjects
  CATEGORIES_READ: 'categories.read',
  CATEGORIES_CREATE: 'categories.create',
  CATEGORIES_UPDATE: 'categories.update',
  CATEGORIES_DELETE: 'categories.delete',

  // Question bank
  QUESTIONS_READ: 'questions.read',
  QUESTIONS_CREATE: 'questions.create',
  QUESTIONS_UPDATE: 'questions.update',
  QUESTIONS_DELETE: 'questions.delete',

  // Examinations
  EXAMS_READ: 'exams.read',
  EXAMS_CREATE: 'exams.create',
  EXAMS_UPDATE: 'exams.update',
  EXAMS_DELETE: 'exams.delete',
  EXAMS_PUBLISH: 'exams.publish',

  // Exam sessions (invigilation oversight)
  SESSIONS_READ: 'sessions.read',

  // Results
  RESULTS_READ: 'results.read',
  RESULTS_EXPORT: 'results.export',

  // Staff accounts
  USERS_READ: 'users.read',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',

  // Audit trail
  AUDIT_READ: 'audit.read',

  // System
  SYSTEM_READ: 'system.read',
  SYSTEM_MANAGE: 'system.manage',

  // Licensing
  LICENSE_READ: 'license.read',
  LICENSE_MANAGE: 'license.manage',
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** Human-readable descriptions, seeded alongside each permission. */
export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  [PERMISSIONS.STUDENTS_READ]: 'View students',
  [PERMISSIONS.STUDENTS_CREATE]: 'Create students',
  [PERMISSIONS.STUDENTS_UPDATE]: 'Update students',
  [PERMISSIONS.STUDENTS_DELETE]: 'Delete or deactivate students',
  [PERMISSIONS.CATEGORIES_READ]: 'View categories and subjects',
  [PERMISSIONS.CATEGORIES_CREATE]: 'Create categories',
  [PERMISSIONS.CATEGORIES_UPDATE]: 'Update categories',
  [PERMISSIONS.CATEGORIES_DELETE]: 'Delete categories',
  [PERMISSIONS.QUESTIONS_READ]: 'View questions and answer keys',
  [PERMISSIONS.QUESTIONS_CREATE]: 'Create questions',
  [PERMISSIONS.QUESTIONS_UPDATE]: 'Update questions',
  [PERMISSIONS.QUESTIONS_DELETE]: 'Delete questions',
  [PERMISSIONS.EXAMS_READ]: 'View examinations',
  [PERMISSIONS.EXAMS_CREATE]: 'Create examinations',
  [PERMISSIONS.EXAMS_UPDATE]: 'Update examinations',
  [PERMISSIONS.EXAMS_DELETE]: 'Delete examinations',
  [PERMISSIONS.EXAMS_PUBLISH]: 'Publish and unpublish examinations',
  [PERMISSIONS.SESSIONS_READ]: 'View live exam sessions',
  [PERMISSIONS.RESULTS_READ]: 'View results',
  [PERMISSIONS.RESULTS_EXPORT]: 'Export results',
  [PERMISSIONS.USERS_READ]: 'View staff accounts',
  [PERMISSIONS.USERS_CREATE]: 'Create staff accounts',
  [PERMISSIONS.USERS_UPDATE]: 'Update staff accounts',
  [PERMISSIONS.USERS_DELETE]: 'Delete staff accounts',
  [PERMISSIONS.AUDIT_READ]: 'View the audit trail',
  [PERMISSIONS.SYSTEM_READ]: 'View system status and settings',
  [PERMISSIONS.SYSTEM_MANAGE]: 'Change system settings',
  [PERMISSIONS.LICENSE_READ]: 'View license information',
  [PERMISSIONS.LICENSE_MANAGE]: 'Activate and manage licenses',
}

/** Every permission key, used by the seeder to guarantee complete coverage. */
export const ALL_PERMISSION_KEYS = Object.values(PERMISSIONS) as PermissionKey[]

export const ROLE_CODES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  EXAM_OFFICER: 'EXAM_OFFICER',
  LECTURER: 'LECTURER',
  INVIGILATOR: 'INVIGILATOR',
  STUDENT: 'STUDENT',
} as const

export type RoleCodeKey = (typeof ROLE_CODES)[keyof typeof ROLE_CODES]

export interface RoleDefinition {
  code: RoleCodeKey
  name: string
  description: string
  /** System roles cannot be renamed or deleted by an administrator. */
  isSystem: boolean
  permissions: PermissionKey[]
}

/**
 * Default role → permission grants.
 *
 * Deliberately conservative for the operational roles: an invigilator supervises
 * a live room and should not be able to alter the question bank or staff
 * accounts. SUPER_ADMIN holds everything implicitly (checked in
 * `hasPermission`) and is listed explicitly so the seeded matrix is readable.
 */
export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    code: ROLE_CODES.SUPER_ADMIN,
    name: 'Super Administrator',
    description: 'Unrestricted access to every part of the system, including licensing and system settings.',
    isSystem: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    code: ROLE_CODES.ADMIN,
    name: 'Administrator',
    description: 'Manages students, question bank, examinations and staff accounts.',
    isSystem: true,
    permissions: [
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.STUDENTS_CREATE,
      PERMISSIONS.STUDENTS_UPDATE,
      PERMISSIONS.STUDENTS_DELETE,
      PERMISSIONS.CATEGORIES_READ,
      PERMISSIONS.CATEGORIES_CREATE,
      PERMISSIONS.CATEGORIES_UPDATE,
      PERMISSIONS.CATEGORIES_DELETE,
      PERMISSIONS.QUESTIONS_READ,
      PERMISSIONS.QUESTIONS_CREATE,
      PERMISSIONS.QUESTIONS_UPDATE,
      PERMISSIONS.QUESTIONS_DELETE,
      PERMISSIONS.EXAMS_READ,
      PERMISSIONS.EXAMS_CREATE,
      PERMISSIONS.EXAMS_UPDATE,
      PERMISSIONS.EXAMS_DELETE,
      PERMISSIONS.EXAMS_PUBLISH,
      PERMISSIONS.SESSIONS_READ,
      PERMISSIONS.RESULTS_READ,
      PERMISSIONS.RESULTS_EXPORT,
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.USERS_DELETE,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.SYSTEM_READ,
      PERMISSIONS.LICENSE_READ,
    ],
  },
  {
    code: ROLE_CODES.EXAM_OFFICER,
    name: 'Examination Officer',
    description: 'Sets up examinations, monitors live sessions and publishes results.',
    isSystem: true,
    permissions: [
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.CATEGORIES_READ,
      PERMISSIONS.QUESTIONS_READ,
      PERMISSIONS.EXAMS_READ,
      PERMISSIONS.EXAMS_CREATE,
      PERMISSIONS.EXAMS_UPDATE,
      PERMISSIONS.EXAMS_PUBLISH,
      PERMISSIONS.SESSIONS_READ,
      PERMISSIONS.RESULTS_READ,
      PERMISSIONS.RESULTS_EXPORT,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.SYSTEM_READ,
    ],
  },
  {
    code: ROLE_CODES.LECTURER,
    name: 'Lecturer',
    description: 'Maintains the question bank and views student results.',
    isSystem: true,
    permissions: [
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.CATEGORIES_READ,
      PERMISSIONS.QUESTIONS_READ,
      PERMISSIONS.QUESTIONS_CREATE,
      PERMISSIONS.QUESTIONS_UPDATE,
      PERMISSIONS.EXAMS_READ,
      PERMISSIONS.RESULTS_READ,
    ],
  },
  {
    code: ROLE_CODES.INVIGILATOR,
    name: 'Invigilator',
    description: 'Supervises live examinations. Read-only access to rooms and candidates.',
    isSystem: true,
    permissions: [
      PERMISSIONS.STUDENTS_READ,
      PERMISSIONS.EXAMS_READ,
      PERMISSIONS.SESSIONS_READ,
      PERMISSIONS.RESULTS_READ,
      PERMISSIONS.SYSTEM_READ,
    ],
  },
  {
    code: ROLE_CODES.STUDENT,
    name: 'Student',
    description: 'Sits examinations. Has no administrative access.',
    isSystem: true,
    // Students authenticate against the same token machinery but reach only the
    // student-facing routes, which are guarded by ownership checks rather than
    // by administrative permissions.
    permissions: [],
  },
]