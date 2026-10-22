import { z } from 'zod'

/**
 * Live monitoring request schemas.
 *
 * These operate on attempts that exist right now, so the payloads stay
 * small: an optional exam filter, and a list of admission numbers when
 * resetting for selected candidates rather than a whole class.
 */

export const liveSessionQuerySchema = z.object({
  /** Restrict the list to one examination. */
  examId: z.string().uuid().optional(),
  /** Hard cap on rows; the dashboard only needs a handful. */
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export const idParamSchema = z.object({
  id: z.string().uuid('Must be a valid identifier'),
})

export const forceSubmitSchema = z.object({
  /** Kept for forwards compatibility with a reason field. */
  reason: z.string().trim().max(200).optional(),
})

export const resetAttemptsSchema = z.object({
  /**
   * Admission numbers to reset. Omitted or empty resets every
   * candidate who has attempted the paper.
   */
  studentIds: z.array(z.string().trim().min(1).max(50)).max(500).optional(),
})

export const extendSessionSchema = z.object({
  /** Minutes to add to the live session's remaining time. */
  additionalMinutes: z.coerce.number().int().min(1).max(180),
})

export type LiveSessionQuery = z.infer<typeof liveSessionQuerySchema>
export type ResetAttemptsInput = z.infer<typeof resetAttemptsSchema>
export type ExtendSessionInput = z.infer<typeof extendSessionSchema>
