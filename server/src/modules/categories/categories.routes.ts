import { Router, type Request, type Response } from 'express'
import { requirePermission, currentUser } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData, sendPaginated } from '../../utils/http-response.js'
import { clientIp, userAgentOf } from '../../services/audit.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  categoryListQuerySchema,
  createCategorySchema,
  createSubjectSchema,
  idParamSchema,
  updateCategorySchema,
  updateSubjectSchema,
} from './categories.schema.js'
import {
  createCategory,
  createSubject,
  deleteCategory,
  getCategory,
  listCategories,
  listSubjects,
  updateCategory,
  updateSubject,
} from './categories.service.js'

/** Category and subject routes (§56). */

const contextOf = (req: Request) => ({
  actorId: currentUser(req).id,
  ipAddress: clientIp(req.ip),
  userAgent: userAgentOf(req.headers['user-agent']),
})

export const categoriesRouter = Router()

categoriesRouter.get(
  '/',
  requirePermission(PERMISSIONS.CATEGORIES_READ),
  validate({ query: categoryListQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { data, meta } = await listCategories(req.query as never)
    sendPaginated(res, data, meta)
  }),
)

/** Subjects are nested under categories for filter convenience in the UI. */
categoriesRouter.get(
  '/subjects',
  requirePermission(PERMISSIONS.CATEGORIES_READ),
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await listSubjects(req.query as never))
  }),
)

categoriesRouter.post(
  '/',
  requirePermission(PERMISSIONS.CATEGORIES_CREATE),
  validate({ body: createCategorySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await createCategory(req.body as never, contextOf(req)), 201, 'Category created')
  }),
)

categoriesRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.CATEGORIES_READ),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await getCategory(id))
  }),
)

categoriesRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.CATEGORIES_UPDATE),
  validate({ params: idParamSchema, body: updateCategorySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await updateCategory(id, req.body as never, contextOf(req)), 200, 'Category updated')
  }),
)

categoriesRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.CATEGORIES_DELETE),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await deleteCategory(id, contextOf(req)), 200, 'Category deleted')
  }),
)

// --- Subjects -------------------------------------------------------------

export const subjectsRouter = Router()

subjectsRouter.post(
  '/',
  requirePermission(PERMISSIONS.CATEGORIES_CREATE),
  validate({ body: createSubjectSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendData(res, await createSubject(req.body as never, contextOf(req)), 201, 'Subject created')
  }),
)

subjectsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.CATEGORIES_UPDATE),
  validate({ params: idParamSchema, body: updateSubjectSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }
    sendData(res, await updateSubject(id, req.body as never, contextOf(req)), 200, 'Subject updated')
  }),
)