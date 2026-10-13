import type { Response } from 'express'

/**
 * Response envelope (§48).
 *
 * Success:
 *   { "success": true, "data": ... , "meta"?: { page, pageSize, totalItems, totalPages } }
 * Failure:
 *   { "success": false, "message": "...", "errors"?: { field: ["..."] } }
 *
 * `meta` sits at the top level rather than nested inside `data` because the admin
 * UI already consumes exactly this shape (`apps/admin/src/types` → `Paginated<T>`),
 * and the build instruction is to avoid changing the frontends unnecessarily.
 * The array itself stays directly under `data` so `envelope.data` is the list.
 */

export interface PaginationMeta {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

export interface SuccessBody<T> {
  success: true
  data: T
  meta?: PaginationMeta
  message?: string
}

export interface ErrorBody {
  success: false
  message: string
  errors?: Record<string, string[]>
}

/** Send a successful single-resource response. */
export function sendData<T>(res: Response, data: T, statusCode = 200, message?: string): Response {
  const body: SuccessBody<T> = { success: true, data }
  if (message) body.message = message
  return res.status(statusCode).json(body)
}

/** Send a successful paginated collection. */
export function sendPaginated<T>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
  statusCode = 200,
  message?: string,
): Response {
  const body: SuccessBody<T[]> = { success: true, data, meta }
  if (message) body.message = message
  return res.status(statusCode).json(body)
}

/** Send a failure. Always `{ success: false }` so clients can branch on one field. */
export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  errors?: Record<string, string[]>,
): Response {
  const body: ErrorBody = { success: false, message }
  if (errors) body.errors = errors
  return res.status(statusCode).json(body)
}