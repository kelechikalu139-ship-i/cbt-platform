/**
 * Live end-to-end check of the student portal (§55):
 * sign-in by admission number, class-targeted delivery,
 * the frozen paper, answer saves, submission, grading,
 * the server clock, attempt limits and the dashboard.
 *
 * Run against a live API:  npx tsx scripts/portal-e2e.ts
 *
 * The run spends the seeded candidates' attempts on the
 * practice paper and renames a profile, so it is meant
 * for a freshly seeded database; it refuses to run twice.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { appendFileSync } from 'node:fs'

const log = (m: string) => appendFileSync('portal-e2e.log', `${m}\n`)

const BASE = 'http://127.0.0.1:5000/api/v1'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    log(`PASS  ${label}`)
  } else {
    failures += 1
    log(
      `FAIL  ${label}${
        detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''
      }`,
    )
  }
}

/** Every successful response is `{ success, data }`. */
interface Envelope<T> {
  success: boolean
  data?: T
}

interface LoginData {
  user: { student: { studentId: string } | null }
  accessToken: string
}

interface ExamSummary {
  id: string
  title: string
}

interface CategorySummary {
  id: string
  name: string
}

interface PaperQuestion {
  id: string
  type: string
  question: string
  options?: string[]
  points: number
  order: number
}

interface LiveSession {
  id: string
  exam: { id: string; title: string; duration: number }
  questions: PaperQuestion[]
  answers: Record<string, string>
  currentQuestion: number
  timeRemaining: number
  status: string
}

interface ResultAnswer {
  question: string
  yourAnswer: string
  correctAnswer: string
  isCorrect: boolean
  points: number
}

interface StudentResult {
  sessionId: string
  examTitle: string
  score: number
  totalPoints: number
  percentage: number
  passed: boolean
  passingScore: number
  answers: ResultAnswer[]
}

interface SessionSummary {
  id: string
  examTitle: string
  submittedAt: string
}

interface StudentProfile {
  matricNumber: string
  name: string
}

interface StudentDashboard {
  totalExams: number
  completedExams: number
  recentSessions: unknown[]
}

async function call<T>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: Envelope<T> | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: Envelope<T> | null = null
  try {
    data = (await res.json()) as Envelope<T>
  } catch {
    data = null
  }
  return { status: res.status, data }
}

// --- database access (to know the answer key and to backdate a clock) ---

if (!process.env.DATABASE_URL) {
  const { default: dotenv } = await import('dotenv')
  dotenv.config()
}
const url = new URL(process.env.DATABASE_URL ?? '')
const adapter = new PrismaMariaDb({
  host: url.hostname || '127.0.0.1',
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  connectionLimit: 3,
  prepareCacheLength: 0,
})
const prisma = new PrismaClient({ adapter })

