import { ArrowRight, BookOpen, Copy, Download, Eye, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import {
  Badge,
  DataTable,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  ErrorState,
  EmptyState,
  FilterSelect,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  PanelBody,
  ResultCount,
  SearchBar,
  StatusBadge,
  ToolbarGroup,
  type Column,
} from '../../components/ui'
import { QuestionEditor, BulkImportModal } from '../../components/questions'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { ApiError, questionsApi, questionMutations } from '../../services'
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type Category,
  type Difficulty,
  type Question,
  type QuestionInput,
  type QuestionStatus,
  type QuestionType,
  type Subject,
} from '../../types'
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
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'INACTIVE', label: 'Inactive' },
]

const DIFFICULTY_OPTIONS = [
  { value: 'all', label: 'All difficulties' },
  { value: 'EASY', label: 'Easy' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HARD', label: 'Hard' },
]

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  ...Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label })),
]

const QUESTION_STATUSES: QuestionStatus[] = ['ACTIVE', 'DRAFT', 'INACTIVE']

function questionStatusFilter(value: string): QuestionStatus | 'all' {
  return QUESTION_STATUSES.find((status) => status === value) ?? 'all'
}

function questionDifficultyFilter(value: string): Difficulty | 'all' {
  return DIFFICULTIES.find((difficulty) => difficulty === value) ?? 'all'
}

