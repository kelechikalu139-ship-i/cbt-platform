import { Router, type Request, type Response } from 'express'
import { requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import { resultsListQuerySchema } from './results.schema.js'
import { exportResultsCsv, listResults, resultsSummary } from './results.service.js'

/**
 * Results routes (§48).
 *
 * Read-only reporting over submitted and graded examination attempts.
 * `results.read` gates listing and the summary; `results.export` gates CSV
 * export.
 */
export const resultsRouter = Router()

/** Paginated list of all graded results. */
resultsRouter.get(
  '/',
  requirePermission(PERMISSIONS.RESULTS_READ),
  validate({ query: resultsListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { data, meta } = await listResults(req.query as never)
    sendPaginated(res, data, meta)
  }),
)

/** Aggregate summary: totals, pass rate, grade distribution, subject performance. */
resultsRouter.get(
  '/summary',
  requirePermission(PERMISSIONS.RESULTS_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    sendData(res, await resultsSummary())
  }),
)

/** CSV export of every result, newest first. */
resultsRouter.get(
  '/export',
  requirePermission(PERMISSIONS.RESULTS_EXPORT),
  asyncHandler(async (_req: Request, res: Response) => {
    const csv = await exportResultsCsv()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="cbt-results.csv"',
    )
    res.status(200).send(csv)
  }),
)
