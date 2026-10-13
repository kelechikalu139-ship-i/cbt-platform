import { FolderTree, MoreHorizontal, Pencil, Plus, Power, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  PageHeader,
  Panel,
  PanelBody,
  StatusBadge,
  type Column,
} from '../../components/ui'
import { CategoryEditor, SubjectEditor } from '../../components/categories'
import { ApiError, categoriesApi, subjectsApi } from '../../services'
import type { Category, CategoryInput, Subject, SubjectInput } from '../../types'
import { formatDate, formatNumber } from '../../utils'

interface CategoriesPageProps {
  categories: Category[]
  subjects: Subject[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

/**
 * Query keys that a category or subject mutation may invalidate. Kept in sync with
 * the keys used by `CategoriesRoute`, `QuestionsRoute` and the dashboard route so a
 * change here propagates everywhere the taxonomy is consumed.
 */
const INVALIDATE_KEYS = ['categories', 'category-subjects', 'question-categories', 'dashboard']

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  const anyErr = err as { response?: { data?: { message?: string } } }
  return anyErr?.response?.data?.message ?? 'The request failed. Check the values and try again.'
}

/**
 * Categories and their subjects.
 *
 * Rendered as a two-level list rather than a flat table: an administrator thinks
 * in terms of "Nursing → Fundamentals", and the hierarchy is already in the
 * schema (`parentId`) for nesting later.
 */
export function CategoriesPage({
  categories,
  subjects,
  loading = false,
  error = null,
  onRetry,
}: CategoriesPageProps) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    INVALIDATE_KEYS.forEach((k) => void queryClient.invalidateQueries({ queryKey: [k] }))

  const [mutationError, setMutationError] = useState<string | null>(null)

  /* ------------------------------------------------------------------ */
  /* Categories                                                          */
  /* ------------------------------------------------------------------ */

  const [addCategoryOpen, setAddCategoryOpen] = useState(false)
  const [editCategory, setEditCategory] = useState<Category | null>(null)
  const [pendingCategoryRemoval, setPendingCategoryRemoval] = useState<Category | null>(null)

  const categoryCreateMutation = useMutation({
    mutationFn: (payload: CategoryInput) => categoriesApi.create(payload),
    onSuccess: () => {
      invalidate()
      setAddCategoryOpen(false)
      setEditCategory(null)
      setMutationError(null)
    },
    onError: (err: unknown) => setMutationError(errorMessage(err)),
  })

