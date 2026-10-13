import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_DEFINITIONS,
  ROLE_CODES,
} from '../src/constants/permissions.js'

/**
 * Permission catalogue tests (§12, §16).
 *
 * These assert properties of the RBAC model itself rather than database state, so
 * they catch a mis-edited grant matrix before it is ever seeded.
 */
describe('permission catalogue', () => {
  it('defines no duplicate permission keys', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length)
  })

  it('describes every permission key', () => {
    // The description table is keyed by the permission value ("students.read"),
    // not by the constant name.
    for (const key of ALL_PERMISSION_KEYS) {
      expect(PERMISSION_DESCRIPTIONS[key]).toBeTruthy()
    }
  })

  it('uses the dotted <resource>.<action> convention', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+\.[a-z]+$/)
    }
  })

  it('covers every resource named in the specification', () => {
    const resources = new Set(ALL_PERMISSION_KEYS.map((key) => key.split('.')[0]))

    for (const resource of [
      'students',
      'questions',
      'exams',
      'results',
      'users',
      'audit',
      'system',
      'license',
      'categories',
    ]) {
      expect(resources).toContain(resource)
    }
  })
})

describe('role definitions', () => {
  const byCode = new Map(ROLE_DEFINITIONS.map((role) => [role.code, role]))

  it('defines every required operational role', () => {
    for (const code of [
      ROLE_CODES.SUPER_ADMIN,
      ROLE_CODES.ADMIN,
      ROLE_CODES.EXAM_OFFICER,
      ROLE_CODES.LECTURER,
      ROLE_CODES.INVIGILATOR,
      ROLE_CODES.STUDENT,
    ]) {
      expect(byCode.has(code)).toBe(true)
    }
  })

  it('grants no duplicate permissions to a role', () => {
    for (const role of ROLE_DEFINITIONS) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length)
    }
  })

  it('grants only permissions that actually exist', () => {
    const known = new Set<string>(ALL_PERMISSION_KEYS)

    for (const role of ROLE_DEFINITIONS) {
      for (const permission of role.permissions) {
        expect(known.has(permission)).toBe(true)
      }
    }
  })

  it('gives SUPER_ADMIN every permission', () => {
    const superAdmin = byCode.get(ROLE_CODES.SUPER_ADMIN)!
    expect(new Set(superAdmin.permissions)).toEqual(new Set(ALL_PERMISSION_KEYS))
  })

  it('gives a student no administrative permission', () => {
    // A candidate must never reach an administrative endpoint.
    expect(byCode.get(ROLE_CODES.STUDENT)!.permissions).toEqual([])
  })

  it('keeps an invigilator read-only', () => {
    // Least privilege: supervising a room must not imply editing the bank or
    // staff accounts.
    const invigilator = byCode.get(ROLE_CODES.INVIGILATOR)!
    const mutating = [
      PERMISSIONS.QUESTIONS_CREATE,
      PERMISSIONS.QUESTIONS_UPDATE,
      PERMISSIONS.QUESTIONS_DELETE,
      PERMISSIONS.EXAMS_CREATE,
      PERMISSIONS.EXAMS_UPDATE,
      PERMISSIONS.EXAMS_DELETE,
      PERMISSIONS.EXAMS_PUBLISH,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.USERS_DELETE,
      PERMISSIONS.STUDENTS_CREATE,
      PERMISSIONS.STUDENTS_UPDATE,
      PERMISSIONS.STUDENTS_DELETE,
      PERMISSIONS.SYSTEM_MANAGE,
    ]

    for (const permission of mutating) {
      expect(invigilator.permissions).not.toContain(permission)
    }
  })

  it('never grants SYSTEM_MANAGE outside SUPER_ADMIN and ADMIN', () => {
    // Changing system settings is the most powerful operational action.
    const allowed = [ROLE_CODES.SUPER_ADMIN, ROLE_CODES.ADMIN]

    for (const role of ROLE_DEFINITIONS) {
      if (role.permissions.includes(PERMISSIONS.SYSTEM_MANAGE)) {
        expect(allowed).toContain(role.code)
      }
    }
  })

  it('never grants ACCOUNT-level administration to a lecturer or invigilator', () => {
    for (const code of [ROLE_CODES.LECTURER, ROLE_CODES.INVIGILATOR]) {
      const role = byCode.get(code)!
      expect(role.permissions).not.toContain(PERMISSIONS.USERS_CREATE)
      expect(role.permissions).not.toContain(PERMISSIONS.USERS_DELETE)
    }
  })

  it('gives ADMIN licensing read but not licensing control', () => {
    const admin = byCode.get(ROLE_CODES.ADMIN)!
    expect(admin.permissions).toContain(PERMISSIONS.LICENSE_READ)
    expect(admin.permissions).not.toContain(PERMISSIONS.LICENSE_MANAGE)
  })
})