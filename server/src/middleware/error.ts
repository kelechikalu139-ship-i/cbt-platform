import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { isProduction } from '../config/env.js'
import { isConnectionError, prisma } from '../config/database.js'
import { logger } from '../config/logger.js'
import { ApiError } from '../utils/api-error.js'
import { sendError } from '../utils/http-response.js'

/**
 * Centralised error handling (§18).
 *
 * Three responsibilities:
 *
 * 1. Turn anything thrown anywhere in the request into one consistent envelope.
 * 2. Never leak a stack trace, SQL fragment, or driver message to a client in
 *    production. Unexpected errors become a flat 500; the detail goes to the log
 *    with the request id so an operator can correlate it.
 * 3. Return the right status for the failure classes that genuinely deserve one —
 *    notably Prisma's unique-constraint violation as a 409 rather than a 500.
 */

/** Prisma error codes we can translate into a meaningful HTTP response. */
const PRISMA_ERROR_MAP: Record<string, { status: number; message: string; code: string }> = {
  P2002: {
    status: 409,
    message: 'A record with these details already exists',
    code: 'DUPLICATE',
  },
  P2003: {
    status: 409,
    message: 'This record is referenced by other records and cannot be changed',
    code: 'IN_USE',
  },
  P2025: {
    status: 404,
    message: 'Resource not found',
    code: 'NOT_FOUND',
  },
  P2000: {
    status: 422,
    message: 'A value is longer than the database allows',
    code: 'VALUE_TOO_LONG',
  },
}

/** Body parser failures arrive here too; give them a useful message. */
function translateBodyParserError(error: unknown): ApiError | null {
  if (!(error instanceof Error)) return null

  const type = (error as { type?: string }).type
  if (type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON')
  }
  if (type === 'entity.too.large') {
    return new ApiError(413, 'Request body is too large', 'PAYLOAD_TOO_LARGE')
  }
  return null
}

/** Express 5 exposes body-parser errors with a `status`/`statusCode` property. */
function statusFromExpressError(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown }
  const value = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode
  return typeof value === 'number' && value >= 400 && value < 600 ? value : undefined
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, `Route ${req.method} ${req.path} does not exist`)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error middleware by arity; `next` must stay in the signature.
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  // A response already sent means the failure happened mid-stream; there is
  // nothing safe to do but destroy the socket.
  if (res.headersSent) {
    logger.error({ err: error, requestId: req.requestId }, 'error after response started')
    res.destroy()
    return
  }

  const requestId = req.requestId

  // --- Deliberate, client-facing errors ---------------------------------
  if (error instanceof ApiError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, requestId, path: req.path }, 'operational error')
    } else {
      logger.warn(
        { code: error.code, status: error.statusCode, requestId, path: req.path, method: req.method },
        error.message,
      )
    }
    sendError(res, error.statusCode, error.message, error.details)
    return
  }

  // --- Zod escaping from a service (controllers validate at the edge) -----
  if (error instanceof ZodError) {
    const details: Record<string, string[]> = {}
    for (const issue of error.issues) {
      const field = issue.path.length === 1 ? String(issue.path[0]) : issue.path.map(String).join('.')
      if (details[field]) details[field]?.push(issue.message)
      else details[field] = [issue.message]
    }
    sendError(res, 422, 'Validation failed', details)
    return
  }

  // --- Malformed request bodies ------------------------------------------
  const parserError = translateBodyParserError(error)
  if (parserError) {
    sendError(res, parserError.statusCode, parserError.message, parserError.details)
    return
  }

  // --- Prisma / database --------------------------------------------------
  const prismaCode = (error as { code?: string } | null)?.code
  if (typeof prismaCode === 'string' && PRISMA_ERROR_MAP[prismaCode]) {
    const mapped = PRISMA_ERROR_MAP[prismaCode]
    logger.warn({ prismaCode, requestId, path: req.path }, mapped.message)
    sendError(res, mapped.status, mapped.message)
    return
  }

  if (isConnectionError(error)) {
    // The database is unreachable. This is an operator problem, not a client
    // error, but the honest status is 503 so a client can retry rather than
    // treat a transient database blip as a permanent failure.
    logger.error({ err: error, requestId, path: req.path }, 'database unavailable')
    sendError(res, 503, 'The service is temporarily unavailable. Please retry shortly.')
    return
  }

  // --- Express-level status (e.g. 404 from a router) ----------------------
  const expressStatus = statusFromExpressError(error)
  if (expressStatus) {
    sendError(res, expressStatus, isProduction ? 'Request failed' : String((error as Error).message))
    return
  }

  // --- Anything else is a bug ---------------------------------------------
  logger.error(
    { err: error, requestId, path: req.path, method: req.method },
    'unhandled error',
  )

  sendError(
    res,
    500,
    isProduction ? 'An unexpected error occurred' : `Unhandled: ${(error as Error)?.message ?? 'unknown'}`,
  )
}

/**
 * Wrap `prisma.$transaction` so a failure cannot leave a half-applied write.
 *
 * Every multi-table operation in this codebase goes through here (§26). The
 * callback form is used deliberately: it returns a promise and lets Prisma apply
 * or roll back the whole unit of work as one.
 *
 * `Prisma.TransactionClient` is the type Prisma itself passes to the callback —
 * the interactive-transaction client without `$connect`/`$disconnect`, which are
 * forbidden inside a transaction.
 */
export async function runInTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number
    timeout?: number
    isolationLevel?: Prisma.TransactionIsolationLevel
  },
): Promise<T> {
  return prisma.$transaction(callback, {
    // A lab server can briefly stall while every student submits at once. The
    // default 5s transaction timeout is too tight for grading a whole paper.
    maxWait: options?.maxWait ?? 15_000,
    timeout: options?.timeout ?? 30_000,
    isolationLevel: options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
  })
}