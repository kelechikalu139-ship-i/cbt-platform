import { prisma } from '../../config/database.js'
import { logger } from '../../config/logger.js'
import { ApiError } from '../../utils/api-error.js'
import { comparePassword, hashPassword } from '../../utils/password.js'
import { randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'
import {
  hashTokenDigest,
  lifetimeToMs,
  matchesTokenDigest,
  secondsUntilExpiry,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/tokens.js'
import { AUDIT_ACTIONS, recordAudit, recordAuditInTransaction } from '../../services/audit.service.js'
import type { ChangePasswordInput, LoginInput } from './auth.schema.js'
import type { Prisma } from '@prisma/client'

/**
 * Authentication service (§13, §14, §15).
 *
 * Rules enforced here rather than in the controller:
 *
 * - A failed sign-in always returns the *same* message, whether the account is
 *   unknown, the password is wrong, or the account is disabled. Distinguishing
 *   them would let an attacker enumerate valid accounts and staff roles.
 * - A disabled or locked account is refused even with the correct password.
 * - The refresh token is stored only as a SHA-256 digest, and rotated on every
 *   refresh so a replayed token is detectable.
 */

/** Deliberately identical for every failure mode. */
const GENERIC_CREDENTIAL_ERROR = 'Invalid email or password'

/** Consecutive failures before the account is temporarily locked. */
const MAX_FAILED_ATTEMPTS = 5
/** Lockout length. Short enough that a legitimate user is not locked out of an exam. */
const LOCKOUT_MINUTES = 15

export interface RequestContext {
  ipAddress?: string | null
  userAgent?: string | null
}

export interface PublicUser {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  role: string
  status: string
  permissions: string[]
  studentId: string | null
  lastLoginAt: string | null
  /**
   * The student record linked to this account, present for student
   * portal accounts and `null` for staff. Carries the fields the
   * student app renders (admission number, programme, class) so the
   * portal can hydrate its profile from the sign-in response alone.
   */
  student: {
    studentId: string
    program: string
    level: number
    semester: number
    className: string | null
    session: string | null
  } | null
}

export interface AuthResult {
  user: PublicUser
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: 'Bearer'
}

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  lastLoginAt: true,
  deletedAt: true,
  failedLoginCount: true,
  lockedUntil: true,
  refreshTokenHash: true,
  sessionHash: true,
  sessionExpiresAt: true,
  // Selected only so sign-in can compare a password. `toPublicUser` maps the row
  // to a DTO that has no password field, so it can never reach a response.
  passwordHash: true,
  role: { select: { code: true } },
  student: {
    select: {
      id: true,
      studentId: true,
      program: true,
      level: true,
      semester: true,
      className: true,
      session: true,
    },
  },
} satisfies Prisma.UserSelect

type UserWithRole = Prisma.UserGetPayload<{ select: typeof userSelect }>

/** The user shape matric-only sign-in resolves or provisions. */
type StudentLoginUser = UserWithRole

/** Load the permission keys granted to a role. */
async function permissionsForRole(role: string): Promise<string[]> {
  const grants = await prisma.rolePermission.findMany({
    where: { role: { code: role as UserWithRole['role']['code'] } },
    select: { permission: { select: { key: true } } },
  })
  return grants.map((grant) => grant.permission.key)
}

/** Map a user row to the shape the API exposes. Never includes the hash. */
export async function toPublicUser(user: UserWithRole): Promise<PublicUser> {
  const permissions = await permissionsForRole(user.role.code)

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    role: user.role.code,
    status: user.status,
    permissions,
    studentId: user.student?.id ?? null,
    student: user.student
      ? {
          studentId: user.student.studentId,
          program: user.student.program,
          level: user.student.level,
          semester: user.student.semester,
          className: user.student.className,
          session: user.student.session,
        }
      : null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  }
}

