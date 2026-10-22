import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/database.js'
import {
  buildMeta,
  escapeSearchTerm,
  normaliseSearch,
  resolvePagination,
  resolveSortOrder,
} from '../../utils/pagination.js'
import type { ResultsListQuery } from './results.schema.js'

/**
 * Grade boundaries, lowest score inclusive for each grade.
 */
const GRADE_BOUNDARIES: Array<{ grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; min: number }> = [
  { grade: 'A', min: 70 },
  { grade: 'B', min: 60 },
  { grade: 'C', min: 50 },
  { grade: 'D', min: 45 },
  { grade: 'E', min: 40 },
  { grade: 'F', min: 0 },
]

function gradeFor(percentage: number): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' {
  for (const boundary of GRADE_BOUNDARIES) {
    if (percentage >= boundary.min) return boundary.grade
  }
  return 'F'
}

/** Shape one result row for the API. */
function toResultDto(row: Prisma.ResultGetPayload<{ select: typeof resultSelect }>) {
  return {
    id: row.id,
    examSessionId: row.sessionId,
    examId: row.examId,
    examName: row.exam.title,
    studentId: row.student.id,
    studentId_: row.student.studentId,
    studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
    className: row.student.className,
    level: row.student.level,
    totalQuestions: row.totalQuestions,
    correctAnswers: row.correctAnswers,
    wrongAnswers: row.wrongAnswers,
    unansweredQuestions: row.unanswered,
    totalMarks: Number(row.totalMarks),
    marksObtained: Number(row.marksObtained),
    percentage: Number(row.percentage),
    grade: gradeFor(Number(row.percentage)),
    passed: row.passed,
    timeSpentSeconds: row.timeSpentSeconds,
    submittedAt: row.session.submittedAt?.toISOString() ?? '',
  }
}

const resultSelect = {
  id: true,
  sessionId: true,
  examId: true,
  studentId: true,
  totalQuestions: true,
  answeredQuestions: true,
  correctAnswers: true,
  wrongAnswers: true,
  unanswered: true,
  totalMarks: true,
  marksObtained: true,
  percentage: true,
  passed: true,
  timeSpentSeconds: true,
  exam: { select: { title: true } },
  student: {
    select: {
      id: true,
      studentId: true,
      firstName: true,
      lastName: true,
      className: true,
      level: true,
    },
  },
  session: { select: { submittedAt: true } },
} satisfies Prisma.ResultSelect

/**
 * List results with pagination, search and filters.
 */
export async function listResults(query: ResultsListQuery): Promise<{
  data: ReturnType<typeof toResultDto>[]
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number }
}> {
  const { page, limit, skip, take } = resolvePagination(query.page, query.limit)
  const search = normaliseSearch(query.search)

  const where: Prisma.ResultWhereInput = {}
  if (search) {
    const term = escapeSearchTerm(search)
    where.OR = [
      { student: { studentId: { contains: term } } },
      { student: { firstName: { contains: term } } },
      { student: { lastName: { contains: term } } },
      { exam: { title: { contains: term } } },
    ]
  }
  if (query.examId) where.examId = query.examId
  if (query.studentId) where.studentId = query.studentId
  if (query.passed !== 'all') where.passed = query.passed === 'true'

  const orderBy: Prisma.ResultOrderByWithRelationInput = {}
  if (query.sort) {
    (orderBy as Record<string, 'asc' | 'desc'>)[query.sort] = resolveSortOrder(
      query.order,
    )
  } else {
    orderBy.gradedAt = 'desc'
  }

  const [rows, totalItems] = await Promise.all([
    prisma.result.findMany({
      where,
      skip,
      take,
      orderBy,
      select: resultSelect,
    }),
    prisma.result.count({ where }),
  ])

  return {
    data: rows.map(toResultDto),
    meta: buildMeta(totalItems, page, limit),
  }
}

