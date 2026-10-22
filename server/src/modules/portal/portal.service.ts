import { Prisma } from '@prisma/client'
import { prisma } from '../../config/database.js'
import { runInTransaction } from '../../middleware/error.js'
import { ApiError } from '../../utils/api-error.js'
import { AUDIT_ACTIONS, recordAudit, recordAuditInTransaction } from '../../services/audit.service.js'
import type { AuthenticatedUser } from '../../middleware/auth.js'
import {
  WEB_QUESTION_TYPES,
  WEB_SESSION_STATUS,
  type StudentDashboardDto,
  type StudentExamSummary,
  type StudentProfileDto,
  type StudentResultDto,
  type StudentSessionDto,
  type StudentSessionQuestion,
  type StudentSessionSummary,
} from './portal.schema.js'

/**
 * Student portal service (§28, §32, §33, §44, §55).
 *
 * This is the exam engine. It owns the candidate-facing lifecycle:
 *
 * - **Delivery**: a paper is offered to a candidate when it is
 *   published, its window is open, and the candidate's class is
 *   one of the classes the paper was set for.
 * - **The frozen paper**: starting a session shuffles the question
 *   order (and, when enabled, the option order) once, persists
 *   that order on the session row, and serves every later read
 *   from it. A resumed or retried request can never regenerate a
 *   different paper mid-exam.
 * - **The server clock**: `expiresAt` is computed at start and is
 *   the only thing that decides whether an exam is still live.
 *   The browser renders a countdown; it cannot extend one.
 * - **Grading**: objective questions are marked against the stored
 *   answer key at submission. Short answers stay ungraded until a
 *   lecturer reviews them and count as zero until then.
 */

