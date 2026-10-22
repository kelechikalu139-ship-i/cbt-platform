/**
 * Domain types for the CBT administration application.
 *
 * These mirror the API's actual responses, captured from the running backend
 * (`server/src/prisma/schema.prisma` and the service DTOs). Where the two
 * previously disagreed, the backend won: it is the implemented, tested and
 * security-reviewed side, and a type that drifts from the wire format is worse
 * than no type at all.
 *
 * Conventions
 * - IDs are opaque UUID strings.
 * - Timestamps are ISO-8601 strings on the wire, not `Date`, so a payload
 *   survives JSON round-tripping unchanged.
 * - Enums are UPPER_CASE exactly as the database stores them. Lowercase variants
 *   are NOT accepted: a silent case mismatch previously emptied the whole
 *   navigation, because permission lookups failed closed and returned nothing.
 * - Decimal columns (marks, percentages) arrive as JSON numbers.
 */

/* -------------------------------------------------------------------------- */
/* Roles, permissions and users                                               */
/* -------------------------------------------------------------------------- */

export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'EXAM_OFFICER',
  'LECTURER',
  'INVIGILATOR',
  'STUDENT',
] as const
export type Role = (typeof ROLES)[number]

/**
 * The server's 29 permissions, in `<resource>.<action>` form.
 *
 * Grants are read from `GET /auth/me` rather than reimplemented here. A client
 * copy of the grant matrix is a second source of truth that drifts from the seed
 * and silently grants or hides the wrong screens.
 */
export const PERMISSIONS = [
  'students.read',
  'students.create',
  'students.update',
  'students.delete',
  'categories.read',
  'categories.create',
  'categories.update',
  'categories.delete',
  'questions.read',
  'questions.create',
  'questions.update',
  'questions.delete',
  'exams.read',
  'exams.create',
  'exams.update',
  'exams.delete',
  'exams.publish',
  'sessions.read',
  'results.read',
  'results.export',
  'users.read',
  'users.create',
  'users.update',
  'users.delete',
  'audit.read',
  'system.read',
  'system.manage',
  'license.read',
  'license.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  EXAM_OFFICER: 'Exam Officer',
  LECTURER: 'Lecturer',
  INVIGILATOR: 'Invigilator',
  STUDENT: 'Student',
}

/** As returned by `GET /auth/me` and `GET /users`. */
export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  role: Role
  /** Present on the users list, absent on `/auth/me`. */
  roleName?: string
  status: EntityStatus
  /** Server-computed; a locked account cannot sign in. */
  isLocked?: boolean
  lastLoginAt: string | null
  /** Only present on `/auth/me`, for an account linked to a candidate record. */
  studentId?: string | null
  /** Authoritative permission list. Empty is possible for STUDENT. */
  permissions: Permission[]
  createdAt?: string
  updatedAt?: string
}

/**
 * Write payload for `POST /users`.
 *
 * Two deliberate differences from the read shape: the role is sent as `roleCode`
 * (the unique column on the role row, not the display `name`), and the enum
 * excludes `STUDENT` — a candidate's portal account is created as a side effect
 * of `POST /students`, never directly here, so this type cannot mint one.
 * `password` is write-only and never returned.
 */
export interface UserInput {
  email: string
  password?: string
  firstName: string
  lastName: string
  roleCode: Exclude<Role, 'STUDENT'>
  status: EntityStatus
}

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Account and record lifecycle states.
 *
 * `SUSPENDED` is a real backend state. `PENDING` is not: no server column holds
 * it, so accepting it here would let the UI offer a value the API rejects with a
 * 422.
 */
export type EntityStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

export interface Paginated<T> {
  data: T[]
  meta: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
}

export interface ApiEnvelope<T> {
  success: boolean
  data: T
  message?: string
}

export interface ApiErrorPayload {
  success: false
  message: string
  /** Field-level validation messages, keyed by field name. */
  errors?: Record<string, string[]>
}

export type SortOrder = 'asc' | 'desc'

export interface ListQuery {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: string
  sortOrder?: SortOrder
}

export interface StatusFilter {
  status?: EntityStatus | 'all'
}

