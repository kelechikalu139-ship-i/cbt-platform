import { CalendarDays, CheckCircle2, ClipboardList, Copy, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Badge,
  ConfirmDialog,
  DataTable,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  EmptyState,
  ErrorState,
  FilterSelect,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  PhaseNotice,
  ResultCount,
  SearchBar,
  StatusBadge,
  Toolbar,
  ToolbarGroup,
  type Column,
} from '../../components/ui'
import { ExamEditor } from '../../components/exams/ExamEditor'
import { ApiError, examMutations, examSessionMutations, examsApi } from '../../services'
import {
  EXAM_STATUS_LABELS,
  type Category,
  type Exam,
  type ExamInput,
  type SchoolOptions,
  type Subject,
} from '../../types'
import { formatDate, formatNumber, formatDuration } from '../../utils'

interface ExamsPageProps {
  exams: Exam[]
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number }
  /** Taxonomy for the question-pool picker in the editor. */
  categories: Category[]
  subjects: Subject[]
  /** Distinct class names already in use by students. */
  classNames: string[]
  /**
   * The school's academic vocabulary — programmes, departments, classes,
   * levels and semesters — offered as suggestions by the editor's pickers.
   */
  schoolOptions?: SchoolOptions
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...Object.entries(EXAM_STATUS_LABELS).map(([value, label]) => ({ value, label })),
]

/**
 * Delivery-rule flags, read from the flat columns the server actually stores.
 *
 * These are separate booleans on `Exam`, not a nested `rules` object, so a rule
 * the backend drops simply stops being shown here rather than rendering blank.
 */
