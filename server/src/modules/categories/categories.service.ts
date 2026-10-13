import { Prisma } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { ApiError } from '../../utils/api-error.js'
import { buildMeta, escapeSearchTerm, normaliseSearch } from '../../utils/pagination.js'
import { AUDIT_ACTIONS, recordAudit } from '../../services/audit.service.js'
import { buildCategoryListArgs } from './categories.schema.js'
import type { PaginationMeta } from '../../utils/http-response.js'

/**
 * Category and subject service.
 *
 * Categories form the top of the taxonomy (`Category → Subject → Question`), so
 * deletion is blocked while dependent records exist rather than cascading: losing
 * a question bank to a mis-click is unacceptable (§26, §51).
 */

const categorySelect = {
  id: true,
  name: true,
  description: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { subjects: true, questions: true } },
} satisfies Prisma.CategorySelect

export type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>

function toDto(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    subjectCount: row._count.subjects,
    questionCount: row._count.questions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listCategories(query: Parameters<typeof buildCategoryListArgs>[0]): Promise<{
  data: ReturnType<typeof toDto>[]
  meta: PaginationMeta
}> {
  const args = buildCategoryListArgs(query)

  const [rows, totalItems] = await Promise.all([
    prisma.category.findMany({
      where: args.where,
      skip: args.skip,
      take: args.take,
      orderBy: args.orderBy,
      select: categorySelect,
    }),
    prisma.category.count({ where: args.where }),
  ])

  return { data: rows.map(toDto), meta: buildMeta(totalItems, args.page, args.limit) }
}

export async function getCategory(id: string) {
  const category = await prisma.category.findUnique({
    where: { id },
    select: {
      ...categorySelect,
      deletedAt: true,
      subjects: {
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, code: true, status: true },
        orderBy: { name: 'asc' },
      },
    },
  })

  if (!category || category.deletedAt !== null) {
    throw ApiError.notFound('Category not found')
  }

  return { ...toDto(category as CategoryRow), subjects: category.subjects }
}

export async function createCategory(
  input: { name: string; description?: string; sortOrder: number; isActive: boolean },
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.category.findUnique({
    where: { name: input.name },
    select: { id: true },
  })

  if (existing) {
    throw ApiError.conflict('A category with this name already exists', {
      name: ['This name is already in use'],
    })
  }

  const category = await prisma.category.create({
    data: {
      name: input.name,
      description: input.description || null,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    },
    select: categorySelect,
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.CREATE_CATEGORY,
    entity: 'Category',
    entityId: category.id,
    description: `Created category ${category.name}`,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(category)
}

export async function updateCategory(
  id: string,
  input: { name?: string; description?: string; sortOrder?: number; isActive?: boolean },
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.category.findUnique({
    where: { id },
    select: { id: true, deletedAt: true },
  })

  if (!existing || existing.deletedAt !== null) {
    throw ApiError.notFound('Category not found')
  }

  if (input.name) {
    const clash = await prisma.category.findUnique({
      where: { name: input.name },
      select: { id: true },
    })
    if (clash && clash.id !== id) {
      throw ApiError.conflict('A category with this name already exists', {
        name: ['This name is already in use'],
      })
    }
  }

  const category = await prisma.category.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: categorySelect,
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.UPDATE_CATEGORY,
    entity: 'Category',
    entityId: id,
    description: `Updated category ${category.name}`,
    metadata: { fields: Object.keys(input) },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(category)
}

/**
 * Delete a category only when nothing references it.
 *
 * The check and the delete run in one transaction so a concurrent question
 * insert cannot slip a reference in between the check and the delete.
 */
export async function deleteCategory(
  id: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id },
      select: { id: true, name: true, deletedAt: true },
    })

    if (!category || category.deletedAt !== null) {
      throw ApiError.notFound('Category not found')
    }

    const [questionCount, subjectCount] = await Promise.all([
      tx.question.count({ where: { categoryId: id } }),
      tx.subject.count({ where: { categoryId: id } }),
    ])

    if (questionCount > 0 || subjectCount > 0) {
      throw ApiError.conflict(
        `Cannot delete "${category.name}" while it still has ${questionCount} question(s) and ${subjectCount} subject(s). Remove or reassign them first.`,
      )
    }

    await tx.category.delete({ where: { id } })

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTIONS.DELETE_CATEGORY,
      entity: 'Category',
      entityId: id,
      description: `Deleted category ${category.name}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    })

    return { id, deleted: true }
  })
}

// --- Subjects -------------------------------------------------------------

const subjectSelect = {
  id: true,
  categoryId: true,
  name: true,
  code: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  _count: { select: { questions: true } },
} satisfies Prisma.SubjectSelect

type SubjectRow = Prisma.SubjectGetPayload<{ select: typeof subjectSelect }>

function subjectToDto(row: SubjectRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    questionCount: row._count.questions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listSubjects(query: {
  search?: string
  categoryId?: string
  status?: 'ACTIVE' | 'INACTIVE'
}): Promise<ReturnType<typeof subjectToDto>[]> {
  const search = normaliseSearch(query.search)
  const where: Prisma.SubjectWhereInput = {}

  if (query.categoryId) where.categoryId = query.categoryId
  if (query.status) where.status = query.status
  if (search) {
    const term = escapeSearchTerm(search)
    where.OR = [{ name: { contains: term } }, { code: { contains: term } }]
  }

  const rows = await prisma.subject.findMany({
    where,
    select: subjectSelect,
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    take: 500,
  })

  return rows.map(subjectToDto)
}

export async function createSubject(
  input: { name: string; categoryId: string; code?: string; status: 'ACTIVE' | 'INACTIVE' },
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, deletedAt: true },
  })

  if (!category || category.deletedAt !== null) {
    throw ApiError.validation('Category does not exist', {
      categoryId: ['Category does not exist'],
    })
  }

  if (input.code) {
    const clash = await prisma.subject.findUnique({
      where: { code: input.code },
      select: { id: true },
    })
    if (clash) {
      throw ApiError.conflict('A subject with this code already exists', {
        code: ['This code is already in use'],
      })
    }
  }

  const subject = await prisma.subject.create({
    data: {
      name: input.name,
      categoryId: input.categoryId,
      code: input.code || null,
      status: input.status,
    },
    select: subjectSelect,
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.CREATE_CATEGORY,
    entity: 'Subject',
    entityId: subject.id,
    description: `Created subject ${subject.name}`,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return subjectToDto(subject)
}

export async function updateSubject(
  id: string,
  input: { name?: string; categoryId?: string; code?: string; status?: 'ACTIVE' | 'INACTIVE' },
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.subject.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!existing) {
    throw ApiError.notFound('Subject not found')
  }

  if (input.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, deletedAt: true },
    })
    if (!category || category.deletedAt !== null) {
      throw ApiError.validation('Category does not exist', {
        categoryId: ['Category does not exist'],
      })
    }
  }

  if (input.code) {
    const clash = await prisma.subject.findUnique({
      where: { code: input.code },
      select: { id: true },
    })
    if (clash && clash.id !== id) {
      throw ApiError.conflict('A subject with this code already exists', {
        code: ['This code is already in use'],
      })
    }
  }

  const subject = await prisma.subject.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.code !== undefined ? { code: input.code || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    select: subjectSelect,
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.UPDATE_CATEGORY,
    entity: 'Subject',
    entityId: id,
    description: `Updated subject ${subject.name}`,
    metadata: { fields: Object.keys(input) },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return subjectToDto(subject)
}