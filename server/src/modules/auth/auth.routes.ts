import { Router } from 'express'
import { authenticate } from '../../middleware/auth.js'
import { authLimiter } from '../../middleware/rate-limit.js'
import { validate } from '../../middleware/validate.js'
import { changePasswordSchema, loginSchema, logoutSchema, refreshSchema, studentLoginSchema } from './auth.schema.js'
import {
  changePasswordController,
  loginController,
  logoutController,
  meController,
  refreshController,
  studentLoginController,
} from './auth.controller.js'

/**
 * Authentication routes (§24, §56).
 *
 * `login` and `refresh` are rate limited; `me`, `logout` and
 * `change-password` require a valid access token.
 */
export const authRouter = Router()

authRouter.post('/login', authLimiter, validate({ body: loginSchema }), loginController)
authRouter.post('/student-login', authLimiter, validate({ body: studentLoginSchema }), studentLoginController)
authRouter.post('/refresh', authLimiter, validate({ body: refreshSchema }), refreshController)

authRouter.post(
  '/logout',
  authenticate,
  validate({ body: logoutSchema.optional() }),
  logoutController,
)
authRouter.get('/me', authenticate, meController)
authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  changePasswordController,
)