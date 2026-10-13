import { prisma } from '../config/database.js'
import { logger } from '../config/logger.js'
import type { Prisma } from '@prisma/client'

/**
 * Centralised audit trail (§22).
 *
 * Every security-relevant action is recorded with who did it, what they did, to
 * which record, from where. Two properties matter:
 *
 * - **It must not break the business operation.** A failure to write an audit
 *   row is logged and swallowed. Losing an audit line is bad; refusing a student's
 *   exam submission because the audit insert failed is much worse. The one
 *   exception is a login *success*, where the audit row is part of the same
 *   transaction so the record of access is guaranteed.
 * - **It must not leak secrets.** `metadata` is written verbatim, so callers pass
 *   only non-sensitive detail. Nothing here ever receives a password, a token, or
 *   an answer key.
 */

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',

  CREATE_STUDENT: 'CREATE_STUDENT',
  UPDATE_STUDENT: 'UPDATE_STUDENT',
  DELETE_STUDENT: 'DELETE_STUDENT',
  LOGOUT_STUDENT: 'LOGOUT_STUDENT',

  CREATE_CATEGORY: 'CREATE_CATEGORY',
  UPDATE_CATEGORY: 'UPDATE_CATEGORY',
  DELETE_CATEGORY: 'DELETE_CATEGORY',

  CREATE_QUESTION: 'CREATE_QUESTION',
  UPDATE_QUESTION: 'UPDATE_QUESTION',
  DELETE_QUESTION: 'DELETE_QUESTION',

  CREATE_EXAM: 'CREATE_EXAM',
  UPDATE_EXAM: 'UPDATE_EXAM',
  DELETE_EXAM: 'DELETE_EXAM',
  PUBLISH_EXAM: 'PUBLISH_EXAM',
  UNPUBLISH_EXAM: 'UNPUBLISH_EXAM',

  START_EXAM_SESSION: 'START_EXAM_SESSION',
  SUBMIT_EXAM: 'SUBMIT_EXAM',
  AUTO_SUBMIT_EXAM: 'AUTO_SUBMIT_EXAM',

  CREATE_USER: 'CREATE_USER',
  UPDATE_USER: 'UPDATE_USER',
  DELETE_USER: 'DELETE_USER',

  CHANGE_SETTINGS: 'CHANGE_SETTINGS',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export interface AuditEntry {
  /** Null for actions by an unauthenticated actor, e.g. a failed sign-in. */
  actorId?: string | null
  action: AuditAction | string
  entity?: string | null
  entityId?: string | null
  description?: string | null
  metadata?: Prisma.InputJsonValue | undefined
  ipAddress?: string | null
  userAgent?: string | null
  success?: boolean
}

/**
 * Write an audit record outside any caller transaction.
 *
 * Never throws. Returns the created row's id, or null when the write failed.
 */
export async function recordAudit(entry: AuditEntry): Promise<string | null> {
  try {
    const row = await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        description: entry.description ?? null,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        success: entry.success ?? true,
      },
      select: { id: true },
    })
    return row.id
  } catch (error) {
    logger.error({ err: error, action: entry.action, entity: entry.entity }, 'failed to write audit log')
    return null
  }
}

/**
 * Write an audit record using the caller's transaction client.
 *
 * Used where the audit entry is part of the business unit of work — chiefly a
 * successful sign-in, where the access record must be as durable as the session
 * it describes.
 */
export async function recordAuditInTransaction(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<string> {
  const row = await tx.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      description: entry.description ?? null,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      success: entry.success ?? true,
    },
    select: { id: true },
  })
  return row.id
}

/** Extract the client IP from a request, honouring a reverse proxy when present. */
export function clientIp(address: string | undefined): string | null {
  return address ?? null
}

/** Truncate a user agent so it fits the column and the log format. */
export function userAgentOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.slice(0, 255)
}