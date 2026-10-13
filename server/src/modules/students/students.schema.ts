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
 * Student request schemas (§17).
 *
 * `studentId` is the school's admission number. It is unique, human-typed on
 * forms, and therefore validated as a short token rather than a number — schools
 * commonly use slashes, hyphens or letters in these.
 */

export const studentIdField = z
  .string()
  .trim()
  .min(2, 'Student ID must be at least 2 characters')
  .max(50, 'Student ID is too long')
  .regex(/^[\w\-/]+$/, 'Student ID may contain letters, numbers, - / and _')

const nameField = z.string().trim().min(1, 'Required').max(80)
const optionalShort = z.string().trim().max(120).optional().or(z.literal(''))
/** Academic session, e.g. "2026/2027". */
const sessionField = z
  .string()
  .trim()
  .max(20, 'Session is too long')
  .regex(/^[\w\-/ ]+$/, 'Session may contain letters, numbers, spaces, - / and _')
  .optional()
  .or(z.literal(''))

/** Reusable list query schema for paginated collections (§49, §50). */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

export const idParamSchema = z.object({
  id: z.string().uuid('Must be a valid identifier'),
})

export const createStudentSchema = z.object({
  studentId: studentIdField,
  firstName: nameField,
  lastName: nameField,
  email: z.string().trim().email('Enter a valid email address').max(190).optional().or(z.literal('')),
  program: z.string().trim().min(1, 'Program is required').max(120),
  department: optionalShort,
  level: z.coerce.number().int().min(1).max(1000).default(100),
  semester: z.coerce.number().int().min(1).max(24).default(1),
  className: z.string().trim().max(80).optional().or(z.literal('')),
  session: sessionField,
  gender: z.string().trim().max(20).optional().or(z.literal('')),
  /** Optional portal login for the student. Omitted means portal access is off. */
  userEmail: z.string().trim().email('Enter a valid email address').max(190).optional().or(z.literal('')),
  userPassword: z.string().min(8).max(200).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).default('ACTIVE'),
})

export const updateStudentSchema = createStudentSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

/** Admin list filters. */
export const studentListQuerySchema = listQuerySchema.extend({
  program: z.string().trim().max(120).optional(),
  level: z.coerce.number().int().min(1).max(1000).optional(),
  semester: z.coerce.number().int().min(1).max(24).optional(),
  className: z.string().trim().max(80).optional(),
  session: sessionField,
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
})

export type CreateStudentInput = z.infer<typeof createStudentSchema>
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>
export type StudentListQuery = z.infer<typeof studentListQuerySchema>

/** Sortable student columns, restricted to what the UI offers. */
export const STUDENT_SORT_FIELDS = [
  'studentId',
  'firstName',
  'lastName',
  'program',
  'level',
  'createdAt',
] as const

export interface StudentListArgs {
  where: Prisma.StudentWhereInput
  skip: number
  take: number
  orderBy: Prisma.StudentOrderByWithRelationInput
  page: number
  limit: number
}

/**
 * Translate a validated list query into Prisma arguments.
 *
 * Returns only real Prisma arguments plus the resolved page window, so the result
 * can be spread into a query without dragging helper fields along with it.
 */
export function buildStudentListArgs(query: StudentListQuery): StudentListArgs {
  const { page, limit, skip, take } = resolvePagination(query.page, query.limit)
  const search = normaliseSearch(query.search)

  // Soft-deleted students must never appear in a list. Every other module seeds
  // its where clause this way; omitting it here meant deleted rows were listed but
  // then 404 on their own detail endpoint, so the admin table offered rows that
  // could not be opened.
  const where: Prisma.StudentWhereInput = { deletedAt: null }

  if (search) {
    // Parameterised by Prisma; the escape only stops `%` and `_` acting as
    // wildcards inside a user's own search term.
    const term = escapeSearchTerm(search)
    where.OR = [
      { studentId: { contains: term } },
      { firstName: { contains: term } },
      { lastName: { contains: term } },
      { program: { contains: term } },
      { className: { contains: term } },
      { session: { contains: term } },
    ]
  }

  if (query.program) where.program = query.program
  if (query.level !== undefined) where.level = query.level
  if (query.semester !== undefined) where.semester = query.semester
  if (query.className) where.className = query.className
  if (query.session) where.session = query.session
  if (query.status) where.status = query.status

  return {
    where,
    skip,
    take,
    orderBy: {
      [resolveSortField(query.sort, STUDENT_SORT_FIELDS, 'lastName')]: resolveSortOrder(query.order),
    },
    page,
    limit,
  }
}