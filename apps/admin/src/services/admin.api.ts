import type {
  AuditLog,
  Category,
  CategoryInput,
  DashboardSummary,
  Exam,
  ExamDetail,
  ExamInput,
  HealthProbe,
  ListQuery,
  Paginated,
  Question,
  QuestionInput,
  QuestionType,
  Role,
  SchoolOptions,
  Student,
  StudentInput,
  Subject,
  SubjectInput,
  SystemStatus,
  User,
  UserInput,
} from '../types'
import { http } from './http'

/**
 * Real implementations of the CBT admin API.
 *
 * One function per endpoint, grouped by resource. Every function returns the
 * domain type directly because `http` unwraps the response envelope.
 */

type Query = Record<string, string | number | boolean | undefined | null>

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Tokens returned by `POST /auth/login`.
 *
 * `user` is included so the UI can render the session immediately after
 * sign-in rather than issuing a second `/auth/me` round trip. `refreshToken` is
 * deliberately not stored anywhere in this layer: the admin UI is a
 * short-lived LAN tool, and the access token is re-issued by re-authenticating.
 */
export interface LoginResponse {
  user: User
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: string
}

export const realAuthApi = {
  me: () => http.get<User>('/auth/me'),
  /**
   * Staff sign-in.
   *
   * The backend identifies staff by email address, so the field the form calls
   * "Username or staff ID" is sent as `email`. The API returns the whole token
   * bundle, not a bare user, so the caller needs both halves.
   */
  login: (identifier: string, password: string) =>
    http.post<LoginResponse>('/auth/login', { email: identifier, password }),
  logout: () => http.post<void>('/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<void>('/auth/change-password', { currentPassword, newPassword }),
}

/* -------------------------------------------------------------------------- */
/* Dashboard and system                                                        */
/* -------------------------------------------------------------------------- */

export const realDashboardApi = {
  summary: () => http.get<DashboardSummary>('/dashboard'),
}

/**
 * `GET /health` is the only system-adjacent endpoint in this phase.
 *
 * It is mounted *outside* `authenticate`, so the health screen can report on a
 * server whose auth path is broken. There is no `/system/settings`,
 * `/system/access-urls` or `/system/restart` yet — those arrive with the settings
 * and licensing phases, so this client does not pretend they exist.
 */
export const realSystemApi = {
  /**
   * `GET /health` answers **503** when the database is unreachable, carrying the
   * same `{ status, database }` body.
   *
   * A plain `http.get` would throw on that status, which is exactly the moment the
   * health screen most needs to render. So the status is allowed through and the
   * body is read either way — the probe reports what it found instead of turning
   * a degraded server into a blank panel.
   */
  health: () => http.get<HealthProbe>('/health', { acceptStatuses: [503] }),
  /** Richer status card payload, behind `system.read`. */
  status: () => http.get<SystemStatus>('/system/status'),
}

/* -------------------------------------------------------------------------- */
/* Resources                                                                   */
/* -------------------------------------------------------------------------- */

export const realStudentsApi = {
  list: (
    query: ListQuery & {
      status?: string
      program?: string
      level?: number
      semester?: number
      className?: string
    } = {},
  ) => http.get<Paginated<Student>>('/students', { query: query as Query }),
  get: (id: string) => http.get<Student>(`/students/${id}`),
  create: (payload: StudentInput) => http.post<Student>('/students', payload),
  update: (id: string, payload: Partial<StudentInput>) =>
    http.patch<Student>(`/students/${id}`, payload),
  /**
   * Status is a field on the resource, so this is a PATCH to the same endpoint.
   * There is no `/students/:id/status` sub-resource on the server.
   */
  setStatus: (id: string, status: Student['status']) =>
    http.patch<Student>(`/students/${id}`, { status }),
  remove: (id: string) => http.delete<void>(`/students/${id}`),
  /** End a student's active session (forces sign-out on all devices). */
  endSession: (id: string) => http.post<void>(`/students/${id}/logout`),
    classes: () => http.get<string[]>('/students/classes'),

    /**
     * The school's academic vocabulary — programmes, departments, classes,
     * levels and semesters observed in the register — used by the pickers
     * when setting an examination.
     */
    options: () => http.get<SchoolOptions>('/students/options'),
  }

export const realQuestionsApi = {
  list: (
    query: ListQuery & {
      categoryId?: string
      subjectId?: string
      type?: QuestionType
      difficulty?: string
      status?: string
    } = {},
  ) => http.get<Paginated<Question>>('/questions', { query: query as Query }),
  get: (id: string) => http.get<Question>(`/questions/${id}`),
  create: (payload: QuestionInput) => http.post<Question>('/questions', payload),
  update: (id: string, payload: Partial<QuestionInput>) =>
    http.patch<Question>(`/questions/${id}`, payload),
  remove: (id: string) => http.delete<void>(`/questions/${id}`),
  bulkImport: (payload: {
    questions: Array<Record<string, unknown>>
    /** Create categories/subjects the file names but the bank lacks. */
    autoCreateTaxonomy?: boolean
  }) =>
    http.post<{ created: number; failed: Array<{ index: number; error: string }> }>('/questions/bulk', payload),
  /** Declared before `/:id` on the server so the literal path is not captured. */
  subjects: () => http.get<Subject[]>('/questions/subjects'),
}

export const realCategoriesApi = {
  list: (query: ListQuery = {}) => http.get<Paginated<Category>>('/categories', { query: query as Query }),
  create: (payload: CategoryInput) => http.post<Category>('/categories', payload),
  update: (id: string, payload: Partial<CategoryInput>) =>
    http.patch<Category>(`/categories/${id}`, payload),
  // Availability is a boolean on the server, not a status enum.
  setActive: (id: string, isActive: boolean) =>
    http.patch<Category>(`/categories/${id}`, { isActive }),
  remove: (id: string) => http.delete<void>(`/categories/${id}`),
  /** Subjects nested under categories, for filter convenience. */
  subjects: () => http.get<Subject[]>('/categories/subjects'),
}

export const realSubjectsApi = {
  create: (payload: SubjectInput) => http.post<Subject>('/subjects', payload),
  update: (id: string, payload: Partial<SubjectInput>) =>
    http.patch<Subject>(`/subjects/${id}`, payload),
  remove: (id: string) => http.delete<void>(`/subjects/${id}`),
}

export const realExamsApi = {
  list: (query: ListQuery & { status?: string; program?: string; level?: number; semester?: number } = {}) =>
    http.get<Paginated<Exam>>('/exams', { query: query as Query }),
  get: (id: string) => http.get<ExamDetail>(`/exams/${id}`),
  create: (payload: ExamInput) => http.post<Exam>('/exams', payload),
  update: (id: string, payload: Partial<ExamInput>) =>
    http.patch<Exam>(`/exams/${id}`, payload),
  remove: (id: string) => http.delete<{ id: string; deleted: true }>(`/exams/${id}`),
  /**
   * Publication is a separate audited action, not a status write.
   *
   * The server refuses to publish a paper with no questions, and refuses to
   * unpublish one that already has recorded attempts — both surface as 409, so
   * the caller's error handling has to show the server's message verbatim rather
   * than a generic failure.
   */
  publish: (id: string) => http.post<Exam>(`/exams/${id}/publish`),
  unpublish: (id: string) => http.post<Exam>(`/exams/${id}/unpublish`),
}

/**
 * Results and grading have no backend in this phase.
 *
 * There is no results router in `server/src/routes/index.ts` — grading belongs to
 * the exam-engine phase. So there is deliberately no `realResultsApi`: the results
 * screen runs off fixtures in mock mode only, and saying so on the screen is better
 * than shipping calls that 404 at runtime.
 */

export const realUsersApi = {
  /** The list filter is `roleCode`, matching the column's unique name, not `role`. */
  list: (query: ListQuery & { roleCode?: Role; status?: string } = {}) =>
    http.get<Paginated<User>>('/users', { query: query as Query }),
  create: (payload: UserInput) => http.post<User>('/users', payload),
  update: (id: string, payload: Partial<UserInput>) =>
    http.patch<User>(`/users/${id}`, payload),
  /**
   * Status is a field on the resource; there is no `/users/:id/status` endpoint.
   */
  setStatus: (id: string, status: User['status']) =>
    http.patch<User>(`/users/${id}`, { status }),
  remove: (id: string) => http.delete<void>(`/users/${id}`),
}

export const realAuditApi = {
  list: (
    query: ListQuery & { action?: string; entity?: string; actorId?: string } = {},
  ) => http.get<Paginated<AuditLog>>('/audit-logs', { query: query as Query }),
  /** Distinct action names, for the filter dropdown. Capped at 200 server-side. */
  actions: () => http.get<string[]>('/audit-logs/actions'),
}
