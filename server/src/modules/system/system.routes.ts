import { z } from 'zod'
import { createHash } from 'node:crypto'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { join, sep } from 'node:path'
import { currentUser, requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { ApiError } from '../../utils/api-error.js'
import { prisma } from '../../config/database.js'
import { Prisma } from '@prisma/client'
import { env } from '../../config/env.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import { verifySignedLicense, type SignedLicense, type VerifiedLicense } from '../../utils/license.js'
import { ensureInstallationId } from '../../services/installation.service.js'
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
    let license: { status: string; type: string; expiresAt: Date | null; studentLimit: number } | null = null

    try {
      const [students, questions, exams, results, installation, activeLicense] = await Promise.all([
        prisma.student.count({ where: { deletedAt: null } }),
        prisma.question.count({ where: { deletedAt: null } }),
        prisma.exam.count({ where: { deletedAt: null } }),
        prisma.result.count(),
        ensureInstallationId(),
        prisma.license.findFirst({ orderBy: { updatedAt: 'desc' }, select: { status: true, type: true, expiresAt: true, studentLimit: true } }),
      ])
      counts = { students, questions, exams, results }
      installationId = installation
      license = activeLicense
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
      license: license ? {
        status: license.status,
        plan: license.type,
        expiresAt: license.expiresAt?.toISOString() ?? null,
        maxCandidates: license.studentLimit,
      } : { status: 'UNACTIVATED', plan: null, expiresAt: null, maxCandidates: null },
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

export const licenseRouter = Router()

async function persistSignedLicense(
  actorId: string,
  installationId: string,
  claims: VerifiedLicense,
  signedLicense: SignedLicense,
  licenseKeyHash: string | null,
  action: 'LICENSE_ACTIVATED' | 'LICENSE_IMPORTED',
) {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.license.upsert({
      where: { id: claims.licenseId },
      create: {
        id: claims.licenseId,
        installationId,
        licenseKey: null,
        licenseKeyHash,
        type: claims.plan,
        status: claims.plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
        issuedTo: claims.institutionName,
        issuedAt: new Date(claims.issuedAt),
        expiresAt: claims.expiresAt ? new Date(claims.expiresAt) : null,
        studentLimit: claims.maxCandidates,
        features: claims.features,
        signedLicense: signedLicense as unknown as Prisma.InputJsonValue,
        lastValidatedAt: now,
        activatedAt: now,
      },
      update: {
        installationId,
        licenseKey: null,
        licenseKeyHash,
        type: claims.plan,
        status: claims.plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
        issuedTo: claims.institutionName,
        issuedAt: new Date(claims.issuedAt),
        expiresAt: claims.expiresAt ? new Date(claims.expiresAt) : null,
        studentLimit: claims.maxCandidates,
        features: claims.features,
        signedLicense: signedLicense as unknown as Prisma.InputJsonValue,
        lastValidatedAt: now,
        activatedAt: now,
      },
    })
    await tx.auditLog.create({
      data: {
        actorId,
        action,
        entity: 'License',
        entityId: claims.licenseId,
        description: action === 'LICENSE_ACTIVATED'
          ? 'A signed central license was activated on this installation'
          : 'An offline signed license was imported on this installation',
        metadata: { institutionId: claims.institutionId, plan: claims.plan },
      },
    })
  })
}

licenseRouter.get(
  '/',
  requirePermission(PERMISSIONS.LICENSE_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    const installationId = await ensureInstallationId()
    const license = await prisma.license.findFirst({
      where: { installationId },
      orderBy: { updatedAt: 'desc' },
      select: { status: true, type: true, expiresAt: true, studentLimit: true, features: true, signedLicense: true },
    })
    if (!license) {
      sendData(res, { installationId, status: 'UNACTIVATED', plan: null, expiresAt: null, maxCandidates: null, features: [] })
      return
    }

    if (!license.signedLicense || !env.LICENSE_PUBLIC_KEY_B64) {
      sendData(res, { installationId, status: 'INVALID', plan: null, expiresAt: null, maxCandidates: null, features: [] })
      return
    }
    try {
      const publicKeyPem = Buffer.from(env.LICENSE_PUBLIC_KEY_B64, 'base64').toString('utf8')
      const claims = verifySignedLicense(license.signedLicense as unknown as SignedLicense, {
        publicKeyPem,
        installationId,
        allowExpired: true,
      })
      sendData(res, {
        installationId,
        status: claims.expiresAt && Date.parse(claims.expiresAt) <= Date.now() ? 'EXPIRED' : license.status,
        plan: claims.plan,
        expiresAt: claims.expiresAt,
        maxCandidates: claims.maxCandidates,
        features: claims.features,
      })
    } catch {
      sendData(res, { installationId, status: 'INVALID', plan: null, expiresAt: null, maxCandidates: null, features: [] })
    }
  }),
)

