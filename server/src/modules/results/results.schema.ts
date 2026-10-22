import { z } from 'zod'

/**
 * Results request schemas (§48).
 *
 * Listing supports pagination, search, exam filter, pass/fail filter and
 * grade filter. Export is a parameter-free stream of every row.
 */

export const resultsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(120).optional(),
  examId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  passed: z.enum(['all', 'true', 'false']).default('all'),
  grade: z.enum(['all', 'A', 'B', 'C', 'D', 'E', 'F']).default('all'),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

export type ResultsListQuery = z.infer<typeof resultsListQuerySchema>
