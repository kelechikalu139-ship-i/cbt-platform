import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import {
  escapeSearchTerm,
  normaliseSearch,
  resolvePagination,
  resolveSortField,
  resolveSortOrder,
} from '../../utils/pagination.js'

/** Category and subject request schemas (§17). */

export const idParamSchema = z.object({
  id: z.string().uuid('Must be a valid identifier'),
})

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.coerce.boolean().default(true),
})

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

export const createSubjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  categoryId: z.string().uuid('A valid category is required'),
  code: z.string().trim().max(40).optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
})

export const updateSubjectSchema = createSubjectSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

export const categoryListQuerySchema = listQuerySchema.extend({
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
})

export const CATEGORY_SORT_FIELDS = ['name', 'sortOrder', 'createdAt'] as const

export interface CategoryListArgs {
  where: Prisma.CategoryWhereInput
  skip: number
  take: number
  orderBy: Prisma.CategoryOrderByWithRelationInput
  page: number
  limit: number
}

export function buildCategoryListArgs(query: z.infer<typeof categoryListQuerySchema>): CategoryListArgs {
  const { page, limit, skip, take } = resolvePagination(query.page, query.limit)
  const search = normaliseSearch(query.search)

  const where: Prisma.CategoryWhereInput = { deletedAt: null }

  if (search) {
    const term = escapeSearchTerm(search)
    where.OR = [{ name: { contains: term } }, { description: { contains: term } }]
  }

  if (query.isActive !== undefined) where.isActive = query.isActive

  return {
    where,
    skip,
    take,
    orderBy: {
      [resolveSortField(query.sort, CATEGORY_SORT_FIELDS, 'sortOrder')]: resolveSortOrder(query.order),
    },
    page,
    limit,
  }
}