licenseRouter.post(
  '/activate',
  requirePermission(PERMISSIONS.LICENSE_MANAGE),
  validate({ body: z.object({ activationKey: z.string().trim().min(15).max(100) }).strict() }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.LICENSE_PUBLIC_KEY_B64) {
      throw new ApiError(503, 'License verification is not configured on this server', 'LICENSE_NOT_CONFIGURED')
    }
    const installationId = await ensureInstallationId()
    let response: globalThis.Response
    try {
      response = await fetch(new URL('/api/public/activate', env.LICENSING_API_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activationKey: req.body.activationKey, installationId }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new ApiError(503, 'Licensing service is unavailable. Try again when internet access is restored.', 'LICENSING_UNAVAILABLE')
    }

    if (!response.ok) {
      if (response.status === 401) throw ApiError.unauthorized('Activation key is invalid', 'LICENSE_KEY_INVALID')
      if (response.status === 403) throw ApiError.forbidden('This license is expired, suspended or revoked')
      if (response.status === 409) throw ApiError.conflict('This license is already bound to another installation')
      if (response.status === 429) throw ApiError.tooManyRequests('Too many activation attempts. Try again later.')
      throw new ApiError(503, 'Licensing service could not complete activation', 'LICENSING_UNAVAILABLE')
    }

    const body = await response.json().catch(() => null) as { data?: SignedLicense } | null
    if (!body?.data) throw ApiError.internal('Licensing service returned an invalid response')
    const publicKeyPem = Buffer.from(env.LICENSE_PUBLIC_KEY_B64, 'base64').toString('utf8')
    let claims
    try {
      claims = verifySignedLicense(body.data, { publicKeyPem, installationId })
    } catch {
      throw ApiError.forbidden('The returned license could not be verified')
    }

    const keyHash = createHash('sha256').update(req.body.activationKey.replace(/[^a-z0-9]/gi, '').toUpperCase()).digest('hex')
    await persistSignedLicense(currentUser(req).id, installationId, claims, body.data, keyHash, 'LICENSE_ACTIVATED')

    sendData(res, {
      installationId,
      status: claims.plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
      plan: claims.plan,
      expiresAt: claims.expiresAt,
      maxCandidates: claims.maxCandidates,
      features: claims.features,
    }, 201)
  }),
)

licenseRouter.post(
  '/import',
  requirePermission(PERMISSIONS.LICENSE_MANAGE),
  validate({ body: z.object({ signedLicense: z.unknown() }).strict() }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.LICENSE_PUBLIC_KEY_B64) {
      throw new ApiError(503, 'License verification is not configured on this server', 'LICENSE_NOT_CONFIGURED')
    }
    const installationId = await ensureInstallationId()
    const signedLicense = req.body.signedLicense as SignedLicense
    let claims: VerifiedLicense
    try {
      claims = verifySignedLicense(signedLicense, {
        publicKeyPem: Buffer.from(env.LICENSE_PUBLIC_KEY_B64, 'base64').toString('utf8'),
        installationId,
      })
    } catch {
      throw ApiError.forbidden('The offline license is invalid, expired or belongs to another installation')
    }

    await persistSignedLicense(currentUser(req).id, installationId, claims, signedLicense, null, 'LICENSE_IMPORTED')
    sendData(res, {
      installationId,
      status: claims.plan === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
      plan: claims.plan,
      expiresAt: claims.expiresAt,
      maxCandidates: claims.maxCandidates,
      features: claims.features,
    }, 201)
  }),
)

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