/* -------------------------------------------------------------------------- */
/* Students                                                                    */
/* -------------------------------------------------------------------------- */

export const STUDENT_LEVELS = [100, 200, 300, 400, 500, 600, 700, 800] as const
export type StudentLevel = (typeof STUDENT_LEVELS)[number]

/**
 * A candidate record.
 *
 * `program` is the degree programme and is required server-side; `department` is
 * optional. There is no `registrationNumber`, `otherName` or `lastExamAt`
 * column — those existed only in the original frontend-only schema.
 *
 * Candidates do not self-register. An administrator creates the record and
 * optionally links it to a portal account, which is why the API exposes
 * `hasPortalAccount` on the detail view.
 */
export interface Student {
  id: string
  /** School-issued admission number, unique. The primary handle everywhere. */
  studentId: string
  firstName: string
  lastName: string
  fullName: string
  email: string | null
  program: string
  department: string | null
  level: StudentLevel
  semester: number
  className: string | null
  /** Academic session, e.g. "2026/2027". */
  session: string | null
  gender: string | null
  status: EntityStatus
  /** Detail view only: whether portal credentials have been issued. */
  hasPortalAccount?: boolean
  /** Detail & list view: whether the student currently has an active sign-in session. */
  hasActiveSession?: boolean
  createdAt: string
  updatedAt: string
}

export interface StudentFieldConfig {
  key: keyof Student
  label: string
  required: boolean
  visible: boolean
}

/**
 * Write payload for `POST /students`.
 *
 * Mirrors `createStudentSchema`. Candidates do not self-register: the optional
 * `userEmail`/`userPassword` pair creates a portal login for the record, and
 * omitting both means portal access is off rather than "pending".
 */
export interface StudentInput {
  studentId: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  gender?: string
  program: string
  department?: string
  level: number
  semester: number
  className?: string
  /** Academic session, e.g. "2026/2027". */
  session?: string
  status: EntityStatus
  userEmail?: string
  userPassword?: string
}

/* -------------------------------------------------------------------------- */
/* Categories and subjects                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The institution's academic vocabulary.
 *
 * Observed from the student register rather than a fixed catalogue, so
 * pickers offer what the school actually runs. Values a school uses but
 * has not registered yet are still typed by hand where a combobox is
 * used.
 */
export interface SchoolOptions {
  /** Programmes students are registered under, e.g. "Nursing". */
  programs: string[]
  /** Departments, e.g. "Health Sciences". */
  departments: string[]
  /** Class names, e.g. "NMR 100 - A". */
  classes: string[]
  /** Academic sessions, e.g. ["2026/2027"]. */
  sessions: string[]
  /** Levels in use, e.g. [100, 200]. */
  levels: number[]
  /** Semesters in use, e.g. [1, 2]. */
  semesters: number[]
}

/**
 * A question-bank category.
 *
 * The server models availability as `isActive` (boolean) rather than a status
 * enum, so there is no `status` field and no "archived" state to map.
 */
export interface Category {
  id: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  subjectCount: number
  questionCount: number
  createdAt: string
  updatedAt: string
  /** Detail view only. */
  subjects?: Subject[]
}

/** Write payload for `POST /categories`. */
export interface CategoryInput {
  name: string
  description?: string
  sortOrder?: number
  isActive?: boolean
}

/**
 * Write payload for `POST /subjects`.
 *
 * Deliberately asymmetric with `CategoryInput`: a subject's availability is a
 * `status` enum of only `ACTIVE`/`INACTIVE`, not an `isActive` boolean. That is
 * the server's model, so the two shapes are kept distinct rather than normalised
 * into something the API would reject.
 */
export interface SubjectInput {
  name: string
  categoryId: string
  code?: string
  status?: 'ACTIVE' | 'INACTIVE'
}

/** As returned by `GET /categories/subjects`. */
export interface Subject {
  id: string
  name: string
  code: string | null
  status: 'ACTIVE' | 'INACTIVE'
  categoryId: string
  categoryName: string
  questionCount: number
  createdAt: string
  updatedAt: string
}

