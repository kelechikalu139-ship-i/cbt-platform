import type { NextFunction, Request, Response } from 'express'
import type { RoleCode } from '@prisma/client'
import { prisma } from '../config/database.js'
import { ROLE_CODES } from '../constants/permissions.js'
import { ApiError } from '../utils/api-error.js'
import { matchesTokenDigest, verifyAccessToken } from '../utils/tokens.js'

/**
 * Request identity and authentication (§16).
 *
 * `authenticate` proves who the caller is; `requirePermission` proves they are
 * allowed to do what they are attempting. Both live on `req` so a handler never
 * re-parses a token.
 */

export interface AuthenticatedUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: RoleCode
  status: string
  /** Set when the authenticated account is linked to a student record. */
  studentId?: string | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
      requestId?: string
    }
  }
}

/**
 * Require a valid access token.
 *
 * The user row is re-read on every request rather than trusted from the token
 * payload. That costs one indexed primary-key lookup and buys immediate effect
 * for account suspension and role changes: a token issued before an admin
 * suspended a staff member stops working at once, instead of remaining valid for
 * the rest of its 15-minute life.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization

    if (!header || !header.startsWith('Bearer ')) {
      next(ApiError.unauthorized('Authentication required', 'NO_TOKEN'))
      return
    }

    const token = header.slice('Bearer '.length).trim()
    if (!token) {
      next(ApiError.unauthorized('Authentication required', 'NO_TOKEN'))
      return
    }

    let payload
    try {
      payload = verifyAccessToken(token)
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError'
      next(
        ApiError.unauthorized(
          expired ? 'Session expired' : 'Invalid authentication token',
          expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        ),
      )
      return
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        deletedAt: true,
        role: { select: { code: true } },
        student: { select: { id: true } },
        sessionHash: true,
        sessionExpiresAt: true,
      },
    })

    if (!user) {
      next(ApiError.unauthorized('Account no longer exists', 'ACCOUNT_MISSING'))
      return
    }

    if (user.deletedAt !== null) {
      next(ApiError.unauthorized('Account no longer exists', 'ACCOUNT_DELETED'))
      return
    }

    if (user.status !== 'ACTIVE') {
      next(ApiError.forbidden('Account is not active'))
      return
    }

    // Student single-session enforcement: if the token carries a session id
    // (sid claim), verify it matches the stored digest and has not expired.
    // A mismatch means the session was ended (by the student, an admin, or expiry)
    // and the token is no longer valid.
    if (user.role.code === 'STUDENT' && payload.sid) {
      const now = new Date()
      if (!user.sessionHash || !user.sessionExpiresAt || user.sessionExpiresAt <= now || !matchesTokenDigest(payload.sid, user.sessionHash)) {
        next(ApiError.unauthorized('Session ended, please sign in again', 'SESSION_ENDED'))
        return
      }
    }

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role.code,
      status: user.status,
      studentId: user.student?.id ?? null,
    }

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Restrict a route to one or more roles (§16).
 *
 * Coarse-grained companion to `requirePermission`; prefer permissions for new
 * code because they survive a reorganisation of job titles.
 */
export function requireRole(...allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized())
      return
    }

    if (!allowed.includes(req.user.role)) {
      next(ApiError.forbidden('Your role does not permit this action'))
      return
    }

    next()
  }
}

/**
 * Restrict a route to a permission key (§12, §16).
 *
 * Knowing a URL is never sufficient: every protected route in this API sits
 * behind this middleware, and the role grants are read from the database rather
 * than from a compiled-in list, so a change takes effect immediately.
 */
export function requirePermission(...required: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        next(ApiError.unauthorized())
        return
      }

      // A super administrator bypasses the matrix, which keeps day-to-day
      // recovery from the server console possible.
      if (req.user.role === ROLE_CODES.SUPER_ADMIN) {
        next()
        return
      }

      const grants = await prisma.rolePermission.findMany({
        where: { role: { code: req.user.role } },
        select: { permission: { select: { key: true } } },
      })

      const held = new Set(grants.map((grant) => grant.permission.key))

      const missing = required.filter((permission) => !held.has(permission))
      if (missing.length > 0) {
        next(ApiError.forbidden('You do not have permission to perform this action'))
        return
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}

/** Narrow `req.user` for handlers mounted behind `authenticate`. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw ApiError.unauthorized()
  }
  return req.user
}