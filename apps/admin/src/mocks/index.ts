import type {
  AuditLog,
  Category,
  CategoryInput,
  DashboardSummary,
  Exam,
  ExamDetail,
  HealthProbe,
  ListQuery,
  Paginated,
  Question,
  Result,
  SchoolOptions,
  Student,
  StudentPerformance,
  Subject,
  SubjectInput,
  SystemSettings,
  SystemStatus,
  User,
} from '../types'
import type { LoginResponse } from '../services/admin.api'
import { paginate, matchesSearch } from '../utils'
import * as fx from './fixtures'

/**
 * Mock implementations of every admin endpoint.
 *
 * Each returns the same unwrapped domain type as the real backend, so switching
 * `VITE_USE_MOCK` to false requires no page-level changes. Latency is simulated
 * so loading states are exercised during UI development.
 */

const LATENCY = 220

/* -------------------------------------------------------------------------- */
/* Filter shapes                                                               */
/* -------------------------------------------------------------------------- */

/** Query objects accepted by the mock list endpoints. */
type StudentQuery = ListQuery & { status?: string; level?: number; className?: string }
type QuestionQuery = ListQuery & {
  categoryId?: string
  subjectId?: string
  type?: string
  difficulty?: string
  status?: string
}
type ExamQuery = ListQuery & { status?: string; program?: string }
type ResultQuery = ListQuery & {
  examId?: string
  passed?: 'true' | 'false' | 'all'
  grade?: string
}
type UserQuery = ListQuery & { role?: string; status?: string }
type AuditQuery = ListQuery & { action?: string; entity?: string; actorId?: string }

/**
 * Simulated network latency.
 *
 * The mock resolves the *unwrapped* domain value, exactly as `http` does for the
 * real API. Callers therefore cannot tell the two apart, and `src/services`
 * needs no branching beyond which implementation it picks.
 */
function respond<T>(data: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), LATENCY))
}

function notFound<T>(resource: string): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(
      () => reject({ response: { status: 404, data: { success: false, message: `${resource} not found` } } }),
      LATENCY,
    ),
  )
}

/** `paginate` is generic over records; narrow the result back to the row type. */
const pageOf = <T,>(rows: T[], query: ListQuery): Paginated<T> =>
  paginate(rows as unknown as Array<Record<string, unknown>>, query) as unknown as Paginated<T>

/* -------------------------------------------------------------------------- */
/* Dashboard and system                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors `GET /dashboard` exactly, including the fields the server hardcodes to
 * empty in this phase. `activeSessions` and `subjectPerformance` are `[]` because
 * the exam engine and grading have not landed; `license` is `null` for the same
 * reason. Keeping the mock honest about those means the page renders identically
 * in both modes instead of mock mode promising panels the server will never send.
 */
export const mockDashboardApi = {
  summary: (): Promise<DashboardSummary> => {
    const upcoming = fx.getUpcomingExams()
    return respond({
      counters: fx.getDashboardCounters(),
      recentActivity: fx.getRecentActivity(),
      upcomingExams: upcoming.map((exam) => ({
        id: exam.id,
        title: exam.title,
        program: exam.program,
        level: exam.level,
        semester: exam.semester,
        durationMinutes: exam.durationMinutes,
        startAt: exam.startAt,
        endAt: exam.endAt,
        status: exam.status,
        questionCount: exam.questionCount,
      })),
      activeSessions: [],
      subjectPerformance: [],
      license: null,
      todayExams: fx.getDashboardCounters().publishedExams,
      generatedAt: new Date().toISOString(),
    })
  },
}

/**
 * `health` and `status` mirror the two real system endpoints.
 *
 * The richer `settings`, `saveSettings` and `accessUrls` entries have no server
 * counterpart yet; they exist only so the mock-only settings screen has something
 * to render. `systemApi` marks those `notYet` in live mode.
 */