/* -------------------------------------------------------------------------- */
/* Questions                                                                   */
/* -------------------------------------------------------------------------- */

export const QUESTION_TYPES = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: 'Multiple Choice',
  TRUE_FALSE: 'True / False',
  SHORT_ANSWER: 'Short Answer',
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
}

/**
 * A selectable option.
 *
 * There is no `isCorrect` flag. Correctness is held as a single answer key on
 * the question (`correctAnswer`, the option label for objective types), which is
 * what lets an exam snapshot freeze the key when the paper is published.
 */
export interface QuestionOption {
  id: string
  label: string
  text: string
  sortOrder: number
}

/** Lifecycle of a question in the bank. `INACTIVE` retires without deleting. */
export type QuestionStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT'

export interface Question {
  id: string
  type: QuestionType
  /** The question body. There is no separate `text` field. */
  stem: string
  explanation: string | null
  difficulty: Difficulty
  /** Marks awarded for a correct response. A `DecimalString`, e.g. `"1.5"`. */
  points: DecimalString
  /**
   * Answer key: an option label ("B") for objective types, or the accepted text
   * for SHORT_ANSWER.
   *
   * The student-facing API never returns this. The admin API does, because staff
   * must be able to see and edit the key.
   */
  correctAnswer: string
  status: QuestionStatus
  /** Comma-separated tag list. */
  tags: string | null
  /** How many published exams have used this question. */
  timesUsed: number
  categoryId: string
  categoryName: string
  subjectId: string
  subjectName: string
  options: QuestionOption[]
  createdAt: string
  updatedAt: string
}

/**
 * Write payload for `POST /questions`.
 *
 * A discriminated union mirroring `createQuestionSchema`, because the shape of the
 * answer key depends on the type: `MULTIPLE_CHOICE` requires an `options` array of
 * at least two entries and a `correctAnswer` naming one of their labels;
 * `TRUE_FALSE` takes no options and a `correctAnswer` of `'TRUE'`/`'FALSE'`; and
 * `SHORT_ANSWER` takes no options and free text. The server rejects a
 * `MULTIPLE_CHOICE` whose key matches no option, so the client cannot rely on the
 * server to catch a mismatched key after the fact.
 */
export type QuestionInput =
  | (QuestionBaseInput & {
      type: 'MULTIPLE_CHOICE'
      options: Array<{ label: string; text: string }>
      correctAnswer: string
    })
  | (QuestionBaseInput & { type: 'TRUE_FALSE'; correctAnswer: 'TRUE' | 'FALSE' })
  | (QuestionBaseInput & { type: 'SHORT_ANSWER'; correctAnswer: string })

interface QuestionBaseInput {
  categoryId: string
  subjectId: string
  stem: string
  explanation?: string
  difficulty: Difficulty
  /** Sent as a number; returned as a `DecimalString`. */
  points: number
  status: QuestionStatus
  tags?: string
}

/* -------------------------------------------------------------------------- */
/* Exams                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Exam lifecycle. `SCHEDULED` does not exist server-side: a paper with future
 * dates is still `DRAFT` or `PUBLISHED`, and its window is read from
 * `startAt`/`endAt`.
 */
export const EXAM_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ONGOING',
  'COMPLETED',
  'ARCHIVED',
] as const
export type ExamStatus = (typeof EXAM_STATUSES)[number]

export const EXAM_STATUS_LABELS: Record<ExamStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
}

export interface Exam {
  id: string
  title: string
  description: string | null
  instructions: string | null
  program: string | null
  department: string | null
  level: number | null
  semester: number | null
  /** Academic session this paper is set for; `null` means any cohort. */
  session: string | null
  /** Class names this paper is set for. */
  classes?: string[] | null
  /** Server-owned clock; the browser only renders a countdown. */
  durationMinutes: number
  /** Percentage required to pass. A `DecimalString`: `"50"`, not `50`. */
  passPercentage: DecimalString
  maxAttempts: number
  shuffleQuestions: boolean
  shuffleOptions: boolean
  showResultImmediately: boolean
  /**
   * Questions attached to this paper.
   *
   * `null` means every eligible question is used, and is only ever null when no
   * `questionIds` were supplied on create. The server always sets it to the
   * attached count on create, so in practice the detail view shows a number.
   */
  questionCount: number | null
  startAt: string | null
  endAt: string | null
  status: ExamStatus
  publishedAt: string | null
  createdById: string
  /** List view counters, resolved by the server. */
  attachedQuestions?: number
  sessionCount?: number
  resultCount?: number
  createdAt: string
  updatedAt: string
}

