import { Prisma } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { ApiError } from '../../utils/api-error.js'
import { buildMeta } from '../../utils/pagination.js'
import { AUDIT_ACTIONS, recordAudit } from '../../services/audit.service.js'
import { buildQuestionListArgs } from './questions.schema.js'
import type { BulkQuestionRowInput, BulkQuestionImportInput, CreateQuestionInput, QuestionListQuery, UpdateQuestionInput } from './questions.schema.js'
import type { PaginationMeta } from '../../utils/http-response.js'

/**
 * Question bank service.
 *
 * Answer-key handling is the security-critical part of this module (§32):
 *
 * - `correctAnswer` is accepted on write and returned only on the *staff* routes,
 *   which are behind `questions.read`. It never appears in any student-facing
 *   response — those are built in the exam-session module, which deliberately
 *   selects columns rather than reusing this admin DTO.
 * - Grading always re-reads the stored key from the database. An answer submitted
 *   by a client is never compared against a value the client supplied.
 */

const questionSelect = {
  id: true,
  categoryId: true,
  subjectId: true,
  type: true,
  stem: true,
  explanation: true,
  difficulty: true,
  points: true,
  correctAnswer: true,
  status: true,
  tags: true,
  timesUsed: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  subject: { select: { id: true, name: true } },
  options: {
    select: { id: true, label: true, text: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.QuestionSelect

type QuestionRow = Prisma.QuestionGetPayload<{ select: typeof questionSelect }>

/** Staff-facing DTO. Includes the answer key — only ever used behind questions.read. */
function toDto(row: QuestionRow) {
  return {
    id: row.id,
    type: row.type,
    stem: row.stem,
    explanation: row.explanation,
    difficulty: row.difficulty,
    points: row.points.toString(),
    correctAnswer: row.correctAnswer,
    status: row.status,
    tags: row.tags,
    timesUsed: row.timesUsed,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    subjectId: row.subjectId,
    subjectName: row.subject.name,
    options: row.options.map((option) => ({
      id: option.id,
      label: option.label,
      text: option.text,
      sortOrder: option.sortOrder,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type QuestionDto = ReturnType<typeof toDto>

export async function listQuestions(query: QuestionListQuery): Promise<{
  data: QuestionDto[]
  meta: PaginationMeta
}> {
  const args = buildQuestionListArgs(query)

  const [rows, totalItems] = await Promise.all([
    prisma.question.findMany({
      where: args.where,
      skip: args.skip,
      take: args.take,
      orderBy: args.orderBy,
      select: questionSelect,
    }),
    prisma.question.count({ where: args.where }),
  ])

  return { data: rows.map(toDto), meta: buildMeta(totalItems, args.page, args.limit) }
}

export async function getQuestion(id: string): Promise<QuestionDto> {
  const question = await prisma.question.findUnique({
    where: { id },
    select: { ...questionSelect, deletedAt: true },
  })

  if (!question || question.deletedAt !== null) {
    throw ApiError.notFound('Question not found')
  }

  return toDto(question)
}

/** Confirm the category exists, the subject exists, and the subject is in it. */
async function assertTaxonomy(
  tx: Prisma.TransactionClient,
  categoryId: string,
  subjectId: string,
): Promise<void> {
  const subject = await tx.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, categoryId: true, status: true, category: { select: { deletedAt: true } } },
  })

  if (!subject || subject.category.deletedAt !== null) {
    throw ApiError.validation('Subject does not exist', { subjectId: ['Subject does not exist'] })
  }

  if (subject.categoryId !== categoryId) {
    throw ApiError.validation('Subject does not belong to the selected category', {
      categoryId: ['Category does not match the subject'],
    })
  }

  if (subject.status !== 'ACTIVE') {
    throw ApiError.validation('Subject is not active', { subjectId: ['Subject is not active'] })
  }

  const category = await tx.category.findUnique({
    where: { id: categoryId },
    select: { id: true, deletedAt: true },
  })

  if (!category || category.deletedAt !== null) {
    throw ApiError.notFound('Category not found')
  }
}

export async function createQuestion(
  input: CreateQuestionInput,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<QuestionDto> {
  const question = await prisma.$transaction(async (tx) => {
    await assertTaxonomy(tx, input.categoryId, input.subjectId)

    return tx.question.create({
      data: {
        categoryId: input.categoryId,
        subjectId: input.subjectId,
        createdById: context.actorId,
        type: input.type,
        stem: input.stem,
        explanation: input.explanation || null,
        difficulty: input.difficulty,
        points: new Prisma.Decimal(input.points),
        correctAnswer: input.correctAnswer.toUpperCase(),
        status: input.status,
        tags: input.tags || null,
        ...(input.type === 'MULTIPLE_CHOICE'
          ? {
              options: {
                create: input.options.map((option, index) => ({
                  label: option.label.toUpperCase(),
                  text: option.text,
                  sortOrder: index,
                })),
              },
            }
          : {}),
      },
      select: questionSelect,
    })
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.CREATE_QUESTION,
    entity: 'Question',
    entityId: question.id,
    description: `Created ${question.type} question`,
    metadata: { subjectId: question.subjectId, difficulty: question.difficulty },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(question)
}

export async function updateQuestion(
  id: string,
  input: UpdateQuestionInput,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<QuestionDto> {
  const existing = await prisma.question.findUnique({
    where: { id },
    select: { id: true, type: true, deletedAt: true },
  })

  if (!existing || existing.deletedAt !== null) {
    throw ApiError.notFound('Question not found')
  }

  const question = await prisma.$transaction(async (tx) => {
    const categoryId = input.categoryId
    const subjectId = input.subjectId

    if (categoryId || subjectId) {
      const current = await tx.question.findUnique({
        where: { id },
        select: { categoryId: true, subjectId: true },
      })
      await assertTaxonomy(tx, categoryId ?? current!.categoryId, subjectId ?? current!.subjectId)
    }

    // Options are replaced wholesale when supplied. This runs only for an
    // objective question; a true/false or short-answer question has no options and
    // changing its type is deliberately not supported here.
    if (input.options) {
      if (existing.type !== 'MULTIPLE_CHOICE') {
        throw ApiError.validation('Options can only be set on a multiple-choice question', {
          options: ['This question type has no options'],
        })
      }

      await tx.questionOption.deleteMany({ where: { questionId: id } })
      await tx.questionOption.createMany({
        data: input.options.map((option, index) => ({
          questionId: id,
          label: option.label.toUpperCase(),
          text: option.text,
          sortOrder: index,
        })),
      })

      // Existing answers reference options that no longer exist; drop them so
      // grading cannot score against a deleted option.
      await tx.examAnswer.deleteMany({ where: { questionId: id } })
    }

    if (input.correctAnswer && input.options) {
      const labels = input.options.map((option) => option.label.toUpperCase())
      if (!labels.includes(input.correctAnswer.toUpperCase())) {
        throw ApiError.validation('Correct answer must match one of the option labels', {
          correctAnswer: ['Correct answer must match one of the option labels'],
        })
      }
    }

    return tx.question.update({
      where: { id },
      data: {
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
        ...(input.stem !== undefined ? { stem: input.stem } : {}),
        ...(input.explanation !== undefined ? { explanation: input.explanation || null } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.points !== undefined ? { points: new Prisma.Decimal(input.points) } : {}),
        ...(input.correctAnswer !== undefined
          ? { correctAnswer: input.correctAnswer.toUpperCase() }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.tags !== undefined ? { tags: input.tags || null } : {}),
      },
      select: questionSelect,
    })
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.UPDATE_QUESTION,
    entity: 'Question',
    entityId: id,
    // Field names only: the payload could contain the answer key.
    metadata: { fields: Object.keys(input) },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(question)
}

/**
 * Soft-delete a question.
 *
 * Existing sessions and results keep their own copy of the graded outcome, so a
 * historical paper is unaffected by removing a question from the bank.
 */
export async function deleteQuestion(
  id: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.question.findUnique({
    where: { id },
    select: { id: true, stem: true, deletedAt: true },
  })

  if (!existing || existing.deletedAt !== null) {
    throw ApiError.notFound('Question not found')
  }

  await prisma.question.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'INACTIVE' },
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.DELETE_QUESTION,
    entity: 'Question',
    entityId: id,
    description: 'Deleted question',
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return { id, deleted: true }
}

/**
 * Pool sizes per subject, for the exam builder.
 *
 * Returned as counts only — never question bodies — so an administrator can size
 * an exam without the response carrying the answer key (§32, §43).
 */
export async function questionPoolSizes(): Promise<
  Array<{ subjectId: string; subjectName: string; categoryId: string; categoryName: string; poolSize: number }>
> {
  const subjects = await prisma.subject.findMany({
    where: { status: 'ACTIVE', category: { deletedAt: null } },
    select: {
      id: true,
      name: true,
      category: { select: { id: true, name: true } },
      _count: { select: { questions: { where: { status: 'ACTIVE', deletedAt: null } } } },
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    take: 500,
  })

  return subjects.map((subject) => ({
    subjectId: subject.id,
    subjectName: subject.name,
    categoryId: subject.category.id,
    categoryName: subject.category.name,
    poolSize: subject._count.questions,
  }))
}

/** Parse CSV options string like "A: Option A|B: Option B" into array. */
function parseOptions(csv: string): Array<{ label: string; text: string }> {
  return csv
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colonIndex = part.indexOf(':')
      if (colonIndex === -1) {
        throw new Error(`Invalid option format: "${part}". Use "A: Option text|B: Option text"`)
      }
      const label = part.slice(0, colonIndex).trim().toUpperCase()
      const text = part.slice(colonIndex + 1).trim()
      if (!label || !text) {
        throw new Error(`Invalid option format: "${part}". Label and text are required`)
      }
      return { label, text }
    })
}

/**
 * Resolve a row's category.
 *
 * An id is authoritative when present. Otherwise the name is matched
 * against the bank; a name that matches nothing is created when
 * `autoCreateTaxonomy` is set, so a CSV from a new course imports
 * without manual taxonomy setup first.
 */
async function resolveCategory(
  tx: Prisma.TransactionClient,
  row: BulkQuestionRowInput,
  autoCreateTaxonomy: boolean,
): Promise<string> {
  if (row.categoryId) {
    const category = await tx.category.findUnique({
      where: { id: row.categoryId },
      select: { id: true, deletedAt: true },
    })
    if (!category || category.deletedAt !== null) {
      throw new Error('Category not found')
    }
    return category.id
  }

  const name = row.categoryName!.trim()
  // `name` is unique and the column collation (utf8mb4_unicode_ci)
  // compares case-insensitively, so a plain equality matches any
  // capitalisation of a known category.
  const existing = await tx.category.findFirst({
    where: { name },
    select: { id: true, deletedAt: true },
  })
  if (existing) {
    if (existing.deletedAt !== null) {
      throw new Error(`Category "${name}" exists but is deleted`)
    }
    return existing.id
  }

  if (!autoCreateTaxonomy) {
    throw new Error(`Category not found: "${name}". Create it first or enable auto-create.`)
  }

  const created = await tx.category.create({
    data: { name, description: `Created automatically during bulk question import.` },
    select: { id: true },
  })
  return created.id
}

/** Resolve a row's subject inside a resolved category. */
async function resolveSubject(
  tx: Prisma.TransactionClient,
  row: BulkQuestionRowInput,
  categoryId: string,
  autoCreateTaxonomy: boolean,
): Promise<string> {
  if (row.subjectId) {
    const subject = await tx.subject.findUnique({
      where: { id: row.subjectId },
      select: { id: true, categoryId: true, status: true },
    })
    if (!subject) {
      throw new Error('Subject not found')
    }
    if (subject.categoryId !== categoryId) {
      throw new Error('Subject does not belong to the selected category')
    }
    if (subject.status !== 'ACTIVE') {
      throw new Error('Subject is not active')
    }
    return subject.id
  }

  const name = row.subjectName!.trim()
  // Same case-insensitive equality as the category lookup; the
  // categoryId scope keeps the match inside the resolved course.
  const existing = await tx.subject.findFirst({
    where: { categoryId, name },
    select: { id: true, status: true },
  })
  if (existing) {
    if (existing.status !== 'ACTIVE') {
      throw new Error('Subject is not active')
    }
    return existing.id
  }

  if (!autoCreateTaxonomy) {
    throw new Error(`Subject not found: "${name}". Create it first or enable auto-create.`)
  }

  const created = await tx.subject.create({
    data: { name, categoryId, status: 'ACTIVE' },
    select: { id: true },
  })
  return created.id
}

/** Normalise the options field, which may arrive as a CSV string or an array. */
function normaliseOptions(
  options: string | Array<{ label: string; text: string }> | undefined,
): Array<{ label: string; text: string }> {
  if (!options) return []
  if (typeof options === 'string') return parseOptions(options)
  return options.map((option) => ({
    label: option.label.trim().toUpperCase(),
    text: option.text,
  }))
}

/** Bulk import questions from CSV/JSON. */
export async function bulkImportQuestions(
  input: BulkQuestionImportInput,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<{ created: number; failed: Array<{ index: number; error: string }> }> {
  const results = { created: 0, failed: [] as Array<{ index: number; error: string }> }
  const autoCreateTaxonomy = input.autoCreateTaxonomy !== false

  for (let i = 0; i < input.questions.length; i++) {
    const row = input.questions[i]!
    try {
      await prisma.$transaction(async (tx) => {
        // Validate taxonomy, creating the category/subject when the row
        // names one the bank has never seen and auto-create is on.
        const categoryId = await resolveCategory(tx, row, autoCreateTaxonomy)
        const subjectId = await resolveSubject(tx, row, categoryId, autoCreateTaxonomy)

        // Build question data
        const questionData: Prisma.QuestionCreateInput = {
          category: { connect: { id: categoryId } },
          subject: { connect: { id: subjectId } },
          createdBy: { connect: { id: context.actorId } },
          type: row.type,
          stem: row.stem,
          explanation: row.explanation || null,
          difficulty: row.difficulty,
          points: new Prisma.Decimal(row.points),
          correctAnswer: row.correctAnswer.toUpperCase(),
          status: row.status,
          tags: row.tags || null,
        }

        // Add options for multiple choice
        if (row.type === 'MULTIPLE_CHOICE') {
          const options = normaliseOptions(row.options)
          if (options.length === 0) {
            throw new Error('Multiple choice questions require options')
          }
          const labels = options.map((option) => option.label)
          if (!labels.includes(row.correctAnswer.toUpperCase())) {
            throw new Error('Correct answer must match one of the option labels')
          }
          const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index)
          if (duplicates.length > 0) {
            throw new Error(`Duplicate option label(s): ${[...new Set(duplicates)].join(', ')}`)
          }
          questionData.options = {
            create: options.map((option, index) => ({
              label: option.label,
              text: option.text,
              sortOrder: index,
            })),
          }
        }

        await tx.question.create({
          data: questionData,
        })
      })

      results.created++
    } catch (error) {
      results.failed.push({
        index: i + 1,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.CREATE_QUESTION,
    entity: 'Question',
    entityId: 'bulk',
    description: `Bulk imported ${results.created} question(s), ${results.failed.length} failed`,
    metadata: { created: results.created, failed: results.failed.length },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return results
}