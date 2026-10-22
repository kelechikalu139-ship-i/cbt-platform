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
  LocalLicenseInfo,
  LiveExamSession,
  Paginated,
  Question,
  QuestionInput,
  QuestionType,
  Result,
  ResultSummary,
  Role,
  SchoolOptions,
  Student,
  StudentInput,
  StudentPerformance,
  Subject,
  SubjectInput,
  SystemSettings,
  SystemStatus,
  User,
  UserInput,
  BackupInfo,
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
  /**
   * One-time super administrator registration.
   *
   * Only available when no active super administrator exists. Returns the full
   * token bundle so the caller can sign in immediately.
   */
  register: (payload: {
    email: string
    password: string
    firstName: string
    lastName: string
  }) => http.post<LoginResponse>('/auth/register', payload),
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
  /** Signed local license status; activation keys are never returned by the API. */
  license: () => http.get<LocalLicenseInfo>('/system/license'),
  /** Activate with the one-time key; only a verified signed claim is persisted locally. */
  activateLicense: (activationKey: string) =>
    http.post<LocalLicenseInfo>('/system/license/activate', { activationKey }),
  /** Import an offline signed license file; the server verifies its signature and installation binding. */
  importLicense: (signedLicense: unknown) =>
    http.post<LocalLicenseInfo>('/system/license/import', { signedLicense }),
  /** System settings. */
  settings: () => http.get<SystemSettings>('/system/settings'),
  saveSettings: (patch: Partial<SystemSettings>) => http.patch<SystemSettings>('/system/settings', patch),
  /**
   * `POST /system/logo` — multipart upload of the institution logo.
   *
   * Returns the public URL the uploaded file is served at. The caller persists
   * it with `saveSettings`; the upload itself only stores the file.
   */
  uploadLogo: (file: File) => {
    const formData = new FormData()
    formData.append('logo', file)
    return http.post<{ logoUrl: string }>('/system/logo', formData)
  },
  /**
   * `POST /system/restart` — gracefully shut the server down so a supervisor
   * can start a fresh process. The server exits with code 0 after shutdown.
   */
  restartService: () => http.post<void>('/system/restart'),
  /** List every backup folder available on the server. */
  backups: () => http.get<BackupInfo[]>('/system/backups'),
  /** Create a new logical backup of every table. */
  backup: () => http.post<BackupInfo>('/system/backup', {}),
  /**
   * Restore a backup folder back into the database, replacing all current data.
   * `name` is the backup folder's timestamp from `backups()`.
   */
  restoreBackup: (name: string) => http.post<{ message: string }>('/system/restore', { name }),
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
  /**
   * Soft-delete every student matching a class name or an examination.
   * At least one of `className` or `examId` must be provided.
   */
  removeByFilter: (filter: { className?: string; examId?: string }) =>
    http.delete<{ deleted: number }>('/students/bulk', { body: filter }),
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
  /**
   * Soft-delete an exam even when it has student attempts.
   *
   * Unlike unpublish/delete, archiving is always allowed: the paper is
   * hidden from the active list but its results stay intact for reporting.
   */
  archive: (id: string) => http.post<{ id: string; archived: true }>(`/exams/${id}/archive`),

  /**
   * Attempts in progress right now. Polled by the live monitor, so the
   * response is capped by the server and safe to refresh on an interval.
   */
  liveSessions: (query: { examId?: string; limit?: number } = {}) =>
    http.get<LiveExamSession[]>('/exams/sessions/live', { query: query as Query }),

  /**
   * Close one candidate's live attempt early and grade what was answered.
   * Used when a device has died mid-exam or an invigilator ends the attempt.
   */
  forceSubmitSession: (sessionId: string, reason?: string) =>
    http.post<LiveExamSession | null>(`/exams/sessions/${sessionId}/force-submit`, {
      ...(reason ? { reason } : {}),
    }),

  /**
   * Wipe attempts on a paper so candidates can sit it again.
   *
   * With no student ids every attempt is reset; otherwise only the listed
   * admission numbers. Returns how many attempts were actually cleared.
   */
  resetAttempts: (examId: string, studentIds?: string[]) =>
    http.post<{ examTitle: string; resetStudents: number; resetAttempts: number }>(
      `/exams/${examId}/reset-attempts`,
      { ...(studentIds && studentIds.length > 0 ? { studentIds } : {}) },
    ),

  /**
   * Add extra time to a live examination session.
   *
   * Granted when a technical fault ate part of the sitting. The server clock
   * extends the deadline; the candidate's browser picks it up on the next poll.
   */
  extendSession: (sessionId: string, additionalMinutes: number) =>
    http.post<LiveExamSession | null>(
      `/exams/sessions/${sessionId}/extend-time`,
      { additionalMinutes },
    ),

  /**
   * Every candidate who has attempted a paper. The reset dialog lists
   * these so an invigilator picks names rather than typing them.
   */
  examAttempts: (examId: string) =>
    http.get<
      Array<{
        studentRecordId: string
        admissionNumber: string
        studentName: string
        className: string | null
        attempts: number
        isLive: boolean
        lastSubmittedAt: string | null
      }>
    >(`/exams/${examId}/attempts`),
}

/**
 * Real implementations of the results API, backed by the server's results router.
 */
export const realResultsApi = {
  /** Paginated list of all graded results. */
  list: (query: {
    page?: number
    limit?: number
    search?: string
    examId?: string
    studentId?: string
    passed?: 'all' | 'true' | 'false'
    grade?: 'all' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
    sort?: string
    order?: 'asc' | 'desc'
  } = {}) =>
    http.get<Paginated<Result>>('/results', { query: query as Query }),

  /** Aggregate summary: totals, pass rate, grade distribution, subject performance. */
  summary: () => http.get<ResultSummary>('/results/summary'),

  /** CSV export of every result. */
  exportCsv: () => http.get<string>('/results/export', { responseType: 'text' }),

  /** One result by id. */
  get: (id: string) => http.get<Result>(`/results/${id}`),

  /** Aggregate performance for one student across every exam they sat. */
  studentPerformance: (studentId: string) =>
    http.get<StudentPerformance>(`/results/students/${studentId}/performance`),
}

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
