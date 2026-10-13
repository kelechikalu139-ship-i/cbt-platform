import { z } from 'zod'
import { MIN_PASSWORD_LENGTH } from '../../utils/password.js'

/**
 * Request schemas for authentication (§17).
 *
 * Staff sign in with the email address that identifies their `users`
 * row. Students sign in with their school-issued admission number,
 * which identifies the same row through the linked `students` record.
 * Both are short tokens (admission numbers commonly contain `/`, `-`
 * and letters), so the field is validated as a token rather than as
 * an email address; the lookup itself is the authority.
 */

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email or admission number is required')
    .max(190, 'Identifier is too long'),
  password: z.string().min(1, 'Password is required').max(200, 'Password is too long'),
})

/**
 * Passwordless student sign-in.
 *
 * The admission number (studentId) is the only credential required.
 * The server enforces single-session semantics: a candidate may hold
 * at most one live session.
 */
export const studentLoginSchema = z.object({
  studentId: z
    .string()
    .trim()
    .min(2, 'Admission number is required')
    .max(50, 'Admission number is too long')
    .regex(/^[\w\-/]+$/, 'Admission number may contain letters, numbers, - / and _'),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token is required'),
})

/**
 * Logout accepts no body at all.
 *
 * A client that just wants to end the session sends a bare POST, and Express 5
 * leaves `req.body` as `undefined` in that case. The route wraps this schema in
 * `.optional()` so an absent body is valid rather than a validation failure.
 */
export const logoutSchema = z.object({
  refreshToken: z.string().min(10).optional(),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(200),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  })

export type LoginInput = z.infer<typeof loginSchema>
export type StudentLoginInput = z.infer<typeof studentLoginSchema>
export type RefreshInput = z.infer<typeof refreshSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>