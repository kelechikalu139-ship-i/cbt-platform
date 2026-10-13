import { Router, type Request, type Response } from 'express'
import { currentUser, requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { clientIp, userAgentOf } from '../../services/audit.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  bulkQuestionImportSchema,
  createQuestionSchema,
  idParamSchema,
  questionListQuerySchema,
  updateQuestionSchema,
} from './questions.schema.js'
import {
  bulkImportQuestions,
  createQuestion,
  deleteQuestion,
  getQuestion,
  listQuestions,
  questionPoolSizes,
  updateQuestion,
} from './questions.service.js'

/**
 * Question bank routes (§56).
 *
 * Every route requires `questions.*`, so the answer key is only ever returned to a
 * member of staff who is allowed to edit the bank (§32).
 */

const contextOf = (req: Request) => ({
  actorId: currentUser(req).id,
  ipAddress: clientIp(req.ip),
  userAgent: userAgentOf(req.headers['user-agent']),
})

export const questionsRouter = Router()

questionsRouter.get(
  '/',
  requirePermission(PERMISSIONS.QUESTIONS_READ),
  validate({ query: questionListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { data, meta } = await listQuestions(req.query as never)
    sendPaginated(res, data, meta)
  }),
)

/** Declared before `/:id` so the literal path is not captured as an id. */
questionsRouter.get(
  '/subjects',
  requirePermission(PERMISSIONS.QUESTIONS_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    sendData(res, await questionPoolSizes())
  }),
)

questionsRouter.post(
  '/bulk',
  requirePermission(PERMISSIONS.QUESTIONS_CREATE),
  validate({ body: bulkQuestionImportSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await bulkImportQuestions(req.body as never, contextOf(req)), 201, 'Questions imported')
  }),
)

questionsRouter.post(
  '/',
  requirePermission(PERMISSIONS.QUESTIONS_CREATE),
  validate({ body: createQuestionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await createQuestion(req.body as never, contextOf(req)), 201, 'Question created')
  }),
)

questionsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.QUESTIONS_READ),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await getQuestion(id))
  }),
)

questionsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.QUESTIONS_UPDATE),
  validate({ params: idParamSchema, body: updateQuestionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await updateQuestion(id, req.body as never, contextOf(req)), 200, 'Question updated')
  }),
)

questionsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.QUESTIONS_DELETE),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await deleteQuestion(id, contextOf(req)), 200, 'Question deleted')
  }),
)