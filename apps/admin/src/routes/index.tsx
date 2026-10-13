import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AdminLayout } from '../layouts/AdminLayout'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { DashboardPage } from '../pages/DashboardPage'
import { StudentsPage } from '../pages/students/StudentsPage'
import { QuestionsPage } from '../pages/questions/QuestionsPage'
import { CategoriesPage } from '../pages/categories/CategoriesPage'
import { ExamsPage } from '../pages/exams/ExamsPage'
import { ResultsPage } from '../pages/results/ResultsPage'
import { UsersPage } from '../pages/users/UsersPage'
import { AuditLogsPage } from '../pages/audit-logs/AuditLogsPage'
import { SystemHealthPage } from '../pages/system-health/SystemHealthPage'
import { SettingsPage } from '../pages/settings/SettingsPage'
import { useApiErrorMessage } from '../hooks/useApiErrorMessage'
import { useAuth } from '../store/auth'
import { USE_MOCK } from '../services'
import {
  auditApi,
  categoriesApi,
  dashboardApi,
  examsApi,
  questionsApi,
  resultsApi,
  studentsApi,
  systemApi,
  usersApi,
} from '../services'
import type { Permission, SystemStatus } from '../types'
import type { ReactNode } from 'react'

/* -------------------------------------------------------------------------- */
/* Permission gate                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Client-side gate that hides sections the current user cannot reach.
 *
 * This is presentation only. Every one of these routes is protected again by
 * the API, which is the actual boundary.
 */
function RequirePermission({
  permission,
  children,
}: {
  permission: Permission
  children: ReactNode
}) {
  const { can } = useAuth()
  if (!can(permission)) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * Session boundary for the whole application shell.
 *
 * Blocks every protected route until hydration finishes, then sends anonymous
 * visitors to the sign-in screen and remembers where they were headed. The
 * server re-checks the session on every API call; this only avoids rendering
 * chrome and firing doomed requests for a signed-out visitor.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isHydrated } = useAuth()
  const location = useLocation()

  if (!isHydrated) return <FullPageLoader />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950">
      <div className="flex items-center gap-3 text-sm text-ink-400">
        <Loader2 size={18} className="animate-spin" aria-hidden />
        Restoring session…
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Route elements                                                              */
/* -------------------------------------------------------------------------- */

function DashboardRoute() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.summary(),
  })
  const message = useApiErrorMessage(error)

  return (
    <DashboardPage
      summary={data ?? EMPTY_SUMMARY}
      loading={isPending}
      error={message}
      onRetry={() => void refetch()}
    />
  )
}

function StudentsRoute() {
  const query = useQuery({
    queryKey: ['students'],
    queryFn: () => studentsApi.list({ page: 1, pageSize: 20 }),
  })
  const classes = useQuery({
    queryKey: ['student-classes'],
    queryFn: () => studentsApi.classes(),
  })
  // The school's academic vocabulary: the add and edit dialogs offer
  // these as suggestions so programme, department, class and session
  // names stay uniform across the register.
  const schoolOptions = useQuery({
    queryKey: ['student-options'],
    queryFn: () => studentsApi.options(),
  })
  const message = useApiErrorMessage(query.error)

  return (
    <StudentsPage
      students={query.data?.data ?? []}
      meta={query.data?.meta ?? EMPTY_META}
      classNames={classes.data ?? []}
      schoolOptions={schoolOptions.data}
      loading={query.isPending}
      error={message}
      onRetry={() => void query.refetch()}
    />
  )
}

function QuestionsRoute() {
  const query = useQuery({
    queryKey: ['questions'],
    queryFn: () => questionsApi.list({ page: 1, pageSize: 20 }),
  })
  const subjects = useQuery({
    queryKey: ['question-subjects'],
    // `/categories/subjects` returns the full Subject rows the pages
    // render; `/questions/subjects` returns pool sizes for the builder.
    queryFn: () => categoriesApi.subjects(),
  })
  const categories = useQuery({
    queryKey: ['question-categories'],
    queryFn: () => categoriesApi.list({ page: 1, pageSize: 50 }),
  })
  const message = useApiErrorMessage(query.error)

  return (
    <QuestionsPage
      questions={query.data?.data ?? []}
      meta={query.data?.meta ?? EMPTY_META}
      subjects={subjects.data ?? []}
      categories={categories.data?.data ?? []}
      loading={query.isPending}
      error={message}
      onRetry={() => void query.refetch()}
    />
  )
}

