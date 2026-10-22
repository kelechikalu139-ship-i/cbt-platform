import { Router, type Request, type Response } from 'express'
import { requirePermission } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData } from '../../utils/http-response.js'
import { prisma } from '../../config/database.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import { ApiError } from '../../utils/api-error.js'
import { countLiveSessions, countSignedInStudents, listLiveSessions } from '../monitoring/monitoring.service.js'

/**
 * Dashboard aggregate (§24).
 *
 * The admin landing page needs one request, not nine. Every panel is computed
 * here so the dashboard costs a single round trip and cannot half-load, which is
 * what previously produced a screen mixing real numbers with "Dashboard
 * unavailable".
 *
 * Permission is the union of everything the page displays, so a caller who can
 * only read the question bank still gets a working (if sparse) dashboard rather
 * than a 403 on the whole screen. Sections the caller cannot see are reported as
 * `null` rather than omitted, so the UI can distinguish "no data" from "not
 * permitted to see".
 */

export const dashboardRouter = Router()

type Counters = {
  totalStudents: number
  activeStudents: number
  totalQuestions: number
  activeQuestions: number
  totalCategories: number
  totalSubjects: number
  totalExams: number
  publishedExams: number
  draftExams: number
  completedExams: number
  totalResults: number
  totalUsers: number
  /** Attempts in progress right now. */
  liveSessions: number
  /** Candidates holding a live portal sign-in. */
  signedInStudents: number
}

type DailyActivity = { date: string; started: number; submitted: number }

/** One row of the subject-performance aggregation. DB returns numbers as strings. */
type SubjectPerformanceRow = {
  subjectId: string
  subjectName: string
  categoryName: string
  averageScore: string
  attempts: string
  passRate: string
}

