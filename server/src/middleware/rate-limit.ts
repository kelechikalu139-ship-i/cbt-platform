import rateLimit, { type Options } from 'express-rate-limit'
import type { Request, Response } from 'express'
import { env } from '../config/env.js'
import { sendError } from '../utils/http-response.js'

/**
 * Rate limiting (§20).
 *
 * Two very different policies, because the traffic profiles are different.
 *
 * - Authentication endpoints are limited tightly. Ten attempts per quarter hour
 *   per IP is far above human behaviour and well below credential stuffing.
 * - Everything else gets a deliberately generous global ceiling. During an
 *   examination a whole lab can legitimately fire hundreds of requests in the
 *   same second, and throttling a student's answer save is a far worse outcome
 *   than tolerating the load.
 *
 * A student terminal is behind the same NAT address as the rest of the lab, so
 * the limiter keys on IP and a busy room shares one budget. That is deliberate:
 * it stops one machine abusing the API without risking a false lockout of an
 * entire class.
 */

function limitHandler(_req: Request, res: Response, _next: unknown, options: Options): void {
  const retryAfterSeconds = options.windowMs / 1000

  res.setHeader('Retry-After', String(Math.ceil(retryAfterSeconds)))
  sendError(
    res,
    429,
    'Too many requests. Please wait a moment and try again.',
  )
}

/** Tight limit for `/auth/login` and `/auth/refresh`. */
export const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Failed sign-ins count. Successful ones are free, so a legitimate user with a
  // fat-fingered password cannot lock out their own class.
  skipSuccessfulRequests: true,
  handler: limitHandler,
})

/** Generous global ceiling. See the module comment before tightening this. */
export const globalLimiter = rateLimit({
  windowMs: env.GLOBAL_RATE_LIMIT_WINDOW_MS,
  limit: env.GLOBAL_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Health checks are polled by monitoring; they must never be throttled.
  skip: (req) => req.path === '/health' || req.path.endsWith('/system/status'),
  handler: limitHandler,
})

/**
 * Per-account throttle for answer autosave.
 *
 * Answer saving is the highest-volume endpoint during an exam, so this is set
 * generously. It exists to catch a runaway client loop, not to throttle a class.
 *
 * The default IP-based key is used deliberately: express-rate-limit's default
 * already normalises IPv6 into subnets, and a whole lab shares one NAT address in
 * any case, so a custom key would add risk without adding fairness.
 */
export const answerSaveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: limitHandler,
})