const examPaperSelect = {
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
  deletedAt: true,
  _count: { select: { questions: true } },
  questions: {
    orderBy: { position: 'asc' },
    select: {
      position: true,
      points: true,
      question: {
        select: {
          id: true,
          type: true,
          stem: true,
          points: true,
          correctAnswer: true,
          status: true,
          deletedAt: true,
          options: {
            orderBy: { sortOrder: 'asc' },
            select: { id: true, label: true, text: true, sortOrder: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ExamSelect

type ExamPaperRow = Prisma.ExamGetPayload<{ select: typeof examPaperSelect }>
type QuestionRow = ExamPaperRow['questions'][number]['question']

/** An exam session row as the engine reads it. */
interface SessionRow {
  id: string
  examId: string
  studentId: string
  status: string
  startedAt: Date
  expiresAt: Date
  submittedAt: Date | null
  lastSavedAt: Date | null
  questionOrder: Prisma.JsonValue | null
  attemptNumber: number
  lastIpAddress: string | null
}

/** An answer row as the engine reads and grades it. */
interface AnswerRow {
  id: string
  examSessionId: string
  questionId: string
  selectedOptionId: string | null
  textAnswer: string | null
  isCorrect: boolean | null
  marksObtained: Prisma.Decimal | null
}

const studentSelect = {
  id: true,
  studentId: true,
  userId: true,
  firstName: true,
  lastName: true,
  email: true,
  program: true,
  department: true,
  level: true,
  semester: true,
  className: true,
  session: true,
  gender: true,
  status: true,
  deletedAt: true,
} satisfies Prisma.StudentSelect

type StudentRow = Prisma.StudentGetPayload<{ select: typeof studentSelect }>

/** The frozen question and option order of one attempt. */
interface FrozenPaper {
  questions: string[]
  options: Record<string, string[]>
}

/** Load the candidate record behind an authenticated account. */
async function requireStudent(user: AuthenticatedUser): Promise<StudentRow> {
  if (!user.studentId) {
    throw ApiError.forbidden('This account has no student record linked to it')
  }

  const student = await prisma.student.findUnique({
    where: { id: user.studentId },
    select: studentSelect,
  })

  if (!student || student.deletedAt !== null || student.status !== 'ACTIVE') {
    throw ApiError.forbidden('Your student account is not active')
  }

  return student
}

async function requireExam(examId: string): Promise<ExamPaperRow> {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, deletedAt: null },
    select: examPaperSelect,
  })
  if (!exam) {
    throw ApiError.notFound('Examination not found')
  }
  return exam
}

async function requireOwnedSession(sessionId: string, studentId: string) {
  const session = await prisma.examSession.findUnique({ where: { id: sessionId } })
  if (!session || session.studentId !== studentId) {
    throw ApiError.notFound('Session not found')
  }
  return session
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** The `classes` JSON column as an array of class names. */
function targetClasses(exam: ExamPaperRow): string[] {
  const classes = exam.classes as string[] | null
  return Array.isArray(classes) ? classes : []
}

/**
 * Is this paper delivered to this candidate right now?
 *
 * A paper with no classes set is open to every candidate; a paper with
 * classes set goes only to the candidates whose class is listed. A paper
 * tied to an academic session goes only to candidates registered in it —
 * so the same class can sit a first-semester paper once per cohort
 * without a paper for one cohort reaching the next. The window, when
 * set, bounds the offer.
 */
function isDeliveredTo(exam: ExamPaperRow, student: StudentRow, now: Date): boolean {
  const classes = targetClasses(exam)
  if (
    classes.length > 0 &&
    (student.className === null || !classes.includes(student.className))
  ) {
    return false
  }
  if (exam.session && exam.session !== student.session) return false
  if (exam.startAt !== null && now < exam.startAt) return false
  if (exam.endAt !== null && now > exam.endAt) return false
  return true
}

/** Attempts already spent on this paper. */
async function completedAttempts(examId: string, studentId: string): Promise<number> {
  return prisma.examSession.count({
    where: { examId, studentId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
  })
}

/** The candidate's live attempt for this paper, if any. */
async function liveSession(examId: string, studentId: string) {
  return prisma.examSession.findFirst({
    where: { examId, studentId, status: 'IN_PROGRESS' },
  })
}

/** Papers a candidate can open right now: delivered, and attempts remain. */
async function availableExamsFor(student: StudentRow, now: Date): Promise<ExamPaperRow[]> {
  const exams = await prisma.exam.findMany({
    where: { status: 'PUBLISHED', deletedAt: null },
    select: examPaperSelect,
  })

  const available: ExamPaperRow[] = []
  for (const exam of exams) {
    if (!isDeliveredTo(exam, student, now)) continue

    const [active, done] = await Promise.all([
      liveSession(exam.id, student.id),
      completedAttempts(exam.id, student.id),
    ])

    if (active) {
      // A live attempt is resumable; an expired one is spent, so the
      // paper only stays listed while a further attempt remains.
      const spent = now > active.expiresAt ? done + 1 : done
      if (spent < exam.maxAttempts) available.push(exam)
    } else if (done < exam.maxAttempts) {
      available.push(exam)
    }
  }
  return available
}

// ---------------------------------------------------------------------------
// DTO shaping
// ---------------------------------------------------------------------------

function webQuestionType(type: string): StudentSessionQuestion['type'] {
  if (type === 'TRUE_FALSE') return WEB_QUESTION_TYPES.TRUE_FALSE
  if (type === 'SHORT_ANSWER') return WEB_QUESTION_TYPES.SHORT_ANSWER
  return WEB_QUESTION_TYPES.MULTIPLE_CHOICE
}

function webSessionStatus(status: string): StudentSessionDto['status'] {
  if (status === 'AUTO_SUBMITTED') return WEB_SESSION_STATUS.AUTO_SUBMITTED
  if (status === 'IN_PROGRESS') return WEB_SESSION_STATUS.IN_PROGRESS
  return WEB_SESSION_STATUS.SUBMITTED
}

function examSummary(exam: ExamPaperRow): StudentExamSummary {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description ?? '',
    program: exam.program ?? '',
    level: exam.level ?? 0,
    duration: exam.durationMinutes,
    totalQuestions: exam.questionCount ?? exam._count.questions,
    passingScore: Number(exam.passPercentage),
    startDate: exam.startAt?.toISOString() ?? '',
    endDate: exam.endAt?.toISOString() ?? '',
    status: 'published',
  }
}

/**
 * Shape a session for the browser: the frozen paper in its frozen
 * order, the answers saved so far, and the seconds the server
 * clock leaves. Never includes the answer key.
 */
async function sessionDto(
  session: SessionRow,
  exam: ExamPaperRow,
): Promise<StudentSessionDto> {
  const paper: FrozenPaper =
    (session.questionOrder as FrozenPaper | null) ?? {
      questions: exam.questions.map((row) => row.question.id),
      options: Object.fromEntries(
        exam.questions.map((row) => [
          row.question.id,
          row.question.options.map((option) => option.id),
        ]),
      ),
    }

  const saved = await prisma.examAnswer.findMany({ where: { examSessionId: session.id } })
  const savedByQuestion = new Map<AnswerRow['questionId'], AnswerRow>(
    saved.map((answer) => [answer.questionId, answer]),
  )

  const questions: StudentSessionQuestion[] = []
  const answers: Record<string, string> = {}

  for (const questionId of paper.questions) {
    const row = exam.questions.find((join) => join.question.id === questionId)
    if (!row || row.question.deletedAt !== null) continue
    const question = row.question

    const optionIds = paper.options[questionId] ?? question.options.map((option) => option.id)
    const options = optionIds
      .map((id) => question.options.find((option) => option.id === id))
      .filter((option): option is NonNullable<typeof option> => Boolean(option))

    questions.push({
      id: questionId,
      type: webQuestionType(question.type),
      question: question.stem,
      options: question.type === 'SHORT_ANSWER' ? undefined : options.map((option) => option.text),
      points: Number(row.points ?? question.points),
      order: row.position,
    })

    const answer = savedByQuestion.get(questionId)
    if (answer) {
      if (answer.selectedOptionId !== null) {
        const option = question.options.find((o) => o.id === answer.selectedOptionId)
        if (option) answers[questionId] = option.text
      } else if (answer.textAnswer !== null) {
        answers[questionId] = answer.textAnswer
      }
    }
  }

  return {
    id: session.id,
    exam: { id: exam.id, title: exam.title, duration: exam.durationMinutes },
    questions,
    answers,
    currentQuestion: 0,
    timeRemaining: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
    status: webSessionStatus(session.status),
  }
}

// ---------------------------------------------------------------------------
// The frozen paper
// ---------------------------------------------------------------------------

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const held = copy[i] as T
    copy[i] = copy[j] as T
    copy[j] = held
  }
  return copy
}

/**
 * Shuffle the paper once and freeze the result on the session, so
 * every later read — resume, review, replay — serves the same paper
 * the candidate started with (§33).
 */
function buildPaper(exam: ExamPaperRow): FrozenPaper {
  const questionIds = exam.questions.map((row) => row.question.id)
  const options: Record<string, string[]> = {}
  for (const row of exam.questions) {
    const optionIds = row.question.options.map((option) => option.id)
    options[row.question.id] = exam.shuffleOptions ? shuffled(optionIds) : optionIds
  }
  return {
    questions: exam.shuffleQuestions ? shuffled(questionIds) : questionIds,
    options,
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export async function startSession(
  examId: string,
  user: AuthenticatedUser,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<StudentSessionDto> {
  const student = await requireStudent(user)
  const exam = await requireExam(examId)
  const now = new Date()

  // Only a live paper can be sat: a draft is still being
  // built, and an archived or completed paper is closed.
  // The list never offers such a paper, so reaching one
  // by id directly is refused the same way (§55).
  if (exam.status !== 'PUBLISHED' && exam.status !== 'ONGOING') {
    throw ApiError.forbidden('This examination is not available')
  }

  // A live attempt is resumed, never restarted: the frozen paper the
  // candidate already saw is the paper they keep (§33).
  const active = await liveSession(exam.id, student.id)
  if (active) {
    if (now > active.expiresAt) {
      await finalizeSession(active.id, 'AUTO_SUBMITTED')
    } else {
      return sessionDto(active, exam)
    }
  }

  if (!isDeliveredTo(exam, student, now)) {
    throw ApiError.forbidden('This examination is not set for your class')
  }

  const done = await completedAttempts(exam.id, student.id)
  if (done >= exam.maxAttempts) {
    throw ApiError.forbidden('You have already used every attempt for this examination')
  }

  const session = await prisma.examSession.create({
    data: {
      examId: exam.id,
      studentId: student.id,
      status: 'IN_PROGRESS',
      startedAt: now,
      expiresAt: new Date(now.getTime() + exam.durationMinutes * 60_000),
      attemptNumber: done + 1,
      // The frozen paper is plain JSON; the double cast is the
      // standard bridge to a JSON column's input type.
      questionOrder: buildPaper(exam) as unknown as Prisma.InputJsonValue,
      lastIpAddress: ipAddress,
    },
  })

  // A session start is security-relevant but must never fail the
  // exam because the audit write failed (§22). The actor is the
  // candidate's user account, which is what the audit trail's
  // actor reference points at.
  await recordAudit({
    actorId: student.userId,
    action: AUDIT_ACTIONS.START_EXAM_SESSION,
    entity: 'ExamSession',
    entityId: session.id,
    description: `Started "${exam.title}" (attempt ${session.attemptNumber})`,
    ipAddress,
    userAgent,
    success: true,
  })

  return sessionDto(session, exam)
}

export async function getSession(
  sessionId: string,
  user: AuthenticatedUser,
): Promise<StudentSessionDto> {
  const student = await requireStudent(user)
  const session = await requireOwnedSession(sessionId, student.id)
  const exam = await requireExam(session.examId)

  // The server clock is authoritative: an expired attempt is closed
  // before it is served, so a candidate can never read a paper the
  // clock has already ended.
  if (session.status === 'IN_PROGRESS' && new Date() > session.expiresAt) {
    await finalizeSession(session.id, 'AUTO_SUBMITTED')
    const closed = await requireOwnedSession(sessionId, student.id)
    return sessionDto(closed, exam)
  }

  return sessionDto(session, exam)
}

/**
 * Resolve an option *text* from the browser back to the stored
 * option row. The student app renders and answers with texts, so
 * the text is the handle the candidate knows the option by.
 */
function resolveOption(question: QuestionRow, answer: string) {
  const normalised = answer.trim().toLowerCase()
  return question.options.find((option) => option.text.trim().toLowerCase() === normalised)
}

export async function saveAnswer(
  sessionId: string,
  user: AuthenticatedUser,
  input: { questionId: string; answer: string },
): Promise<Record<string, never>> {
  const student = await requireStudent(user)
  const session = await requireOwnedSession(sessionId, student.id)

  if (session.status !== 'IN_PROGRESS') {
    throw ApiError.conflict('This session has already been submitted')
  }

  const now = new Date()
  if (now > session.expiresAt) {
    await finalizeSession(session.id, 'AUTO_SUBMITTED')
    throw ApiError.conflict('Time expired and the examination was submitted automatically')
  }

  const exam = await requireExam(session.examId)
  const row = exam.questions.find((join) => join.question.id === input.questionId)
  if (!row || row.question.deletedAt !== null) {
    throw ApiError.badRequest('Question is not part of this examination')
  }
  const question = row.question

  // One answer row per question per session; the unique constraint
  // on (examSessionId, questionId) makes a retried save idempotent (§44).
  if (question.type === 'SHORT_ANSWER') {
    await prisma.examAnswer.upsert({
      where: {
        examSessionId_questionId: { examSessionId: sessionId, questionId: input.questionId },
      },
      create: {
        examSessionId: sessionId,
        questionId: input.questionId,
        textAnswer: input.answer,
      },
      update: { textAnswer: input.answer },
    })
  } else if (question.type === 'TRUE_FALSE') {
    // TRUE_FALSE has no stored options; the answer text is stored directly.
    const normalised = normaliseTrueFalse(input.answer)
    if (normalised !== 'TRUE' && normalised !== 'FALSE') {
      throw ApiError.badRequest('Answer must be True or False')
    }
    await prisma.examAnswer.upsert({
      where: {
        examSessionId_questionId: { examSessionId: sessionId, questionId: input.questionId },
      },
      create: {
        examSessionId: sessionId,
        questionId: input.questionId,
        textAnswer: normalised,
      },
      update: { textAnswer: normalised },
    })
  } else {
    const option = resolveOption(question, input.answer)
    if (!option) {
      throw ApiError.badRequest('Answer does not match any option for this question')
    }
    await prisma.examAnswer.upsert({
      where: {
        examSessionId_questionId: { examSessionId: sessionId, questionId: input.questionId },
      },
      create: {
        examSessionId: sessionId,
        questionId: input.questionId,
        selectedOptionId: option.id,
      },
      update: { selectedOptionId: option.id },
    })
  }

  await prisma.examSession.update({
    where: { id: sessionId },
    data: { lastSavedAt: now },
  })

  return {}
}

export async function submitSession(
  sessionId: string,
  user: AuthenticatedUser,
): Promise<{ sessionId: string }> {
  const student = await requireStudent(user)
  const session = await requireOwnedSession(sessionId, student.id)

  // Submitting twice returns the same outcome rather than an error:
  // the browser retries on flaky lab networks (§44).
  if (session.status === 'SUBMITTED' || session.status === 'AUTO_SUBMITTED') {
    return { sessionId: session.id }
  }

  await finalizeSession(session.id, 'SUBMITTED')
  return { sessionId: session.id }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/** "True"/"False" as rendered, to the stored "TRUE"/"FALSE" key. */
function normaliseTrueFalse(text: string): string {
  const value = text.trim().toLowerCase()
  if (value === 'true' || value === 't') return 'TRUE'
  if (value === 'false' || value === 'f') return 'FALSE'
  return value.toUpperCase()
}

/**
 * Close a live session and grade it (§44).
 *
 * Objective questions are marked against the stored answer key
 * here, server-side, and the per-answer marks are written back.
 * Short answers stay ungraded until a lecturer reviews them and
 * count as zero until then, so the percentage is a floor, not a
 * ceiling. The whole close-and-grade runs in one transaction so a
 * result can never exist while its session is still open.
 */
export async function forceFinalizeSession(
  sessionId: string,
  finalStatus: 'SUBMITTED' | 'AUTO_SUBMITTED',
): Promise<void> {
  await finalizeSession(sessionId, finalStatus)
}

async function finalizeSession(
  sessionId: string,
  finalStatus: 'SUBMITTED' | 'AUTO_SUBMITTED',
): Promise<void> {
  const submittedAt = new Date()

  await runInTransaction(async (tx) => {
    const session = await tx.examSession.findUnique({ where: { id: sessionId } })
    if (!session || session.status !== 'IN_PROGRESS') return

    // The audit trail records the candidate's user account,
    // which is what the audit actor reference points at.
    const student = await tx.student.findUnique({
      where: { id: session.studentId },
      select: { userId: true },
    })

    const exam = await tx.exam.findFirst({
      where: { id: session.examId, deletedAt: null },
      select: examPaperSelect,
    })
    if (!exam) return

    const saved = await tx.examAnswer.findMany({ where: { examSessionId: sessionId } })
    const byQuestion = new Map<AnswerRow['questionId'], AnswerRow>(
      saved.map((answer) => [answer.questionId, answer]),
    )

    let correct = 0
    let wrong = 0
    let answered = 0
    let totalPoints = 0
    let marksObtained = 0
    const grading: Array<Promise<unknown>> = []

    for (const row of exam.questions) {
      const question = row.question
      const points = Number(row.points ?? question.points)
      totalPoints += points

      const answer = byQuestion.get(question.id)
      const hasAnswer =
        answer !== undefined &&
        (answer.selectedOptionId !== null ||
          (answer.textAnswer !== null && answer.textAnswer.trim() !== ''))

      if (question.type === 'SHORT_ANSWER') {
        // Graded by hand in a later phase; honest about being pending.
        if (hasAnswer) answered += 1
        continue
      }

      if (!hasAnswer) continue

      answered += 1
      let isCorrect = false
      if (question.type === 'TRUE_FALSE') {
        isCorrect = answer!.textAnswer?.trim().toUpperCase() === question.correctAnswer.trim().toUpperCase()
      } else {
        const option = question.options.find((o) => o.id === answer!.selectedOptionId)
        isCorrect = option !== undefined && option.label === question.correctAnswer.trim().toUpperCase()
      }

      if (isCorrect) {
        correct += 1
        marksObtained += points
      } else {
        wrong += 1
      }

      grading.push(
        tx.examAnswer.update({
          where: { id: answer!.id },
          data: {
            isCorrect,
            marksObtained: new Prisma.Decimal(isCorrect ? points : 0),
          },
        }),
      )
    }

    const percentage = totalPoints > 0 ? (marksObtained / totalPoints) * 100 : 0

    await Promise.all(grading)

    await tx.result.create({
      data: {
        sessionId: session.id,
        examId: exam.id,
        studentId: session.studentId,
        totalQuestions: exam.questions.length,
        answeredQuestions: answered,
        correctAnswers: correct,
        wrongAnswers: wrong,
        unanswered: exam.questions.length - answered,
        totalMarks: new Prisma.Decimal(totalPoints.toFixed(2)),
        marksObtained: new Prisma.Decimal(marksObtained.toFixed(2)),
        percentage: new Prisma.Decimal(percentage.toFixed(2)),
        passed: percentage >= Number(exam.passPercentage),
        timeSpentSeconds: Math.max(
          0,
          Math.round((submittedAt.getTime() - session.startedAt.getTime()) / 1000),
        ),
      },
    })

    await tx.examSession.update({
      where: { id: session.id },
      data: { status: finalStatus, submittedAt },
    })

    await recordAuditInTransaction(tx, {
      actorId: student?.userId ?? null,
      action: finalStatus === 'AUTO_SUBMITTED' ? AUDIT_ACTIONS.AUTO_SUBMIT_EXAM : AUDIT_ACTIONS.SUBMIT_EXAM,
      entity: 'ExamSession',
      entityId: session.id,
      description: `Submitted "${exam.title}" (${finalStatus === 'AUTO_SUBMITTED' ? 'time expired' : 'by candidate'})`,
      success: true,
    })
  })
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** The answer-key text shown on the candidate's own review (§32). */
function expectedAnswer(question: QuestionRow): string {
  if (question.type === 'SHORT_ANSWER') return question.correctAnswer
  if (question.type === 'TRUE_FALSE') {
    return question.correctAnswer.trim().toUpperCase() === 'TRUE' ? 'True' : 'False'
  }
  return (
    question.options.find((o) => o.label === question.correctAnswer.trim().toUpperCase())?.text ??
    question.correctAnswer
  )
}

export async function getResult(
  sessionId: string,
  user: AuthenticatedUser,
): Promise<StudentResultDto> {
  const student = await requireStudent(user)
  const session = await requireOwnedSession(sessionId, student.id)

  if (session.status === 'IN_PROGRESS') {
    if (new Date() > session.expiresAt) {
      await finalizeSession(session.id, 'AUTO_SUBMITTED')
    } else {
      throw ApiError.conflict('This examination has not been submitted yet')
    }
  }

  const exam = await requireExam(session.examId)
  const result = await prisma.result.findUnique({ where: { sessionId: session.id } })
  if (!result) {
    throw ApiError.notFound('Result is not available for this session')
  }

  // The instructor decides whether candidates may see the breakdown
  // (§32): while `showResultImmediately` is off, the graded paper is
  // withheld and only the attempt itself remains visible.
  if (!exam.showResultImmediately) {
    throw ApiError.forbidden('Results for this examination have not been released')
  }

  const saved = await prisma.examAnswer.findMany({ where: { examSessionId: session.id } })
  const byQuestion = new Map<AnswerRow['questionId'], AnswerRow>(
    saved.map((answer) => [answer.questionId, answer]),
  )

  // Review in the order the paper was actually delivered.
  const paper = (session.questionOrder as FrozenPaper | null) ?? {
    questions: exam.questions.map((row) => row.question.id),
    options: {},
  }

  const answers = paper.questions
    .map((questionId) => {
      const row = exam.questions.find((join) => join.question.id === questionId)
      if (!row) return null
      const question = row.question
      const answer = byQuestion.get(questionId)

      let yourAnswer = ''
      if (answer) {
        if (answer.selectedOptionId !== null) {
          yourAnswer = question.options.find((o) => o.id === answer.selectedOptionId)?.text ?? ''
        } else if (answer.textAnswer !== null) {
          yourAnswer = answer.textAnswer
        }
      }

      return {
        question: question.stem,
        yourAnswer,
        correctAnswer: expectedAnswer(question),
        isCorrect: answer?.isCorrect ?? false,
        points: Number(row.points ?? question.points),
      }
    })
    .filter((entry): entry is StudentResultDto['answers'][number] => entry !== null)

  return {
    sessionId: session.id,
    examTitle: exam.title,
    score: Number(result.marksObtained),
    totalPoints: Number(result.totalMarks),
    percentage: Number(result.percentage),
    passed: result.passed,
    passingScore: Number(exam.passPercentage),
    duration: `${Math.max(1, Math.round(result.timeSpentSeconds / 60))} min`,
    answers,
  }
}

/** The candidate's graded attempts, newest first. */
async function sessionsFor(student: StudentRow): Promise<StudentSessionSummary[]> {
  const sessions = await prisma.examSession.findMany({
    where: { studentId: student.id, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      examId: true,
      submittedAt: true,
      exam: { select: { title: true, showResultImmediately: true } },
      result: { select: { percentage: true, passed: true } },
    },
  })

  // A paper whose results are withheld still lists the attempt, but the
  // score is the instructor's to release, never the API's.
  return sessions.map((session) => ({
    id: session.id,
    examId: session.examId,
    examTitle: session.exam.title,
    percentage: session.exam.showResultImmediately
      ? session.result
        ? Number(session.result.percentage)
        : 0
      : null,
    passed: session.exam.showResultImmediately
      ? session.result
        ? session.result.passed
        : false
      : null,
    submittedAt: session.submittedAt?.toISOString(),
  }))
}

export async function mySessions(user: AuthenticatedUser): Promise<StudentSessionSummary[]> {
  return sessionsFor(await requireStudent(user))
}

// ---------------------------------------------------------------------------
// Exam browsing, profile and dashboard
// ---------------------------------------------------------------------------

export async function listStudentExams(
  user: AuthenticatedUser,
): Promise<StudentExamSummary[]> {
  const student = await requireStudent(user)
  const exams = await availableExamsFor(student, new Date())
  return exams.map(examSummary)
}

export async function getStudentExam(
  user: AuthenticatedUser,
  examId: string,
): Promise<StudentExamSummary> {
  const student = await requireStudent(user)
  const exam = await prisma.exam.findFirst({
    where: { id: examId, status: 'PUBLISHED', deletedAt: null },
    select: examPaperSelect,
  })
  if (!exam || !isDeliveredTo(exam, student, new Date())) {
    throw ApiError.notFound('Examination not found')
  }
  return examSummary(exam)
}

export async function getStudentProfile(user: AuthenticatedUser): Promise<StudentProfileDto> {
  const student = await requireStudent(user)
  return {
    id: student.id,
    userId: student.userId ?? '',
    matricNumber: student.studentId,
    name: `${student.firstName} ${student.lastName}`.trim(),
    program: student.program,
    level: student.level,
    semester: student.semester,
    className: student.className,
    email: student.email,
  }
}

export async function updateStudentProfile(
  user: AuthenticatedUser,
  input: { name: string },
): Promise<StudentProfileDto> {
  const student = await requireStudent(user)
  const [firstName, ...rest] = input.name.trim().split(/\s+/)
  await prisma.student.update({
    where: { id: student.id },
    data: { firstName, lastName: rest.join(' ') },
  })
  return getStudentProfile(user)
}

export async function getStudentDashboard(
  user: AuthenticatedUser,
): Promise<StudentDashboardDto> {
  const student = await requireStudent(user)
  const [available, sessions] = await Promise.all([
    availableExamsFor(student, new Date()),
    sessionsFor(student),
  ])

  // Only released scores count towards the average: a withheld paper
  // contributes its attempt to "completed" but not its score.
  const released = sessions.filter((session) => session.percentage !== null)
  const averageScore =
    released.length > 0
      ? Math.round(
          (released.reduce((sum, session) => sum + (session.percentage ?? 0), 0) /
            released.length) *
            100,
        ) / 100
      : 0

  return {
    totalExams: available.length,
    completedExams: sessions.length,
    averageScore,
    availableExams: available.map(examSummary),
    recentSessions: sessions.slice(0, 5).map((session) => ({
      id: session.id,
      examTitle: session.examTitle,
      percentage: session.percentage,
      passed: session.passed,
    })),
  }
}