export const mockSystemApi = {
  health: (): Promise<HealthProbe> =>
    respond({ status: 'ok', database: 'connected' }),

  status: (): Promise<SystemStatus> =>
    respond({
      application: fx.appName,
      version: fx.appVersion,
      status: 'online',
      environment: 'production',
      server: {
        port: fx.lan.port,
        uptimeSeconds: 4 * 3600 + 900,
        nodeVersion: 'v20.11.1',
        memoryUsageMb: 742,
      },
      database: 'connected',
      counts: {
        students: fx.students.length,
        questions: fx.questions.length,
        exams: fx.exams.length,
        results: fx.results.length,
      },
      timestamp: new Date().toISOString(),
    }),

  settings: (): Promise<SystemSettings> => respond(fx.settings),

  saveSettings: (patch: Partial<SystemSettings>): Promise<SystemSettings> =>
    respond({ ...fx.settings, ...patch }),

  /** The addresses an administrator hands out to students. */
  accessUrls: () =>
    respond({
      studentUrl: fx.getStudentUrl(),
      adminUrl: fx.getAdminUrl(),
      localUrl: `http://localhost:${fx.lan.port}/admin`,
      lanAddress: fx.lan.address,
      port: fx.lan.port,
    }),
}

/* -------------------------------------------------------------------------- */
/* Students                                                                    */
/* -------------------------------------------------------------------------- */

export const mockStudentsApi = {
  list: (query: StudentQuery = {}): Promise<Paginated<Student>> => {
    let rows = [...fx.students]
    if (query.status && query.status !== 'all') {
      rows = rows.filter((s) => s.status === query.status)
    }
    if (query.level) rows = rows.filter((s) => s.level === query.level)
    if (query.className) rows = rows.filter((s) => s.className === query.className)
    if (query.search) {
      // Mirrors the server's search scope: admission number, name, programme and
      // class. There is no registration number or other-name column to match.
      rows = rows.filter((s) =>
        matchesSearch(
          query.search!,
          s.studentId,
          s.firstName,
          s.lastName,
          s.email,
          s.program,
          s.className,
        ),
      )
    }
    return respond(pageOf(rows, query))
  },

  get: (id: string): Promise<Student> => {
    const found = fx.students.find((s) => s.id === id)
    return found ? respond(found) : notFound<Student>('Student')
  },

  classes: (): Promise<string[]> =>
    respond([...new Set(fx.students.map((s) => s.className).filter((c): c is string => !!c))].sort()),

  /** The mock register's academic vocabulary, mirroring the live endpoint. */
  options: (): Promise<SchoolOptions> =>
    respond({
      programs: [...new Set(fx.students.map((s) => s.program))].sort(),
      departments: [
        ...new Set(fx.students.map((s) => s.department).filter((d): d is string => !!d)),
      ].sort(),
      classes: [...new Set(fx.students.map((s) => s.className).filter((c): c is string => !!c))].sort(),
      sessions: [...new Set(fx.students.map((s) => s.session).filter((v): v is string => !!v))].sort(),
      levels: [...new Set(fx.students.map((s) => s.level))].sort((a, b) => a - b),
      semesters: [...new Set(fx.students.map((s) => s.semester))].sort((a, b) => a - b),
    }),

  endSession: (id: string): Promise<void> => {
    const found = fx.students.find((s) => s.id === id)
    if (!found) return notFound<void>('Student')
    // In mock mode, just toggle the flag
    found.hasActiveSession = false
    return respond(undefined)
  },
}

/* -------------------------------------------------------------------------- */
/* Questions                                                                   */
/* -------------------------------------------------------------------------- */

