import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { ZodType } from 'zod'
import { ApiError } from '../utils/api-error.js'

/**
 * Zod request validation (§17).
 *
 * Validates body, params and query *before* any controller or service code runs,
 * so malformed input can never reach business logic or the database.
 *
 * Zod flattens to `{ field: ["message"] }`, which is exactly the `errors` shape
 * the frontend's `ApiError` already reads.
 */

type Source = 'body' | 'params' | 'query'

export interface ValidationSchemas {
  body?: ZodType
  params?: ZodType
  query?: ZodType
}

/**
 * Build a validation middleware from one or more Zod schemas.
 *
 * On success the *parsed* value replaces the raw input, so downstream handlers
 * receive coerced, defaulted, correctly typed data rather than `unknown` strings.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const source of ['params', 'query', 'body'] as Source[]) {
      const schema = schemas[source]
      if (!schema) continue

      const result = schema.safeParse(req[source])

      if (!result.success) {
        const details: Record<string, string[]> = {}

        for (const issue of result.error.issues) {
          // `params.id` should surface as `id`; only nested paths keep a prefix.
          const field = issue.path.length === 1
            ? String(issue.path[0])
            : issue.path.map(String).join('.')

          const message = issue.message
          if (details[field]) details[field]?.push(message)
          else details[field] = [message]
        }

        next(ApiError.validation('Validation failed', details))
        return
      }

      // Express 5 makes `req.query` a getter-only property in some setups, so
      // assignment is avoided where possible and mutation is used for objects.
      if (source === 'query') {
        Object.assign(req.query, result.data as Record<string, unknown>)
      } else {
        req[source] = result.data as never
      }
    }

    next()
  }
}