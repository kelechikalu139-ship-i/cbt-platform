import { Router } from 'express'
import { requirePermission } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  createStudentSchema,
  idParamSchema,
  studentListQuerySchema,
  updateStudentSchema,
} from './students.schema.js'
import {
  createStudentController,
  deleteStudentController,
  getStudentController,
  listClassesController,
  listStudentsController,
  logoutStudentController,
  schoolOptionsController,
  updateStudentController,
} from './students.controller.js'

/**
 * Student routes (§56).
 *
 * Every route is behind `authenticate` and a permission, so knowing the URL is
 * never enough to reach student data (§16, §51).
 */
export const studentsRouter = Router()

studentsRouter.get(
  '/',
  requirePermission(PERMISSIONS.STUDENTS_READ),
  validate({ query: studentListQuerySchema }),
  listStudentsController,
)

/** Filter helper for the admin UI. Declared before `/:id` so it is not shadowed. */
studentsRouter.get(
  '/classes',
  requirePermission(PERMISSIONS.STUDENTS_READ),
  listClassesController,
)

/**
 * The school's academic vocabulary, for the pickers in the administration
 * UI. Declared before `/:id` so it is not shadowed.
 */
studentsRouter.get(
  '/options',
  requirePermission(PERMISSIONS.STUDENTS_READ),
  schoolOptionsController,
)

studentsRouter.post(
  '/',
  requirePermission(PERMISSIONS.STUDENTS_CREATE),
  validate({ body: createStudentSchema }),
  createStudentController,
)

studentsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.STUDENTS_READ),
  validate({ params: idParamSchema }),
  getStudentController,
)

studentsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.STUDENTS_UPDATE),
  validate({ params: idParamSchema, body: updateStudentSchema }),
  updateStudentController,
)

studentsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.STUDENTS_DELETE),
  validate({ params: idParamSchema }),
  deleteStudentController,
)

studentsRouter.post(
  '/:id/logout',
  requirePermission(PERMISSIONS.STUDENTS_UPDATE),
  validate({ params: idParamSchema }),
  logoutStudentController,
)