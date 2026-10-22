import { Download, FileText, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  DataTable,
  ErrorState,
  FilterSelect,
  HorizontalBarList,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  PanelBody,
  PanelHeader,
  PhaseNotice,
  ResultCount,
  SearchBar,
  StatusBadge,
  StatCard,
  Toolbar,
  ToolbarGroup,
  type Column,
} from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useTableState } from '../../hooks/useTableState'
import type { Result } from '../../types'
import { formatDateTime, formatDuration, formatNumber } from '../../utils'

interface ResultsPageProps {
  results: Result[]
  summary: {
    totalResults: number
    passed: number
    failed: number
    averageScore: number
    passRate: number
    gradeDistribution: Array<{ grade: string; count: number }>
    subjectPerformance: Array<{
      subjectId: string
      subjectName: string
      categoryName: string
      averageScore: number
      attempts: number
      passRate: number
    }>
  }
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number }
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onExport?: () => void
}

const GRADE_TONE: Record<string, 'success' | 'brand' | 'warning' | 'danger' | 'neutral'> = {
  A: 'success',
  B: 'brand',
  C: 'warning',
  D: 'warning',
  E: 'warning',
  F: 'danger',
}

/**
 * Results and reports.
 *
 * Grading figures come from the server's stored result records — this page only
 * displays them. Export, PDF and print land with the reporting phase.
 */
