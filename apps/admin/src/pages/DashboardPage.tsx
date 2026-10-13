import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileQuestion,
  Gauge,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type {
  DashboardCounters,
  DashboardUpcomingExam,
  SubjectPerformance,
} from '../types'
import {
  BarChart,
  Badge,
  EmptyState,
  ErrorState,
  HorizontalBarList,
  LoadingState,
  Panel,
  PanelBody,
  PanelHeader,
  StatCard,
  StatusBadge,
  PageHeader,
} from '../components/ui'

/* -------------------------------------------------------------------------- */
/* Presentation pieces                                                          */
/* -------------------------------------------------------------------------- */

/** Compact one-line activity bar for the last seven days. */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'narrow' })
}

function ExamRow({
  name,
  meta,
  trailing,
}: {
  name: string
  meta: string
  trailing: ReactNode
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-800">{name}</p>
        <p className="mt-0.5 truncate text-2xs text-slate-500">{meta}</p>
      </div>
      <div className="shrink-0">{trailing}</div>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export interface DashboardPageProps {
  summary: {
    counters: DashboardCounters
    recentActivity: Array<{ date: string; started: number; submitted: number }>
    /** `null` when the caller lacks `exams.read`. */
    upcomingExams: DashboardUpcomingExam[] | null
    /** Always empty until the exam engine lands. */
    activeSessions: readonly unknown[]
    /** Always empty until grading lands. */
    subjectPerformance: SubjectPerformance[]
  }
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

/**
 * Administration overview.
 *
 * Presentational by design: it receives data from the route element so the same
 * component works against the mock layer today and the real API unchanged.
 */
export function DashboardPage({ summary, loading = false, error = null, onRetry }: DashboardPageProps) {
  const c = summary?.counters

  if (error) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          description="Manage examinations, students and system configuration."
        />
        <Panel>
          <ErrorState title="Dashboard unavailable" message={error} onRetry={onRetry} />
        </Panel>
      </div>
    )
  }

  if (loading && !c) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          description="Manage examinations, students and system configuration."
        />
        <Panel>
          <LoadingState label="Loading dashboard…" rows={6} />
        </Panel>
      </div>
    )
  }

  const activity = summary.recentActivity ?? []
  const topSubjects = (summary.subjectPerformance ?? []).slice(0, 6)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description="Manage examinations, students and system configuration."
      />

      {/* Primary counters */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students"
          value={c?.totalStudents ?? 0}
          hint={`${c?.activeStudents ?? 0} active`}
          icon={Users}
          tone="brand"
        />
        <StatCard
          label="Questions"
          value={c?.totalQuestions ?? 0}
          hint={`${c?.activeQuestions ?? 0} active`}
          icon={FileQuestion}
          tone="violet"
        />
        <StatCard
          label="Exams"
          value={c?.totalExams ?? 0}
          hint={`${c?.publishedExams ?? 0} published · ${c?.draftExams ?? 0} draft`}
          icon={ClipboardList}
          tone="sky"
        />
        <StatCard
          label="Staff accounts"
          value={c?.totalUsers ?? 0}
          hint="With administrative access"
          icon={CheckCircle2}
          tone="emerald"
        />
      </div>

      {/* Examination counters */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Categories"
          value={c?.totalCategories ?? 0}
          hint="Question bank groupings"
          icon={Gauge}
          tone="brand"
        />
        <StatCard
          label="Subjects"
          value={c?.totalSubjects ?? 0}
          hint="Across all categories"
          icon={ClipboardList}
          tone="violet"
        />
        <StatCard
          label="Completed exams"
          value={c?.completedExams ?? 0}
          hint="Papers no longer live"
          icon={CalendarClock}
          tone="sky"
        />
        <StatCard
          label="Results"
          value={c?.totalResults ?? 0}
          hint="Grading arrives in a later phase"
          icon={TrendingUp}
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Activity */}
        <Panel className="xl:col-span-2">
          <PanelHeader
            title="Session activity"
            description="Exams started and submitted over the last seven days"
            actions={
              <Badge tone="neutral">
                {activity.reduce((sum, d) => sum + d.submitted, 0).toLocaleString()} submitted
              </Badge>
            }
          />
          <PanelBody>
            {activity.length === 0 ? (
              <EmptyState
                title="No sessions yet"
                description="Exams that students start will appear here."
              />
            ) : (
              <BarChart
                data={activity.map((d) => ({
                  label: dayLabel(d.date),
                  value: d.started,
                  secondary: d.submitted,
                }))}
              />
            )}
          </PanelBody>
        </Panel>

        {/* Results */}
        <Panel>
          <PanelHeader
            title="Results"
            actions={
              <Link
                to="/results"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Details
              </Link>
            }
          />
          <PanelBody flush>
            <ul className="divide-y divide-slate-100 px-5 py-1">
              <ExamRow
                name="Marked results"
                meta={`${c?.totalResults ?? 0} recorded`}
                trailing={
                  <Badge tone={(c?.totalResults ?? 0) > 0 ? 'success' : 'neutral'}>
                    {c?.totalResults ?? 0}
                  </Badge>
                }
              />
            </ul>
            <p className="px-5 pb-4 pt-1 text-2xs text-slate-400">
              Automatic grading and result publication arrive with the exam engine. The server
              reports the result count only.
            </p>
          </PanelBody>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Upcoming exams */}
        <Panel>
          <PanelHeader
            title="Upcoming examinations"
            actions={
              <Link to="/exams" className="text-xs font-medium text-brand-700 hover:underline">
                View all
              </Link>
            }
          />
          <PanelBody flush>
            {/* `null` means the caller lacks exams.read; that is different from "none". */}
            {summary.upcomingExams === null ? (
              <EmptyState
                title="Not permitted"
                description="Your role cannot read examinations, so this panel is withheld."
              />
            ) : summary.upcomingExams.length ? (
              <ul className="px-5 py-1">
                {summary.upcomingExams.map((exam) => (
                  <ExamRow
                    key={exam.id}
                    name={exam.title}
                    meta={`${exam.program ?? 'Programme not set'} · ${exam.durationMinutes} min · ${exam.questionCount ?? 0} questions`}
                    trailing={<StatusBadge status={exam.status} />}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No scheduled examinations"
                description="Publish an examination to see it here."
              />
            )}
          </PanelBody>
        </Panel>

        {/* Live sessions */}
        <Panel>
          <PanelHeader title="Live exam sessions" description="Students currently writing" />
          <PanelBody>
            <EmptyState
              title="Not available yet"
              description="Live session monitoring arrives with the exam engine. The server returns an empty list until then, so no candidates can be hidden from you by a stale figure."
            />
          </PanelBody>
        </Panel>
      </div>

      {/* Subject performance */}
      <Panel>
        <PanelHeader
          title="Performance by subject"
          description="Average score across completed examinations"
          actions={
            <Link to="/results" className="text-xs font-medium text-brand-700 hover:underline">
              Open reports
            </Link>
          }
        />
        <PanelBody>
          {topSubjects.length ? (
            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
              <HorizontalBarList
                items={topSubjects.map((s) => ({
                  label: s.subjectName,
                  value: Math.round(s.averageScore),
                  meta: `${s.categoryName} · ${s.attempts} submissions`,
                }))}
              />
            </div>
          ) : (
            <EmptyState
              title="No performance data yet"
              description="Subject averages arrive with grading; the server returns an empty list until then."
            />
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}