/**
 * A question attached to a paper, as returned by `GET /exams/:id`.
 *
 * `position` is the explicit paper order assigned server-side from the order of
 * `questionIds`; it is not editable independently. `points` is the marks this
 * exam awards, which falls back to the question's own points when not overridden
 * on the join row, so it is always present.
 */
export interface ExamQuestion {
  questionId: string
  position: number
  points: DecimalString
  stem: string
  type: QuestionType
  difficulty: Difficulty
  subjectId: string
  subjectName: string
}

/** `GET /exams/:id`: the exam plus its ordered paper. */
export interface ExamDetail extends Exam {
  questions: ExamQuestion[]
}

/**
 * Criteria that select questions from the bank by pool rather than by id.
 *
 * Sent as `questionFilter` on exam create/update; the server attaches
 * every eligible question matching all supplied criteria.
 */
export interface ExamQuestionFilter {
  categoryIds?: string[]
  subjectIds?: string[]
  types?: QuestionType[]
  difficulties?: Difficulty[]
}

/**
 * Write payload for `POST /exams`.
 *
 * Mirrors `createExamSchema`. `passPercentage` is sent as a number and comes back
 * as a `DecimalString`; `level` and `semester` accept `''` to mean "not set",
 * because the schema treats an empty string as null rather than a validation error.
 * `questionIds` is the whole paper: sending it replaces the join rows entirely.
 * `questionFilter` is the pool alternative: the server attaches every
 * eligible question it matches.
 */
export interface ExamInput {
  title: string
  description?: string
  instructions?: string
  program?: string
  department?: string
  level?: number | ''
  semester?: number | ''
  /**
   * Academic session, e.g. "2026/2027". When set, only candidates
   * registered in that session are delivered the paper.
   */
  session?: string
  /** Class names this paper is set for. */
  classes?: string[]
  durationMinutes: number
  passPercentage: number
  maxAttempts: number
  shuffleQuestions: boolean
  shuffleOptions: boolean
  showResultImmediately: boolean
  questionIds?: string[]
  questionFilter?: ExamQuestionFilter
  startAt?: string
  endAt?: string
}

/* -------------------------------------------------------------------------- */
/* Exam sessions (server-authoritative)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Session lifecycle.
 *
 * There is no `not_started`: a session row only exists once a candidate begins
 * an attempt. `ONGOING` is `IN_PROGRESS` on the wire.
 */
export const EXAM_SESSION_STATUSES = [
  'IN_PROGRESS',
  'SUBMITTED',
  'AUTO_SUBMITTED',
  'EXPIRED',
  'ABANDONED',
] as const
export type ExamSessionStatus = (typeof EXAM_SESSION_STATUSES)[number]

export const EXAM_SESSION_STATUS_LABELS: Record<ExamSessionStatus, string> = {
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  AUTO_SUBMITTED: 'Auto Submitted',
  EXPIRED: 'Expired',
  ABANDONED: 'Abandoned',
}

/**
 * `startedAt` / `expiresAt` are computed and stored server-side. The browser
 * receives them only to render a countdown; it can never extend them.
 */
export interface ExamSession {
  id: string
  examId: string
  examName: string
  studentId: string
  /** The school-issued admission number, distinct from the record id. */
  studentId_: string
  studentName: string
  status: ExamSessionStatus
  startedAt: string
  expiresAt: string
  submittedAt: string | null
  currentQuestionIndex: number
  /** Server-authoritative seconds remaining, recomputed on every read. */
  secondsRemaining: number
  /** Requests processed abnormally, used to flag suspicious traffic. */
  violations: number
  lastSeenAt: string
}

