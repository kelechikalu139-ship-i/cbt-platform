import type { Request, Response } from 'express'
import { currentUser } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData } from '../../utils/http-response.js'
import { clientIp, userAgentOf } from '../../services/audit.service.js'
import {
  changePassword,
  currentUserProfile,
  login,
  logout,
  register,
  refresh,
  studentLogin,
  type RequestContext,
} from './auth.service.js'
import type { ChangePasswordInput, LoginInput, RefreshInput, RegisterInput, StudentLoginInput } from './auth.schema.js'

/**
 * Authentication controller (§25).
 *
 * Thin by design: extract the request, call the service, shape the response. No
 * business rules and no database access belong in this file.
 */

/** Collect the auditing context from the live request. */
function contextOf(req: Request): RequestContext {
  return {
    ipAddress: clientIp(req.ip),
    userAgent: userAgentOf(req.headers['user-agent']),
  }
}

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const result = await login(req.body as LoginInput, contextOf(req))
  sendData(res, result, 200, 'Signed in successfully')
})

export const studentLoginController = asyncHandler(async (req: Request, res: Response) => {
  const result = await studentLogin(req.body as StudentLoginInput, contextOf(req))
  sendData(res, result, 200, 'Signed in successfully')
})

export const registerController = asyncHandler(async (req: Request, res: Response) => {
  const result = await register(req.body as RegisterInput, contextOf(req))
  sendData(res, result, 201, 'Super administrator registered')
})

export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as RefreshInput
  const result = await refresh(refreshToken, contextOf(req))
  sendData(res, result, 200, 'Session refreshed')
})

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req)
  // A bare POST arrives with `req.body` undefined under Express 5, so the refresh
  // token is genuinely optional here — logging out without one still revokes the
  // stored session server-side.
  const { refreshToken } = (req.body ?? {}) as { refreshToken?: string }

  await logout(user.id, refreshToken, contextOf(req))
  sendData(res, { success: true }, 200, 'Signed out')
})

export const meController = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req)
  const profile = await currentUserProfile(user.id)
  sendData(res, profile)
})

export const changePasswordController = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req)
  await changePassword(user.id, req.body as ChangePasswordInput, contextOf(req))
  // The response deliberately carries no token: changing a password revokes every
  // existing session, so the client must sign in again.
  sendData(res, { changed: true }, 200, 'Password changed. Please sign in again.')
})