function CategoriesRoute() {
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list({ page: 1, pageSize: 50 }),
  })
  const subjects = useQuery({
    queryKey: ['category-subjects'],
    queryFn: () => categoriesApi.subjects(),
  })
  const message = useApiErrorMessage(categories.error)

  return (
    <CategoriesPage
      categories={categories.data?.data ?? []}
      subjects={subjects.data ?? []}
      loading={categories.isPending}
      error={message}
      onRetry={() => void categories.refetch()}
    />
  )
}

function ExamsRoute() {
  const query = useQuery({
    queryKey: ['exams'],
    queryFn: () => examsApi.list({ page: 1, pageSize: 20 }),
  })
  const classes = useQuery({
    queryKey: ['student-classes'],
    queryFn: () => studentsApi.classes(),
  })
  // The school's academic vocabulary, offered as suggestions by the
  // editor's pickers (programme, department, level, semester, class).
  const schoolOptions = useQuery({
    queryKey: ['student-options'],
    queryFn: () => studentsApi.options(),
  })
  const categories = useQuery({
    queryKey: ['question-categories'],
    queryFn: () => categoriesApi.list({ page: 1, pageSize: 50 }),
  })
  const subjects = useQuery({
    queryKey: ['category-subjects'],
    queryFn: () => categoriesApi.subjects(),
  })
  const message = useApiErrorMessage(query.error)

  return (
    <ExamsPage
      exams={query.data?.data ?? []}
      meta={query.data?.meta ?? EMPTY_META}
      categories={categories.data?.data ?? []}
      subjects={subjects.data ?? []}
      classNames={classes.data ?? []}
      schoolOptions={schoolOptions.data}
      loading={query.isPending}
      error={message}
      onRetry={() => void query.refetch()}
    />
  )
}

function ResultsRoute() {
  const query = useQuery({
    queryKey: ['results'],
    queryFn: () => resultsApi.list({ page: 1, pageSize: 20 }),
  })
  const summary = useQuery({
    queryKey: ['results-summary'],
    queryFn: () => resultsApi.summary(),
  })
  const message = useApiErrorMessage(query.error)

  return (
    <ResultsPage
      results={query.data?.data ?? []}
      summary={summary.data ?? EMPTY_RESULTS_SUMMARY}
      meta={query.data?.meta ?? EMPTY_META}
      loading={query.isPending}
      error={message}
      onRetry={() => void query.refetch()}
    />
  )
}

function UsersRoute() {
  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list({ page: 1, pageSize: 20 }),
  })
  const message = useApiErrorMessage(query.error)

  return (
    <UsersPage
      users={query.data?.data ?? []}
      meta={query.data?.meta ?? EMPTY_META}
      loading={query.isPending}
      error={message}
      onRetry={() => void query.refetch()}
    />
  )
}

function AuditLogsRoute() {
  const query = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => auditApi.list({ page: 1, pageSize: 25 }),
  })
  const message = useApiErrorMessage(query.error)

  return (
    <AuditLogsPage
      logs={query.data?.data ?? []}
      meta={query.data?.meta ?? EMPTY_META}
      loading={query.isPending}
      error={message}
      onRetry={() => void query.refetch()}
    />
  )
}

/**
 * System health route.
 *
 * Two requests in live mode: `/health` (unauthenticated, tolerated 503) and
 * `/system/status` (authenticated, `system.read`). The health screen polls both
 * so an administrator watching an in-progress exam sees the database flicker from
 * connected to unavailable and back, rather than staring at a stale "ok".
 *
 * In mock mode the fixture supplies a single merged object to match the
 * presentational page's prop shape.
 */
