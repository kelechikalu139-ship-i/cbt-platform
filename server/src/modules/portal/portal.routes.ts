import { Router, type Request, type Response } from 'express'
import { requireRole, currentUser } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData } from '../../utils/http-response.js'
import { clientIp, userAgentOf } from '../../services/audit.service.js'
import { ROLE_CODES } from '../../constants/permissions.js'
import {
  idParamSchema,
  saveAnswerSchema,
  startSessionSchema,
  updateProfileSchema,
} from './portal.schema.js'
import {
  getResult,
  getSession,
  getStudentDashboard,
  getStudentExam,
  getStudentProfile,
  listStudentExams,
  mySessions,
  saveAnswer,
  startSession,
  submitSession,
  updateStudentProfile,
} from './portal.service.js'

/**
 * Student portal routes (§55).
 *
 * The API router mounts `authenticate` before this router, so
 * every route here has a proven identity. Students hold no
 * administrative permissions, so the guard is the STUDENT role
 * plus an ownership check on every session and result: a
 * candidate can only ever reach their own paper.
 */

export const portalRouter = Router()

const studentOnly = requireRole(ROLE_CODES.STUDENT)

/** Collect the auditing context from the live request. */
function contextOf(req: Request) {
  return {
    ipAddress: clientIp(req.ip),
    userAgent: userAgentOf(req.headers['user-agent']),
  }
}

// --- Exam browsing -----------------------------------------------------

portalRouter.get(
  '/exams',
  studentOnly,
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await listStudentExams(currentUser(req)))
  }),
)

portalRouter.get(
  '/exams/:id',
  studentOnly,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await getStudentExam(currentUser(req), id))
  }),
)

// --- Profile -----------------------------------------------------------

portalRouter.get(
  '/me',
  studentOnly,
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await getStudentProfile(currentUser(req)))
  }),
)

portalRouter.put(
  '/me',
  studentOnly,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.body as { name: string }
    sendData(res, await updateStudentProfile(currentUser(req), { name }))
  }),
)

portalRouter.get(
  '/dashboard',
  studentOnly,
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await getStudentDashboard(currentUser(req)))
  }),
)

// --- Exam sessions -----------------------------------------------------

// Registered before `/sessions/:id` so the literal path wins.
portalRouter.get(
  '/sessions/mine',
  studentOnly,
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await mySessions(currentUser(req)))
  }),
)

portalRouter.post(
  '/sessions/start',
  studentOnly,
  validate({ body: startSessionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { examId } = req.body as { examId: string }
    const { ipAddress, userAgent } = contextOf(req)
    sendData(
      res,
      await startSession(examId, currentUser(req), ipAddress, userAgent),
      201,
      'Examination started',
    )
  }),
)

portalRouter.get(
  '/sessions/:id',
  studentOnly,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await getSession(id, currentUser(req)))
  }),
)

portalRouter.post(
  '/sessions/:id/answer',
  studentOnly,
  validate({ params: idParamSchema, body: saveAnswerSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    const { questionId, answer } = req.body as { questionId: string; answer: string }
    sendData(res, await saveAnswer(id, currentUser(req), { questionId, answer }))
  }),
)

portalRouter.post(
  '/sessions/:id/submit',
  studentOnly,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await submitSession(id, currentUser(req)))
  }),
)

portalRouter.get(
  '/sessions/:id/result',
  studentOnly,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await getResult(id, currentUser(req)))
  }),
)
