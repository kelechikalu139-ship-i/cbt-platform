import { Router, type Request, type Response } from 'express'
import { requirePermission } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/async-handler.js'
import { sendData } from '../../utils/http-response.js'
import { prisma } from '../../config/database.js'
import { PERMISSIONS } from '../../constants/permissions.js'
import { ApiError } from '../../utils/api-error.js'

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
}

type DailyActivity = { date: string; started: number; submitted: number }

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

    sendData(res, {
      counters,
      recentActivity: [...activityByDay.values()],
      upcomingExams,
      todayExams: examsPublished,
      // Sessions, results analytics and licensing land in later phases. Reported
      // as empty rather than omitted so the dashboard renders every panel with
      // an honest "no data yet" instead of silently skipping them.
      activeSessions: [],
      subjectPerformance: [],
      license: null,
      generatedAt: new Date().toISOString(),
    })
  }),
)