export function ResultsPage({
  results,
  summary,
  meta,
  loading = false,
  error = null,
  onRetry,
  onExport,
}: ResultsPageProps) {
  const table = useTableState<{ outcome: string; grade: string }>({ outcome: 'all', grade: 'all' })
  const [search, setSearch] = useState('')
  const [printResult, setPrintResult] = useState<Result | null>(null)
  const debounced = useDebouncedValue(search, 300)

  const visible = useMemo(() => {
    const term = debounced.trim().toLowerCase()
    return results.filter((r) => {
      const f = table.state.filters
      if (f.outcome === 'passed' && !r.passed) return false
      if (f.outcome === 'failed' && r.passed) return false
      if (f.grade !== 'all' && r.grade !== f.grade) return false
      if (!term) return true
      return [r.studentName, r.studentId_, r.examName].some((v) =>
        String(v ?? '').toLowerCase().includes(term),
      )
    })
  }, [results, debounced, table.state.filters])

  const columns: Array<Column<Result>> = [
    {
      key: 'studentName',
      header: 'Student',
      sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{r.studentName}</p>
          <p className="tabular truncate text-2xs text-slate-500">{r.studentId_}</p>
        </div>
      ),
    },
    {
      key: 'examName',
      header: 'Examination',
      hideBelow: 'lg',
      cell: (r) => <span className="line-clamp-1 text-slate-600">{r.examName}</span>,
    },
    {
      key: 'className',
      header: 'Class',
      width: 'w-40',
      hideBelow: 'xl',
      cell: (r) => <span className="text-slate-600">{r.className ?? '—'}</span>,
    },
    {
      key: 'correctAnswers',
      header: 'Correct',
      width: 'w-28',
      align: 'right',
      hideBelow: 'md',
      sortable: true,
      cell: (r) => (
        <div>
          <p className="tabular font-medium text-slate-800">
            {r.correctAnswers}/{r.totalQuestions}
          </p>
          <p className="tabular text-2xs text-slate-400">
            {r.unansweredQuestions} blank
          </p>
        </div>
      ),
    },
    {
      key: 'marksObtained',
      header: 'Marks',
      width: 'w-24',
      align: 'right',
      hideBelow: 'sm',
      cell: (r) => (
        <span className="tabular text-slate-600">
          {r.marksObtained}/{r.totalMarks}
        </span>
      ),
    },
    {
      key: 'percentage',
      header: 'Score',
      width: 'w-24',
      align: 'right',
      sortable: true,
      cell: (r) => (
        <span
          className={`tabular font-semibold ${r.passed ? 'text-emerald-700' : 'text-red-700'}`}
        >
          {r.percentage}%
        </span>
      ),
    },
    {
      key: 'grade',
      header: 'Grade',
      width: 'w-20',
      align: 'center',
      sortable: true,
      hideBelow: 'sm',
      cell: (r) => <Badge tone={GRADE_TONE[r.grade] ?? 'neutral'} dot={false}>{r.grade}</Badge>,
    },
    {
      key: 'timeSpentSeconds',
      header: 'Time',
      width: 'w-24',
      align: 'right',
      hideBelow: 'xl',
      cell: (r) => (
        <span className="tabular text-slate-500">{formatDuration(r.timeSpentSeconds)}</span>
      ),
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      width: 'w-40',
      sortable: true,
      hideBelow: 'lg',
      cell: (r) => (
        <span className="tabular text-slate-500">{formatDateTime(r.submittedAt)}</span>
      ),
    },
    {
      key: 'outcome',
      header: 'Status',
      width: 'w-24',
      cell: (r) => (
        <StatusBadge status={r.passed ? 'passed' : 'failed'} label={r.passed ? 'Passed' : 'Failed'} />
      ),
    },
    {
      key: 'print',
      header: '',
      width: 'w-20',
      align: 'center',
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Printer className="h-3.5 w-3.5" />}
          onClick={(e) => {
            e.stopPropagation()
            setPrintResult(r)
          }}
        >
          Print
        </Button>
      ),
    },
  ]

  const maxGrade = Math.max(1, ...summary.gradeDistribution.map((g) => g.count))

  return (
    <>
      <div className="space-y-5">
      <PageHeader
        title="Results"
        description="Review submissions, performance and reporting across all examinations."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{formatNumber(summary.totalResults)} results</Badge>
            <Badge tone="success">{formatNumber(summary.passed)} passed</Badge>
            <Badge tone="danger">{formatNumber(summary.failed)} failed</Badge>
          </div>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<Printer className="h-4 w-4" />}
              onClick={() => window.print()}
            >
              Print all
            </Button>
            <Button
              size="sm"
              icon={<Download className="h-4 w-4" />}
              onClick={onExport ?? (() => undefined)}
            >
              Export CSV
            </Button>
          </>
        }
      />

      <PhaseNotice phase="Phase 9 — Results and Reports">
        Per-student analytics, question analysis, PDF and CSV export arrive with the reporting
        phase. The figures below are already server-computed in the mock layer.
      </PhaseNotice>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Results" value={summary.totalResults} icon={FileText} tone="brand" />
        <StatCard
          label="Average Score"
          value={`${summary.averageScore}%`}
          icon={FileText}
          tone="violet"
        />
        <StatCard label="Pass Rate" value={`${summary.passRate}%`} icon={FileText} tone="emerald" />
        <StatCard label="Failed" value={summary.failed} icon={FileText} tone="amber" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader title="Grade distribution" description="All recorded submissions" />
          <PanelBody>
            <HorizontalBarList
              max={maxGrade}
              suffix=""
              items={summary.gradeDistribution.map((g) => ({
                label: `Grade ${g.grade}`,
                value: g.count,
                meta: `${summary.totalResults ? Math.round((g.count / summary.totalResults) * 100) : 0}% of results`,
              }))}
            />
          </PanelBody>
        </Panel>

        <Panel className="xl:col-span-2">
          <PanelHeader
            title="Subject performance"
            description="Weakest and strongest subjects, useful for review planning"
          />
          <PanelBody>
            {summary.subjectPerformance.length ? (
              <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                    Strongest
                  </h3>
                  <HorizontalBarList
                    items={summary.subjectPerformance.slice(0, 5).map((s) => ({
                      label: s.subjectName,
                      value: Math.round(s.averageScore),
                      meta: `${s.attempts} submissions`,
                    }))}
                  />
                </div>
                <div>
                  <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                    Needs attention
                  </h3>
                  <HorizontalBarList
                    items={[...summary.subjectPerformance]
                      .reverse()
                      .slice(0, 5)
                      .map((s) => ({
                        label: s.subjectName,
                        value: Math.round(s.averageScore),
                        meta: `${s.attempts} submissions`,
                      }))}
                  />
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-slate-400">No performance data yet</p>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <Toolbar>
          <ToolbarGroup>
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search student or examination…"
              label="Search results"
            />
            <FilterSelect
              label="Outcome"
              value={table.state.filters.outcome}
              onChange={(v) => table.setFilter('outcome', v)}
              options={[
                { value: 'all', label: 'All outcomes' },
                { value: 'passed', label: 'Passed' },
                { value: 'failed', label: 'Failed' },
              ]}
            />
            <FilterSelect
              label="Grade"
              value={table.state.filters.grade}
              onChange={(v) => table.setFilter('grade', v)}
              options={[
                { value: 'all', label: 'All grades' },
                ...summary.gradeDistribution.map((g) => ({ value: g.grade, label: `Grade ${g.grade}` })),
              ]}
            />
          </ToolbarGroup>
          <ResultCount shown={visible.length} total={meta.totalItems} />
        </Toolbar>

        {error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(r) => r.id}
              loading={loading}
              stickyHeader
              emptyTitle="No results match these filters"
            />
            <Pagination
              page={meta.page}
              pageSize={meta.pageSize}
              totalItems={meta.totalItems}
              totalPages={meta.totalPages}
              onPageChange={table.setPage}
              onPageSizeChange={table.setPageSize}
            />
          </>
        )}
      </Panel>
    </div>

    {printResult && (
      <Modal
        open
        onClose={() => setPrintResult(null)}
        title={`Result — ${printResult.studentName}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {printResult.studentName} ({printResult.studentId_}) —{' '}
            {printResult.examName}
          </p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-2xs text-slate-500">Score</p>
              <p className="font-medium">{printResult.percentage}%</p>
            </div>
            <div>
              <p className="text-2xs text-slate-500">Grade</p>
              <p className="font-medium">{printResult.grade}</p>
            </div>
            <div>
              <p className="text-2xs text-slate-500">Correct</p>
              <p className="font-medium">
                {printResult.correctAnswers}/{printResult.totalQuestions}
              </p>
            </div>
            <div>
              <p className="text-2xs text-slate-500">Marks</p>
              <p className="font-medium">
                {printResult.marksObtained}/{printResult.totalMarks}
              </p>
            </div>
            <div>
              <p className="text-2xs text-slate-500">Status</p>
              <p className="font-medium">
                {printResult.passed ? 'Passed' : 'Failed'}
              </p>
            </div>
            <div>
              <p className="text-2xs text-slate-500">Submitted</p>
              <p className="font-medium">
                {formatDateTime(printResult.submittedAt)}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setPrintResult(null)}>
              Close
            </Button>
            <Button onClick={() => window.print()}>Print this result</Button>
          </div>
        </div>
      </Modal>
    )}
    </>
  )
}