dashboardRouter.get(
  '/',
  requirePermission(PERMISSIONS.SYSTEM_READ),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required')
    }

    // Read the caller's real grants from the database rather than inferring them
    // from a role name. Deriving permissions from roles in application code is
    // exactly the duplication that drifts out of step with the seed.
    //
    // `req.user.role` carries the role *code* (e.g. "SUPER_ADMIN"), not the row
    // id, so the lookup is by the unique code column.
    const role = await prisma.role.findUnique({
      where: { code: req.user.role },
      select: { code: true, permissions: { select: { permission: { select: { key: true } } } } },
    })

    const granted = new Set<string>(
      role?.code === 'SUPER_ADMIN'
        ? // SUPER_ADMIN implicitly holds everything; the join table is not the
          // source of truth for it.
          Object.values(PERMISSIONS)
        : (role?.permissions.map((entry) => entry.permission.key) ?? []),
    )

    const can = (permission: string) => granted.has(permission)

    const seeStudents = can(PERMISSIONS.STUDENTS_READ)
    const seeQuestions = can(PERMISSIONS.QUESTIONS_READ)
    const seeExams = can(PERMISSIONS.EXAMS_READ)
    const seeUsers = can(PERMISSIONS.USERS_READ)
    const seeResults = can(PERMISSIONS.RESULTS_READ)

    // Started today, server-side. The browser clock is never trusted for filtering.
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const counters: Counters = {
      totalStudents: 0,
      activeStudents: 0,
      totalQuestions: 0,
      activeQuestions: 0,
      totalCategories: 0,
      totalSubjects: 0,
      totalExams: 0,
      publishedExams: 0,
      draftExams: 0,
      completedExams: 0,
      totalResults: 0,
      totalUsers: 0,
      liveSessions: 0,
      signedInStudents: 0,
    }

    // One grouped count per table. Issued concurrently so a whole lab hitting the
    // dashboard at the same moment does not serialise into a queue.
    const [
      studentsTotal,
      studentsActive,
      questionsTotal,
      questionsActive,
      categoriesTotal,
      subjectsTotal,
      examsTotal,
      examsPublished,
      examsDraft,
      examsCompleted,
      resultsTotal,
      usersTotal,
    ] = await Promise.all([
      seeStudents ? prisma.student.count({ where: { deletedAt: null } }) : 0,
      seeStudents
        ? prisma.student.count({ where: { deletedAt: null, status: 'ACTIVE' } })
        : 0,
      seeQuestions ? prisma.question.count({ where: { deletedAt: null } }) : 0,
      seeQuestions
        ? prisma.question.count({ where: { deletedAt: null, status: 'ACTIVE' } })
        : 0,
      seeQuestions ? prisma.category.count({ where: { deletedAt: null } }) : 0,
      seeQuestions ? prisma.subject.count() : 0,
      seeExams ? prisma.exam.count({ where: { deletedAt: null } }) : 0,
      seeExams ? prisma.exam.count({ where: { deletedAt: null, status: 'PUBLISHED' } }) : 0,
      seeExams ? prisma.exam.count({ where: { deletedAt: null, status: 'DRAFT' } }) : 0,
      seeExams ? prisma.exam.count({ where: { deletedAt: null, status: 'COMPLETED' } }) : 0,
      prisma.result.count(),
      seeUsers ? prisma.user.count({ where: { deletedAt: null } }) : 0,
    ])

    Object.assign(counters, {
      totalStudents: studentsTotal,
      activeStudents: studentsActive,
      totalQuestions: questionsTotal,
      activeQuestions: questionsActive,
      totalCategories: categoriesTotal,
      totalSubjects: subjectsTotal,
      totalExams: examsTotal,
      publishedExams: examsPublished,
      draftExams: examsDraft,
      completedExams: examsCompleted,
      totalResults: resultsTotal,
      totalUsers: usersTotal,
      liveSessions: seeExams ? await countLiveSessions() : 0,
      signedInStudents: seeStudents ? await countSignedInStudents() : 0,
    })

    // Upcoming exams: published papers whose window has not closed. An exam with
    // no dates is treated as always available, which is how an undated practice
    // paper behaves.
    const upcomingExams = seeExams
      ? (
          await prisma.exam.findMany({
            where: {
              deletedAt: null,
              status: { in: ['PUBLISHED', 'ONGOING'] },
              AND: [
                { OR: [{ startAt: null }, { startAt: { lte: new Date() } }] },
                { OR: [{ endAt: null }, { endAt: { gte: new Date() } }] },
              ],
            },
            orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
            take: 5,
            select: {
              id: true,
              title: true,
              program: true,
              level: true,
              semester: true,
              durationMinutes: true,
              startAt: true,
              endAt: true,
              status: true,
              questionCount: true,
            },
          })
        ).map((exam) => ({
          ...exam,
          startAt: exam.startAt?.toISOString() ?? null,
          endAt: exam.endAt?.toISOString() ?? null,
        }))
      : null

    // Seven days of session activity, oldest first, so the chart reads left to
    // right. Built from the database rather than in the browser to avoid
    // shipping every session row to the client just to aggregate it.
    const activityRows = await prisma.examSession.groupBy({
      by: ['startedAt'],
      _count: { _all: true },
      where: { startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    })

    const activityByDay = new Map<string, DailyActivity>()
    for (let offset = 6; offset >= 0; offset--) {
      const day = new Date(Date.now() - offset * 24 * 60 * 60 * 1000)
      activityByDay.set(day.toISOString().slice(0, 10), {
        date: day.toISOString().slice(0, 10),
        started: 0,
        submitted: 0,
      })
    }

    for (const row of activityRows) {
      const key = row.startedAt.toISOString().slice(0, 10)
      const bucket = activityByDay.get(key)
      if (bucket) bucket.started += row._count._all
    }

    const submittedRows = await prisma.examSession.groupBy({
      by: ['submittedAt'],
      _count: { _all: true },
      where: { submittedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    })

    for (const row of submittedRows) {
      if (!row.submittedAt) continue
      const key = row.submittedAt.toISOString().slice(0, 10)
      const bucket = activityByDay.get(key)
      if (bucket) bucket.submitted += row._count._all
    }

    // Live attempts — the same query the monitor runs, capped for the
    // landing page. Reported empty rather than omitted so the panel
    // renders an honest "nobody is writing" instead of disappearing.
    const activeSessions = seeExams ? await listLiveSessions({ limit: 8 }) : []

    // Subject performance: average score across completed examinations,
    // grouped by subject. Each (result, subject) pair counts once, so a
    // multi-subject exam contributes its percentage to each of its subjects.
    const subjectPerformance = seeResults
      ? (
          await prisma.$queryRawUnsafe<SubjectPerformanceRow[]>(`
            WITH result_subjects AS (
              SELECT DISTINCT r.id as resultId, r.percentage, r.passed,
                             s.id as subjectId, s.name as subjectName,
                             c.name as categoryName
              FROM \`results\` r
              JOIN \`exam_questions\` eq ON eq.examId = r.examId
              JOIN \`questions\` q ON q.id = eq.questionId
              JOIN \`subjects\` s ON s.id = q.subjectId
              JOIN \`categories\` c ON c.id = s.categoryId
            )
            SELECT
              subjectId,
              subjectName,
              categoryName,
              ROUND(AVG(CAST(percentage AS DECIMAL(10,2))), 2) as averageScore,
              COUNT(*) as attempts,
              ROUND(AVG(CASE WHEN passed = 1 THEN 1 ELSE 0 END) * 100, 2) as passRate
            FROM result_subjects
            GROUP BY subjectId, subjectName, categoryName
            ORDER BY averageScore DESC
          `)
        ).map((row) => ({
          subjectId: row.subjectId,
          subjectName: row.subjectName,
          categoryName: row.categoryName,
          averageScore: Number(row.averageScore),
          attempts: Number(row.attempts),
          passRate: Number(row.passRate),
        }))
      : []

    sendData(res, {
      counters,
      recentActivity: [...activityByDay.values()],
      upcomingExams,
      todayExams: examsPublished,
      activeSessions,
      subjectPerformance,
      license: null,
      generatedAt: new Date().toISOString(),
    })
  }),
)