/** Answers are stored per session, separately from the question bank. */
export interface ExamAnswer {
  id: string
  examSessionId: string
  questionId: string
  selectedAnswer: string
  /** Determined by the server at save time. Never trusted from the client. */
  isCorrect: boolean
  marksAwarded: number
  answeredAt: string
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export type ResultGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export interface Result {
  id: string
  examSessionId: string
  examId: string
  examName: string
  studentId: string
  studentId_: string
  studentName: string
  className: string | null
  level: StudentLevel
  totalQuestions: number
  correctAnswers: number
  wrongAnswers: number
  unansweredQuestions: number
  totalMarks: number
  marksObtained: number
  percentage: number
  grade: ResultGrade
  passed: boolean
  timeSpentSeconds: number
  submittedAt: string
}

export interface StudentPerformance {
  studentId: string
  studentName: string
  examsTaken: number
  averageScore: number
  highestScore: number
  lowestScore: number
  passRate: number
  questionsAttempted: number
  questionsCorrect: number
  questionsIncorrect: number
}

export interface SubjectPerformance {
  subjectId: string
  subjectName: string
  categoryName: string
  averageScore: number
  attempts: number
  passRate: number
}

export interface ResultSummary {
  totalResults: number
  passed: number
  failed: number
  averageScore: number
  passRate: number
  gradeDistribution: Array<{ grade: string; count: number }>
  subjectPerformance: SubjectPerformance[]
}

/* -------------------------------------------------------------------------- */
/* Audit logs (append-only)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Audit actions are SCREAMING_SNAKE identifiers supplied by the server
 * (`GET /audit-logs/actions`), not a fixed client enum. Keeping this as `string`
 * means a new server-side action appears in the filter without a frontend
 * release.
 */
export type AuditAction = string

/** Friendly rendering; unknown identifiers fall back to their raw value. */
export function auditActionLabel(action: string): string {
  return action
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** As returned by `GET /audit-logs`. */
export interface AuditLog {
  id: string
  /** Null for an unauthenticated actor, e.g. a failed sign-in. */
  actorId: string | null
  actorEmail: string | null
  actorName: string | null
  action: AuditAction
  /** Resource the action touched, e.g. "EXAM". Free-form, not an enum. */
  entity: string | null
  entityId: string | null
  description: string | null
  /** Non-sensitive contextual detail. Never secrets, never answer keys. */
  metadata: Record<string, unknown> | null
  /** Client IP as seen by the server on the school LAN. */
  ipAddress: string | null
  success: boolean
  createdAt: string
}

/* -------------------------------------------------------------------------- */
/* System health                                                               */
/* -------------------------------------------------------------------------- */

export type HealthState = 'ok' | 'warn' | 'error' | 'unknown'

/**
 * `GET /health` — unauthenticated liveness.
 *
 * Deliberately minimal: the route is reachable without a token, so it exposes
 * nothing beyond "is the process up and can it reach the database". A bare
 * payload, not the `{ success, data }` envelope, and a **503 with this same body**
 * when the database is unreachable — a degraded database still means the process
 * is running, which is what a liveness probe needs to know.
 */
export interface HealthProbe {
  status: 'ok' | 'degraded'
  database: 'connected' | 'unavailable'
}

/**
 * `GET /system/status` — authenticated operational detail behind `system.read`.
 *
 * Reports port, uptime, node version and memory. No secrets, no resolved paths,
 * no environment values. `counts` is `null` when the database is unreachable,
 * which is distinct from "zero rows".
 */
export interface SystemStatus {
  application: string
  version: string
  status: 'online' | 'degraded'
  environment: string
  server: {
    port: number
    uptimeSeconds: number
    nodeVersion: string
    memoryUsageMb: number
  }
  database: 'connected' | 'unavailable'
  counts: { students: number; questions: number; exams: number; results: number } | null
  /** Machine identifier shown to administrators for support and licensing. */
  installationId: string | null
  timestamp: string
}

export interface LocalLicenseInfo {
  installationId: string
  status: 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED' | 'UNACTIVATED' | 'INVALID'
  plan: 'TRIAL' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE' | null
  expiresAt: string | null
  maxCandidates: number | null
  features: string[]
}

/**
 * School-wide settings.
 *
 * **No backend yet.** There is no `/system/settings` route, so this describes only
 * what the settings screen proposes. `systemApi.settings` throws `notYet` in live
 * mode, which is why nothing here may be presented as saved configuration.
 */
export interface SystemSettings {
    schoolName: string
    schoolShortName: string
    primaryColor?: string | null
  /** Logo served by the backend at /api/system/logo. */
  logoUrl: string | null
  defaultTimezone: string
  serverPort: number
  /** Where automated database backups are written on the server PC. */
  backupPath: string
  backupEnabled: boolean
  backupFrequencyHours: number
  backupRetentionDays: number
  startOnWindowsBoot: boolean
  sessionTimeoutMinutes: number
  maintenanceMode: boolean
}

/* -------------------------------------------------------------------------- */
/* Decimal columns                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A `Decimal` column as it arrives on the wire: a JSON **string**.
 *
 * Marks and percentages are stored as Prisma `Decimal`, which serialises as a
 * string to avoid binary floating-point drift. Treating these as `number` is
 * the trap — `"50"` + 1 is `"501"`, not 51, and `parseFloat` on a value that may
 * already be a number silently yields `NaN`. Use `toDecimalNumber` (in
 * `utils/format`) at the point of arithmetic or display.
 */
export type DecimalString = string

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Row counts computed by `GET /dashboard` in one server round trip.
 *
 * These are the exact fields the server emits. Sections the caller lacks
 * permission to see are reported as `0` rather than omitted.
 */
export interface DashboardCounters {
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
  /** Always counted today; session and grading analytics arrive in a later phase. */
  totalResults: number
  totalUsers: number
  /** Attempts in progress right now. */
  liveSessions: number
  /** Candidates holding a live portal sign-in. */
  signedInStudents: number
}
/**
 * One attempt in progress, as the live monitor and the dashboard see it.
 */
export interface LiveExamSession {
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
  answeredCount: number
  totalQuestions: number
  violationCount: number
  lastIpAddress: string | null
  lastSavedAt: string | null
}

/**
 * A candidate who has attempted a paper, for the reset-attempts dialog.
 */
export interface ExamAttemptSummary {
  studentRecordId: string
  admissionNumber: string
  studentName: string
  className: string | null
  attempts: number
  /** True while an attempt is still in progress. */
  isLive: boolean
  lastSubmittedAt: string | null
}

/**
 * The `upcomingExams` projection from `GET /dashboard`.
 *
 * Deliberately narrower than a full `Exam`: the aggregate selects only the
 * columns the landing panel renders, so `passPercentage` and `attachedQuestions`
 * are absent here even though the exam detail endpoint returns them.
 */
export interface DashboardUpcomingExam {
  id: string
  title: string
  program: string | null
  level: number | null
  semester: number | null
  durationMinutes: number
  startAt: string | null
  endAt: string | null
  status: ExamStatus
  questionCount: number | null
}

export interface DashboardSummary {
  counters: DashboardCounters
  /** Seven days of session activity, oldest first, for the activity chart. */
  recentActivity: Array<{ date: string; started: number; submitted: number }>
  /** `null` when the caller lacks `exams.read`, so the UI can tell it from "none". */
  upcomingExams: DashboardUpcomingExam[] | null
  /**
   * Live attempts, newest first. `[]` means nobody is writing (or the
   * caller lacks `exams.read` and the panel shows a permitted-empty state).
   */
  activeSessions: LiveExamSession[]
  /** Empty until grading lands; typed for the payload the server will send. */
  subjectPerformance: SubjectPerformance[]
  /** Always `null` until licensing lands. */
  license: null
  todayExams: number
  generatedAt: string
}

/**
 * One logical backup, as returned by `GET /system/backups`.
 *
 * `name` is the backup folder's timestamp; `path` is server-side only and is
 * not meaningful to the browser, but it is kept for parity with the server
 * payload.
 */
export interface BackupInfo {
  name: string
  path: string
  createdAt: string
  appVersion: string
  sizeBytes: number
  rowCounts: Record<string, number>
}

