import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { runInTransaction } from '../../middleware/error.js'
import { ApiError } from '../../utils/api-error.js'
import { AUDIT_ACTIONS, recordAudit } from '../../services/audit.service.js'
import { forceFinalizeSession } from '../portal/portal.service.js'
import type { LiveSessionQuery } from './monitoring.schema.js'

/**
 * Live examination monitoring (§55).
 *
 * Everything an invigilator needs on exam day: who is writing right
 * now, how far through they are, and the three interventions that
 * actually come up — sign a candidate out, force-close a stuck
 * attempt, and let a candidate sit a paper again.
 *
 * The reads here are deliberately the same query the dashboard's live
 * panel uses, so a number on the landing page and a row on the monitor
 * can never disagree.
 */

/** Shape of one live attempt, as the monitor and the dashboard see it. */
export interface LiveSessionRow {
  sessionId: string
  examId: string
  examTitle: string
  studentId: string
  studentRecordId: string
  studentName: string
  admissionNumber: string
  className: string | null
  program: string
  session: string | null
  attemptNumber: number
  status: string
  startedAt: string
  expiresAt: string
  /** Seconds left on the server clock; 0 once the attempt has run over. */
  secondsRemaining: number
  /** Answers saved so far, out of the paper's question count. */
  answeredCount: number
  totalQuestions: number
  violationCount: number
  lastIpAddress: string | null
  lastSavedAt: string | null
}

const liveSelect = {
  id: true,
  status: true,
  startedAt: true,
  expiresAt: true,
  lastSavedAt: true,
  attemptNumber: true,
  violationCount: true,
  lastIpAddress: true,
  exam: {
    select: {
      id: true,
      title: true,
      questionCount: true,
      _count: { select: { questions: true } },
    },
  },
  student: {
    select: {
      id: true,
      userId: true,
      studentId: true,
      firstName: true,
      lastName: true,
      className: true,
      program: true,
      session: true,
    },
  },
  _count: { select: { answers: true } },
} satisfies Prisma.ExamSessionSelect

/**
 * Attempts currently in progress, newest first.
 *
 * An attempt whose clock has run out but which was never closed (a
 * browser closed without submitting) still counts as live — it is
 * exactly the case an invigilator needs to see — and reports
 * `secondsRemaining: 0` so it reads as overdue.
 */
export async function listLiveSessions(query: LiveSessionQuery = {}): Promise<LiveSessionRow[]> {
  const now = new Date()

  const rows = await prisma.examSession.findMany({
    where: { status: 'IN_PROGRESS' },
    orderBy: { startedAt: 'desc' },
    take: query.limit ?? 200,
    select: liveSelect,
  })

  const visible = query.examId ? rows.filter((row) => row.exam.id === query.examId) : rows

  return visible.map((row) => {
    const totalQuestions = row.exam.questionCount ?? row.exam._count.questions
    return {
      sessionId: row.id,
      examId: row.exam.id,
      examTitle: row.exam.title,
      studentId: row.student.studentId,
      studentRecordId: row.student.id,
      studentName: `${row.student.firstName} ${row.student.lastName}`,
      admissionNumber: row.student.studentId,
      className: row.student.className,
      program: row.student.program,
      session: row.student.session,
      attemptNumber: row.attemptNumber,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      secondsRemaining: Math.max(0, Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000)),
      answeredCount: row._count.answers,
      totalQuestions,
      violationCount: row.violationCount,
      lastIpAddress: row.lastIpAddress,
      lastSavedAt: row.lastSavedAt?.toISOString() ?? null,
    }
  })
}

/**
 * Every candidate who has attempted a paper, with how far their attempts
 * went. The reset dialog lists these, so an invigilator picks a name
 * rather than typing one.
 */
export async function listExamAttempts(examId: string): Promise<
  Array<{
    studentRecordId: string
    admissionNumber: string
    studentName: string
    className: string | null
    attempts: number
    /** True while an attempt is still in progress. */
    isLive: boolean
    lastSubmittedAt: string | null
  }>
