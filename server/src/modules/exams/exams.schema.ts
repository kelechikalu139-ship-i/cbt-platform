import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import {
  escapeSearchTerm,
  normaliseSearch,
  resolvePagination,
  resolveSortField,
  resolveSortOrder,
} from '../../utils/pagination.js'

/** Exam request schemas (§17). */

export const idParamSchema = z.object({
  id: z.string().uuid('Must be a valid identifier'),
})

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

const questionFilterSchema = z
  .object({
    /** Attach every active question in these categories. */
    categoryIds: z.array(z.string().uuid()).max(50).optional(),
    /** Attach every active question in these subjects. */
    subjectIds: z.array(z.string().uuid()).max(50).optional(),
    types: z
      .array(z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']))
      .max(3)
      .optional(),
    difficulties: z.array(z.enum(['EASY', 'MEDIUM', 'HARD'])).max(3).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.categoryIds?.length ||
          value.subjectIds?.length ||
          value.types?.length ||
          value.difficulties?.length,
      ),
    {
      message: 'Provide at least one question filter criterion',
    },
  )

const baseExamFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(5000).optional().or(z.literal('')),
  instructions: z.string().trim().max(5000).optional().or(z.literal('')),
  program: z.string().trim().max(120).optional().or(z.literal('')),
  department: z.string().trim().max(120).optional().or(z.literal('')),
  level: z.coerce.number().int().min(1).max(1000).optional().or(z.literal('')),
  semester: z.coerce.number().int().min(1).max(24).optional().or(z.literal('')),
  /** Academic session, e.g. "2026/2027". Restricts delivery to that cohort. */
  session: z
    .string()
    .trim()
    .max(20, 'Session is too long')
    .regex(/^[\w\-/ ]+$/, 'Session may contain letters, numbers, spaces, - / and _')
    .optional()
    .or(z.literal('')),
  /** Class names this paper is set for, e.g. ["CSC 100 - A"]. */
  classes: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(1, 'Duration must be at least 1 minute')
    .max(600, 'Duration cannot exceed 10 hours'),
  passPercentage: z.coerce.number().min(0).max(100),
  maxAttempts: z.coerce.number().int().min(1).max(10),
  shuffleQuestions: z.coerce.boolean(),
  shuffleOptions: z.coerce.boolean(),
  showResultImmediately: z.coerce.boolean(),
  /** Questions attached to this exam, with an explicit paper order. */
  questionIds: z.array(z.string().uuid()).max(500),
  /**
   * Alternative to `questionIds`: attach every eligible question matching
   * the filter. Used when a paper is built from a course pool rather than
   * hand-picked items.
   */
  questionFilter: questionFilterSchema.optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
}

/**
 * Defaults for a new paper. The update schema leaves these
 * fields without defaults on purpose: a partial update changes
 * only the fields the request actually sends, so an omitted
 * field keeps its stored value instead of resetting to the
 * default. In particular, an update that does not mention
 * `questionIds` must never rewrite the question set.
 */
const createExamDefaults = {
  passPercentage: baseExamFields.passPercentage.default(50),
  maxAttempts: baseExamFields.maxAttempts.default(1),
  shuffleQuestions: baseExamFields.shuffleQuestions.default(true),
  shuffleOptions: baseExamFields.shuffleOptions.default(false),
  showResultImmediately: baseExamFields.showResultImmediately.default(false),
  questionIds: baseExamFields.questionIds.default([]),
}

export const createExamSchema = z
  .object({ ...baseExamFields, ...createExamDefaults })
  .refine((value) => !value.startAt || !value.endAt || value.endAt > value.startAt, {
    message: 'End time must be after the start time',
    path: ['endAt'],
  })

export const updateExamSchema = z
  .object({ ...baseExamFields, title: baseExamFields.title.optional() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine((value) => !value.startAt || !value.endAt || value.endAt > value.startAt, {
    message: 'End time must be after the start time',
    path: ['endAt'],
  })

export const examListQuerySchema = listQuerySchema.extend({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ONGOING', 'COMPLETED', 'ARCHIVED']).optional(),
  program: z.string().trim().max(120).optional(),
  level: z.coerce.number().int().min(1).max(1000).optional(),
  semester: z.coerce.number().int().min(1).max(24).optional(),
})

export type CreateExamInput = z.infer<typeof createExamSchema>
export type UpdateExamInput = z.infer<typeof updateExamSchema>
export type ExamListQuery = z.infer<typeof examListQuerySchema>

export const EXAM_SORT_FIELDS = ['title', 'createdAt', 'durationMinutes', 'status'] as const

export interface ExamListArgs {
  where: Prisma.ExamWhereInput
  skip: number
  take: number
  orderBy: Prisma.ExamOrderByWithRelationInput
  page: number
  limit: number
}

export function buildExamListArgs(query: ExamListQuery): ExamListArgs {
  const { page, limit, skip, take } = resolvePagination(query.page, query.limit)
  const search = normaliseSearch(query.search)

  const where: Prisma.ExamWhereInput = { deletedAt: null }

  if (search) {
    const term = escapeSearchTerm(search)
    where.OR = [{ title: { contains: term } }, { description: { contains: term } }]
  }

  if (query.status) where.status = query.status
  if (query.program) where.program = query.program
  if (query.level !== undefined) where.level = query.level
  if (query.semester !== undefined) where.semester = query.semester

  return {
    where,
    skip,
    take,
    orderBy: {
      [resolveSortField(query.sort, EXAM_SORT_FIELDS, 'createdAt')]: resolveSortOrder(query.order),
    },
    page,
    limit,
  }
}