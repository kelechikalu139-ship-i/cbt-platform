import { Router, type Request, type Response } from 'express'
import { requirePermission } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import { buildMeta, escapeSearchTerm, normaliseSearch, resolvePagination } from '../../utils/pagination.js'

/**
 * System routes (§35, §36).
 *
 * `/health` is deliberately unauthenticated so a load balancer, a monitoring
 * agent, or an installer script can poll it. It therefore exposes nothing beyond
 * liveness — no version, no host detail, no configuration.
 *
 * `/system/status` requires a session and a permission, and reports safe
 * operational detail without any secret, path, or environment value.
 */

export const healthRouter = Router()

/**
 * Mounted at `/health` in the v1 router, so the route path here is `/`.
 * Declaring `/health` inside would expose `/api/v1/health/health`.
 */
healthRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    let database: 'connected' | 'unavailable' = 'connected'

    try {
      await prisma.$queryRawUnsafe('SELECT 1')
    } catch {
      database = 'unavailable'
    }

    // A degraded database still means the process is running, which is what a
    // liveness probe needs to know. Readiness is a separate concern.
    res.status(database === 'connected' ? 200 : 503).json({
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
    })
  }),
)

export const systemRouter = Router()

systemRouter.get(
  '/status',
  requirePermission(PERMISSIONS.SYSTEM_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    const startedAt = process.uptime()
    let database: 'connected' | 'unavailable' = 'connected'
    let counts: { students: number; questions: number; exams: number; results: number } | null = null

    try {
      const [students, questions, exams, results] = await Promise.all([
        prisma.student.count({ where: { deletedAt: null } }),
        prisma.question.count({ where: { deletedAt: null } }),
        prisma.exam.count({ where: { deletedAt: null } }),
        prisma.result.count(),
      ])
      counts = { students, questions, exams, results }
    } catch {
      database = 'unavailable'
    }

    sendData(res, {
      application: env.APP_NAME,
      version: env.APP_VERSION,
      status: database === 'connected' ? 'online' : 'degraded',
      environment: env.NODE_ENV,
      server: {
        // Port and bind address only — never the resolved secrets or full env.
        port: env.PORT,
        uptimeSeconds: Math.round(startedAt),
        nodeVersion: process.version,
        memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      database,
      counts,
      timestamp: new Date().toISOString(),
    })
  }),
)

// --- Audit log -----------------------------------------------------------

export const auditRouter = Router()

auditRouter.get(
  '/',
  requirePermission(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as Record<string, string | undefined>
    const { page, limit, skip, take } = resolvePagination(query.page, query.limit)
    const search = normaliseSearch(query.search)

    const where: Record<string, unknown> = {}
    if (search) {
      const term = escapeSearchTerm(search)
      where.OR = [{ action: { contains: term } }, { description: { contains: term } }]
    }
    if (query.action) where.action = query.action
    if (query.entity) where.entity = query.entity
    if (query.actorId) where.actorId = query.actorId

    const [rows, totalItems] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          actorId: true,
          action: true,
          entity: true,
          entityId: true,
          description: true,
          metadata: true,
          ipAddress: true,
          success: true,
          createdAt: true,
          actor: { select: { email: true, firstName: true, lastName: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ])

    sendPaginated(
      res,
      rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorEmail: row.actor?.email ?? null,
        actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : null,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        description: row.description,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        success: row.success,
        createdAt: row.createdAt.toISOString(),
      })),
      buildMeta(totalItems, page, limit),
    )
  }),
)

/** Distinct action names, for the audit filter dropdown. */
auditRouter.get(
  '/actions',
  requirePermission(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200,
    })
    sendData(res, rows.map((row) => row.action))
  }),
)