/**
 * Application error type.
 *
 * Every deliberate failure in this codebase is an `ApiError`. Anything else that
 * reaches the error middleware is treated as an unexpected bug and reported as a
 * generic 500 with no internal detail (§18).
 */
export class ApiError extends Error {
  readonly statusCode: number
  /** Stable machine-readable code, e.g. `AUTH_INVALID_CREDENTIALS`. */
  readonly code: string
  /** Field-level validation messages, keyed by field name. */
  readonly details?: Record<string, string[]>
  /** Whether the error is safe to show a client in production. */
  readonly isOperational: boolean

  constructor(
    statusCode: number,
    message: string,
    code = 'ERROR',
    details?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    this.isOperational = true
    Error.captureStackTrace(this, ApiError)
  }

  static badRequest(message = 'Bad request', details?: Record<string, string[]>): ApiError {
    return new ApiError(400, message, 'BAD_REQUEST', details)
  }

  static validation(message = 'Validation failed', details?: Record<string, string[]>): ApiError {
    return new ApiError(422, message, 'VALIDATION_FAILED', details)
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, message, code)
  }

  static forbidden(message = 'You do not have permission to perform this action'): ApiError {
    return new ApiError(403, message, 'FORBIDDEN')
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, message, 'NOT_FOUND')
  }

  static conflict(message = 'Resource conflict', details?: Record<string, string[]>): ApiError {
    return new ApiError(409, message, 'CONFLICT', details)
  }

  static unprocessable(message = 'Request could not be processed', details?: Record<string, string[]>): ApiError {
    return new ApiError(422, message, 'UNPROCESSABLE', details)
  }

  static tooManyRequests(message = 'Too many requests'): ApiError {
    return new ApiError(429, message, 'TOO_MANY_REQUESTS')
  }

  static internal(message = 'An unexpected error occurred'): ApiError {
    return new ApiError(500, message, 'INTERNAL_ERROR')
  }
}