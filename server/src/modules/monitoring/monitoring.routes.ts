import { Router, type Request, type Response } from 'express'
import { currentUser, requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData } from '../../utils/http-response.js'
import { clientIp, userAgentOf } from '../../services/audit.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  extendSessionSchema,
  forceSubmitSchema,
  idParamSchema,
  liveSessionQuerySchema,
  resetAttemptsSchema,
} from './monitoring.schema.js'
import {
  extendSession,
  forceSubmitSession,
  listExamAttempts,
  listLiveSessions,
  resetExamAttempts,
} from './monitoring.service.js'

/**
 * Live examination monitoring (§55).
 *
 * Mounted under `/exams` so the invigilator's tools sit beside the
 * papers they act on: who is writing, who is stuck, and the three
 * interventions that actually come up on exam day.
 */

const contextOf = (req: Request) => ({
  actorId: currentUser(req).id,
  ipAddress: clientIp(req.ip),
  userAgent: userAgentOf(req.headers['user-agent']),
})

export const monitoringRouter = Router()

/** Attempts in progress right now, for the monitor and the dashboard. */
monitoringRouter.get(
  '/sessions/live',
  requirePermission(PERMISSIONS.EXAMS_READ),
  validate({ query: liveSessionQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    // `validate` replaces `req.query` with the parsed values.
    sendData(res, await listLiveSessions(req.query as never))
  }),
)

/** Everyone who has attempted a paper, for the reset dialog. */
monitoringRouter.get(
  '/:id/attempts',
  requirePermission(PERMISSIONS.EXAMS_READ),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await listExamAttempts(id))
  }),
)

/** Close one live attempt early and grade what was answered. */
monitoringRouter.post(
  '/sessions/:id/force-submit',
  requirePermission(PERMISSIONS.EXAMS_UPDATE),
  validate({ params: idParamSchema, body: forceSubmitSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    const row = await forceSubmitSession(id, contextOf(req))
    sendData(res, row, 200, 'Attempt ended and graded')
  }),
)

/** Add extra time to a live examination session (invigilator action). */
monitoringRouter.post(
  '/sessions/:id/extend-time',
  requirePermission(PERMISSIONS.EXAMS_UPDATE),
  validate({ params: idParamSchema, body: extendSessionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    const { additionalMinutes } = req.body as { additionalMinutes: number }
    const row = await extendSession(id, additionalMinutes, contextOf(req))
    sendData(res, row, 200, `${additionalMinutes} minute(s) added`)
  }),
)

/** Wipe attempts on a paper so candidates can sit it again. */
monitoringRouter.post(
  '/:id/reset-attempts',
  requirePermission(PERMISSIONS.EXAMS_UPDATE),
  validate({ params: idParamSchema, body: resetAttemptsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    const { studentIds } = req.body as { studentIds?: string[] }
    const result = await resetExamAttempts(id, studentIds, contextOf(req))
    sendData(res, result, 200, `${result.resetAttempts} attempt(s) reset`)
  }),
)
