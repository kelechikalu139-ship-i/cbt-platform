import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { currentUser, requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { clientIp, userAgentOf, AUDIT_ACTIONS, recordAudit } from '../../services/audit.service.js'
import { PERMISSIONS, ROLE_CODES } from '../../constants/permissions.js'
import { ApiError } from '../../utils/api-error.js'
import {
  buildMeta,
  escapeSearchTerm,
  normaliseSearch,
  resolvePagination,
  resolveSortField,
  resolveSortOrder,
} from '../../utils/pagination.js'
import { assertPasswordAcceptable, hashPassword } from '../../utils/password.js'

/**
 * Staff account routes (§56).
 *
 * Staff-account administration is the most dangerous surface in the system: it can
 * mint an account with every permission. Two guards apply here beyond the usual
 * permission check:
 *
 * - An administrator cannot delete or demote their own account, which would
 *   otherwise let the last privileged account lock everyone out.
 * - The last remaining super administrator cannot be removed or demoted.
 */

const idParamSchema = z.object({ id: z.string().uuid('Must be a valid identifier') })

const createUserSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(190).transform((v) => v.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  roleCode: z.enum(['SUPER_ADMIN', 'ADMIN', 'EXAM_OFFICER', 'LECTURER', 'INVIGILATOR']),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).default('ACTIVE'),
})

const updateUserSchema = z
  .object({
    email: z.string().trim().email().max(190).transform((v) => v.toLowerCase()).optional(),
    password: z.string().min(8).max(200).optional(),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    roleCode: z.enum(['SUPER_ADMIN', 'ADMIN', 'EXAM_OFFICER', 'LECTURER', 'INVIGILATOR']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  roleCode: z.enum(['SUPER_ADMIN', 'ADMIN', 'EXAM_OFFICER', 'LECTURER', 'INVIGILATOR', 'STUDENT']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
})

const USER_SORT_FIELDS = ['email', 'firstName', 'lastName', 'createdAt', 'lastLoginAt'] as const

const contextOf = (req: Request) => ({
  actorId: currentUser(req).id,
  ipAddress: clientIp(req.ip),
  userAgent: userAgentOf(req.headers['user-agent']),
})

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { code: true, name: true } },
} as const

/**
 * The fields `toDto` reads.
 *
 * Structural rather than an exact payload type: the list query does not select
 * `deletedAt`, while single-record reads do, and both should map cleanly.
 */
type UserDtoSource = {
  id: string
  email: string
  firstName: string
  lastName: string
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
  lastLoginAt: Date | null
  lockedUntil: Date | null
  createdAt: Date
  updatedAt: Date
  role: { code: string; name: string }
}

function loadUser(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { ...userSelect, deletedAt: true } })
}

/** Never selects `passwordHash`, so it cannot be serialised by accident. */
function toDto(row: UserDtoSource) {
  return {
    id: row.id,
    email: row.email,
    fullName: `${row.firstName} ${row.lastName}`,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role.code,
    roleName: row.role.name,
    status: row.status,
    isLocked: row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const usersRouter = Router()

usersRouter.get(
  '/',
  requirePermission(PERMISSIONS.USERS_READ),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as z.infer<typeof listQuerySchema>
    const { page, limit, skip, take } = resolvePagination(query.page, query.limit)
    const search = normaliseSearch(query.search)

    const where: Record<string, unknown> = { deletedAt: null }
    if (search) {
      const term = escapeSearchTerm(search)
      where.OR = [
        { email: { contains: term } },
        { firstName: { contains: term } },
        { lastName: { contains: term } },
      ]
    }
    if (query.roleCode) where.role = { code: query.roleCode }
    if (query.status) where.status = query.status

    const [rows, totalItems] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: {
          [resolveSortField(query.sort, USER_SORT_FIELDS, 'createdAt')]: resolveSortOrder(query.order),
        },
        select: userSelect,
      }),
      prisma.user.count({ where }),
    ])

    sendPaginated(res, rows.map(toDto), buildMeta(totalItems, page, limit))
  }),
)

