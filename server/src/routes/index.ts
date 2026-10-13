import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { authRouter } from '../modules/auth/auth.routes.js'
import { usersRouter } from '../modules/users/users.routes.js'
import { studentsRouter } from '../modules/students/students.routes.js'
import { categoriesRouter, subjectsRouter } from '../modules/categories/categories.routes.js'
import { questionsRouter } from '../modules/questions/questions.routes.js'
import { examsRouter } from '../modules/exams/exams.routes.js'
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.js'
import { portalRouter } from '../modules/portal/portal.routes.js'
import { auditRouter, healthRouter, systemRouter } from '../modules/system/system.routes.js'

/**
 * API v1 router (§23, §24).
 *
 * `health` is mounted before `authenticate` so it stays reachable without a token
 * (§36). Everything below it is authenticated; individual routes then add their
 * own permission guard.
 */
export const apiRouter = Router()

apiRouter.use('/health', healthRouter)

// --- Authentication ------------------------------------------------------
apiRouter.use('/auth', authRouter)

// --- Authenticated area --------------------------------------------------
apiRouter.use(authenticate)
apiRouter.use('/users', usersRouter)
apiRouter.use('/students', studentsRouter)
apiRouter.use('/categories', categoriesRouter)
apiRouter.use('/subjects', subjectsRouter)
apiRouter.use('/questions', questionsRouter)
apiRouter.use('/exams', examsRouter)
apiRouter.use('/dashboard', dashboardRouter)
// The student portal: exam delivery, sessions, results and
// the candidate's own profile (§55).
apiRouter.use('/portal', portalRouter)
apiRouter.use('/audit-logs', auditRouter)
apiRouter.use('/system', systemRouter)