function questionTypeFilter(value: string): QuestionType | 'all' {
  return QUESTION_TYPES.find((type) => type === value) ?? 'all'
}

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
  const [subjectSearch, setSubjectSearch] = useState('')
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null)
  const [detailSearch, setDetailSearch] = useState('')
  const debouncedDetailSearch = useDebouncedValue(detailSearch, 250)
  const [detailStatus, setDetailStatus] = useState<QuestionStatus | 'all'>('all')
  const [detailDifficulty, setDetailDifficulty] = useState<Difficulty | 'all'>('all')
  const [detailType, setDetailType] = useState<QuestionType | 'all'>('all')
  const [detailPage, setDetailPage] = useState(1)
  const [detailPageSize, setDetailPageSize] = useState(20)
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
      void queryClient.invalidateQueries({ queryKey: ['question-subjects'] })
      void queryClient.invalidateQueries({ queryKey: ['subject-questions'] })
      void queryClient.invalidateQueries({ queryKey: ['exam-question-picker'] })
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
      void queryClient.invalidateQueries({ queryKey: ['question-subjects'] })
      void queryClient.invalidateQueries({ queryKey: ['subject-questions'] })
      void queryClient.invalidateQueries({ queryKey: ['exam-question-picker'] })
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
      void queryClient.invalidateQueries({ queryKey: ['question-subjects'] })
      void queryClient.invalidateQueries({ queryKey: ['subject-questions'] })
      void queryClient.invalidateQueries({ queryKey: ['exam-question-picker'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['question-categories'] })
      setImportOpen(false)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const visibleSubjects = useMemo(() => {
    const term = subjectSearch.trim().toLowerCase()
    return subjects.filter((subject) =>
      !term || [subject.name, subject.code, subject.categoryName]
        .some((value) => String(value ?? '').toLowerCase().includes(term)),
    )
  }, [subjects, subjectSearch])

  const subjectQuestions = useQuery({
    queryKey: [
      'subject-questions',
      selectedSubject?.id,
      debouncedDetailSearch,
      detailStatus,
      detailDifficulty,
      detailType,
      detailPage,
      detailPageSize,
    ],
    queryFn: () =>
      questionsApi.list({
        page: detailPage,
        pageSize: detailPageSize,
        subjectId: selectedSubject!.id,
        search: debouncedDetailSearch || undefined,
        status: detailStatus === 'all' ? undefined : detailStatus,
        difficulty: detailDifficulty === 'all' ? undefined : detailDifficulty,
        type: detailType === 'all' ? undefined : detailType,
      }),
    enabled: selectedSubject !== null,
  })

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
              void queryClient.invalidateQueries({ queryKey: ['question-subjects'] })
              void queryClient.invalidateQueries({ queryKey: ['subject-questions'] })
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
    const rows = questions.map((q) => ({
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

  const openSubject = (subject: Subject) => {
    setSelectedSubject(subject)
    setDetailSearch('')
    setDetailStatus('all')
    setDetailDifficulty('all')
    setDetailType('all')
    setDetailPage(1)
    setDetailPageSize(20)
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
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 text-sm font-medium shadow-sm transition-colors hover:bg-[var(--cb-primary-dark)]"
            >
              <Plus className="h-4 w-4" />
              Add question
            </button>
          </>
        }
      />

      <Panel>
        {error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : loading ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
            ))}
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Browse by subject</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Select a subject to search, filter and manage its questions.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="neutral">{formatNumber(meta.totalItems)} questions</Badge>
                <Badge tone="neutral">{subjects.length} subjects</Badge>
                <div className="w-60">
                  <SearchBar
                    value={subjectSearch}
                    onChange={setSubjectSearch}
                    placeholder="Find a subject…"
                    label="Search subjects"
                  />
                </div>
              </div>
            </div>

            {visibleSubjects.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-8 w-8" />}
                title={subjects.length ? 'No subjects match your search' : 'No subjects yet'}
                description={subjects.length ? 'Try another subject or course name.' : 'Create a subject in Categories, then add questions to it.'}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleSubjects.map((subject) => {
                  const typeCounts = subject.questionTypeCounts ?? {}
                  const availableTypes = Object.entries(QUESTION_TYPE_LABELS)
                    .filter(([type]) => (typeCounts[type as Question['type']] ?? 0) > 0)
                  return (
                    <button
                      key={subject.id}
                      type="button"
                      onClick={() => openSubject(subject)}
                      className="group relative flex min-h-44 flex-col overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white via-white to-indigo-50/70 p-5 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-primary)] focus-visible:ring-offset-2"
                    >
                      <span className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-indigo-100/50 blur-2xl transition group-hover:bg-indigo-200/60" />
                      <span className="relative flex w-full items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-base font-semibold text-slate-900">{subject.name}</span>
                          <span className="mt-1 block truncate text-xs text-slate-500">{subject.categoryName}</span>
                        </span>
                        <span className="shrink-0 rounded-lg bg-white/90 px-2.5 py-1.5 text-center shadow-sm ring-1 ring-slate-200/80">
                          <span className="block text-lg font-bold leading-5 tabular-nums text-slate-900">{formatNumber(subject.questionCount)}</span>
                          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">questions</span>
                        </span>
                      </span>

                      <span className="relative mt-5 flex flex-wrap gap-1.5">
                        {availableTypes.length > 0 ? availableTypes.map(([type, label]) => (
                          <span key={type} className="rounded-full border border-white bg-white/80 px-2 py-1 text-[10px] font-medium text-slate-600 shadow-sm">
                            {label} · {typeCounts[type as Question['type']]}
                          </span>
                        )) : (
                          <span className="text-xs text-slate-400">No questions added yet</span>
                        )}
                      </span>

                      <span className="relative mt-auto flex items-center justify-between pt-5 text-xs font-semibold text-indigo-700">
                        <span>{subject.code ? `Code ${subject.code}` : 'Open question bank'}</span>
                        <span className="inline-flex items-center gap-1 opacity-70 transition group-hover:translate-x-0.5 group-hover:opacity-100">
                          View questions <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Modal
        open={selectedSubject !== null}
        onClose={() => setSelectedSubject(null)}
        title={selectedSubject?.name ?? 'Subject questions'}
        description={selectedSubject ? `${selectedSubject.categoryName} · ${formatNumber(selectedSubject.questionCount)} question(s)` : undefined}
        size="full"
      >
        {selectedSubject && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <SearchBar
                  value={detailSearch}
                  onChange={(value) => {
                    setDetailSearch(value)
                    setDetailPage(1)
                  }}
                  placeholder="Search question text…"
                  label="Search questions in this subject"
                />
              </div>
              <FilterSelect
                label="Difficulty"
                value={detailDifficulty}
                onChange={(value) => { setDetailDifficulty(questionDifficultyFilter(value)); setDetailPage(1) }}
                options={DIFFICULTY_OPTIONS}
              />
              <FilterSelect
                label="Status"
                value={detailStatus}
                onChange={(value) => { setDetailStatus(questionStatusFilter(value)); setDetailPage(1) }}
                options={STATUS_OPTIONS}
              />
              <FilterSelect
                label="Type"
                value={detailType}
                onChange={(value) => { setDetailType(questionTypeFilter(value)); setDetailPage(1) }}
                options={TYPE_OPTIONS}
              />
              <ResultCount
                shown={subjectQuestions.data?.data.length ?? 0}
                total={subjectQuestions.data?.meta.totalItems ?? 0}
              />
            </div>
            {subjectQuestions.error ? (
              <ErrorState
                title="Could not load this subject’s questions"
                message={errorMessage(subjectQuestions.error)}
                onRetry={() => void subjectQuestions.refetch()}
              />
            ) : (
              <>
                <DataTable
                  columns={columns}
                  rows={subjectQuestions.data?.data ?? []}
                  rowKey={(question) => question.id}
                  loading={subjectQuestions.isPending || subjectQuestions.isFetching}
                  stickyHeader
                  onRowClick={setPreview}
                  emptyTitle="No questions found"
                  emptyDescription="Adjust the search or filters, or add questions to this subject."
                />
                {subjectQuestions.data?.meta && (
                  <Pagination
                    page={subjectQuestions.data.meta.page}
                    pageSize={subjectQuestions.data.meta.pageSize}
                    totalItems={subjectQuestions.data.meta.totalItems}
                    totalPages={subjectQuestions.data.meta.totalPages}
                    onPageChange={setDetailPage}
                    onPageSizeChange={(pageSize) => {
                      setDetailPageSize(pageSize)
                      setDetailPage(1)
                    }}
                  />
                )}
              </>
            )}
          </div>
        )}
      </Modal>

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
            <div className="rounded-md border border-[var(--cb-primary-a30)] bg-[var(--cb-primary-bg)] px-3 py-2">
              <p className="text-2xs font-medium uppercase tracking-wide text-[var(--cb-primary-deep)]">
                Explanation
              </p>
              <p className="mt-1 text-sm text-[var(--cb-primary-deep)]">{question.explanation}</p>
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
          className="rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--cb-primary-dark)]"
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