export const mockQuestionsApi = {
  list: (query: QuestionQuery = {}): Promise<Paginated<Question>> => {
    let rows = [...fx.questions]
    if (query.categoryId) rows = rows.filter((q) => q.categoryId === query.categoryId)
    if (query.subjectId) rows = rows.filter((q) => q.subjectId === query.subjectId)
    if (query.type) rows = rows.filter((q) => q.type === query.type)
    if (query.difficulty) rows = rows.filter((q) => q.difficulty === query.difficulty)
    if (query.status) rows = rows.filter((q) => q.status === query.status)
    if (query.search) {
      rows = rows.filter((q) =>
        matchesSearch(query.search!, q.stem, q.subjectName, q.categoryName, q.tags),
      )
    }
    return respond(
      pageOf(rows, query),
    )
  },

  get: (id: string): Promise<Question> => {
    const found = fx.questions.find((q) => q.id === id)
    return found ? respond(found) : notFound<Question>('Question')
  },

  create: (payload: Record<string, unknown>): Promise<Question> => {
    const inputOptions = Array.isArray(payload.options)
      ? (payload.options as Array<{ label: string; text: string }>)
      : []
    const options: Question['options'] = inputOptions.map((opt, j) => ({
      id: `opt-${String(fx.questions.length + 1).padStart(6, '0')}-${String.fromCharCode(65 + j)}`,
      label: opt.label,
      text: opt.text,
      sortOrder: j,
    }))
    const newQuestion: Question = {
      id: `que-${String(fx.questions.length + 1).padStart(6, '0')}`,
      categoryId: String(payload.categoryId),
      subjectId: String(payload.subjectId),
      type: String(payload.type) as Question['type'],
      stem: String(payload.stem),
      explanation: String(payload.explanation ?? ''),
      difficulty: String(payload.difficulty) as Question['difficulty'],
      points: String(Number(payload.points ?? 1)),
      correctAnswer: String(payload.correctAnswer),
      status: String(payload.status) as Question['status'],
      tags: String(payload.tags ?? ''),
      timesUsed: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      categoryName: fx.categories.find((c) => c.id === payload.categoryId)?.name ?? '',
      subjectName: fx.subjects.find((s) => s.id === payload.subjectId)?.name ?? '',
      options,
    }
    fx.questions.unshift(newQuestion)
    return respond(newQuestion)
  },

  update: (id: string, payload: Record<string, unknown>): Promise<Question> => {
    const index = fx.questions.findIndex((q) => q.id === id)
    if (index === -1) return notFound<Question>('Question')
    const updated = { ...fx.questions[index], ...payload, updatedAt: new Date().toISOString() }
    fx.questions[index] = updated
    return respond(updated)
  },

  remove: (id: string): Promise<void> => {
    const index = fx.questions.findIndex((q) => q.id === id)
    if (index === -1) return notFound<void>('Question')
    fx.questions.splice(index, 1)
    return respond(undefined as void)
  },

  bulkImport: (payload: { questions: Array<Record<string, unknown>> }): Promise<{ created: number; failed: Array<{ index: number; error: string }> }> => {
    const results = { created: 0, failed: [] as Array<{ index: number; error: string }> }
    payload.questions.forEach((row, i) => {
      try {
        const rawOptions = Array.isArray(row.options)
          ? (row.options as Array<{ label: string; text: string }>)
          : []
        const options: Question['options'] = rawOptions.map((opt, j) => ({
          id: `opt-${String(fx.questions.length + results.created + 1).padStart(6, '0')}-${String.fromCharCode(65 + j)}`,
          label: opt.label,
          text: opt.text,
          sortOrder: j,
        }))
        const newQuestion: Question = {
          id: `que-${String(fx.questions.length + results.created + 1).padStart(6, '0')}`,
          categoryId: String(row.categoryId),
          subjectId: String(row.subjectId),
          type: String(row.type) as Question['type'],
          stem: String(row.stem),
          explanation: String(row.explanation ?? ''),
          difficulty: String(row.difficulty) as Question['difficulty'],
          points: String(Number(row.points ?? 1)),
          correctAnswer: String(row.correctAnswer),
          status: String(row.status) as Question['status'],
          tags: String(row.tags ?? ''),
          timesUsed: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          categoryName: fx.categories.find((c) => c.id === row.categoryId)?.name ?? '',
          subjectName: fx.subjects.find((s) => s.id === row.subjectId)?.name ?? '',
          options,
        }
        fx.questions.unshift(newQuestion)
        results.created++
      } catch (error) {
        results.failed.push({ index: i + 1, error: error instanceof Error ? error.message : 'Unknown error' })
      }
    })
    return respond(results)
  },

  subjects: (): Promise<Subject[]> => respond(fx.subjects.filter((s) => s.status === 'ACTIVE')),
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

export const mockCategoriesApi = {
  list: (query: ListQuery = {}): Promise<Paginated<Category>> => {
    let rows = [...fx.categories]
    if (query.search) {
      rows = rows.filter((c) => matchesSearch(query.search!, c.name, c.description))
    }
    return respond(
      pageOf(rows, query),
    )
  },

  subjects: (): Promise<Subject[]> => respond(fx.subjects),

  create: (payload: CategoryInput): Promise<Category> => {
    const newCategory: Category = {
      id: `cat-${String(fx.categories.length + 1).padStart(3, '0')}`,
      name: payload.name,
      description: payload.description ?? null,
      sortOrder: payload.sortOrder ?? 0,
      isActive: payload.isActive ?? true,
      subjectCount: 0,
      questionCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fx.categories.push(newCategory)
    return respond(newCategory)
  },

  update: (id: string, payload: Partial<CategoryInput>): Promise<Category> => {
    const index = fx.categories.findIndex((c) => c.id === id)
    if (index === -1) return notFound<Category>('Category')
    const updated = { ...fx.categories[index], ...payload, updatedAt: new Date().toISOString() }
    fx.categories[index] = updated
    return respond(updated)
  },

  setActive: (id: string, isActive: boolean): Promise<Category> => {
    const index = fx.categories.findIndex((c) => c.id === id)
    if (index === -1) return notFound<Category>('Category')
    fx.categories[index].isActive = isActive
    fx.categories[index].updatedAt = new Date().toISOString()
    return respond(fx.categories[index])
  },

  remove: (id: string): Promise<void> => {
    const index = fx.categories.findIndex((c) => c.id === id)
    if (index === -1) return notFound<void>('Category')
    fx.categories.splice(index, 1)
    return respond(undefined as void)
  },
}

/* -------------------------------------------------------------------------- */
/* Exams                                                                       */
/* -------------------------------------------------------------------------- */

export const mockExamsApi = {
  list: (query: ExamQuery = {}): Promise<Paginated<Exam>> => {
    let rows = [...fx.exams]
    if (query.status && query.status !== 'all') rows = rows.filter((e) => e.status === query.status)
    // Exams no longer belong to a category; they target a programme and level.
    if (query.program) rows = rows.filter((e) => e.program === query.program)
    // The server searches title and description only, not programme.
    if (query.search) rows = rows.filter((e) => matchesSearch(query.search!, e.title, e.description))
    return respond(pageOf(rows, query))
  },

  /**
   * `GET /exams/:id` returns the exam *plus* its ordered paper, so the detail view
   * gets the questions it needs without a second request.
   */
  get: (id: string): Promise<ExamDetail> => {
    const found = fx.exams.find((e) => e.id === id)
    if (!found) return notFound<ExamDetail>('Exam')

    // The server assigns position from the order of `questionIds`, so the paper is
    // the pool filtered to this exam's subjects, in bank order.
    const paper = fx.questions
      .filter((q) => q.status === 'ACTIVE')
      .slice(0, found.questionCount ?? 10)
      .map((q, index) => ({
        questionId: q.id,
        position: index + 1,
        points: q.points,
        stem: q.stem,
        type: q.type,
        difficulty: q.difficulty,
        subjectId: q.subjectId,
        subjectName: q.subjectName,
      }))

    return respond({ ...found, questions: paper })
  },
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export const mockResultsApi = {
  list: (query: ResultQuery = {}): Promise<Paginated<Result>> => {
    let rows = [...fx.results]
    if (query.examId) rows = rows.filter((r) => r.examId === query.examId)
    if (query.passed && query.passed !== 'all') {
      rows = rows.filter((r) => String(r.passed) === query.passed)
    }
    if (query.grade) rows = rows.filter((r) => r.grade === query.grade)
    if (query.search) {
      rows = rows.filter((r) => matchesSearch(query.search!, r.studentName, r.studentId_, r.examName))
    }
    return respond(pageOf(rows, query))
  },

  get: (id: string): Promise<Result> => {
    const found = fx.results.find((r) => r.id === id)
    return found ? respond(found) : notFound<Result>('Result')
  },

  summary: () =>
    respond({
      totalResults: fx.results.length,
      passed: fx.results.filter((r) => r.passed).length,
      failed: fx.results.filter((r) => !r.passed).length,
      averageScore:
        Math.round(
          (fx.results.reduce((s, r) => s + r.percentage, 0) / fx.results.length) * 10,
        ) / 10,
      passRate: Math.round(
        (fx.results.filter((r) => r.passed).length / fx.results.length) * 1000,
      ) / 10,
      gradeDistribution: (['A', 'B', 'C', 'D', 'E', 'F'] as const).map((grade) => ({
        grade,
        count: fx.results.filter((r) => r.grade === grade).length,
      })),
      subjectPerformance: fx.getSubjectPerformance(),
    }),

  /** Aggregate performance for one student across every exam they sat. */
  studentPerformance: (studentId: string): Promise<StudentPerformance> =>
    respond((() => {
      const forStudent = fx.results.filter((r) => r.studentId === studentId)
      const scores = forStudent.map((r) => r.percentage)
      const correct = forStudent.reduce((s, r) => s + r.correctAnswers, 0)
      const attempted = forStudent.reduce((s, r) => s + r.totalQuestions - r.unansweredQuestions, 0)
      return {
        studentId,
        studentName: forStudent[0]?.studentName ?? '—',
        examsTaken: forStudent.length,
        averageScore: scores.length
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : 0,
        highestScore: scores.length ? Math.max(...scores) : 0,
        lowestScore: scores.length ? Math.min(...scores) : 0,
        passRate: forStudent.length
          ? Math.round((forStudent.filter((r) => r.passed).length / forStudent.length) * 1000) / 10
          : 0,
        questionsAttempted: attempted,
        questionsCorrect: correct,
        questionsIncorrect: attempted - correct,
      }
    })()),
}

/* -------------------------------------------------------------------------- */
/* Users and audit log                                                         */
/* -------------------------------------------------------------------------- */

export const mockUsersApi = {
  list: (query: UserQuery = {}): Promise<Paginated<User>> => {
    let rows = [...fx.users]
    if (query.role && query.role !== 'all') rows = rows.filter((u) => u.role === query.role)
    if (query.status && query.status !== 'all') rows = rows.filter((u) => u.status === query.status)
    if (query.search) {
      rows = rows.filter((u) => matchesSearch(query.search!, u.fullName, u.email))
    }
    return respond(pageOf(rows, query))
  },

  me: (): Promise<User> => respond(fx.currentUser),

  /**
   * Mirrors the real endpoint's contract: any non-empty identifier and password
   * resolve to the seeded admin so the UI can be exercised without a database.
   * A blank field still rejects, so required-field validation stays honest.
   *
   * Returns the same `{ user, accessToken, ... }` bundle as the real login, so
   * switching mock mode off cannot change how the caller behaves.
   */
  login: async (identifier: string, password: string): Promise<LoginResponse> => {
    await respond(undefined as void)
    if (!identifier.trim()) throw new Error('Enter your email address.')
    if (!password) throw new Error('Enter your password.')
    return {
      user: fx.currentUser,
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 900,
      tokenType: 'Bearer',
    }
  },

  logout: (): Promise<void> => respond(undefined as void),
}

export const mockSubjectsApi = {
  create: (payload: SubjectInput): Promise<Subject> => {
    const category = fx.categories.find((c) => c.id === payload.categoryId)
    if (!category) {
      return new Promise((_, reject) =>
        setTimeout(
          () => reject({ response: { status: 400, data: { success: false, message: 'Category not found' } } }),
          LATENCY,
        ),
      )
    }
    const newSubject: Subject = {
      id: `sub-${String(fx.subjects.length + 1).padStart(3, '0')}`,
      categoryId: payload.categoryId,
      categoryName: category.name,
      name: payload.name,
      code: payload.code ?? null,
      status: payload.status ?? 'ACTIVE',
      questionCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fx.subjects.push(newSubject)
    return respond(newSubject)
  },

  update: (id: string, payload: Partial<SubjectInput>): Promise<Subject> => {
    const index = fx.subjects.findIndex((s) => s.id === id)
    if (index === -1) return notFound<Subject>('Subject')
    const updated = { ...fx.subjects[index], ...payload, updatedAt: new Date().toISOString() }
    if (payload.categoryId) {
      const category = fx.categories.find((c) => c.id === payload.categoryId)
      if (category) updated.categoryName = category.name
    }
    fx.subjects[index] = updated
    return respond(updated)
  },

  remove: (id: string): Promise<void> => {
    const index = fx.subjects.findIndex((s) => s.id === id)
    if (index === -1) return notFound<void>('Subject')
    fx.subjects.splice(index, 1)
    return respond(undefined as void)
  },
}

export const mockAuditApi = {
  list: (query: AuditQuery = {}): Promise<Paginated<AuditLog>> => {
    let rows = [...fx.auditLogs]
    if (query.action) rows = rows.filter((a) => a.action === query.action)
    // `entity` is the server's resource label; `actorId` replaces the old `userId`.
    if (query.entity) rows = rows.filter((a) => a.entity === query.entity)
    if (query.actorId) rows = rows.filter((a) => a.actorId === query.actorId)
    if (query.search) {
      rows = rows.filter((a) =>
        matchesSearch(query.search!, a.description, a.actorName, a.actorEmail, a.ipAddress),
      )
    }
    return respond(pageOf(rows, query))
  },

  actions: (): Promise<string[]> =>
    respond([...new Set(fx.auditLogs.map((a) => a.action))]),
}
