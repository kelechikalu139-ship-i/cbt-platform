import { Copy, Download, Eye, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import {
  Badge,
  DataTable,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  ErrorState,
  FilterSelect,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  PanelBody,
  PhaseNotice,
  ResultCount,
  SearchBar,
  StatusBadge,
  Toolbar,
  ToolbarGroup,
  type Column,
} from '../../components/ui'
import { QuestionEditor, BulkImportModal } from '../../components/questions'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useTableState } from '../../hooks/useTableState'
import { ApiError, questionsApi, questionMutations } from '../../services'
import { QUESTION_TYPE_LABELS, type Category, type Question, type QuestionInput, type Subject } from '../../types'
import { formatDate, formatNumber, shortId, toDecimalNumber } from '../../utils'

interface QuestionsPageProps {
  questions: Question[]
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number }
  subjects: Subject[]
  categories: Category[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

const DIFFICULTY_TONE = {
  EASY: 'success',
  MEDIUM: 'warning',
  HARD: 'danger',
} as const

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
]

const DIFFICULTY_OPTIONS = [
  { value: 'all', label: 'All difficulties' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  ...Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label })),
]

/** Clamp long question text so one verbose stem cannot break row rhythm. */
function QuestionText({ text }: { text: string }) {
  return (
    <p className="line-clamp-2 max-w-xl text-slate-700" title={text}>
      {text}
    </p>
  )
}