async function main(): Promise<void> {
  // --- 1. administrator setup ------------------------------------------

  const admin = await call<LoginData>('POST', '/auth/login', undefined, {
    email: 'admin@cbt.local',
    password: 'Admin@12345',
  })
  check('admin signs in with email', admin.status === 200 && admin.data?.success === true)
  const adminToken = admin.data?.data?.accessToken
  if (!adminToken) {
    log('ERROR cannot continue without an administrator token')
    return
  }

  const examList = await call<ExamSummary[]>('GET', '/exams?limit=50', adminToken)
  const practice = (examList.data?.data ?? []).find(
    (e) => e.title === 'CBT Practice Paper — Introduction to Computing',
  )
  if (!practice) {
    check('practice paper listed for admin', false)
    log('ERROR cannot continue without the practice paper')
    return
  }
  check('practice paper listed for admin', true)

  // A second, short paper so the server clock can be
  // exercised without waiting out a real duration.
  const categories = await call<CategorySummary[]>(
    'GET',
    '/categories?limit=50',
    adminToken,
  )
  const math = (categories.data?.data ?? []).find(
    (c) => c.name === 'Mathematics',
  )
  if (!math) {
    check('Mathematics category listed for admin', false)
    log('ERROR cannot continue without the Mathematics category')
    return
  }
  check('Mathematics category listed for admin', true)

  // Refuse to run twice: the run spends the candidate's
  // attempts on the practice paper.
  const spent = await prisma.examSession.findFirst({
    where: {
      examId: practice.id,
      student: { studentId: 'CSC/2024/0001' },
      status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
    },
    select: { id: true },
  })
  if (spent) {
    log('SKIP  CSC/2024/0001 has already spent an attempt on the practice paper')
    log('      re-seed the database (npm run prisma:reset) before running again')
    console.log('Already run against this database — re-seed before re-running')
    return
  }

  // Target the practice paper at one class: unpublish,
  // retarget, republish (a published paper is immutable).
  await call('POST', `/exams/${practice.id}/unpublish`, adminToken)
  const retargeted = await call('PATCH', `/exams/${practice.id}`, adminToken, {
    classes: ['CSC 100 - A'],
  })
  check('retarget practice paper to CSC 100 - A', retargeted.status === 200)
  const republished = await call('POST', `/exams/${practice.id}/publish`, adminToken)
  check('republish practice paper', republished.status === 200)

  const second = await call<ExamSummary>('POST', '/exams', adminToken, {
    title: 'Portal Clock Test Paper',
    description: 'One-minute paper for verifying the server clock.',
    program: 'Computer Science',
    level: 100,
    semester: 1,
    classes: ['CSC 100 - A'],
    durationMinutes: 1,
    passPercentage: 50,
    maxAttempts: 1,
    shuffleQuestions: false,
    questionFilter: { categoryIds: [math.id] },
  })
  const secondId = second.data?.data?.id
  check('create second paper', second.status === 201 && secondId !== undefined)
  if (!secondId) {
    log('ERROR cannot continue without the second paper')
    return
  }
  const secondPublished = await call('POST', `/exams/${secondId}/publish`, adminToken)
  check('publish second paper', secondPublished.status === 200)

  // --- 2. candidate sign-in --------------------------------------------

  const wrongPassword = await call('POST', '/auth/login', undefined, {
    email: 'CSC/2024/0001',
    password: 'not-the-password',
  })
  check('wrong password refused', wrongPassword.status === 401)

  const unknownCandidate = await call('POST', '/auth/login', undefined, {
    email: 'CSC/9999/9999',
    password: 'whatever',
  })
  check('unknown admission number refused', unknownCandidate.status === 401)

  const student = await call<LoginData>('POST', '/auth/login', undefined, {
    email: 'CSC/2024/0001',
    password: 'Student@12345',
  })
  check(
    'candidate signs in with admission number',
    student.status === 200 && student.data?.success === true,
  )
  const studentToken = student.data?.data?.accessToken
  check(
    'sign-in returns the admission number',
    student.data?.data?.user.student?.studentId === 'CSC/2024/0001',
    student.data?.data?.user,
  )
  if (!studentToken) {
    log('ERROR cannot continue without a candidate token')
    return
  }

  const otherClass = await call<LoginData>('POST', '/auth/login', undefined, {
    email: 'CSC/2024/0003',
    password: 'Student@12345',
  })
  const otherClassToken = otherClass.data?.data?.accessToken
  check(
    'second class candidate signs in',
    otherClass.status === 200 && otherClassToken !== undefined,
  )

  // --- 3. delivery: only the set class sees the paper -----------------

  const myExams = await call<ExamSummary[]>('GET', '/portal/exams', studentToken)
  const myTitles = (myExams.data?.data ?? []).map((e) => e.title)
  check(
    'targeted candidate sees both papers',
    myTitles.includes('CBT Practice Paper — Introduction to Computing') &&
      myTitles.includes('Portal Clock Test Paper'),
    myTitles,
  )

  const theirExams = await call<ExamSummary[]>('GET', '/portal/exams', otherClassToken)
  check(
    'other class candidate sees no papers',
    Array.isArray(theirExams.data?.data) && theirExams.data.data.length === 0,
    theirExams.data?.data,
  )

  const theirDetail = await call('GET', `/portal/exams/${practice.id}`, otherClassToken)
  check('paper detail hidden from other class', theirDetail.status === 404)

  const detail = await call<LiveSession['exam'] & {
    totalQuestions: number
    passingScore: number
  }>('GET', `/portal/exams/${practice.id}`, studentToken)
  const detailData = detail.data?.data
  check(
    'paper detail for the set class',
    detail.status === 200 &&
      detailData?.totalQuestions === 5 &&
      detailData?.duration === 30 &&
      detailData?.passingScore === 50,
    detailData,
  )

  // --- 4. starting a session: the frozen paper -------------------------

  const started = await call<LiveSession>('POST', '/portal/sessions/start', studentToken, {
    examId: practice.id,
  })
  const sessionId = started.data?.data?.id
  check('session started', started.status === 201 && sessionId !== undefined, started.data)
  if (!sessionId) {
    log('ERROR cannot continue without a session')
    return
  }
  const questions = started.data?.data?.questions ?? []
  check('paper carries five questions', questions.length === 5)
  check(
    'questions carry no answer key',
    questions.every((q) => !('correctAnswer' in q)),
    questions[0],
  )
  check(
    'options are plain texts',
    questions.filter((q) => q.options).every((q) => q.options?.every((o) => typeof o === 'string')),
  )
  const timeRemaining = started.data?.data?.timeRemaining ?? 0
  check(
    'clock is running',
    timeRemaining > 0 && timeRemaining <= 1800,
    timeRemaining,
  )
  check('status is in_progress', started.data?.data?.status === 'in_progress')

  // The paper is frozen: a re-read serves the same order.
  const reread = await call<LiveSession>('GET', `/portal/sessions/${sessionId}`, studentToken)
  check(
    'paper order is frozen across reads',
    JSON.stringify((reread.data?.data?.questions ?? []).map((q) => q.id)) ===
      JSON.stringify(questions.map((q) => q.id)),
  )

  // --- 5. answering ----------------------------------------------------

  const paper = await prisma.exam.findUnique({
    where: { id: practice.id },
    select: {
      questions: {
        orderBy: { position: 'asc' },
        select: {
          position: true,
          points: true,
          question: {
            select: {
      id: true,
      stem: true,
      points: true,
      correctAnswer: true,
      type: true,
      options: { select: { id: true, label: true, text: true } },
            },
          },
        },
      },
    },
  })
  const rows = paper?.questions ?? []
  const totalPoints = rows.reduce(
    (sum, row) => sum + Number(row.points ?? row.question.points),
    0,
  )

  // Only questions that render options can be answered by
  // text; short-answer questions are graded by hand.
  const answerable = rows.filter((row) => row.question.options.length > 0)
  if (answerable.length < 2) {
    check('paper carries two answerable questions', false)
    log('ERROR cannot continue without two answerable questions')
    return
  }
  check('paper carries two answerable questions', true)

  const firstRow = answerable[0]
  const secondRow = answerable[1]
  const first = firstRow.question
  const secondQuestion = secondRow.question
  const expectedMarks = Number(firstRow.points ?? first.points)
  const correctOption = first.options.find((o) => o.label === first.correctAnswer)
  const wrongOption = first.options.find((o) => o.label !== first.correctAnswer)
  const secondCorrect = secondQuestion.options.find(
    (o) => o.label === secondQuestion.correctAnswer,
  )
  const secondWrong = secondQuestion.options.find(
    (o) => o.label !== secondQuestion.correctAnswer,
  )
  if (!correctOption || !wrongOption || !secondCorrect || !secondWrong) {
    check('answer options loaded for both questions', false)
    log('ERROR cannot continue without the answer options')
    return
  }
  check('answer options loaded for both questions', true)

  const saveBad = await call(
    'POST',
    `/portal/sessions/${sessionId}/answer`,
    studentToken,
    { questionId: first.id, answer: 'Not an option of this question' },
  )
  check('an option that does not exist is rejected', saveBad.status === 400, saveBad.data)

  const saveFirst = await call(
    'POST',
    `/portal/sessions/${sessionId}/answer`,
    studentToken,
    { questionId: first.id, answer: correctOption.text },
  )
  check('first answer saved', saveFirst.status === 200, saveFirst.data)

  // Overwrite with a wrong option: the last save wins.
  const overwrite = await call(
    'POST',
    `/portal/sessions/${sessionId}/answer`,
    studentToken,
    { questionId: first.id, answer: wrongOption.text },
  )
  check('answer overwrite accepted', overwrite.status === 200)

  // Restore the correct answer so the expected score is deterministic.
  await call('POST', `/portal/sessions/${sessionId}/answer`, studentToken, {
    questionId: first.id,
    answer: correctOption.text,
  })

  // Second question: answer it wrongly; the rest stay unanswered.
  await call('POST', `/portal/sessions/${sessionId}/answer`, studentToken, {
    questionId: secondQuestion.id,
    answer: secondWrong.text,
  })

  const withAnswers = await call<LiveSession>(
    'GET',
    `/portal/sessions/${sessionId}`,
    studentToken,
  )
  const savedAnswers = withAnswers.data?.data?.answers ?? {}
  check(
    'saved answers are served back',
    savedAnswers[first.id] === correctOption.text &&
      savedAnswers[secondQuestion.id] === secondWrong.text,
    savedAnswers,
  )

  // --- 6. submission and grading ---------------------------------------

  const submitted = await call<StudentResult>(
    'POST',
    `/portal/sessions/${sessionId}/submit`,
    studentToken,
  )
  check('exam submitted', submitted.status === 200, submitted.data)

  const again = await call<{ sessionId: string }>(
    'POST',
    `/portal/sessions/${sessionId}/submit`,
    studentToken,
  )
  check(
    'double submit is idempotent',
    again.status === 200 && again.data?.data?.sessionId === sessionId,
    again.data,
  )

  const result = await call<StudentResult>(
    'GET',
    `/portal/sessions/${sessionId}/result`,
    studentToken,
  )
  const resultData = result.data?.data
  check('result available after submit', result.status === 200 && resultData !== undefined, result.data)
  if (!resultData) {
    log('ERROR cannot continue without a result')
    return
  }
  const expectedPercentage = Math.round((expectedMarks / totalPoints) * 10000) / 100
  check(
    'graded against the answer key',
    resultData.score === expectedMarks &&
      resultData.totalPoints === totalPoints &&
      resultData.percentage === expectedPercentage,
    { got: resultData, expected: { expectedMarks, totalPoints, expectedPercentage } },
  )
  check(
    'pass/fail against the pass mark',
    resultData.passed === (expectedPercentage >= 50) && resultData.passingScore === 50,
    resultData,
  )
  check(
    'review covers every question of the paper',
    rows.every((row) =>
      resultData.answers.some((a) => a.question === row.question.stem),
    ),
    resultData.answers.map((a) => a.question.slice(0, 30)),
  )
  const reviewForSecond = resultData.answers.find(
    (a) => a.question === secondQuestion.stem,
  )
  check(
    'review shows the correct answer for a wrong response',
    reviewForSecond !== undefined &&
      reviewForSecond.isCorrect === false &&
      reviewForSecond.correctAnswer === secondCorrect.text,
    reviewForSecond,
  )

  // The audit trail records the candidate's user
  // account as the actor, not the student record.
  const candidateAccount = await prisma.student.findUnique({
    where: { studentId: 'CSC/2024/0001' },
    select: { userId: true },
  })
  for (const action of ['START_EXAM_SESSION', 'SUBMIT_EXAM']) {
    const entry = await prisma.auditLog.findFirst({
      where: { action, entity: 'ExamSession', entityId: sessionId },
      orderBy: { createdAt: 'desc' },
      select: { actorId: true, success: true },
    })
    check(
      `${action.toLowerCase()} audited under the candidate account`,
      entry !== null && entry.actorId === candidateAccount?.userId,
      entry,
    )
  }

  // --- 7. attempt limit --------------------------------------------------

  const retry = await call('POST', '/portal/sessions/start', studentToken, {
    examId: practice.id,
  })
  check('exhausted attempts refused', retry.status === 403, retry.data)

  // --- 8. the server clock: expiry auto-submits --------------------------

  const clockStarted = await call<LiveSession>('POST', '/portal/sessions/start', studentToken, {
    examId: secondId,
  })
  const clockSessionId = clockStarted.data?.data?.id
  check('clock paper started', clockStarted.status === 201 && clockSessionId !== undefined, clockStarted.data)
  if (!clockSessionId) {
    log('ERROR cannot continue without the clock session')
    return
  }

  // Move the deadline into the past, as if the timer ran out.
  await prisma.examSession.update({
    where: { id: clockSessionId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  })

  const expired = await call<LiveSession>('GET', `/portal/sessions/${clockSessionId}`, studentToken)
  check(
    'expired session auto-submits',
    expired.status === 200 && expired.data?.data?.status === 'auto_submitted',
    expired.data?.data?.status,
  )

  const expiredResult = await call<StudentResult>(
    'GET',
    `/portal/sessions/${clockSessionId}/result`,
    studentToken,
  )
  check('expired session graded', expiredResult.status === 200, expiredResult.data)
  check(
    'unanswered paper scores zero',
    expiredResult.data?.data?.score === 0 && expiredResult.data?.data?.percentage === 0,
    expiredResult.data?.data,
  )

  const lateSave = await call(
    'POST',
    `/portal/sessions/${clockSessionId}/answer`,
    studentToken,
    { questionId: first.id, answer: correctOption.text },
  )
  check(
    'answers after expiry refused',
    lateSave.status === 409 || lateSave.status === 400,
    lateSave.status,
  )

  // --- 9. history, profile and dashboard ----------------------------------

  const mine = await call<SessionSummary[]>('GET', '/portal/sessions/mine', studentToken)
  const mySessions = mine.data?.data ?? []
  check(
    'session history lists both attempts',
    mySessions.length === 2 && mySessions.every((s) => s.submittedAt),
    mySessions,
  )

  const profile = await call<StudentProfile>('GET', '/portal/me', studentToken)
  check(
    'profile carries the admission number',
    profile.status === 200 && profile.data?.data?.matricNumber === 'CSC/2024/0001',
    profile.data?.data,
  )

  const renamed = await call<StudentProfile>('PUT', '/portal/me', studentToken, {
    name: 'Adaeze N. Okonkwo',
  })
  check(
    'profile name updated',
    renamed.status === 200 && renamed.data?.data?.name === 'Adaeze N. Okonkwo',
    renamed.data?.data,
  )

  const dashboard = await call<StudentDashboard>('GET', '/portal/dashboard', studentToken)
  const dashboardData = dashboard.data?.data
  check(
    'dashboard aggregates',
    dashboard.status === 200 &&
      dashboardData?.completedExams === 2 &&
      dashboardData?.totalExams === 0 &&
      dashboardData?.recentSessions.length === 2,
    dashboardData,
  )

  // --- 10. ownership -------------------------------------------------------

  const foreignCandidate = await call('GET', `/portal/sessions/${sessionId}`, otherClassToken)
  check('session hidden from another candidate', foreignCandidate.status === 404)

  log('')
  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
}

main()
  .catch((error: unknown) => {
    log(`ERROR ${(error as Error).stack}`)
    console.error('E2E failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
