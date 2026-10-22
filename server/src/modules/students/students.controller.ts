import type { Request, Response } from 'express'
import { currentUser } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { clientIp, userAgentOf } from '../../services/audit.service.js'
import {
  deleteStudentsByFilter,
  createStudent,
  deleteStudent,
  extendStudentSession,
  getStudent,
  listClasses,
  listSchoolOptions,
  listStudents,
  logoutStudent,
  updateStudent,
} from './students.service.js'

/** Student controller (§25). */

const contextOf = (req: Request) => ({
  actorId: currentUser(req).id,
  ipAddress: clientIp(req.ip),
  userAgent: userAgentOf(req.headers['user-agent']),
})

export const listStudentsController = asyncHandler(async (req: Request, res: Response) => {
  const { data, meta } = await listStudents(req.query as never)
  sendPaginated(res, data, meta)
})

export const listClassesController = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await listClasses())
})

/** Programmes, departments, classes, levels and semesters the school runs. */
export const schoolOptionsController = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await listSchoolOptions())
})

export const getStudentController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  sendData(res, await getStudent(id))
})

export const createStudentController = asyncHandler(async (req: Request, res: Response) => {
  const student = await createStudent(req.body as never, contextOf(req))
  sendData(res, student, 201, 'Student created successfully')
})

export const updateStudentController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const student = await updateStudent(id, req.body as never, contextOf(req))
  sendData(res, student, 200, 'Student updated successfully')
})

export const deleteStudentController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await deleteStudent(id, contextOf(req))
  sendData(res, { id, deleted: true }, 200, 'Student deactivated')
})

export const logoutStudentController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  await logoutStudent(id, contextOf(req))
  sendData(res, { success: true }, 200, 'Student session ended')
})

export const extendStudentSessionController = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const { additionalMinutes } = req.body as { additionalMinutes: number }
  const result = await extendStudentSession(id, additionalMinutes, contextOf(req))
  sendData(res, result, 200, `Session extended by ${additionalMinutes} minute(s)`)
})

export const bulkDeleteStudentsController = asyncHandler(async (req: Request, res: Response) => {
  const { deleted } = await deleteStudentsByFilter(req.body as never, contextOf(req))
  sendData(res, { deleted }, 200, `${deleted} student(s) deactivated`)
})