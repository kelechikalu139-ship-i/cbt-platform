import { z } from 'zod'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { join, sep } from 'node:path'
import { requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { ApiError } from '../../utils/api-error.js'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import { buildMeta, escapeSearchTerm, normaliseSearch, resolvePagination } from '../../utils/pagination.js'
import { uploadLogo, uploadUrl, deleteUploadedFile } from '../../services/upload.service.js'
import { restart } from '../../server.js'
import {
  createBackup,
  listBackups,
  restoreBackup,
  pruneOldBackups,
} from '../../services/backup.service.js'

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

/**
 * Public institution branding: school name, short name, primary colour and logo.
 *
 * Deliberately unauthenticated so the student application can render the
 * school's identity without a session. No secrets are exposed.
 */
export const brandingRouter = Router()

systemRouter.get(
  '/status',
  requirePermission(PERMISSIONS.SYSTEM_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    const startedAt = process.uptime()
    let database: 'connected' | 'unavailable' = 'connected'
    let counts: { students: number; questions: number; exams: number; results: number } | null = null
    let installationId: string | null = null

    try {
      const [students, questions, exams, results, license] = await Promise.all([
        prisma.student.count({ where: { deletedAt: null } }),
        prisma.question.count({ where: { deletedAt: null } }),
        prisma.exam.count({ where: { deletedAt: null } }),
        prisma.result.count(),
        prisma.license.findFirst({ select: { installationId: true } }),
      ])
      counts = { students, questions, exams, results }
      installationId = license?.installationId ?? null
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
      installationId,
      timestamp: new Date().toISOString(),
    })
  }),
)

// --- Public branding --------------------------------------------------------

/**
 * Public institution branding: school name, short name, primary colour and logo.
 *
 * Deliberately unauthenticated so the student application can render the
 * school's identity without a session. No secrets are exposed.
 */
brandingRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    let settings
    try {
      settings = await loadSettings()
    } catch {
      // The system settings table may not exist yet (installer hasn't run or
      // migrations haven't been applied). Fall back to the compiled defaults so
      // the student app can still render without a 500.
      settings = DEFAULTS
    }
    sendData(res, {
      schoolName: settings.schoolName as string,
      schoolShortName: settings.schoolShortName as string,
      primaryColor: settings.primaryColor as string | null,
      logoUrl: settings.logoUrl as string | null,
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

const settingsSchema = z.object({
  schoolName: z.string().min(1).max(120).optional(),
  schoolShortName: z.string().min(1).max(16).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().nullable().optional(),
  defaultTimezone: z.string().min(1).max(60).optional(),
  serverPort: z.number().int().min(1024).max(65535).optional(),
  backupPath: z.string().min(1).max(260).optional(),
  backupEnabled: z.boolean().optional(),
  backupFrequencyHours: z.number().int().min(1).max(168).optional(),
  backupRetentionDays: z.number().int().min(1).max(3650).optional(),
  startOnWindowsBoot: z.boolean().optional(),
  sessionTimeoutMinutes: z.number().int().min(5).max(480).optional(),
  maintenanceMode: z.boolean().optional(),
})

const DEFAULTS: Record<string, unknown> = {
  schoolName: 'CBT Examination System',
  schoolShortName: 'CBT',
  primaryColor: '#4f46e5',
  logoUrl: null,
  defaultTimezone: 'Africa/Lagos',
  serverPort: 5000,
  backupPath: 'C:\\CBT\\backups',
  backupEnabled: true,
  backupFrequencyHours: 24,
  backupRetentionDays: 30,
  startOnWindowsBoot: false,
  sessionTimeoutMinutes: 30,
  maintenanceMode: false,
}

async function loadSettings() {
  const rows = await prisma.systemSetting.findMany()
  const map: Record<string, unknown> = { ...DEFAULTS }
  for (const r of rows) {
    try { map[r.key] = JSON.parse(r.value) } catch { map[r.key] = r.value }
  }
  return map
}

export { loadSettings }

systemRouter.get(
  '/settings',
  requirePermission(PERMISSIONS.SYSTEM_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await loadSettings()
    sendData(res, settings)
  }),
)

systemRouter.patch(
  '/settings',
  requirePermission(PERMISSIONS.SYSTEM_MANAGE),
  validate({ body: settingsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.body as z.infer<typeof settingsSchema>
    const current = await loadSettings()
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue
      if (key === 'logoUrl' && String(value ?? null) !== String(current.logoUrl ?? null)) {
        // Persisting a new logo retires the previous file from disk.
        deleteUploadedFile(current.logoUrl as string | null)
      }
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: JSON.stringify(value) },
        create: { key, value: JSON.stringify(value) },
      })
    }
    const settings = await loadSettings()
    sendData(res, settings)
  }),
)