export async function login(input: LoginInput, context: RequestContext): Promise<AuthResult> {
  // Staff accounts are identified by email; student portal accounts by
  // their admission number. Both resolve to the same `users` row, and
  // every failure mode below returns the same message, so the lookup
  // order cannot be used to tell the two account kinds apart (§13).
  const user =
    (await prisma.user.findUnique({
      where: { email: input.email },
      select: userSelect,
    })) ??
    (await prisma.user.findFirst({
      where: { student: { studentId: input.email } },
      select: userSelect,
    }))

  // --- Account not found -------------------------------------------------
  // Still run a hash comparison against a dummy value so the response time does
  // not reveal whether the address exists.
  if (!user) {
    await comparePassword(input.password, DUMMY_HASH)
    await recordAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      description: 'Sign-in attempted with an unknown identifier',
      metadata: { identifier: input.email },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR, 'AUTH_INVALID_CREDENTIALS')
  }

  // --- Locked out --------------------------------------------------------
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      description: 'Sign-in refused: account temporarily locked',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    throw new ApiError(423, 'Account is temporarily locked after repeated failed sign-ins', 'ACCOUNT_LOCKED')
  }

  // --- Password ----------------------------------------------------------
  const passwordMatches = await comparePassword(input.password, user.passwordHash)

  if (!passwordMatches) {
    const failures = user.failedLoginCount + 1

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failures,
        lockedUntil:
          failures >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    })

    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      description: 'Sign-in failed: incorrect password',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })

    // Same generic message as an unknown account (§13).
    throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR, 'AUTH_INVALID_CREDENTIALS')
  }

  // --- Account state -----------------------------------------------------
  if (user.deletedAt !== null) {
    throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR, 'AUTH_INVALID_CREDENTIALS')
  }

  if (user.status !== 'ACTIVE') {
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      description: `Sign-in refused: account status ${user.status}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    // Deliberately the generic message even though the reason is known, so the
    // endpoint cannot be used to confirm that a password is correct.
    throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR, 'AUTH_INVALID_CREDENTIALS')
  }

  // --- Issue session -----------------------------------------------------
  const now = new Date()
  const isStudent = user.role.code === 'STUDENT'
  let sessionId: string | undefined
  let sessionHash: string | undefined
  let sessionExpiresAt: Date | undefined

  if (isStudent) {
    // Single-session gate: refuse a new sign-in if an existing session is still live.
    if (user.sessionHash && user.sessionExpiresAt && user.sessionExpiresAt > now) {
      await recordAudit({
        actorId: user.id,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        description: 'Sign-in refused: student already signed in on another device',
        metadata: { existingSessionExpiresAt: user.sessionExpiresAt.toISOString() },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        success: false,
      })
      throw new ApiError(
        409,
        'This account is already signed in on another device. Sign out there first, or ask your administrator to end the session.',
        'SESSION_ACTIVE',
      )
    }
    sessionId = newSessionId()
    sessionHash = hashTokenDigest(sessionId)
    sessionExpiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS)
  }

  const access = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role.code,
    ...(isStudent ? { sid: sessionId } : {}),
  })
  const refresh = signRefreshToken(user.id, isStudent ? sessionId : undefined)
  const refreshDigest = hashTokenDigest(refresh.token)

  // The sign-in record and the session update share one transaction so a
  // successful sign-in always leaves an audit trail (§22).
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        refreshTokenHash: refreshDigest,
        ...(isStudent ? { sessionHash, sessionExpiresAt } : {}),
      },
    })

    await recordAuditInTransaction(tx, {
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN,
      entity: 'User',
      entityId: user.id,
      description: `${user.email} signed in`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: true,
    })
  })

  logger.info({ userId: user.id, role: user.role.code }, 'user signed in')

  return {
    user: await toPublicUser(user),
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: secondsUntilExpiry(access.token),
    tokenType: 'Bearer',
  }
}

/**
 * The portal login a matric-only candidate never received.
 *
 * Roster imports and the "omit the portal section" flow register
 * candidates without a user row; their first sign-in creates one, so
 * every candidate on the register can sit an examination without an
 * administrator issuing accounts one by one.
 *
 * The address is derived from the admission number — never a shared
 * default — and carries a random password hash, so only matric-only
 * sign-in can ever open it. The hash makes password sign-in impossible;
 * it is not a credential anybody holds.
 */
async function provisionStudentLogin(student: {
  id: string
  studentId: string
  firstName: string
  lastName: string
  status: string
}): Promise<StudentLoginUser> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { code: 'STUDENT' },
    select: { id: true },
  })

  const localPart = student.studentId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = `${localPart}@students.cbt.local`

  // The admission number is unique, so the derived address is too — but
  // a candidate deleted long ago can have left the same address behind,
  // so a suffix variant is used rather than failing the sign-in.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const email = attempt === 0 ? base : `${localPart}-${attempt + 1}@students.cbt.local`
    try {
      return await prisma.user.create({
        data: {
          email,
          // Unknowable: only matric-only sign-in can open this account.
          passwordHash: await hashPassword(randomBytes(48).toString('hex')),
          firstName: student.firstName,
          lastName: student.lastName,
          status: student.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
          role: { connect: { id: role.id } },
          student: { connect: { id: student.id } },
        },
        select: userSelect,
      })
    } catch (error) {
      const target = (error as { meta?: { target?: string[] } }).meta?.target
      const isEmailClash = Array.isArray(target) && target.includes('email')
      if (!isEmailClash || attempt === 4) throw error
    }
  }

  throw new Error('Unreachable: the address variants above always return or throw')
}

/**
 * Passwordless student sign-in using only the matriculation number.
 *
 * Enforces the single-session rule: a candidate may hold exactly one
 * live session. A second sign-in is refused until the existing session
 * ends (self sign-out, an administrator ending it, or expiry).
 */
export async function studentLogin(
  input: { studentId: string },
  context: RequestContext,
): Promise<AuthResult> {
  // Resolve the candidate first: matric-only sign-in works from the
  // register, so a candidate is never blocked merely because a portal
  // login was never provisioned for them.
  const student = await prisma.student.findUnique({
    where: { studentId: input.studentId },
    select: {
      id: true,
      studentId: true,
      firstName: true,
      lastName: true,
      status: true,
      deletedAt: true,
      user: { select: userSelect },
    },
  })

  // Unknown admission number — same generic failure as a wrong password
  // so an attacker cannot enumerate valid admission numbers.
  if (!student || student.deletedAt !== null) {
    await comparePassword('', DUMMY_HASH)
    await recordAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      description: 'Student sign-in attempted with an unknown admission number',
      metadata: { studentId: input.studentId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR, 'AUTH_INVALID_CREDENTIALS')
  }

  // Roster imports and the "no portal section" flow register candidates
  // without a login. Their first sign-in provisions one, so every
  // candidate on the register can sit an examination.
  let user = student.user
  if (!user) {
    user = await provisionStudentLogin(student)
  }

  // Locked out (should be rare for students, but apply the same logic).
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      description: 'Student sign-in refused: account temporarily locked',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    throw new ApiError(423, 'Account is temporarily locked after repeated failed sign-ins', 'ACCOUNT_LOCKED')
  }

  // Account state checks.
  if (user.deletedAt !== null || user.status !== 'ACTIVE') {
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      description: `Student sign-in refused: account status ${user.status}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR, 'AUTH_INVALID_CREDENTIALS')
  }

  // Only students may use this endpoint.
  if (user.role.code !== 'STUDENT') {
    throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR, 'AUTH_INVALID_CREDENTIALS')
  }

  const now = new Date()

  // Single-session gate.
  if (user.sessionHash && user.sessionExpiresAt && user.sessionExpiresAt > now) {
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      description: 'Student sign-in refused: already signed in on another device',
      metadata: { existingSessionExpiresAt: user.sessionExpiresAt.toISOString() },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    throw new ApiError(
      409,
      'This account is already signed in on another device. Sign out there first, or ask your administrator to end the session.',
      'SESSION_ACTIVE',
    )
  }

  // Create the session.
  const sessionId = newSessionId()
  const sessionHash = hashTokenDigest(sessionId)
  const sessionExpiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS)

  const access = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role.code,
    sid: sessionId,
  })
  const refresh = signRefreshToken(user.id)
  const refreshDigest = hashTokenDigest(refresh.token)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        refreshTokenHash: refreshDigest,
        sessionHash,
        sessionExpiresAt,
      },
    })

    await recordAuditInTransaction(tx, {
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN,
      entity: 'User',
      entityId: user.id,
      description: `${user.email} signed in (matric only${
        user.id === student.user?.id ? '' : ', login provisioned'
      })`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: true,
    })
  })

  logger.info({ userId: user.id, role: user.role.code }, 'student signed in (matric only)')

  return {
    user: await toPublicUser(user),
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: secondsUntilExpiry(access.token),
    tokenType: 'Bearer',
  }
}

