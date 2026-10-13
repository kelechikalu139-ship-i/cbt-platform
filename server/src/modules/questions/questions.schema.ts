import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import {
  escapeSearchTerm,
  normaliseSearch,
  resolvePagination,
  resolveSortField,
  resolveSortOrder,
} from '../../utils/pagination.js'

/**
 * Question request schemas (§17).
 *
 * Options are validated together with the answer key so an objective question can
 * never be stored without at least two options and a key that points at one of
 * them. That cross-field rule is enforced by `superRefine` here rather than in the
 * service, so it rejects before any database work begins.
 */

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

export const optionSchema = z.object({
  /** Single character position key, e.g. "A". Stable so shuffling is safe. */
  label: z.string().trim().min(1).max(4),
  text: z.string().trim().min(1, 'Option text is required').max(2000),
})

const baseQuestionFields = {
  categoryId: z.string().uuid('A valid category is required'),
  subjectId: z.string().uuid('A valid subject is required'),
  stem: z.string().trim().min(1, 'Question text is required').max(10_000),
  explanation: z.string().trim().max(10_000).optional().or(z.literal('')),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  points: z.coerce.number().positive('Points must be greater than zero').max(1000).default(1),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).default('ACTIVE'),
  tags: z.string().trim().max(255).optional().or(z.literal('')),
}

export const createQuestionSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('MULTIPLE_CHOICE'),
      ...baseQuestionFields,
      options: z.array(optionSchema).min(2, 'At least two options are required').max(8),
      correctAnswer: z.string().trim().min(1).max(4),
    }),
    z.object({
      type: z.literal('TRUE_FALSE'),
      ...baseQuestionFields,
      // No options: true/false is self-describing and options would only create
      // room for a mismatch between the type and the key.
      correctAnswer: z.enum(['TRUE', 'FALSE']),
    }),
    z.object({
      type: z.literal('SHORT_ANSWER'),
      ...baseQuestionFields,
      correctAnswer: z.string().trim().min(1).max(255),
    }),
  ])
  .superRefine((value, ctx) => {
    // The answer key must point at an option that actually exists, otherwise the
    // question is permanently unanswerable.
    if (value.type === 'MULTIPLE_CHOICE') {
      const labels = value.options.map((option) => option.label.toUpperCase())
      if (!labels.includes(value.correctAnswer.toUpperCase())) {
        ctx.addIssue({
          code: 'custom',
          path: ['correctAnswer'],
          message: 'Correct answer must match one of the option labels',
        })
      }

      const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index)
      if (duplicates.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: `Duplicate option label(s): ${[...new Set(duplicates)].join(', ')}`,
        })
      }
    }
  })

export const updateQuestionSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    subjectId: z.string().uuid().optional(),
    stem: z.string().trim().min(1).max(10_000).optional(),
    explanation: z.string().trim().max(10_000).optional().or(z.literal('')),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
    points: z.coerce.number().positive().max(1000).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).optional(),
    tags: z.string().trim().max(255).optional().or(z.literal('')),
    options: z.array(optionSchema).min(2).max(8).optional(),
    correctAnswer: z.string().trim().min(1).max(255).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

export const questionListQuerySchema = listQuerySchema.extend({
  categoryId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']).optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).optional(),
})

/** CSV row for bulk question import. */
export const bulkQuestionRowSchema = z
  .object({
    /** Either the id of an existing category, or a name when the row
     *  should be matched (or created) by name. */
    categoryId: z.string().uuid('A valid category is required').optional(),
    categoryName: z.string().trim().min(1).max(120).optional(),
    subjectId: z.string().uuid('A valid subject is required').optional(),
    subjectName: z.string().trim().min(1).max(120).optional(),
    type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']),
    stem: z.string().trim().min(1, 'Question text is required').max(10_000),
    explanation: z.string().trim().max(10_000).optional().or(z.literal('')),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
    points: z.coerce.number().positive('Points must be greater than zero').max(1000).default(1),
    correctAnswer: z.string().trim().min(1).max(255),
    /** CSV string "A: Option A|B: Option B" or a parsed array. */
    options: z.union([z.string(), z.array(optionSchema)]).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).default('ACTIVE'),
    tags: z.string().trim().max(255).optional().or(z.literal('')),
  })
  .superRefine((value, ctx) => {
    if (!value.categoryId && !value.categoryName) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryId'],
        message: 'A category id or category name is required',
      })
    }
    if (!value.subjectId && !value.subjectName) {
      ctx.addIssue({
        code: 'custom',
        path: ['subjectId'],
        message: 'A subject id or subject name is required',
      })
    }
  })

export const bulkQuestionImportSchema = z.object({
  questions: z.array(bulkQuestionRowSchema).min(1, 'At least one question is required').max(500),
  /**
   * Create categories and subjects that do not exist yet, so a CSV
   * from a new course imports without manual taxonomy setup first.
   */
  autoCreateTaxonomy: z.coerce.boolean().default(true),
})

export type BulkQuestionRowInput = z.infer<typeof bulkQuestionRowSchema>
export type BulkQuestionImportInput = z.infer<typeof bulkQuestionImportSchema>

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>

export const QUESTION_SORT_FIELDS = ['createdAt', 'difficulty', 'type', 'points'] as const

export interface QuestionListArgs {
  where: Prisma.QuestionWhereInput
  skip: number
  take: number
  orderBy: Prisma.QuestionOrderByWithRelationInput
  page: number
  limit: number
}

export function buildQuestionListArgs(query: z.infer<typeof questionListQuerySchema>): QuestionListArgs {
  const { page, limit, skip, take } = resolvePagination(query.page, query.limit)
  const search = normaliseSearch(query.search)

  const where: Prisma.QuestionWhereInput = { deletedAt: null }

  if (search) {
    const term = escapeSearchTerm(search)
    where.OR = [{ stem: { contains: term } }, { tags: { contains: term } }]
  }

  if (query.categoryId) where.categoryId = query.categoryId
  if (query.subjectId) where.subjectId = query.subjectId
  if (query.type) where.type = query.type
  if (query.difficulty) where.difficulty = query.difficulty
  if (query.status) where.status = query.status

  return {
    where,
    skip,
    take,
    orderBy: {
      [resolveSortField(query.sort, QUESTION_SORT_FIELDS, 'createdAt')]: resolveSortOrder(query.order),
    },
    page,
    limit,
  }
}