/** Upload a logo image. Replaces any previously uploaded logo. */
systemRouter.post(
  '/logo',
  requirePermission(PERMISSIONS.SYSTEM_MANAGE),
  (req: Request, res: Response, next: NextFunction) => {
    uploadLogo(req, res, (error: unknown) => {
      if (error) return next(error)
      next()
    })
  },
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file as Express.Multer.File | undefined
    if (!file) {
      throw ApiError.badRequest('No logo file was uploaded')
    }
    sendData(res, { logoUrl: uploadUrl(file.filename) }, 201)
  }),
)

/**
 * `POST /api/v1/system/restart` — gracefully shut the server down so a
 * supervisor (Windows service, PM2, docker restart policy, …) can start a
 * fresh process.
 *
 * A `202 Accepted` is returned before teardown begins so the client is told the
 * restart is accepted; the process exits with code 0 moments later.
 */
systemRouter.post(
  '/restart',
  requirePermission(PERMISSIONS.SYSTEM_MANAGE),
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(202).json({
      success: true,
      message: 'Restarting the CBT service…',
    })
    // Let the response flush before tearing the server down.
    setImmediate(() => {
      void restart()
    })
  }),
)

/** Resolve the configured backup directory from system settings. */
async function resolveBackupDir(): Promise<string> {
  const settings = await loadSettings()
  const dir = (settings as { backupPath?: string | null }).backupPath
  if (!dir) throw ApiError.badRequest('Backup path is not configured')
  return dir
}

/** List every backup folder available on the server. */
systemRouter.get(
  '/backups',
  requirePermission(PERMISSIONS.SYSTEM_MANAGE),
  asyncHandler(async (_req: Request, res: Response) => {
    const backupDir = await resolveBackupDir()
    const backups = await listBackups(backupDir)
    sendData(res, backups)
  }),
)

/** Create a new logical backup of every table. */
systemRouter.post(
  '/backup',
  requirePermission(PERMISSIONS.SYSTEM_MANAGE),
  asyncHandler(async (_req: Request, res: Response) => {
    const backupDir = await resolveBackupDir()
    const settings = await loadSettings()
    const backup = await createBackup(backupDir)
    const retentionDays = Number((settings as { backupRetentionDays?: number }).backupRetentionDays ?? 30)
    await pruneOldBackups(backupDir, retentionDays)
    sendData(res, backup, 201)
  }),
)

/** Restore a backup folder back into the database, replacing all current data. */
systemRouter.post(
  '/restore',
  requirePermission(PERMISSIONS.SYSTEM_MANAGE),
  validate({ body: z.object({ name: z.string().min(1) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.body as { name: string }
    // Only allow restoring a folder that lives directly under the backup dir.
    const backupDir = await resolveBackupDir()
    const target = join(backupDir, name)
    const prefix = backupDir.endsWith(sep) ? backupDir : `${backupDir}${sep}`
    if (!target.startsWith(prefix)) {
      throw ApiError.badRequest('Invalid backup name')
    }
    await restoreBackup(backupDir, name)
    sendData(res, { message: 'Database restored from backup' })
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