/** Aggregate summary for the results dashboard header and charts. */
export async function resultsSummary(): Promise<{
  totalResults: number
  passed: number
  failed: number
  averageScore: number
  passRate: number
  gradeDistribution: Array<{ grade: string; count: number }>
  subjectPerformance: Array<{
    subjectId: string
    subjectName: string
    categoryName: string
    averageScore: number
    attempts: number
    passRate: number
  }>
}> {
  const [rows, totalItems] = await Promise.all([
    prisma.result.findMany({ select: resultSelect }),
    prisma.result.count(),
  ])

  const totalResults = totalItems
  const passed = rows.filter((row) => row.passed).length
  const failed = totalResults - passed
  const averageScore =
    totalResults > 0
      ? Math.round(
          (rows.reduce((sum, row) => sum + Number(row.percentage), 0) / totalResults) *
            10,
        ) / 10
      : 0
  const passRate = totalResults > 0 ? Math.round((passed / totalResults) * 1000) / 10 : 0

  const gradeDistribution = ['A', 'B', 'C', 'D', 'E', 'F'].map((grade) => ({
    grade,
    count: rows.filter((row) => gradeFor(Number(row.percentage)) === grade).length,
  }))

  // Subject performance: aggregate by exam → subject/category.
  const exams = await prisma.exam.findMany({
    select: {
      id: true,
      title: true,
      program: true,
      department: true,
      results: {
        select: { id: true, percentage: true, passed: true },
      },
    },
  })

  const subjectMap = new Map<
    string,
    {
      subjectId: string
      subjectName: string
      categoryName: string
      scores: number[]
      attempts: number
      passed: number
    }
  >()
  for (const exam of exams) {
    const key = `${exam.program}|${exam.department}`
    let entry = subjectMap.get(key)
    if (!entry) {
      entry = {
        subjectId: exam.id,
        subjectName: exam.title,
        categoryName: exam.department ?? '—',
        scores: [],
        attempts: 0,
        passed: 0,
      }
      subjectMap.set(key, entry)
    }
    for (const result of exam.results) {
      entry.scores.push(Number(result.percentage))
      entry.attempts += 1
      if (result.passed) entry.passed += 1
    }
  }

  const subjectPerformance = [...subjectMap.values()].map((entry) => ({
    subjectId: entry.subjectId,
    subjectName: entry.subjectName,
    categoryName: entry.categoryName,
    averageScore:
      entry.scores.length > 0
        ? Math.round(
            (entry.scores.reduce((sum, s) => sum + s, 0) / entry.scores.length) * 10,
          ) / 10
        : 0,
    attempts: entry.attempts,
    passRate: entry.attempts > 0 ? Math.round((entry.passed / entry.attempts) * 1000) / 10 : 0,
  }))

  return {
    totalResults,
    passed,
    failed,
    averageScore,
    passRate,
    gradeDistribution,
    subjectPerformance,
  }
}

/**
 * Export every result as CSV text, newest first.
 */
export async function exportResultsCsv(): Promise<string> {
  const rows = await prisma.result.findMany({
    orderBy: { gradedAt: 'desc' },
    select: resultSelect,
  })

  const header = [
    'Student ID',
    'Student Name',
    'Class',
    'Level',
    'Examination',
    'Total Questions',
    'Correct',
    'Wrong',
    'Unanswered',
    'Marks Obtained',
    'Total Marks',
    'Percentage',
    'Grade',
    'Passed',
    'Time Spent (seconds)',
    'Submitted At',
  ].join(',')

  const lines = [header, ...rows.map((row) => csvRow(toResultDto(row)))]
  return lines.join('\n')
}

function csvRow(result: ReturnType<typeof toResultDto>): string {
  const escape = (value: unknown): string => {
    const text = String(value ?? '')
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }

  return [
    result.studentId_,
    result.studentName,
    result.className ?? '',
    result.level,
    result.examName,
    result.totalQuestions,
    result.correctAnswers,
    result.wrongAnswers,
    result.unansweredQuestions,
    result.marksObtained,
    result.totalMarks,
    result.percentage,
    result.grade,
    result.passed ? 'Yes' : 'No',
    result.timeSpentSeconds,
    result.submittedAt,
  ].map(escape).join(',')
}
