import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Wraps an async route handler so a rejected promise reaches Express.
 *
 * Express 5 forwards rejections from async handlers on its own, but wrapping
 * explicitly keeps the behaviour identical regardless of the Express major and
 * makes the intent obvious at every call site. A handler that throws is a bug;
 * this guarantees it becomes a 500 rather than an unhandled rejection that
 * silently kills the request.
 */
export function asyncHandler<
  P = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = Record<string, unknown>,
>(
  handler: (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}