> {
  const sessions = await prisma.examSession.findMany({
    where: { examId },
    select: {
      status: true,
      attemptNumber: true,
      submittedAt: true,
      student: {
        select: {
          id: true,
          studentId: true,
          firstName: true,
          lastName: true,
          className: true,
        },
      },
    },
    orderBy: { startedAt: 'desc' },
  })

  const byStudent = new Map<string, (typeof sessions)[number]>()
  for (const session of sessions) {
    const current = byStudent.get(session.student.id)
    if (!current || session.attemptNumber > current.attemptNumber) {
      byStudent.set(session.student.id, session)
    }
  }

  return [...byStudent.values()].map((session) => ({
    studentRecordId: session.student.id,
    admissionNumber: session.student.studentId,
    studentName: `${session.student.firstName} ${session.student.lastName}`,
    className: session.student.className,
    attempts: session.attemptNumber,
    isLive: session.status === 'IN_PROGRESS',
    lastSubmittedAt: session.submittedAt?.toISOString() ?? null,
  }))
}

/** How many attempts are in progress right now. */
export async function countLiveSessions(): Promise<number> {
  return prisma.examSession.count({ where: { status: 'IN_PROGRESS' } })
}

/** Candidates holding a live portal sign-in. */
export async function countSignedInStudents(): Promise<number> {
  return prisma.user.count({
    where: {
      role: { code: 'STUDENT' },
      status: 'ACTIVE',
      sessionHash: { not: null },
      sessionExpiresAt: { gt: new Date() },
    },
  })
}

/**
 * Close a live attempt early and grade what was answered.
 *
 * Used when a candidate's device has died mid-exam, or an invigilator
 * ends the attempt on the candidate's behalf. Grading runs exactly as
 * it does at submission, so the candidate sees a real result.
 */
export async function forceSubmitSession(
  sessionId: string,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<LiveSessionRow | null> {
  const before = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      exam: { select: { id: true, title: true } },
      student: { select: { id: true, studentId: true, firstName: true, lastName: true } },
    },
  })

  if (!before) {
    throw ApiError.notFound('Exam session not found')
  }
  if (before.status !== 'IN_PROGRESS') {
    throw ApiError.conflict('That attempt is no longer in progress')
  }

  await forceFinalizeSession(sessionId, 'AUTO_SUBMITTED')

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.END_EXAM_SESSION,
    entity: 'ExamSession',
    entityId: sessionId,
    description: `Ended ${before.student.firstName} ${before.student.lastName}'s attempt on "${before.exam.title}" early`,
    metadata: { examId: before.exam.id, studentId: before.student.id, reason: 'invigilator' },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  const [row] = await listLiveSessions({ limit: 1 }).then((rows) =>
    rows.filter((live) => live.sessionId === sessionId),
  )
  return row ?? null
}

/**
 * Add extra time to a live examination session.
 *
 * The invigilator grants a candidate more time — for example when a
 * technical fault ate part of the sitting. The server clock extends
 * `expiresAt` by the requested minutes; the candidate's browser countdown
 * picks up the new deadline on its next poll.
 */