  const categoryUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CategoryInput> }) =>
      categoriesApi.update(id, payload),
    onSuccess: () => {
      invalidate()
      setEditCategory(null)
      setMutationError(null)
    },
    onError: (err: unknown) => setMutationError(errorMessage(err)),
  })

  const categoryActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      categoriesApi.setActive(id, isActive),
    onSuccess: () => {
      invalidate()
      setMutationError(null)
    },
    onError: (err: unknown) => setMutationError(errorMessage(err)),
  })

  const categoryDeleteMutation = useMutation({
    mutationFn: (id: string) => categoriesApi.remove(id),
    onSuccess: () => {
      invalidate()
      setPendingCategoryRemoval(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
      setPendingCategoryRemoval(null)
    },
  })

  /* ------------------------------------------------------------------ */
  /* Subjects                                                            */
  /* ------------------------------------------------------------------ */

  const [addSubjectOpen, setAddSubjectOpen] = useState(false)
  const [editSubject, setEditSubject] = useState<Subject | null>(null)
  const [pendingSubjectRemoval, setPendingSubjectRemoval] = useState<Subject | null>(null)

  const subjectCreateMutation = useMutation({
    mutationFn: (payload: SubjectInput) => subjectsApi.create(payload),
    onSuccess: () => {
      invalidate()
      setAddSubjectOpen(false)
      setMutationError(null)
    },
    onError: (err: unknown) => setMutationError(errorMessage(err)),
  })

  const subjectUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SubjectInput> }) =>
      subjectsApi.update(id, payload),
    onSuccess: () => {
      invalidate()
      setEditSubject(null)
      setMutationError(null)
    },
    onError: (err: unknown) => setMutationError(errorMessage(err)),
  })

  const subjectDeleteMutation = useMutation({
    mutationFn: (id: string) => subjectsApi.remove(id),
    onSuccess: () => {
      invalidate()
      setPendingSubjectRemoval(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
      setPendingSubjectRemoval(null)
    },
  })

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(categories.slice(0, 3).map((c) => c.id)),
  )

  const subjectsByCategory = useMemo(() => {
    const map = new Map<string, Subject[]>()
    for (const subject of subjects) {
      const list = map.get(subject.categoryId) ?? []
      list.push(subject)
      map.set(subject.categoryId, list)
    }
    return map
  }, [subjects])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const anyEditorOpen =
    addCategoryOpen ||
    !!editCategory ||
    pendingCategoryRemoval !== null ||
    addSubjectOpen ||
    !!editSubject ||
    pendingSubjectRemoval !== null

  const categoryColumns: Array<Column<Category>> = [
    {
      key: 'name',
      header: 'Category',
      sortable: true,
      cell: (c) => {
        const children = subjectsByCategory.get(c.id) ?? []
        const isOpen = expanded.has(c.id)
        return (
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggle(c.id)
              }}
              aria-expanded={isOpen}
              aria-label={isOpen ? `Collapse ${c.name}` : `Expand ${c.name}`}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
              disabled={children.length === 0}
            >
              <span
                aria-hidden
                className={`text-[10px] leading-none ${isOpen ? 'rotate-90' : ''} transition-transform`}
              >
                ▶
              </span>
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{c.name}</p>
              {c.description && (
                <p className="mt-0.5 line-clamp-1 text-2xs text-slate-500">{c.description}</p>
              )}
            </div>
          </div>
        )
      },
    },
    {
      key: 'subjects',
      header: 'Subjects',
      width: 'w-24',
      align: 'right',
      hideBelow: 'sm',
      cell: (c) => (
        <span className="tabular text-slate-600">
          {(subjectsByCategory.get(c.id) ?? []).length || '—'}
        </span>
      ),
    },
    {
      key: 'questionCount',
      header: 'Questions',
      width: 'w-28',
      align: 'right',
      sortable: true,
      cell: (c) => (
        <span className="tabular font-medium text-slate-800">{formatNumber(c.questionCount)}</span>
      ),
    },
    {
      key: 'subjectCount',
      header: 'Subjects',
      width: 'w-24',
      align: 'right',
      hideBelow: 'md',
      cell: (c) => <span className="tabular text-slate-600">{c.subjectCount}</span>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: 'w-28',
      sortable: true,
      hideBelow: 'xl',
      cell: (c) => <span className="tabular text-slate-500">{formatDate(c.createdAt)}</span>,
    },
    {
      key: 'isActive',
      header: 'Status',
      width: 'w-24',
      cell: (c) => (
        <Badge tone={c.isActive ? 'success' : 'neutral'}>
          {c.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 'w-12',
      align: 'right',
      cell: (c) => (
        <Dropdown
          align="right"
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${c.name}`}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          <DropdownItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditCategory(c)
              setMutationError(null)
            }}
          >
            Edit
          </DropdownItem>
          <DropdownItem
            icon={<Power className="h-3.5 w-3.5" />}
            onClick={() => {
              setMutationError(null)
              void categoryActiveMutation.mutate({ id: c.id, isActive: !c.isActive })
            }}
          >
            {c.isActive ? 'Deactivate' : 'Activate'}
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            destructive
            onClick={() => setPendingCategoryRemoval(c)}
          >
            Delete
          </DropdownItem>
        </Dropdown>
      ),
    },
  ]

  const subjectColumns: Array<Column<Subject>> = [
    {
      key: 'subject',
      header: 'Subject',
      cell: (s) => <span className="text-sm font-medium text-slate-800">{s.name}</span>,
    },
    {
      key: 'code',
      header: 'Code',
      width: 'w-28',
      cell: (s) => <span className="tabular text-slate-600">{s.code ?? '—'}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      width: 'w-56',
      hideBelow: 'sm',
      cell: (s) => (
        <span className="text-slate-600">
          {categories.find((c) => c.id === s.categoryId)?.name ?? '—'}
        </span>
      ),
    },
    {
      key: 'questionCount',
      header: 'Questions',
      width: 'w-28',
      align: 'right',
      cell: (s) => (
        <span className="tabular font-medium text-slate-800">{formatNumber(s.questionCount)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-24',
      hideBelow: 'md',
      cell: (s) => <StatusBadge status={s.status} />,
    },
    {
      key: 'actions',
      header: '',
      width: 'w-12',
      align: 'right',
      cell: (s) => (
        <Dropdown
          align="right"
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${s.name}`}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          <DropdownItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditSubject(s)
              setMutationError(null)
            }}
          >
            Edit
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            destructive
            onClick={() => setPendingSubjectRemoval(s)}
          >
            Delete
          </DropdownItem>
        </Dropdown>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Categories"
        description="Organise the question bank into subjects and areas of study."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{categories.length} categories</Badge>
            <Badge tone="neutral">{subjects.length} subjects</Badge>
          </div>
        }
        actions={
          <button
            type="button"
            onClick={() => {
              setAddCategoryOpen(true)
              setMutationError(null)
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            Add category
          </button>
        }
      />

      {mutationError && !anyEditorOpen && (
        <Alert
          tone="danger"
          title="Could not complete that action"
          actions={
            <button
              type="button"
              onClick={() => setMutationError(null)}
              className="rounded p-1 text-red-600/70 hover:bg-red-100/50 hover:text-red-700"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          }
        >
          {mutationError}
        </Alert>
      )}

      <Panel>
        <PanelBody flush>
          {error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : categories.length === 0 ? (
            <EmptyState
              icon={<FolderTree className="h-5 w-5" />}
              title="No categories yet"
              description="Create a category such as Nursing or General Studies, then add subjects beneath it."
            />
          ) : (
            <div className="relative overflow-x-auto">
              <DataTable
                columns={categoryColumns}
                rows={categories}
                rowKey={(c) => c.id}
                loading={loading}
                emptyTitle="No categories found"
              />
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* Subject roll-up, shown as a second panel so nesting stays legible. */}
      <Panel>
        <PanelBody flush>
          <div className="flex items-start justify-between px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Subjects by category</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Every subject carries the question pool size available to examination papers.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAddSubjectOpen(true)
                setMutationError(null)
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Add subject
            </button>
          </div>
          <DataTable
            columns={subjectColumns}
            rows={subjects}
            rowKey={(s) => s.id}
            loading={loading}
            stickyHeader
            emptyTitle="No subjects found"
          />
        </PanelBody>
      </Panel>

      {/* Category editor (add + edit) */}
      <CategoryEditor
        open={addCategoryOpen}
        onClose={() => setAddCategoryOpen(false)}
        category={null}
        submitting={categoryCreateMutation.isPending}
        error={mutationError}
        onSubmit={(payload) => categoryCreateMutation.mutate(payload)}
      />
      <CategoryEditor
        open={editCategory !== null}
        onClose={() => setEditCategory(null)}
        category={editCategory}
        submitting={categoryUpdateMutation.isPending}
        error={mutationError}
        onSubmit={(payload) => {
          if (editCategory) categoryUpdateMutation.mutate({ id: editCategory.id, payload })
        }}
      />

      {/* Subject editor (add + edit) */}
      <SubjectEditor
        open={addSubjectOpen}
        onClose={() => setAddSubjectOpen(false)}
        subject={null}
        categories={categories}
        submitting={subjectCreateMutation.isPending}
        error={mutationError}
        onSubmit={(payload) => subjectCreateMutation.mutate(payload)}
      />
      <SubjectEditor
        open={editSubject !== null}
        onClose={() => setEditSubject(null)}
        subject={editSubject}
        categories={categories}
        submitting={subjectUpdateMutation.isPending}
        error={mutationError}
        onSubmit={(payload) => {
          if (editSubject) subjectUpdateMutation.mutate({ id: editSubject.id, payload })
        }}
      />

      {/* Confirmation gates for destructive actions */}
      <ConfirmDialog
        open={pendingCategoryRemoval !== null}
        onCancel={() => setPendingCategoryRemoval(null)}
        onConfirm={() => {
          if (pendingCategoryRemoval) void categoryDeleteMutation.mutate(pendingCategoryRemoval.id)
        }}
        loading={categoryDeleteMutation.isPending}
        destructive
        title="Delete category"
        confirmLabel="Delete"
        message={
          pendingCategoryRemoval ? (
            <>
              Delete <strong className="font-semibold text-slate-800">{pendingCategoryRemoval.name}</strong
              >? This removes it from the question bank. A category with subjects or questions
              cannot be deleted — reassign them first.
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={pendingSubjectRemoval !== null}
        onCancel={() => setPendingSubjectRemoval(null)}
        onConfirm={() => {
          if (pendingSubjectRemoval) void subjectDeleteMutation.mutate(pendingSubjectRemoval.id)
        }}
        loading={subjectDeleteMutation.isPending}
        destructive
        title="Delete subject"
        confirmLabel="Delete"
        message={
          pendingSubjectRemoval ? (
            <>
              Delete <strong className="font-semibold text-slate-800">{pendingSubjectRemoval.name} (
              {pendingSubjectRemoval.code ?? '—'})</strong
              >? This removes it from the question bank. Reassign its questions first if needed.
            </>
          ) : null
        }
      />
    </div>
  )
}