export function QuestionsPage({
  questions,
  meta,
  subjects,
  categories,
  loading = false,
  error = null,
  onRetry,
}: QuestionsPageProps) {
  const queryClient = useQueryClient()
  const table = useTableState<{ status: string; difficulty: string; type: string; subjectId: string }>({
    status: 'all',
    difficulty: 'all',
    type: 'all',
    subjectId: 'all',
  })
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const [preview, setPreview] = useState<Question | null>(null)

  // Mutation dialogs
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Question | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (payload: QuestionInput) => questionMutations.create(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setAddOpen(false)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<QuestionInput> }) =>
      questionMutations.update(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setEditTarget(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const bulkImportMutation = useMutation({
    mutationFn: (payload: {
      questions: Array<Record<string, unknown>>
      autoCreateTaxonomy: boolean
    }) => questionsApi.bulkImport(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['questions'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['question-categories'] })
      void queryClient.invalidateQueries({ queryKey: ['question-subjects'] })
      setImportOpen(false)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const visible = useMemo(() => {
    const term = debounced.trim().toLowerCase()
    return questions.filter((q) => {
      const f = table.state.filters
      if (f.status !== 'all' && q.status !== f.status) return false
      if (f.difficulty !== 'all' && q.difficulty !== f.difficulty) return false
      if (f.type !== 'all' && q.type !== f.type) return false
      if (f.subjectId !== 'all' && q.subjectId !== f.subjectId) return false
      if (!term) return true
      return [q.stem, q.subjectName, q.categoryName, q.tags].some((v) =>
        String(v ?? '').toLowerCase().includes(term),
      )
    })
  }, [questions, debounced, table.state.filters])

  const columns: Array<Column<Question>> = [
    {
      key: 'id',
      header: 'ID',
      width: 'w-28',
      sortable: true,
      cell: (q) => <span className="tabular font-medium text-slate-700">{shortId(q.id)}</span>,
    },
    {
      key: 'stem',
      header: 'Question',
      cell: (q) => <QuestionText text={q.stem} />,
    },
    {
      key: 'type',
      header: 'Type',
      width: 'w-40',
      hideBelow: 'lg',
      cell: (q) => (
        <span className="text-slate-600">{QUESTION_TYPE_LABELS[q.type] ?? q.type}</span>
      ),
    },
    {
      key: 'subjectName',
      header: 'Subject',
      width: 'w-48',
      hideBelow: 'md',
      sortable: true,
      cell: (q) => (
        <div className="min-w-0">
          <p className="truncate text-slate-700">{q.subjectName ?? '—'}</p>
          <p className="truncate text-2xs text-slate-400">{q.categoryName}</p>
        </div>
      ),
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      width: 'w-28',
      hideBelow: 'xl',
      sortable: true,
      cell: (q) => (
        <Badge tone={DIFFICULTY_TONE[q.difficulty] ?? 'neutral'} dot={false}>
          {q.difficulty}
        </Badge>
      ),
    },
    {
      key: 'marks',
      header: 'Marks',
      width: 'w-20',
      align: 'right',
      hideBelow: 'sm',
      sortable: true,
      cell: (q) => <span className="tabular text-slate-600">{q.points}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-24',
      hideBelow: 'sm',
      cell: (q) => <StatusBadge status={q.status} />,
    },
    {
      key: 'actions',
      header: '',
      width: 'w-12',
      align: 'right',
      cell: (q) => (
        /* Row clicks open the preview, so clicks in this
            cell are stopped here. The stop sits on the
            wrapper (not the trigger button) so the Dropdown's
            own toggle still receives the event and opens. */
        <div onClick={(ev) => ev.stopPropagation()}>
          <Dropdown
            align="right"
            trigger={
              <button
                type="button"
                aria-label={`Actions for question ${shortId(q.id)}`}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
          <DropdownItem icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setPreview(q)}>
            Preview
          </DropdownItem>
          <DropdownItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditTarget(q)
              setMutationError(null)
            }}
          >
            Edit
          </DropdownItem>
          <DropdownItem
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => {
              setAddOpen(true)
              setMutationError(null)
            }}
          >
            Duplicate
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            destructive
            onClick={() => {
              void questionMutations.remove(q.id)
              void queryClient.invalidateQueries({ queryKey: ['questions'] })
            }}
          >
            Delete
          </DropdownItem>
          </Dropdown>
        </div>
      ),
    },
  ]

  const handleExport = () => {
    const rows = visible.map((q) => ({
      stem: q.stem,
      type: q.type,
      category: q.categoryName,
      subject: q.subjectName ?? '',
      difficulty: q.difficulty,
      points: q.points,
      status: q.status,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation ?? '',
      tags: q.tags ?? '',
      ...(q.type === 'MULTIPLE_CHOICE'
        ? { options: q.options.map((o) => ({ label: o.label, text: o.text })) }
        : {}),
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `questions-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Question Bank"
        description="Build and maintain the pool of questions examinations draw from."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">{formatNumber(meta.totalItems)} questions</Badge>
            <Badge tone="neutral">{subjects.length} subjects</Badge>
          </div>
        }
        actions={
          <>
            <ToolbarGroup>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(true)
                  setMutationError(null)
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Upload className="h-4 w-4" />
                Bulk import
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </ToolbarGroup>
            <button
              type="button"
              onClick={() => {
                setAddOpen(true)
                setMutationError(null)
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              <Plus className="h-4 w-4" />
              Add question
            </button>
          </>
        }
      />

      <PhaseNotice phase="Phase 3 — Question Bank">
        Authoring, duplication and bulk import/export arrive with the Node.js API. The bank is
        already modelled for multiple choice as the primary type, with true/false, multiple answer
        and short answer supported.
      </PhaseNotice>

      <Panel>
        <Toolbar>
          <ToolbarGroup>
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v)
                table.setSearch(v)
              }}
              placeholder="Search question text or reference…"
              label="Search questions"
            />
            <FilterSelect
              label="Subject"
              value={table.state.filters.subjectId}
              onChange={(v) => table.setFilter('subjectId', v)}
              options={[
                { value: 'all', label: 'All subjects' },
                ...subjects.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <FilterSelect
              label="Status"
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={STATUS_OPTIONS}
            />
            <FilterSelect
              label="Type"
              value={table.state.filters.type}
              onChange={(v) => table.setFilter('type', v)}
              options={TYPE_OPTIONS}
            />
            <FilterSelect
              label="Difficulty"
              value={table.state.filters.difficulty}
              onChange={(v) => table.setFilter('difficulty', v)}
              options={DIFFICULTY_OPTIONS}
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
              rowKey={(q) => q.id}
              loading={loading}
              stickyHeader
              onRowClick={(q) => setPreview(q)}
              emptyTitle="No questions match these filters"
              emptyDescription="Adjust the subject, type or difficulty filters to widen the search."
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

      <QuestionPreview question={preview} onClose={() => setPreview(null)} />

      <QuestionEditor
        open={addOpen}
        onClose={() => setAddOpen(false)}
        question={null}
        categories={categories}
        subjects={subjects}
        submitting={createMutation.isPending}
        error={mutationError}
        onSubmit={(payload: QuestionInput) => createMutation.mutate(payload)}
      />

      <QuestionEditor
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        question={editTarget}
        categories={categories}
        subjects={subjects}
        submitting={updateMutation.isPending}
        error={mutationError}
        onSubmit={(payload) =>
          editTarget && updateMutation.mutate({ id: editTarget.id, payload })
        }
      />

      <BulkImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        categories={categories}
        subjects={subjects}
        submitting={bulkImportMutation.isPending}
        error={mutationError}
        onImport={(records: Array<Record<string, unknown>>, autoCreateTaxonomy: boolean) =>
          bulkImportMutation.mutate({ questions: records, autoCreateTaxonomy })
        }
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function QuestionPreview({ question, onClose }: { question: Question | null; onClose: () => void }) {
  return (
    <Modal
      open={question !== null}
      onClose={onClose}
      title={question ? `Question ${shortId(question.id)}` : ''}
      description={question
        ? `${QUESTION_TYPE_LABELS[question.type]} · ${question.points} point${toDecimalNumber(question.points) === 1 ? '' : 's'}`
        : ''}
      size="lg"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      }
    >
      {question && (
        <div className="space-y-4">
          <p className="text-sm font-medium leading-relaxed text-slate-800">{question.stem}</p>

          {question.options.length > 0 && (
            <ol className="space-y-2">
              {question.options.map((opt) => (
                <li
                  key={opt.id}
                  className="flex items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2"
                >
                  <span className="tabular flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-2xs font-semibold text-slate-600">
                    {opt.label}
                  </span>
                  <span className="text-sm text-slate-700">{opt.text}</span>
                  {opt.label === question.correctAnswer && <Badge tone="success">Correct</Badge>}
                </li>
              ))}
            </ol>
          )}

          {question.type === 'SHORT_ANSWER' && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-2xs font-medium uppercase tracking-wide text-slate-500">
                Accepted answer
              </p>
              <p className="mt-1 text-sm text-slate-700">{question.correctAnswer}</p>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-slate-200 pt-3 text-xs sm:grid-cols-4">
            {[
              ['Category', question.categoryName],
              ['Subject', question.subjectName ?? '—'],
              ['Difficulty', question.difficulty],
              ['Status', question.status],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-slate-500">{label}</dt>
                <dd className="mt-0.5 capitalize text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>

          {question.explanation && (
            <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-2xs font-medium uppercase tracking-wide text-brand-700">
                Explanation
              </p>
              <p className="mt-1 text-sm text-brand-900">{question.explanation}</p>
            </div>
          )}

          <p className="text-2xs text-slate-400">
            Last updated {formatDate(question.updatedAt)} · used in {question.timesUsed} published
            exam{question.timesUsed === 1 ? '' : 's'}
            {question.tags ? ` · tagged ${question.tags}` : ''}
          </p>
        </div>
      )}
    </Modal>
  )
}

/** Reusable body wrapper for pages that only need a read-only preview. */
export function PreviewBody({ children }: { children: ReactNode }) {
  return <PanelBody>{children}</PanelBody>
}

/**
 * Placeholder shown for actions whose endpoint does not exist yet.
 *
 * Re-exported from here so pages that already use it keep working without a
 * separate import. It is a pure presentational component — it takes a phase
 * string and renders a modal saying the action is scheduled for that phase.
 */
export function PendingActionModal({
  action,
  phase,
  onClose,
}: {
  action: string | null
  phase: string
  onClose: () => void
}) {
  return (
    <Modal
      open={action !== null}
      onClose={onClose}
      title={action ?? ''}
      size="sm"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Close
        </button>
      }
    >
      <p className="text-sm text-slate-600">
        <span className="font-medium capitalize text-slate-800">{action}</span> is scheduled for{' '}
        {phase}. The interface contract is in place; the endpoint needs the Node.js API and the
        MariaDB schema.
      </p>
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
