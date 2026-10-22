import { Prisma } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { runInTransaction } from '../../middleware/error.js'
import { ApiError } from '../../utils/api-error.js'
import { buildMeta } from '../../utils/pagination.js'
import { AUDIT_ACTIONS, recordAudit } from '../../services/audit.service.js'
import { buildExamListArgs } from './exams.schema.js'
import type { CreateExamInput, ExamListQuery, UpdateExamInput } from './exams.schema.js'
import type { PaginationMeta } from '../../utils/http-response.js'

/**
 * Examination service (§26, §56).
 *
 * Creating an exam writes the exam row and every `ExamQuestion` join in a single
 * transaction: a half-built paper with no questions is not a valid state, and a
 * partially attached question set would produce an unpredictable paper.
 *
 * This phase creates and publishes exams. Starting a session, randomisation and
 * grading belong to the exam-engine phase and are deliberately not implemented
 * here (§55).
 */

const examSelect = {
  id: true,
  title: true,
  description: true,
  instructions: true,
  program: true,
  department: true,
  level: true,
  semester: true,
  session: true,
  classes: true,
  durationMinutes: true,
  passPercentage: true,
  maxAttempts: true,
  shuffleQuestions: true,
  shuffleOptions: true,
  showResultImmediately: true,
  questionCount: true,
  startAt: true,
  endAt: true,
  status: true,
  publishedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { questions: true, sessions: true, results: true } },
} satisfies Prisma.ExamSelect

type ExamRow = Prisma.ExamGetPayload<{ select: typeof examSelect }>