export async function extendSession(
  sessionId: string,
  additionalMinutes: number,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<LiveSessionRow | null> {
  const before = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      exam: { select: { id: true, title: true } },
      student: { select: { id: true, studentId: true, firstName: true, lastName: true } },
    },
  })

  if (!before) {
    throw ApiError.notFound('Exam session not found')
  }
  if (before.status !== 'IN_PROGRESS') {
    throw ApiError.conflict('That attempt is no longer in progress')
  }

  // A session whose clock ran out but was never closed (browser closed
  // without submitting) still counts as IN_PROGRESS and can be extended —
  // the invigilator grants more time and the candidate keeps working.

  const expiresAt = new Date(before.expiresAt.getTime() + additionalMinutes * 60_000)

  const updated = await prisma.examSession.update({
    where: { id: sessionId },
    data: { expiresAt },
    select: liveSelect,
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.EXTEND_EXAM_TIME,
    entity: 'ExamSession',
    entityId: sessionId,
    description: `Added ${additionalMinutes} minutes to ${before.student.firstName} ${before.student.lastName}'s attempt on "${before.exam.title}"`,
    metadata: { examId: before.exam.id, studentId: before.student.id, additionalMinutes },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  const row = await mapLiveRow(updated)
  return row ?? null
}

/**
 * Map a raw Prisma exam session row (with `liveSelect` shape) to a
 * `LiveSessionRow`, recomputing `secondsRemaining` against the server clock.
 */
function mapLiveRow(row: Prisma.ExamSessionGetPayload<{ select: typeof liveSelect }>): LiveSessionRow {
  const now = new Date()
  const totalQuestions = row.exam.questionCount ?? row.exam._count.questions
  return {
    sessionId: row.id,
    examId: row.exam.id,
    examTitle: row.exam.title,
    studentId: row.student.studentId,
    studentRecordId: row.student.id,
    studentName: `${row.student.firstName} ${row.student.lastName}`,
    admissionNumber: row.student.studentId,
    className: row.student.className,
    program: row.student.program,
    session: row.student.session,
    attemptNumber: row.attemptNumber,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    secondsRemaining: Math.max(0, Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000)),
    answeredCount: row._count.answers,
    totalQuestions,
    violationCount: row.violationCount,
    lastIpAddress: row.lastIpAddress,
    lastSavedAt: row.lastSavedAt?.toISOString() ?? null,
  }
}

/**
 * Wipe a candidate's attempts on a paper so they can sit it again.
 *
 * Sessions, their saved answers and the resulting results all go: a
 * result that outlived its session would keep a stale percentage
 * after the re-sit. Deletion is the honest reset — the audit trail
 * records what happened and who did it, which is what an exam board
 * needs if a re-sit is ever questioned.
 *
 * The portal session of every reset candidate is ended too. Resets are
 * overwhelmingly applied to a device that died mid-exam, and that
 * device's stale sign-in would otherwise block the candidate from
 * signing in to sit the paper again.
 *
 * With no student ids, every attempt on the paper is reset.
 */
export async function resetExamAttempts(
  examId: string,
  studentIds: string[] | undefined,
  context: { actorId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<{ examTitle: string; resetStudents: number; resetAttempts: number }> {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, deletedAt: null },
    select: { id: true, title: true },
  })
  if (!exam) {
    throw ApiError.notFound('Examination not found')
  }

  const sessions = await prisma.examSession.findMany({
    where: {
      examId,
      ...(studentIds && studentIds.length > 0 ? { student: { studentId: { in: studentIds } } } : {}),
    },
    select: { id: true, studentId: true },
  })

  if (sessions.length === 0) {
    return { examTitle: exam.title, resetStudents: 0, resetAttempts: 0 }
  }

  const sessionIds = sessions.map((session) => session.id)
  const studentRecordIds = [...new Set(sessions.map((session) => session.studentId))]

  await runInTransaction(async (tx) => {
    // Results reference sessions, so they go first. Answers are removed
    // by the cascade the schema declares on `examAnswer.examSession`.
    await tx.result.deleteMany({ where: { sessionId: { in: sessionIds } } })
    await tx.examSession.deleteMany({ where: { id: { in: sessionIds } } })

    // End the portal session of every candidate reset, so a sign-in left
    // behind on the frozen device cannot refuse their fresh one.
    await tx.user.updateMany({
      where: { student: { id: { in: studentRecordIds } } },
      data: { sessionHash: null, sessionExpiresAt: null, refreshTokenHash: null },
    })
  })

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTIONS.RESET_EXAM_ATTEMPTS,
    entity: 'Exam',
    entityId: exam.id,
    description: `Reset ${sessions.length} attempt(s) for ${studentRecordIds.length} candidate(s) on "${exam.title}"`,
    metadata: {
      examId: exam.id,
      studentIds,
      affectedStudents: studentRecordIds.length,
      affectedAttempts: sessions.length,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  })

  return {
    examTitle: exam.title,
    resetStudents: studentRecordIds.length,
    resetAttempts: sessions.length,
  }
}
