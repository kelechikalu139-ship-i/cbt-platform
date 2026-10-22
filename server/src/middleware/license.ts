import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { prisma } from '../config/database.js'
import { ensureInstallationId } from '../services/installation.service.js'
import { ApiError } from '../utils/api-error.js'
import { verifySignedLicense, type SignedLicense } from '../utils/license.js'

const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000

/** Gate new exam attempts on a locally verified, unexpired license. */
export async function requireActiveLicense(
  _req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  // Unconfigured development/test installs retain the existing exam workflow.
  // Production fails closed and env.ts requires a valid public key at startup.
  if (env.NODE_ENV !== 'production' && !env.LICENSE_PUBLIC_KEY_B64) {
    next()
    return
  }
  if (!env.LICENSE_PUBLIC_KEY_B64) {
    next(new ApiError(503, 'License verification is not configured on this server', 'LICENSE_NOT_CONFIGURED'))
    return
  }

  try {
    const installationId = await ensureInstallationId()
    const license = await prisma.license.findFirst({
      where: { installationId },
      orderBy: { updatedAt: 'desc' },
      select: { status: true, signedLicense: true, lastValidatedAt: true },
    })
    if (!license?.signedLicense) {
      next(ApiError.forbidden('This installation needs a valid license before a new exam can start'))
      return
    }
    if (license.status === 'SUSPENDED' || license.status === 'REVOKED' || license.status === 'EXPIRED') {
      next(ApiError.forbidden('This license is suspended, revoked or expired'))
      return
    }

    const now = new Date()
    if (license.lastValidatedAt && now.getTime() + CLOCK_ROLLBACK_TOLERANCE_MS < license.lastValidatedAt.getTime()) {
      next(ApiError.forbidden('The server clock moved backwards. Correct the server time before starting another exam'))
      return
    }

    try {
      const claims = verifySignedLicense(license.signedLicense as unknown as SignedLicense, {
        publicKeyPem: Buffer.from(env.LICENSE_PUBLIC_KEY_B64, 'base64').toString('utf8'),
        installationId,
        now,
      })
      if (!claims.features.includes('cbt')) {
        next(ApiError.forbidden('This license does not include CBT exam delivery'))
        return
      }
    } catch (error) {
      const expired = error instanceof Error && error.message === 'License has expired'
      next(ApiError.forbidden(expired
        ? 'This license has expired. Activate a renewal before starting another exam'
        : 'This installation has no valid signed license'))
      return
    }

    if (!license.lastValidatedAt || now > license.lastValidatedAt) {
      await prisma.license.updateMany({
        where: { installationId },
        data: { lastValidatedAt: now },
      })
    }
    next()
  } catch (error) {
    next(error)
  }
}
