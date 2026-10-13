import { Router, type Request, type Response } from 'express'
import { currentUser, requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { clientIp, userAgentOf } from '../../services/audit.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  createExamSchema,
  examListQuerySchema,
  idParamSchema,
  updateExamSchema,
} from './exams.schema.js'
import {
  createExam,
  deleteExam,
  getExam,
  listExams,
  publishExam,
  unpublishExam,
  updateExam,
} from './exams.service.js'

/** Examination routes (§56). */

const contextOf = (req: Request) => ({
  actorId: currentUser(req).id,
  ipAddress: clientIp(req.ip),
  userAgent: userAgentOf(req.headers['user-agent']),
})

export const examsRouter = Router()

examsRouter.get(
  '/',
  requirePermission(PERMISSIONS.EXAMS_READ),
  validate({ query: examListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { data, meta } = await listExams(req.query as never)
    sendPaginated(res, data, meta)
  }),
)

examsRouter.post(
  '/',
  requirePermission(PERMISSIONS.EXAMS_CREATE),
  validate({ body: createExamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await createExam(req.body as never, contextOf(req)), 201, 'Examination created as draft')
  }),
)

examsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.EXAMS_READ),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await getExam(id))
  }),
)

examsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.EXAMS_UPDATE),
  validate({ params: idParamSchema, body: updateExamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await updateExam(id, req.body as never, contextOf(req)), 200, 'Examination updated')
  }),
)

examsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.EXAMS_DELETE),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await deleteExam(id, contextOf(req)), 200, 'Examination deleted')
  }),
)

/**
 * Publish and unpublish.
 *
 * Kept as explicit POST actions rather than a PATCH to `status`, so that
 * publishing is always a deliberate, separately audited operation (§22).
 */
examsRouter.post(
  '/:id/publish',
  requirePermission(PERMISSIONS.EXAMS_PUBLISH),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await publishExam(id, contextOf(req)), 200, 'Examination published')
  }),
)

examsRouter.post(
  '/:id/unpublish',
  requirePermission(PERMISSIONS.EXAMS_PUBLISH),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await unpublishExam(id, contextOf(req)), 200, 'Examination unpublished')
  }),
)