function toDto(row: ExamRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    program: row.program,
    department: row.department,
    level: row.level,
    semester: row.semester,
    session: row.session,
    classes: (row.classes as string[] | null) ?? null,
    durationMinutes: row.durationMinutes,
    passPercentage: row.passPercentage.toString(),
    maxAttempts: row.maxAttempts,
    shuffleQuestions: row.shuffleQuestions,
    shuffleOptions: row.shuffleOptions,
    showResultImmediately: row.showResultImmediately,
    questionCount: row.questionCount ?? row._count.questions,
    attachedQuestions: row._count.questions,
    sessionCount: row._count.sessions,
    resultCount: row._count.results,
    startAt: row.startAt?.toISOString() ?? null,
    endAt: row.endAt?.toISOString() ?? null,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type ExamDto = ReturnType<typeof toDto>

export async function listExams(query: ExamListQuery): Promise<{ data: ExamDto[]; meta: PaginationMeta }> {
  const args = buildExamListArgs(query)

  const [rows, totalItems] = await Promise.all([
    prisma.exam.findMany({
      where: args.where,
      skip: args.skip,
      take: args.take,
      orderBy: args.orderBy,
      select: examSelect,
    }),
    prisma.exam.count({ where: args.where }),
  ])

  return { data: rows.map(toDto), meta: buildMeta(totalItems, args.page, args.limit) }
}

export async function getExam(id: string) {
  const exam = await prisma.exam.findUnique({
    where: { id },
    select: {
      ...examSelect,
      deletedAt: true,
      questions: {
        select: {
          position: true,
          points: true,
          question: {
            select: {
              id: true,
              stem: true,
              type: true,
              difficulty: true,
              points: true,
              subject: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { position: 'asc' },
      },
    },
  })

  if (!exam || exam.deletedAt !== null) {
    throw ApiError.notFound('Examination not found')
  }

  return {
    ...toDto(exam as ExamRow),
    questions: exam.questions.map((entry) => ({
      questionId: entry.question.id,
      position: entry.position,
      points: (entry.points ?? entry.question.points).toString(),
      stem: entry.question.stem,
      type: entry.question.type,
      difficulty: entry.question.difficulty,
      subjectId: entry.question.subject.id,
      subjectName: entry.question.subject.name,
    })),
  }
}

/**
 * Validate that every requested question exists and is usable in a paper.
 *
 * Returns the rows so the caller can build join rows without re-querying inside
 * the transaction.
 */
async function validateQuestions(tx: Prisma.TransactionClient, questionIds: string[]) {
  const unique = [...new Set(questionIds)]
  if (unique.length === 0) return []

  const found = await tx.question.findMany({
    where: { id: { in: unique }, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  })

  if (found.length !== unique.length) {
    const missing = unique.filter((id) => !found.some((row) => row.id === id))
    throw ApiError.validation('One or more questions cannot be used in an examination', {
      questionIds: [`Unavailable question id(s): ${missing.slice(0, 5).join(', ')}`],
    })
  }

  return found
}

/**
 * Expand a question filter into the ids of every eligible question.
 *
 * This is how a paper built from a course pool — "everything uploaded
 * under Nursing Informatics" — becomes an ordered set of join rows
 * without hand-picking ids. Order is deterministic (creation time,
 * then id) so the same filter always produces the same paper order.
 */
async function resolveQuestionFilter(
  tx: Prisma.TransactionClient,
  filter: NonNullable<CreateExamInput['questionFilter']>,
): Promise<string[]> {
  const where: Prisma.QuestionWhereInput = {
    deletedAt: null,
    status: 'ACTIVE',
  }

  if (filter.categoryIds?.length) where.categoryId = { in: filter.categoryIds }
  if (filter.subjectIds?.length) where.subjectId = { in: filter.subjectIds }
  if (filter.types?.length) where.type = { in: filter.types }
  if (filter.difficulties?.length) where.difficulty = { in: filter.difficulties }

  const questions = await tx.question.findMany({
    where,
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 500,
  })

  return questions.map((question) => question.id)
}

export async function createExam(
  input: CreateExamInput,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<ExamDto> {
  const questionIds = await runInTransaction(async (tx) => {
    if (input.questionIds.length > 0) return input.questionIds
    if (input.questionFilter) return resolveQuestionFilter(tx, input.questionFilter)
    return []
  })

  const exam = await runInTransaction(async (tx) => {
    await validateQuestions(tx, questionIds)

    return tx.exam.create({
      data: {
        title: input.title,
        description: input.description || null,
        instructions: input.instructions || null,
        program: input.program || null,
        department: input.department || null,
        level: input.level || null,
        semester: input.semester || null,
        session: input.session || null,
        classes: input.classes?.length ? input.classes : Prisma.DbNull,
        durationMinutes: input.durationMinutes,
        passPercentage: new Prisma.Decimal(input.passPercentage),
        maxAttempts: input.maxAttempts,
        shuffleQuestions: input.shuffleQuestions,
        shuffleOptions: input.shuffleOptions,
        showResultImmediately: input.showResultImmediately,
        questionCount: questionIds.length > 0 ? questionIds.length : null,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        createdById: context.actorId,
        // Always DRAFT on creation. Publication is a separate, audited action so
        // an accidental save can never put a live paper in front of students.
        status: 'DRAFT',
        ...(questionIds.length > 0
          ? {
              questions: {
                create: questionIds.map((questionId, index) => ({ questionId, position: index + 1 })),
              },
            }
          : {}),
      },
      select: examSelect,
    })
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.CREATE_EXAM,
    entity: 'Exam',
    entityId: exam.id,
    description: `Created exam "${exam.title}" with ${questionIds.length} question(s)`,
    metadata: { questionCount: questionIds.length, durationMinutes: exam.durationMinutes },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(exam)
}

/** Only these fields are mutable while an exam is still a draft. */
function buildExamUpdateData(input: UpdateExamInput): Prisma.ExamUpdateInput {
  const data: Prisma.ExamUpdateInput = {}

  if (input.title !== undefined) data.title = input.title
  if (input.description !== undefined) data.description = input.description || null
  if (input.instructions !== undefined) data.instructions = input.instructions || null
  if (input.program !== undefined) data.program = input.program || null
  if (input.department !== undefined) data.department = input.department || null
  if (input.level !== undefined) data.level = input.level || null
  if (input.semester !== undefined) data.semester = input.semester || null
  if (input.session !== undefined) data.session = input.session || null
  if (input.classes !== undefined)
    data.classes = input.classes.length > 0 ? input.classes : Prisma.DbNull
  if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes
  if (input.passPercentage !== undefined) {
    data.passPercentage = new Prisma.Decimal(input.passPercentage)
  }
  if (input.maxAttempts !== undefined) data.maxAttempts = input.maxAttempts
  if (input.shuffleQuestions !== undefined) data.shuffleQuestions = input.shuffleQuestions
  if (input.shuffleOptions !== undefined) data.shuffleOptions = input.shuffleOptions
  if (input.showResultImmediately !== undefined) {
    data.showResultImmediately = input.showResultImmediately
  }
  if (input.startAt !== undefined) data.startAt = input.startAt ?? null
  if (input.endAt !== undefined) data.endAt = input.endAt ?? null

  return data
}

export async function updateExam(
  id: string,
  input: UpdateExamInput,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<ExamDto> {
  const existing = await prisma.exam.findUnique({
    where: { id },
    select: { id: true, status: true, deletedAt: true },
  })

  if (!existing || existing.deletedAt !== null) {
    throw ApiError.notFound('Examination not found')
  }

  // A published paper is immutable for configuration that affects what a student
  // sees. Withdrawing it first is the explicit, audited path back to editing.
  if (existing.status !== 'DRAFT' && hasStructuralChange(input)) {
    throw ApiError.conflict(
      'A published examination cannot be edited. Unpublish it first, make changes, then publish again.',
    )
  }

  const exam = await runInTransaction(async (tx) => {
    // Replacing the question set is a full rewrite of the join table, done in the
    // same transaction as the exam update so the paper is never half-attached.
    if (input.questionIds || input.questionFilter) {
      const questionIds =
        input.questionIds && input.questionIds.length > 0
          ? [...new Set(input.questionIds)]
          : input.questionFilter
            ? await resolveQuestionFilter(tx, input.questionFilter)
            : []

      await validateQuestions(tx, questionIds)

      await tx.examQuestion.deleteMany({ where: { examId: id } })
      if (questionIds.length > 0) {
        await tx.examQuestion.createMany({
          data: questionIds.map((questionId, index) => ({ examId: id, questionId, position: index + 1 })),
        })
      }
      await tx.exam.update({ where: { id }, data: { questionCount: questionIds.length } })
    }

    return tx.exam.update({
      where: { id },
      data: buildExamUpdateData(input),
      select: examSelect,
    })
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.UPDATE_EXAM,
    entity: 'Exam',
    entityId: id,
    description: `Updated exam "${exam.title}"`,
    metadata: { fields: Object.keys(input) },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(exam)
}

/** Does an update change something a student would see? */
function hasStructuralChange(input: UpdateExamInput): boolean {
  return (
    input.questionIds !== undefined ||
    input.questionFilter !== undefined ||
    input.durationMinutes !== undefined ||
    input.passPercentage !== undefined ||
    input.shuffleQuestions !== undefined ||
    input.shuffleOptions !== undefined ||
    input.startAt !== undefined ||
    input.endAt !== undefined ||
    // Class targeting decides which candidates the
    // paper is offered to at all.
    input.classes !== undefined ||
    // Session targeting narrows that further to one cohort.
    input.session !== undefined
  )
}

/**
 * Publish an exam.
 *
 * Refuses a paper with no questions: publishing it would give every candidate an
 * empty paper and a meaningless result.
 */
export async function publishExam(
  id: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<ExamDto> {
  const exam = await prisma.exam.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, deletedAt: true, _count: { select: { questions: true } } },
  })

  if (!exam || exam.deletedAt !== null) {
    throw ApiError.notFound('Examination not found')
  }

  if (exam.status === 'PUBLISHED' || exam.status === 'ONGOING') {
    throw ApiError.conflict('This examination is already published')
  }

  if (exam._count.questions === 0) {
    throw ApiError.validation('Add at least one question before publishing', {
      questionIds: ['An examination must contain at least one question'],
    })
  }

  const updated = await prisma.exam.update({
    where: { id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
    select: examSelect,
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.PUBLISH_EXAM,
    entity: 'Exam',
    entityId: id,
    description: `Published exam "${exam.title}"`,
    metadata: { questionCount: exam._count.questions },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(updated)
}

/** Withdraw a published exam so it can be edited again. */
export async function unpublishExam(
  id: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<ExamDto> {
  const exam = await prisma.exam.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, deletedAt: true, _count: { select: { sessions: true } } },
  })

  if (!exam || exam.deletedAt !== null) {
    throw ApiError.notFound('Examination not found')
  }

  if (exam.status === 'DRAFT') {
    throw ApiError.conflict('This examination is not published')
  }

  // Unpublishing a paper a student has already sat would retroactively change the
  // conditions of a real attempt.
  if (exam._count.sessions > 0) {
    throw ApiError.conflict(
      'This examination already has student attempts and cannot be unpublished. Archive it instead.',
    )
  }

  const updated = await prisma.exam.update({
    where: { id },
    data: { status: 'DRAFT', publishedAt: null },
    select: examSelect,
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.UNPUBLISH_EXAM,
    entity: 'Exam',
    entityId: id,
    description: `Unpublished exam "${exam.title}"`,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return toDto(updated)
}

export async function deleteExam(
  id: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.exam.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, deletedAt: true, _count: { select: { sessions: true } } },
  })

  if (!existing || existing.deletedAt !== null) {
    throw ApiError.notFound('Examination not found')
  }

  if (existing._count.sessions > 0) {
    throw ApiError.conflict(
      'This examination has recorded student attempts and cannot be deleted. Archive it instead.',
    )
  }

  await prisma.exam.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.DELETE_EXAM,
    entity: 'Exam',
    entityId: id,
    description: `Deleted exam "${existing.title}"`,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return { id, deleted: true }
}

/**
 * Archive an examination.
 *
 * Soft-deletes the exam and sets its status to `ARCHIVED` even when it has
 * recorded student attempts — unlike delete/unpublish, which are blocked once
 * a paper has been sat. Archived exams no longer appear in the active list,
 * but their results remain intact for reporting.
 */
export async function archiveExam(
  id: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
) {
  const existing = await prisma.exam.findUnique({
    where: { id },
    select: { id: true, title: true, deletedAt: true, status: true },
  })

  if (!existing || existing.deletedAt !== null) {
    throw ApiError.notFound('Examination not found')
  }
  if (existing.status === 'ARCHIVED') {
    throw ApiError.conflict('This examination is already archived')
  }

  await prisma.exam.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'ARCHIVED' },
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.ARCHIVE_EXAM,
    entity: 'Exam',
    entityId: id,
    description: `Archived exam "${existing.title}"`,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return { id, archived: true }
}