/**
 * A real bcrypt hash of a value nobody can sign in with.
 *
 * Comparing against it on the unknown-account path keeps the timing of a failed
 * sign-in roughly constant, so response latency cannot be used to enumerate
 * accounts.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7Xr5DdF1cTGOcq0Y7x0lF5s0lF5s0lF'

/** Length of a student session in ms, derived from the refresh token lifetime. */
const SESSION_LIFETIME_MS = lifetimeToMs(env.JWT_REFRESH_EXPIRES_IN)

/** Generate a cryptographically random session id. */
function newSessionId(): string {
  return randomBytes(32).toString('hex')
}

export async function refresh(refreshToken: string, context: RequestContext): Promise<AuthResult> {
  let payload
  try {
    payload = verifyRefreshToken(refreshToken)
  } catch {
    throw ApiError.unauthorized('Session expired, please sign in again', 'TOKEN_INVALID')
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: userSelect,
  })

  if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
    throw ApiError.unauthorized('Session expired, please sign in again', 'TOKEN_INVALID')
  }

  // Only the digest is stored, and it must match the token actually presented.
  if (!matchesTokenDigest(refreshToken, user.refreshTokenHash)) {
    // A valid signature but an unrecognised digest means the token was rotated,
    // revoked, or replayed. Refuse it and force a fresh sign-in.
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.TOKEN_REFRESHED,
      description: 'Refresh rejected: token no longer recognised',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    throw ApiError.unauthorized('Session expired, please sign in again', 'TOKEN_INVALID')
  }

  const isStudent = user.role.code === 'STUDENT'
  const now = new Date()

  // For students, enforce session expiry and slide it on successful refresh.
  if (isStudent) {
    if (user.sessionHash && user.sessionExpiresAt && user.sessionExpiresAt <= now) {
      // Session expired — clear it and refuse.
      await prisma.user.update({
        where: { id: user.id },
        data: { sessionHash: null, sessionExpiresAt: null, refreshTokenHash: null },
      })
      throw ApiError.unauthorized('Session expired, please sign in again', 'TOKEN_INVALID')
    }
  }

  // Rotate: the old digest is replaced, so a replayed refresh token fails.
  const sessionId = isStudent ? payload.sid : undefined
  const access = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role.code,
    ...(isStudent ? { sid: sessionId } : {}),
  })
  const nextRefresh = signRefreshToken(user.id)

  await prisma.user.update({
    where: { id: user.id },
    data: {
      refreshTokenHash: hashTokenDigest(nextRefresh.token),
      ...(isStudent ? { sessionExpiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS) } : {}),
    },
  })

  await recordAudit({
    actorId: user.id,
    action: AUDIT_ACTIONS.TOKEN_REFRESHED,
    entity: 'User',
    entityId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return {
    user: await toPublicUser(user),
    accessToken: access.token,
    refreshToken: nextRefresh.token,
    expiresIn: secondsUntilExpiry(access.token),
    tokenType: 'Bearer',
  }
}

export async function logout(
  userId: string,
  refreshToken: string | undefined,
  context: RequestContext,
): Promise<void> {
  // Clear the stored digest so the refresh token stops working immediately.
  // Matched on the digest so a caller cannot clear someone else's session by
  // passing an arbitrary token.
  if (refreshToken) {
    const digest = hashTokenDigest(refreshToken)
    await prisma.user.updateMany({
      where: { id: userId, refreshTokenHash: digest },
      data: { refreshTokenHash: null, sessionHash: null, sessionExpiresAt: null },
    })
  } else {
    await prisma.user.updateMany({
      where: { id: userId },
      data: { refreshTokenHash: null, sessionHash: null, sessionExpiresAt: null },
    })
  }

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.LOGOUT,
    entity: 'User',
    entityId: userId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  context: RequestContext,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, email: true },
  })

  if (!user) {
    throw ApiError.notFound('Account not found')
  }

  const matches = await comparePassword(input.currentPassword, user.passwordHash)
  if (!matches) {
    await recordAudit({
      actorId: userId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      description: 'Password change refused: current password incorrect',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      success: false,
    })
    throw ApiError.badRequest('Current password is incorrect', {
      currentPassword: ['Current password is incorrect'],
    })
  }

  const passwordHash = await hashPassword(input.newPassword)

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      // Changing a password ends every existing session.
      refreshTokenHash: null,
      sessionHash: null,
      sessionExpiresAt: null,
    },
  })

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entity: 'User',
    entityId: userId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })
}

export async function currentUserProfile(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect,
  })

  if (!user || user.deletedAt !== null) {
    throw ApiError.notFound('Account not found')
  }

  return toPublicUser(user)
}