function RuleChips({
  exam,
  onToggleShowResultImmediately,
}: {
  exam: Exam
  /** Fired when the administrator clicks the “Show result immediately” chip. */
  onToggleShowResultImmediately?: (next: boolean) => void
}) {
  const chips: Array<{ label: string; on: boolean; clickable?: boolean }> = [
    { label: 'Shuffle questions', on: exam.shuffleQuestions },
    { label: 'Shuffle options', on: exam.shuffleOptions },
    {
      label: 'Show result immediately',
      on: exam.showResultImmediately,
      clickable: Boolean(onToggleShowResultImmediately),
    },
  ]

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => {
        const isClickable = chip.clickable && chip.label === 'Show result immediately'
        const badge = (
          <Badge
            key={chip.label}
            tone={chip.on ? 'brand' : 'neutral'}
            dot={false}
            className={isClickable ? 'cursor-pointer hover:bg-slate-100 transition-colors' : undefined}
          >
            {chip.on ? chip.label : `No ${chip.label.toLowerCase()}`}
          </Badge>
        )
        if (!isClickable) return badge
        return (
          <button
            key={chip.label}
            type="button"
            onClick={() => onToggleShowResultImmediately!(!chip.on)}
            aria-pressed={chip.on}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-2xs font-medium ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-500/20 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-primary)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {chip.on ? chip.label : `No ${chip.label.toLowerCase()}`}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Examination management.
 *
 * Read-only overview plus the create flow. The editor builds a
 * paper from a question pool (category/subject, type, difficulty)
 * targeted at specific classes and levels; the server resolves the
 * pool and attaches every eligible question at creation time.
 */
export function ExamsPage({
  exams,
  meta,
  categories,
  subjects,
  classNames,
  schoolOptions,
  loading = false,
  error = null,
  onRetry,
}: ExamsPageProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [detail, setDetail] = useState<Exam | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  /** The paper being edited — the editor is prefilled from it. */
  const [editTarget, setEditTarget] = useState<Exam | null>(null)
  /** The paper being duplicated — a new paper seeded from it. */
  const [duplicateTarget, setDuplicateTarget] = useState<Exam | null>(null)
  /** The paper pending a delete confirmation. */
  const [deleteTarget, setDeleteTarget] = useState<Exam | null>(null)
  /** The paper whose attempts are being reset. */
  const [resetTarget, setResetTarget] = useState<Exam | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['exams'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const createMutation = useMutation({
    mutationFn: (payload: ExamInput) => examMutations.create(payload),
    onSuccess: () => {
      refresh()
      setCreateOpen(false)
      setDuplicateTarget(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ExamInput> }) =>
      examMutations.update(id, payload),
    onSuccess: () => {
      refresh()
      setEditTarget(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  /**
   * Publication is its own audited action. The server refuses to
   * publish a paper with no questions and to unpublish one with
   * recorded attempts, so the message is shown verbatim.
   */
  const publishMutation = useMutation({
    mutationFn: (id: string) => examMutations.publish(id),
    onSuccess: () => {
      refresh()
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: (id: string) => examMutations.unpublish(id),
    onSuccess: () => {
      refresh()
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => examMutations.remove(id),
    onSuccess: () => {
      refresh()
      setDeleteTarget(null)
      setDetail(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return exams.filter((e) => {
      if (status !== 'all' && e.status !== status) return false
      if (!term) return true
      return [e.title, e.program, e.department, ...(e.classes ?? [])].some((v) =>
        String(v ?? '').toLowerCase().includes(term),
      )
    })
  }, [exams, search, status])

  const columns: Array<Column<Exam>> = [
    {
      key: 'title',
      header: 'Examination',
      sortable: true,
      cell: (e) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{e.title}</p>
          <p className="mt-0.5 truncate text-2xs text-slate-500">
            {e.program ?? 'Programme not set'}
            {e.level ? ` · ${e.level} level` : ''}
            {e.semester ? ` · semester ${e.semester}` : ''}
            {(e.classes ?? []).length > 0 && (
              <span className="text-[var(--cb-primary-deep)]">
                {' '}· {(e.classes as string[]).join(', ')}
              </span>
            )}
          </p>
        </div>
      ),
    },
    {
      key: 'questionCount',
      header: 'Questions',
      width: 'w-32',
      align: 'right',
      sortable: true,
      hideBelow: 'sm',
      cell: (e) => (
        <div>
          {/* A null questionCount means the paper draws every eligible question,
              so the attached count is the only number available. */}
          <p className="tabular font-medium text-slate-800">
            {e.questionCount ?? formatNumber(e.attachedQuestions ?? 0)}
          </p>
          <p className="tabular text-2xs text-slate-400">
            {e.questionCount === null ? 'all eligible' : 'selected'}
          </p>
        </div>
      ),
    },
    {
      key: 'durationMinutes',
      header: 'Duration',
      width: 'w-24',
      align: 'right',
      sortable: true,
      hideBelow: 'md',
      cell: (e) => (
        <span className="tabular text-slate-600">{formatDuration(e.durationMinutes * 60)}</span>
      ),
    },
    {
      key: 'passPercentage',
      header: 'Pass Mark',
      width: 'w-24',
      align: 'right',
      sortable: true,
      hideBelow: 'lg',
      cell: (e) => <span className="tabular text-slate-600">{e.passPercentage}%</span>,
    },
    {
      key: 'startAt',
      header: 'Window',
      width: 'w-44',
      hideBelow: 'xl',
      cell: (e) => (
        <span className="tabular text-slate-500">
          {formatDate(e.startAt)} → {formatDate(e.endAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-28',
      sortable: true,
      cell: (e) => <StatusBadge status={e.status} label={EXAM_STATUS_LABELS[e.status]} />,
    },
    {
      key: 'actions',
      header: '',
      width: 'w-12',
      align: 'right',
      cell: (e) => (
        /* Row clicks open the preview dialog, so clicks in this
            cell are stopped here. The stop sits on the wrapper
            (not the trigger button) so the Dropdown's own toggle
            still receives the event and opens the menu. */
        <div onClick={(ev) => ev.stopPropagation()}>
          <Dropdown
            align="right"
            trigger={
              <button
                type="button"
                aria-label={`Actions for ${e.title}`}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
          <DropdownItem icon={<ClipboardList className="h-3.5 w-3.5" />} onClick={() => setDetail(e)}>
            Preview
          </DropdownItem>
          {e.status === 'DRAFT' && (
            <>
              <DropdownItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditTarget(e)}>
                Edit
              </DropdownItem>
              <DropdownItem
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                onClick={() => publishMutation.mutate(e.id)}
              >
                Publish
              </DropdownItem>
            </>
          )}
          {(e.status === 'PUBLISHED' || e.status === 'ONGOING') && (
            <DropdownItem
              icon={<Undo2 className="h-3.5 w-3.5" />}
              onClick={() => unpublishMutation.mutate(e.id)}
            >
              Unpublish
            </DropdownItem>
          )}
          <DropdownDivider />
          <DropdownItem
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => setResetTarget(e)}
          >
            Reset attempts
          </DropdownItem>
          <DropdownItem
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => setDuplicateTarget(e)}
          >
            Duplicate
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            destructive
            onClick={() => setDeleteTarget(e)}
          >
            Delete
          </DropdownItem>
          </Dropdown>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Exams"
        description="Create, schedule and configure the examinations candidates sit."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{exams.length} examinations</Badge>
            <Badge tone="success">
              {exams.filter((e) => e.status === 'ONGOING').length} live now
            </Badge>
          </div>
        }
        actions={
          <button
            type="button"
            onClick={() => {
              setCreateOpen(true)
              setMutationError(null)
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 text-sm font-medium shadow-sm transition-colors hover:bg-[var(--cb-primary-dark)]"
          >
            <Plus className="h-4 w-4" />
            Create exam
          </button>
        }
      />

      <PhaseNotice phase="Phase 5 — Exam Management">
        Question selection supports both manual picks and random draws from a subject pool. The
        paper is fixed server-side at session start, so a refresh cannot re-roll a candidate's
        questions.
      </PhaseNotice>

      {/* Errors from the row actions (publish, unpublish,
          delete) land here; the editors show their own. */}
      {mutationError && !createOpen && editTarget === null && duplicateTarget === null && (
        <Alert
          tone="danger"
          title="The examination could not be changed"
          actions={
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setMutationError(null)}
              className="rounded p-0.5 hover:bg-black/5"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          }
        >
          {mutationError}
        </Alert>
      )}

      <Panel>
        <Toolbar>
          <ToolbarGroup>
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search examinations…"
              label="Search exams"
            />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
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
              rowKey={(e) => e.id}
              loading={loading}
              onRowClick={(e) => setDetail(e)}
              stickyHeader
              emptyTitle="No examinations found"
              emptyDescription="Create an examination to begin, or adjust the filters above."
            />
            <Pagination
              page={meta.page}
              pageSize={meta.pageSize}
              totalItems={meta.totalItems}
              totalPages={meta.totalPages}
              onPageChange={() => undefined}
              onPageSizeChange={() => undefined}
            />
          </>
        )}
      </Panel>

      <ExamDetail
        exam={detail}
        onClose={() => setDetail(null)}
        onEdit={(e) => {
          setEditTarget(e)
          setDetail(null)
        }}
        onToggleShowResultImmediately={(next) =>
          detail && updateMutation.mutate({ id: detail.id, payload: { showResultImmediately: next } })
        }
      />

      {/* Create and duplicate share the dialog: a duplicate
          is a new paper seeded with the original's values. */}
      <ExamEditor
        open={createOpen || duplicateTarget !== null}
        onClose={() => {
          setCreateOpen(false)
          setDuplicateTarget(null)
        }}
        categories={categories}
        subjects={subjects}
        classNames={classNames}
        schoolOptions={schoolOptions}
        submitting={createMutation.isPending}
        error={mutationError}
        prefill={duplicateTarget}
        onSubmit={(payload) => createMutation.mutate(payload)}
      />

      <ExamEditor
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        categories={categories}
        subjects={subjects}
        classNames={classNames}
        schoolOptions={schoolOptions}
        submitting={updateMutation.isPending}
        error={mutationError}
        exam={editTarget}
        onSubmit={(payload) =>
          editTarget && updateMutation.mutate({ id: editTarget.id, payload })
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() =>
          deleteTarget && deleteMutation.mutate(deleteTarget.id)
        }
        title="Delete examination"
        confirmLabel="Delete examination"
        destructive
        loading={deleteMutation.isPending}
        message={
          deleteTarget
            ? `Delete "${deleteTarget.title}"? The paper is withdrawn from every list. The question bank, and any attempts already recorded, are not affected.`
            : ''
        }
      />

      <ResetAttemptsDialog exam={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function ExamDetail({
  exam,
  onClose,
  onEdit,
  onToggleShowResultImmediately,
}: {
  exam: Exam | null
  onClose: () => void
  /** Opens the editor for a draft paper. */
  onEdit?: (exam: Exam) => void
  /** Toggles “show result immediately” on the paper. */
  onToggleShowResultImmediately?: (next: boolean) => void
}) {
  return (
    <Modal
      open={exam !== null}
      onClose={onClose}
      title={exam?.title ?? ''}
      description={exam ? `${exam.program ?? 'Programme not set'} · created ${formatDate(exam.createdAt)}` : ''}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          {exam?.status === 'DRAFT' && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(exam)}
              className="rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--cb-primary-dark)]"
            >
              Edit examination
            </button>
          )}
        </>
      }
    >
      {exam && (
        <div className="space-y-5">
          {exam.description && (
            <p className="text-sm leading-relaxed text-slate-600">{exam.description}</p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                'Questions drawn',
                exam.questionCount === null
                  ? 'All eligible'
                  : String(exam.questionCount),
              ],
              ['Questions attached', formatNumber(exam.attachedQuestions ?? 0)],
              ['Duration', formatDuration(exam.durationMinutes * 60)],
              ['Pass mark', `${exam.passPercentage}%`],
              ['Attempts allowed', String(exam.maxAttempts)],
              ['Level', exam.level === null ? '—' : String(exam.level)],
              ['Opens', formatDate(exam.startAt)],
              ['Closes', formatDate(exam.endAt)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-slate-200 px-3 py-2">
                <p className="text-2xs uppercase tracking-wide text-slate-500">{label}</p>
                <p className="tabular mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>

          {(exam.classes ?? []).length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Set for classes
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {(exam.classes as string[]).map((name) => (
                  <Badge key={name} tone="brand" dot={false}>
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {exam.instructions && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Instructions to candidates
              </h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {exam.instructions}
              </p>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Examination rules
            </h3>
            <RuleChips exam={exam} onToggleShowResultImmediately={onToggleShowResultImmediately} />
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="flex items-start gap-2 text-2xs leading-relaxed text-amber-900">
              <CalendarDays aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Timing is enforced on the server. <code>startedAt</code> and{' '}
                <code>expiresAt</code> are recorded when the session is created, and the remaining
                time is recalculated from the server on every read — a candidate cannot extend an
                examination by changing the browser clock.
              </span>
            </p>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Extract a readable message from an API error. */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  const anyErr = err as { response?: { data?: { message?: string } } }
  return anyErr?.response?.data?.message ?? 'The request failed. Check the values and try again.'
}

/**
 * Reset attempts on one paper.
 *
 * The candidate list comes from the server rather than the students
 * table, so only names who have actually attempted this paper can be
 * picked — resetting a candidate who never sat it would be meaningless.
 */
function ResetAttemptsDialog({ exam, onClose }: { exam: Exam | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const attempts = useQuery({
    queryKey: ['exam-attempts', exam?.id],
    queryFn: () => examsApi.examAttempts(exam!.id),
    enabled: exam !== null,
  })

  const reset = useMutation({
    mutationFn: () => examSessionMutations.resetAttempts(exam!.id, selected),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exams'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['exam-attempts', exam?.id] })
      onClose()
    },
    onError: (err: unknown) => setError(errorMessage(err)),
  })

  const rows = attempts.data ?? []
  const resetAll = selected.length === 0

  return (
    <Modal
      open={exam !== null}
      onClose={onClose}
      title="Reset attempts"
      description={exam?.title}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="reset-attempts-form"
            disabled={reset.isPending || attempts.isPending || rows.length === 0}
            className="rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-[var(--cb-primary-dark)] disabled:opacity-50"
          >
            {reset.isPending ? 'Resetting…' : 'Reset attempts'}
          </button>
        </>
      }
    >
      <form
        id="reset-attempts-form"
        onSubmit={(e) => {
          e.preventDefault()
          reset.mutate()
        }}
        className="space-y-4"
      >
        {error && (
          <p className="rounded-md bg-[var(--cb-primary-bg)] px-3 py-2 text-sm text-[var(--cb-primary-deep)]">{error}</p>
        )}

        {attempts.isPending ? (
          <LoadingState label="Loading attempts…" rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No attempts yet"
            description="Nobody has attempted this paper, so there is nothing to reset."
          />
        ) : (
          <>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
              <input
                type="checkbox"
                checked={resetAll}
                onChange={(e) => setSelected(e.target.checked ? [] : rows.map((r) => r.admissionNumber))}
              />
              <span className="text-sm font-medium text-slate-700">
                Reset every candidate ({rows.length})
              </span>
            </label>

            <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2">Candidate</th>
                    <th className="px-3 py-2">Class</th>
                    <th className="px-3 py-2">Attempts</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const checked = selected.includes(row.admissionNumber)
                    return (
                      <tr key={row.studentRecordId}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelected((current) =>
                                current.includes(row.admissionNumber)
                                  ? current.filter((id) => id !== row.admissionNumber)
                                  : [...current, row.admissionNumber],
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-800">{row.studentName}</p>
                          <p className="tabular text-2xs text-slate-500">{row.admissionNumber}</p>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{row.className ?? '—'}</td>
                        <td className="px-3 py-2 tabular text-slate-600">{row.attempts}</td>
                        <td className="px-3 py-2">
                          <Badge tone={row.isLive ? 'warning' : 'neutral'}>
                            {row.isLive ? 'Writing' : 'Submitted'}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-2xs leading-relaxed text-slate-500">
              {resetAll
                ? 'Every attempt on this paper — and its results — will be deleted, so all listed candidates may sit it again. Any portal sign-in left behind on a candidate\'s device is ended, so nobody is refused with "already signed in on another device".'
                : `${selected.length} candidate${selected.length === 1 ? '' : 's'} selected: their attempts and results on this paper will be deleted, and they may sit it again. Their portal sign-in is ended too, so a frozen device cannot block the fresh one.`}
            </p>
          </>
        )}
      </form>
    </Modal>
  )
}