usersRouter.post(
  '/',
  requirePermission(PERMISSIONS.USERS_CREATE),
  validate({ body: createUserSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.body as z.infer<typeof createUserSchema>
    const context = contextOf(req)

    const weak = assertPasswordAcceptable(input.password)
    if (weak) {
      throw ApiError.validation(weak, { password: [weak] })
    }

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    })
    if (existing) {
      throw ApiError.conflict('An account with this email already exists', {
        email: ['This email is already registered'],
      })
    }

    // Only one super administrator may exist: it is the installation owner.
    if (input.roleCode === 'SUPER_ADMIN') {
      const superAdminCount = await prisma.user.count({
        where: { role: { code: 'SUPER_ADMIN' }, deletedAt: null },
      })
      if (superAdminCount > 0) {
        throw ApiError.conflict('A super administrator already exists. Only one is allowed per installation.', {
          roleCode: ['A super administrator already exists for this installation.'],
        })
      }
    }

    const passwordHash = await hashPassword(input.password)

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: input.status,
        role: { connect: { code: input.roleCode } },
      },
      select: userSelect,
    })

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTIONS.CREATE_USER,
      entity: 'User',
      entityId: user.id,
      description: `Created staff account ${user.email} with role ${input.roleCode}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    sendData(res, toDto(user), 201, 'Staff account created')
  }),
)

usersRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.USERS_READ),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    const user = await loadUser(id)
    if (!user || user.deletedAt !== null) {
      throw ApiError.notFound('User not found')
    }
    sendData(res, toDto(user))
  }),
)

usersRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.USERS_UPDATE),
  validate({ params: idParamSchema, body: updateUserSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    const input = req.body as z.infer<typeof updateUserSchema>
    const context = contextOf(req)

    const user = await loadUser(id)
    if (!user || user.deletedAt !== null) {
      throw ApiError.notFound('User not found')
    }

    // Lockout prevention.
    if (id === context.actorId && (input.status === 'INACTIVE' || input.status === 'SUSPENDED')) {
      throw ApiError.validation('You cannot deactivate your own account', {
        status: ['You cannot deactivate your own account'],
      })
    }
    if (id === context.actorId && input.roleCode && input.roleCode !== ROLE_CODES.SUPER_ADMIN) {
      if (user.role.code === ROLE_CODES.SUPER_ADMIN) {
        throw ApiError.validation('You cannot remove your own super administrator role', {
          roleCode: ['You cannot remove your own super administrator role'],
        })
      }
    }

    if (input.email) {
      const clash = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      })
      if (clash && clash.id !== id) {
        throw ApiError.conflict('An account with this email already exists', {
          email: ['This email is already registered'],
        })
      }
    }

    // Never allow the last super administrator to be demoted or disabled, which
    // would leave the installation with no way back in.
    if (
      user.role.code === ROLE_CODES.SUPER_ADMIN &&
      (input.roleCode !== undefined || input.status !== undefined) &&
      (input.roleCode !== ROLE_CODES.SUPER_ADMIN || (input.status && input.status !== 'ACTIVE'))
    ) {
      const remaining = await prisma.user.count({
        where: { role: { code: ROLE_CODES.SUPER_ADMIN }, status: 'ACTIVE', deletedAt: null },
      })
      if (remaining <= 1) {
        throw ApiError.conflict(
          'This is the only active super administrator. Create another before changing this account.',
        )
      }
    }

    const passwordHash = input.password
      ? await hashPassword(input.password)
      : undefined

    if (input.password) {
      const weak = assertPasswordAcceptable(input.password)
      if (weak) throw ApiError.validation(weak, { password: [weak] })
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.roleCode !== undefined ? { role: { connect: { code: input.roleCode } } } : {}),
        ...(passwordHash
          ? { passwordHash, refreshTokenHash: null }
          : {}),
      },
      select: userSelect,
    })

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTIONS.UPDATE_USER,
      entity: 'User',
      entityId: id,
      description: `Updated staff account ${user.email}`,
      // Field names only; `password` is never recorded.
      metadata: { fields: Object.keys(input) },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    sendData(res, toDto(updated), 200, 'Staff account updated')
  }),
)

usersRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.USERS_DELETE),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    const context = contextOf(req)

    if (id === context.actorId) {
      throw ApiError.validation('You cannot delete your own account', {
        id: ['You cannot delete your own account'],
      })
    }

    const user = await loadUser(id)
    if (!user || user.deletedAt !== null) {
      throw ApiError.notFound('User not found')
    }

    if (user.role.code === ROLE_CODES.SUPER_ADMIN) {
      const remaining = await prisma.user.count({
        where: { role: { code: ROLE_CODES.SUPER_ADMIN }, status: 'ACTIVE', deletedAt: null },
      })
      if (remaining <= 1) {
        throw ApiError.conflict('This is the only active super administrator and cannot be deleted')
      }
    }

    // Soft delete plus session revocation: the account keeps its audit trail but
    // cannot authenticate again.
    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE', refreshTokenHash: null },
    })

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTIONS.DELETE_USER,
      entity: 'User',
      entityId: id,
      description: `Deleted staff account ${user.email}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    sendData(res, { id, deleted: true }, 200, 'Staff account deleted')
  }),
)