function SystemHealthRoute() {
  // `/health` is unauthenticated and answers 503 with its body intact, so a
  // degraded database still renders instead of throwing. `/system/status` is the
  // richer, authenticated read. Health is polled so an administrator watching an
  // in-progress exam sees the database flicker between the two.
  const healthQuery = useQuery({
    queryKey: ['system-health'],
    queryFn: () => systemApi.health(),
    refetchInterval: 30_000,
  })
  const statusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: () => systemApi.status(),
    refetchInterval: 30_000,
  })
  const message = useApiErrorMessage(healthQuery.error ?? statusQuery.error)

  const status = USE_MOCK ? (healthQuery.data as unknown as SystemStatus) : statusQuery.data
  const health = USE_MOCK ? undefined : healthQuery.data

  return (
    <SystemHealthPage
      status={status ?? null}
      health={health ?? null}
      loading={healthQuery.isPending || statusQuery.isPending}
      error={message}
      onRetry={() => {
        void healthQuery.refetch()
        void statusQuery.refetch()
      }}
    />
  )
}

function SettingsRoute() {
  const query = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemApi.settings(),
  })
  const message = useApiErrorMessage(query.error)

  return (
    <SettingsPage
      settings={query.data ?? EMPTY_SETTINGS}
      loading={query.isPending}
      saving={false}
      error={message}
      onRetry={() => void query.refetch()}
      onSave={(patch) => {
        // Persisting settings needs the API; it lands with Phase 12.
        void patch
      }}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Route table                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every section is declared here with the permission that unlocks it, so the
 * navigation, routing and permission model stay in one readable place.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardRoute />} />

        <Route
          path="students"
          element={
            <RequirePermission permission="students.read">
              <StudentsRoute />
            </RequirePermission>
          }
        />
        <Route
          path="questions"
          element={
            <RequirePermission permission="questions.read">
              <QuestionsRoute />
            </RequirePermission>
          }
        />
        <Route
          path="categories"
          element={
            <RequirePermission permission="questions.read">
              <CategoriesRoute />
            </RequirePermission>
          }
        />
        <Route
          path="exams"
          element={
            <RequirePermission permission="exams.read">
              <ExamsRoute />
            </RequirePermission>
          }
        />
        <Route
          path="results"
          element={
            <RequirePermission permission="results.read">
              <ResultsRoute />
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission permission="users.read">
              <UsersRoute />
            </RequirePermission>
          }
        />
        <Route
          path="audit-logs"
          element={
            <RequirePermission permission="audit.read">
              <AuditLogsRoute />
            </RequirePermission>
          }
        />
        <Route
          path="system-health"
          element={
            <RequirePermission permission="system.read">
              <SystemHealthRoute />
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="system.manage">
              <SettingsRoute />
            </RequirePermission>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

/* -------------------------------------------------------------------------- */
/* Empty fallbacks                                                             */
/* -------------------------------------------------------------------------- */

const EMPTY_META = { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }

/**
 * Placeholder payloads shown while a query is in flight.
 *
 * These mirror the real response shapes exactly, including the fields the server
 * sends as empty or `null`. Using a shape that drifted from the API here would
 * hide a contract error behind a plausible-looking loading screen.
 */
const EMPTY_SUMMARY = {
  counters: {
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
  },
  recentActivity: [],
  // `[]`, not `null`: `null` is reserved for "caller lacks exams.read", which is a
  // settled answer rather than a pending one.
  upcomingExams: [],
  activeSessions: [],
  subjectPerformance: [],
  license: null,
  todayExams: 0,
  generatedAt: '',
}

const EMPTY_RESULTS_SUMMARY = {
  totalResults: 0,
  passed: 0,
  failed: 0,
  averageScore: 0,
  passRate: 0,
  gradeDistribution: [],
  subjectPerformance: [],
}

const EMPTY_SETTINGS = {
  schoolName: '',
  schoolShortName: '',
  logoUrl: null,
  defaultTimezone: 'Africa/Lagos',
  serverPort: 3000,
  backupPath: '',
  backupEnabled: false,
  backupFrequencyHours: 12,
  backupRetentionDays: 30,
  startOnWindowsBoot: false,
  sessionTimeoutMinutes: 30,
  maintenanceMode: false,
}
