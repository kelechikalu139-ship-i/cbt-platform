import {
  Ban,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import {
  Badge,
  Combobox,
  ConfirmDialog,
  DataTable,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  EmptyState,
  ErrorState,
  FilterSelect,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  PanelBody,
  ResultCount,
  SearchBar,
  StatusBadge,
  Toolbar,
  ToolbarGroup,
  type Column,
} from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import { useTableState } from '../../hooks/useTableState'
import { studentMutations, ApiError } from '../../services'
import type { EntityStatus, SchoolOptions, Student, StudentInput } from '../../types'
import { formatDate, formatNumber } from '../../utils'

/**
 * Student administration.
 *
 * Reads come from the paginated API (or the mock layer when
 * `VITE_USE_MOCK=true`). Mutations always go to the real backend,
 * because the mock layer has no persistence: a mutation there would
 * appear to succeed while changing nothing.
 */

interface StudentsPageProps {
  students: Student[]
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number }
  classNames: string[]
  exams: Array<{ id: string; title: string; showResultImmediately: boolean }>
  /**
   * The school's academic vocabulary, offered as suggestions by the add
   * and edit dialogs so programme, department, class and session names
   * stay uniform across the register.
   */
  schoolOptions?: SchoolOptions
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

const LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All levels' },
  ...([100, 200, 300, 400, 500, 600, 700, 800] as const).map((l) => ({
    value: String(l),
    label: `Level ${l}`,
  })),
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
]

/** CSV column headers accepted by the bulk importer. */
const CSV_COLUMNS = [
  'studentId',
  'firstName',
  'lastName',
  'email',
  'program',
  'department',
  'level',
  'semester',
  'className',
  'session',
  'gender',
  'status',
] as const

/**
 * A row from the CSV importer.
 *
 * Keys are lower-cased because `Papa.parse` runs `transformHeader`
 * with `.toLowerCase()`, so a `studentId` header becomes `studentid`
 * here. Keeping the interface in the same case avoids a whole class
 * of "column present but read as undefined" bugs.
 */
interface ParsedStudent {
  studentid: string
  firstname: string
  lastname: string
  email: string
  program: string
  department: string
  level: string
  semester: string
  classname: string
  session: string
  gender: string
  status: string
}

export function StudentsPage({
  students,
  meta,
  classNames,
  exams,
  schoolOptions,
  loading = false,
  error = null,
  onRetry,
}: StudentsPageProps) {
  const queryClient = useQueryClient()
  const table = useTableState<{ status: string; level: string; className: string }>({
    status: 'all',
    level: 'all',
    className: 'all',
  })
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [selected, setSelected] = useState<Student | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<Student | null>(null)
  const [pendingStatus, setPendingStatus] = useState<{ student: Student; status: EntityStatus } | null>(null)
  const [pendingSignOut, setPendingSignOut] = useState<Student | null>(null)
  const [pendingBulkFilter, setPendingBulkFilter] = useState<{ className?: string; examId?: string } | null>(null)

  // Mutation dialogs
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Student | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  // Server-sent error surfaced by the mutation dialogs
  const [mutationError, setMutationError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (payload: StudentInput) => studentMutations.create(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['students'] })
      void queryClient.invalidateQueries({ queryKey: ['student-classes'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setAddOpen(false)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<StudentInput> }) =>
      studentMutations.update(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['students'] })
      void queryClient.invalidateQueries({ queryKey: ['student-classes'] })
      setEditTarget(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => studentMutations.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['students'] })
      void queryClient.invalidateQueries({ queryKey: ['student-classes'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setPendingRemoval(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (filter: { className?: string; examId?: string }) =>
      studentMutations.removeByFilter(filter),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['students'] })
      void queryClient.invalidateQueries({ queryKey: ['student-classes'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setPendingBulkFilter(null)
      setBulkOpen(false)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  const setStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: EntityStatus }) =>
      studentMutations.setStatus(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['students'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setPendingStatus(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  // Ends the candidate's portal session. The same operation both stops an
  // active session and releases a stale one, which is why it reads "Sign
  // out" rather than "End session": freeing the admission number for a
  // fresh sign-in is the usual reason to reach for it.
  const signOutMutation = useMutation({
    mutationFn: (id: string) => studentMutations.endSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['students'] })
      void queryClient.invalidateQueries({ queryKey: ['live-sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setPendingSignOut(null)
      setMutationError(null)
    },
    onError: (err: unknown) => {
      setMutationError(errorMessage(err))
    },
  })

  // Filtering runs client-side here because the fixture set is already loaded.
  // With a live API the same predicate is pushed into the query parameters.
  const visible = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase()
    return students.filter((s) => {
      if (table.state.filters.status !== 'all' && s.status !== table.state.filters.status)
        return false
      if (table.state.filters.level !== 'all' && String(s.level) !== table.state.filters.level)
        return false
      if (
        table.state.filters.className !== 'all' &&
        s.className !== table.state.filters.className
      )
        return false
      if (!term) return true
      return [s.studentId, s.firstName, s.lastName, s.email, s.program, s.className]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    })
  }, [students, debouncedSearch, table.state.filters])

  const columns: Array<Column<Student>> = [
    {
      key: 'studentId',
      header: 'Student ID',
      sortable: true,
      width: 'w-40',
      cell: (s) => (
        <span className="tabular font-medium text-slate-800">{s.studentId}</span>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      sortable: false,
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">
            {s.firstName} {s.lastName}
          </p>
          {s.email && <p className="truncate text-2xs text-slate-500">{s.email}</p>}
        </div>
      ),
    },
    {
      key: 'program',
      header: 'Programme',
      width: 'w-40',
      hideBelow: 'lg',
      cell: (s) => <span className="text-slate-600">{s.program}</span>,
    },
    {
      key: 'className',
      header: 'Class',
      width: 'w-44',
      hideBelow: 'md',
      cell: (s) => <span className="text-slate-600">{s.className ?? '—'}</span>,
    },
    {
      key: 'session',
      header: 'Session',
      width: 'w-28',
      hideBelow: 'lg',
      cell: (s) => <span className="text-slate-600">{s.session ?? '—'}</span>,
    },
    {
      key: 'level',
      header: 'Level',
      width: 'w-24',
      align: 'right',
      sortable: true,
      hideBelow: 'sm',
      cell: (s) => <span className="tabular text-slate-600">{s.level}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-28',
      sortable: true,
      cell: (s) => <StatusBadge status={s.status} />,
    },
    {
      key: 'hasActiveSession',
      header: 'Signed in',
      width: 'w-28',
      align: 'center',
      cell: (s) => (
        <span className="inline-flex h-5 items-center justify-center gap-1 rounded px-2 text-xs font-medium">
          {s.hasActiveSession ? (
            <span className="bg-emerald-100 text-emerald-700">Active</span>
          ) : (
            <span className="bg-slate-100 text-slate-500">No</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 'w-12',
      align: 'right',
      cell: (s) => (
        /* Row clicks open the profile panel, so clicks in
            this cell are stopped here. The stop sits on the
            wrapper (not the trigger button) so the Dropdown's
            own toggle still receives the event and opens. */
        <div onClick={(ev) => ev.stopPropagation()}>
          <Dropdown
            align="right"
            trigger={
              <button
                type="button"
                aria-label={`Actions for ${s.firstName} ${s.lastName}`}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
          <DropdownItem
            icon={<Search className="h-3.5 w-3.5" />}
            onClick={() => setSelected(s)}
          >
            View profile
          </DropdownItem>
          <DropdownItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditTarget(s)
              setMutationError(null)
            }}
          >
            Edit details
          </DropdownItem>
          <DropdownDivider />
          {s.status === 'ACTIVE' ? (
            <DropdownItem
              icon={<Ban className="h-3.5 w-3.5" />}
              onClick={() => setPendingStatus({ student: s, status: 'SUSPENDED' })}
            >
              Suspend
            </DropdownItem>
          ) : (
            <DropdownItem
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => setPendingStatus({ student: s, status: 'ACTIVE' })}
            >
              Reactivate
            </DropdownItem>
          )}
          <DropdownItem
            icon={<X className="h-3.5 w-3.5" />}
            destructive
            onClick={() => setPendingRemoval(s)}
          >
            Deactivate
          </DropdownItem>
          {s.hasActiveSession && (
            <>
              <DropdownDivider />
              <DropdownItem
                icon={<Ban className="h-3.5 w-3.5" />}
                destructive
                onClick={() => setPendingSignOut(s)}
              >
                Sign out
              </DropdownItem>
            </>
          )}
          </Dropdown>
        </div>
      ),
    },
  ]

  const handleExport = () => {
    const rows = visible.map((s) => ({
      studentId: s.studentId,
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email ?? '',
      program: s.program,
      department: s.department ?? '',
      level: String(s.level),
      semester: String(s.semester),
      className: s.className ?? '',
      session: s.session ?? '',
      gender: s.gender ?? '',
      status: s.status,
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `students-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Students"
        description="Register, organise and manage the candidates who sit your examinations."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{formatNumber(meta.totalItems)} students</Badge>
            <Badge tone="neutral">{classNames.length} classes</Badge>
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
                Import CSV
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkOpen(true)
                  setMutationError(null)
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete by filter
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
              Add student
            </button>
          </>
        }
      />

      <Panel>
        <Toolbar>
          <ToolbarGroup>
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v)
                table.setSearch(v)
              }}
              placeholder="Search name, ID, email or class…"
              label="Search students"
            />
            <FilterSelect
              label="Status"
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={STATUS_OPTIONS}
            />
            <FilterSelect
              label="Level"
              value={table.state.filters.level}
              onChange={(v) => table.setFilter('level', v)}
              options={LEVEL_OPTIONS}
            />
            <FilterSelect
              label="Class"
              value={table.state.filters.className}
              onChange={(v) => table.setFilter('className', v)}
              options={[
                { value: 'all', label: 'All classes' },
                ...classNames.map((c) => ({ value: c, label: c })),
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
              rowKey={(s) => s.id}
              loading={loading}
              stickyHeader
              onRowClick={(s) => setSelected(s)}
              emptyTitle="No students match these filters"
              emptyDescription="Try clearing the search or widening the status, level and class filters."
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

      {/* Profile preview — read-only view of a student record. */}
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.firstName} ${selected.lastName}` : ''}
        description={selected?.studentId}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                if (selected) setEditTarget(selected)
                setSelected(null)
              }}
              className="rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--cb-primary-dark)]"
            >
              Edit details
            </button>
          </>
        }
      >
        {selected && <StudentProfile student={selected} />}
      </Modal>

      <AddStudentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        error={mutationError}
        submitting={createMutation.isPending}
        schoolOptions={schoolOptions}
        onSubmit={(payload) => createMutation.mutate(payload)}
      />

      <EditStudentModal
        student={editTarget}
        onClose={() => setEditTarget(null)}
        error={mutationError}
        submitting={updateMutation.isPending}
        schoolOptions={schoolOptions}
        onSubmit={(payload) =>
          editTarget && updateMutation.mutate({ id: editTarget.id, payload })
        }
      />

      <ImportStudentsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        error={mutationError}
        submitting={createMutation.isPending}
        onSubmit={(payloads) => {
          // Sequential creation so the server can report which row failed.
          void (async () => {
            for (const payload of payloads) {
              await createMutation.mutateAsync(payload).catch(() => undefined)
            }
          })()
        }}
      />

      <ConfirmDialog
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onConfirm={() => {
          if (!pendingBulkFilter) return
          bulkDeleteMutation.mutate(pendingBulkFilter)
        }}
        loading={bulkDeleteMutation.isPending}
        destructive
        title="Delete students by filter"
        confirmLabel="Delete"
        message={
          <>
            This will soft-delete every active student matching the filter below. Their
            existing results and sessions are retained for reporting, and they will be
            unable to sign in or start new examinations.
            <br />
            <br />
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Delete by
            </label>
            <div className="flex items-center gap-2 mb-3">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="radio"
                  name="bulk-filter-type"
                  checked={Boolean(pendingBulkFilter?.className)}
                  onChange={() =>
                    setPendingBulkFilter(
                      pendingBulkFilter?.className
                        ? { className: pendingBulkFilter.className }
                        : { className: '' },
                    )
                  }
                />
                Class
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="radio"
                  name="bulk-filter-type"
                  checked={Boolean(pendingBulkFilter?.examId)}
                  onChange={() =>
                    setPendingBulkFilter(
                      pendingBulkFilter?.examId
                        ? { examId: pendingBulkFilter.examId }
                        : { examId: '' },
                    )
                  }
                />
                Examination
              </label>
            </div>
            {pendingBulkFilter?.className ? (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Class
                </label>
                <select
                  value={pendingBulkFilter?.className ?? ''}
                  onChange={(ev) =>
                    setPendingBulkFilter({ ...pendingBulkFilter, className: ev.target.value })
                  }
                  className="w-full h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">Select a class</option>
                  {classNames.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Examination
                </label>
                <select
                  value={pendingBulkFilter?.examId ?? ''}
                  onChange={(ev) =>
                    setPendingBulkFilter({ ...pendingBulkFilter, examId: ev.target.value })
                  }
                  className="w-full h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">Select an examination</option>
                  {exams.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs text-slate-500">
              At least one filter must be selected. Students outside the filter are
              unaffected.
            </p>
          </>
        }
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => pendingRemoval && deleteMutation.mutate(pendingRemoval.id)}
        title="Deactivate student"
        destructive
        confirmLabel="Deactivate"
        message={
          <>
            This will deactivate{' '}
            <strong className="font-semibold text-slate-800">
              {pendingRemoval?.firstName} {pendingRemoval?.lastName}
            </strong>{' '}
            ({pendingRemoval?.studentId}). They will be unable to start new examinations,
            but their existing results are retained.
          </>
        }
      />

      <ConfirmDialog
        open={pendingStatus !== null}
        onCancel={() => setPendingStatus(null)}
        onConfirm={() =>
          pendingStatus && setStatusMutation.mutate({ id: pendingStatus.student.id, status: pendingStatus.status })
        }
        loading={setStatusMutation.isPending}
        destructive={pendingStatus?.status === 'SUSPENDED'}
        title={pendingStatus?.status === 'SUSPENDED' ? 'Suspend student' : 'Reactivate student'}
        confirmLabel={pendingStatus?.status === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
        message={
          pendingStatus?.status === 'SUSPENDED' ? (
            <>
              Suspending{' '}
              <strong className="font-semibold text-slate-800">
                {pendingStatus?.student.firstName} {pendingStatus?.student.lastName}
              </strong>{' '}
              ({pendingStatus?.student.studentId}) will prevent them from signing in to the
              portal or starting examinations. Their existing results are retained.
            </>
          ) : (
            <>
              Reactivating{' '}
              <strong className="font-semibold text-slate-800">
                {pendingStatus?.student.firstName} {pendingStatus?.student.lastName}
              </strong>{' '}
              ({pendingStatus?.student.studentId}) will restore their access to the portal
              and allow them to start examinations again.
            </>
          )
        }
      />

      <ConfirmDialog
        open={pendingSignOut !== null}
        onCancel={() => setPendingSignOut(null)}
        onConfirm={() => pendingSignOut && signOutMutation.mutate(pendingSignOut.id)}
        loading={signOutMutation.isPending}
        destructive
        title="Sign student out"
        confirmLabel="Sign out"
        message={
          <>
            This ends{' '}
            <strong className="font-semibold text-slate-800">
              {pendingSignOut?.firstName} {pendingSignOut?.lastName}
            </strong>
            's portal session immediately. Their admission number is free for a new sign-in,
            which is also the fix when a candidate is refused with "already signed in on
            another device" after a browser closed without signing out.
          </>
        }
      />
    </div>
  )
}

function StudentProfile({ student }: { student: Student }) {
  const rows: Array<[string, string]> = [
    ['Admission number', student.studentId],
    ['Full name', student.fullName],
    ['Email', student.email ?? '—'],
    ['Programme', student.program],
    ['Department', student.department ?? '—'],
    ['Class', student.className ?? '—'],
    ['Session', student.session ?? '—'],
    ['Level', String(student.level)],
    ['Semester', String(student.semester)],
    ['Status', student.status],
    ['Portal account', student.hasPortalAccount ? 'Issued' : 'Not issued'],
    ['Registered', formatDate(student.createdAt)],
  ]

  return (
    <PanelBody flush className="-mx-5 -my-4">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <span
          aria-hidden
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--cb-primary-bg)] text-sm font-semibold text-[var(--cb-primary-deep)]"
        >
          {student.firstName.charAt(0)}
          {student.lastName.charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {student.firstName} {student.lastName}
          </p>
          <p className="tabular truncate text-xs text-slate-500">{student.studentId}</p>
        </div>
        <div className="ml-auto">
          <StatusBadge status={student.status} />
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-8 px-5 py-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 last:border-0"
          >
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="tabular text-right text-xs font-medium capitalize text-slate-800">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
        <p className="text-2xs text-slate-500">
          Examination history and per-subject performance appear here once results exist.
        </p>
      </div>
    </PanelBody>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared form fields                                                          */
/* -------------------------------------------------------------------------- */

const STATUS_VALUES: EntityStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED']

interface FormFieldProps {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}

function FormField({ label, required, error, children }: FormFieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-[var(--cb-primary-deep)]"> *</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-2xs text-[var(--cb-primary-deep)]">{error}</span>}
    </label>
  )
}

const inputClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--cb-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--cb-primary)]'

/* -------------------------------------------------------------------------- */
/* Add student                                                                 */
/* -------------------------------------------------------------------------- */

interface AddStudentModalProps {
  open: boolean
  onClose: () => void
  error: string | null
  submitting: boolean
  schoolOptions?: SchoolOptions
  onSubmit: (payload: StudentInput) => void
}

function AddStudentModal({
  open,
  onClose,
  error,
  submitting,
  schoolOptions,
  onSubmit,
}: AddStudentModalProps) {
  const [form, setForm] = useState({
    studentId: '',
    firstName: '',
    lastName: '',
    email: '',
    program: '',
    department: '',
    level: '100',
    semester: '1',
    className: '',
    session: '',
    gender: '',
    status: 'ACTIVE' as EntityStatus,
    userEmail: '',
    userPassword: '',
  })

  // A fast double-click can dispatch the create before the button
  // renders as disabled; the second request would race the first
  // and hit the studentId unique constraint (P2002).
  const submitGuard = useSubmitGuard(submitting)

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitGuard.begin()) return
    onSubmit({
      studentId: form.studentId.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim() || undefined,
      program: form.program.trim(),
      department: form.department.trim() || undefined,
      level: Number(form.level),
      semester: Number(form.semester),
      className: form.className.trim() || undefined,
      session: form.session.trim() || undefined,
      gender: form.gender.trim() || undefined,
      status: form.status,
      userEmail: form.userEmail.trim() || undefined,
      userPassword: form.userPassword || undefined,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add student"
      description="Register a single candidate. Leave the portal section blank to issue no login."
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
            form="add-student-form"
            disabled={submitting}
            className="rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-[var(--cb-primary-dark)] disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add student'}
          </button>
        </>
      }
    >
      {error && (
        <p className="mb-4 rounded-md bg-[var(--cb-primary-bg)] px-3 py-2 text-sm text-[var(--cb-primary-deep)]">
          {error}
        </p>
      )}
      <form id="add-student-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Student ID" required>
            <input
              className={inputClass}
              value={form.studentId}
              onChange={(e) => set('studentId')(e.target.value)}
              placeholder="e.g. SCI/2025/0001"
              required
            />
          </FormField>
          <Combobox
            label="Programme"
            required
            value={form.program}
            onChange={(e) => set('program')(e.target.value)}
            options={schoolOptions?.programs ?? []}
            placeholder="Pick or type, e.g. Nursing"
          />
          <FormField label="First name" required>
            <input
              className={inputClass}
              value={form.firstName}
              onChange={(e) => set('firstName')(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Last name" required>
            <input
              className={inputClass}
              value={form.lastName}
              onChange={(e) => set('lastName')(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              className={inputClass}
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
              placeholder="name@school.local"
            />
          </FormField>
          <Combobox
            label="Department"
            value={form.department}
            onChange={(e) => set('department')(e.target.value)}
            options={schoolOptions?.departments ?? []}
            placeholder="Pick or type, e.g. Health Sciences"
          />
          <FormField label="Level" required>
            <select
              className={inputClass}
              value={form.level}
              onChange={(e) => set('level')(e.target.value)}
            >
              {[100, 200, 300, 400, 500, 600, 700, 800].map((l) => (
                <option key={l} value={String(l)}>
                  Level {l}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Semester" required>
            <select
              className={inputClass}
              value={form.semester}
              onChange={(e) => set('semester')(e.target.value)}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={String(s)}>
                  Semester {s}
                </option>
              ))}
            </select>
          </FormField>
          <Combobox
            label="Class"
            value={form.className}
            onChange={(e) => set('className')(e.target.value)}
            options={schoolOptions?.classes ?? []}
            placeholder="Pick or type, e.g. NMR 100 - A"
          />
          <Combobox
            label="Academic session"
            value={form.session}
            onChange={(e) => set('session')(e.target.value)}
            options={schoolOptions?.sessions ?? []}
            placeholder="Pick or type, e.g. 2026/2027"
          />
          <FormField label="Gender">
            <select
              className={inputClass}
              value={form.gender}
              onChange={(e) => set('gender')(e.target.value)}
            >
              <option value="">—</option>
              <option>Female</option>
              <option>Male</option>
            </select>
          </FormField>
          <FormField label="Status">
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) => set('status')(e.target.value as EntityStatus)}
            >
              {STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-xs font-medium text-slate-600">
            Portal login (optional)
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Portal email">
              <input
                type="email"
                className={inputClass}
                value={form.userEmail}
                onChange={(e) => set('userEmail')(e.target.value)}
                placeholder="student@school.local"
              />
            </FormField>
            <FormField label="Portal password">
              <input
                type="password"
                className={inputClass}
                value={form.userPassword}
                onChange={(e) => set('userPassword')(e.target.value)}
                placeholder="Min. 8 characters"
              />
            </FormField>
          </div>
          <p className="text-2xs text-slate-500">
            Either way the candidate can sign in with their admission number alone —
            the portal provisions that login automatically. These fields only add an
            email and password for the same account.
          </p>
        </fieldset>
      </form>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Edit student                                                                */
/* -------------------------------------------------------------------------- */

interface EditStudentModalProps {
  student: Student | null
  onClose: () => void
  error: string | null
  submitting: boolean
  schoolOptions?: SchoolOptions
  onSubmit: (payload: Partial<StudentInput>) => void
}

function EditStudentModal({
  student,
  onClose,
  error,
  submitting,
  schoolOptions,
  onSubmit,
}: EditStudentModalProps) {
  const [form, setForm] = useState({
    studentId: '',
    firstName: '',
    lastName: '',
    email: '',
    program: '',
    department: '',
    level: '100',
    semester: '1',
    className: '',
    session: '',
    gender: '',
    status: 'ACTIVE' as EntityStatus,
  })

  // Same re-entry guard as the add form: a double-click must not
  // fire the update twice and race the studentId unique constraint.
  const submitGuard = useSubmitGuard(submitting)

  // Seed the form whenever a different student is opened.
  const [seededId, setSeededId] = useState<string | null>(null)
  if (student && student.id !== seededId) {
    setSeededId(student.id)
    setForm({
      studentId: student.studentId,
      firstName: student.firstName,
      lastName: student.lastName,
      email: student.email ?? '',
      program: student.program,
      department: student.department ?? '',
      level: String(student.level),
      semester: String(student.semester),
      className: student.className ?? '',
      session: student.session ?? '',
      gender: student.gender ?? '',
      status: student.status,
    })
  }

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!student) return
    if (!submitGuard.begin()) return
    onSubmit({
      studentId: form.studentId.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim() || '',
      program: form.program.trim(),
      department: form.department.trim() || '',
      level: Number(form.level),
      semester: Number(form.semester),
      className: form.className.trim() || '',
      session: form.session.trim() || '',
      gender: form.gender.trim() || '',
      status: form.status,
    })
  }

  return (
    <Modal
      open={student !== null}
      onClose={onClose}
      title="Edit student"
      description={student?.studentId}
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
            form="edit-student-form"
            disabled={submitting}
            className="rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-[var(--cb-primary-dark)] disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {error && (
        <p className="mb-4 rounded-md bg-[var(--cb-primary-bg)] px-3 py-2 text-sm text-[var(--cb-primary-deep)]">
          {error}
        </p>
      )}
      <form id="edit-student-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Student ID" required>
            <input
              className={inputClass}
              value={form.studentId}
              onChange={(e) => set('studentId')(e.target.value)}
              required
            />
          </FormField>
          <Combobox
            label="Programme"
            required
            value={form.program}
            onChange={(e) => set('program')(e.target.value)}
            options={schoolOptions?.programs ?? []}
            placeholder="Pick or type, e.g. Nursing"
          />
          <FormField label="First name" required>
            <input
              className={inputClass}
              value={form.firstName}
              onChange={(e) => set('firstName')(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Last name" required>
            <input
              className={inputClass}
              value={form.lastName}
              onChange={(e) => set('lastName')(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Email">
            <input
              type="email"
              className={inputClass}
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
            />
          </FormField>
          <Combobox
            label="Department"
            value={form.department}
            onChange={(e) => set('department')(e.target.value)}
            options={schoolOptions?.departments ?? []}
            placeholder="Pick or type, e.g. Health Sciences"
          />
          <FormField label="Level" required>
            <select
              className={inputClass}
              value={form.level}
              onChange={(e) => set('level')(e.target.value)}
            >
              {[100, 200, 300, 400, 500, 600, 700, 800].map((l) => (
                <option key={l} value={String(l)}>
                  Level {l}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Semester" required>
            <select
              className={inputClass}
              value={form.semester}
              onChange={(e) => set('semester')(e.target.value)}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={String(s)}>
                  Semester {s}
                </option>
              ))}
            </select>
          </FormField>
          <Combobox
            label="Class"
            value={form.className}
            onChange={(e) => set('className')(e.target.value)}
            options={schoolOptions?.classes ?? []}
            placeholder="Pick or type, e.g. NMR 100 - A"
          />
          <Combobox
            label="Academic session"
            value={form.session}
            onChange={(e) => set('session')(e.target.value)}
            options={schoolOptions?.sessions ?? []}
            placeholder="Pick or type, e.g. 2026/2027"
          />
          <FormField label="Gender">
            <select
              className={inputClass}
              value={form.gender}
              onChange={(e) => set('gender')(e.target.value)}
            >
              <option value="">—</option>
              <option>Female</option>
              <option>Male</option>
            </select>
          </FormField>
          <FormField label="Status">
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) => set('status')(e.target.value as EntityStatus)}
            >
              {STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </form>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Bulk import (CSV)                                                           */
/* -------------------------------------------------------------------------- */

interface ImportStudentsModalProps {
  open: boolean
  onClose: () => void
  error: string | null
  submitting: boolean
  onSubmit: (payloads: StudentInput[]) => void
}

function ImportStudentsModal({ open, onClose, error, submitting, onSubmit }: ImportStudentsModalProps) {
  const [rows, setRows] = useState<ParsedStudent[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)

  // Guards the import button against a double-click, which would
  // otherwise start a second sequential loop and re-create rows
  // the first loop already inserted.
  const submitGuard = useSubmitGuard(submitting)

  const handleFile = (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setParseError(null)

    Papa.parse<ParsedStudent>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        if (result.errors.length > 0) {
          setParseError(result.errors[0]?.message ?? 'CSV parse failed')
          setRows([])
          return
        }

        const parsed = result.data
        if (parsed.length === 0) {
          setParseError('The file contains no data rows.')
          return
        }

        // Validate headers: every required column must be present.
        // Headers arrive lower-cased (see transformHeader), so compare
        // against the lower-cased form of each expected column.
        const headers = Object.keys(parsed[0] ?? {})
        const missing = CSV_COLUMNS.filter(
          (col) => !headers.includes(col.toLowerCase()),
        )
        if (missing.length > 0) {
          setParseError(`Missing required columns: ${missing.join(', ')}`)
          return
        }

        setRows(parsed)
      },
      error: () => {
        setParseError('Could not read the file.')
        setRows([])
      },
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitGuard.begin()) return
    const payloads: StudentInput[] = rows.map((row) => ({
      studentId: row.studentid?.trim() ?? '',
      firstName: row.firstname?.trim() ?? '',
      lastName: row.lastname?.trim() ?? '',
      email: row.email?.trim() || undefined,
      program: row.program?.trim() ?? '',
      department: row.department?.trim() || undefined,
      level: Number(row.level) || 100,
      semester: Number(row.semester) || 1,
      className: row.classname?.trim() || undefined,
      session: row.session?.trim() || undefined,
      gender: row.gender?.trim() || undefined,
      status: (STATUS_VALUES.includes(row.status as EntityStatus)
        ? row.status
        : 'ACTIVE') as EntityStatus,
    }))
    onSubmit(payloads)
  }

  const handleClose = () => {
    setRows([])
    setFileName('')
    setParseError(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import students from CSV"
      description="Bulk upload a class, programme or semester roster"
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="import-students-form"
            disabled={submitting || rows.length === 0}
            className="rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-[var(--cb-primary-dark)] disabled:opacity-50"
          >
            {submitting ? 'Importing…' : `Import ${rows.length} student${rows.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <form id="import-students-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            CSV file
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {fileName && (
            <p className="mt-1 text-2xs text-slate-500">Selected: {fileName}</p>
          )}
          {(parseError ?? error) && (
            <p className="mt-2 rounded-md bg-[var(--cb-primary-bg)] px-3 py-2 text-sm text-[var(--cb-primary-deep)]">
              {parseError ?? error}
            </p>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">Required columns</p>
          <p className="text-2xs text-slate-500">
            {CSV_COLUMNS.join(', ')}
          </p>
        </div>

        {rows.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-slate-700">
              Preview ({rows.length} rows)
            </p>
            <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="px-3 py-2">Student ID</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Programme</th>
                    <th className="px-3 py-2">Level</th>
                    <th className="px-3 py-2">Semester</th>
                    <th className="px-3 py-2">Class</th>
                    <th className="px-3 py-2">Session</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 50).map((row, i) => (
                    <tr key={`${row.studentid}-${i}`}>
                      <td className="px-3 py-1.5 tabular">{row.studentid}</td>
                      <td className="px-3 py-1.5">
                        {row.firstname} {row.lastname}
                      </td>
                      <td className="px-3 py-1.5">{row.program}</td>
                      <td className="px-3 py-1.5 tabular">{row.level}</td>
                      <td className="px-3 py-1.5 tabular">{row.semester}</td>
                      <td className="px-3 py-1.5">{row.classname}</td>
                      <td className="px-3 py-1.5">{row.session}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 50 && (
              <p className="mt-1 text-2xs text-slate-500">
                Showing first 50 of {rows.length} rows.
              </p>
            )}
          </div>
        )}

        <details className="rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">
            Download a template CSV
          </summary>
          <p className="mt-2 text-2xs text-slate-500">
            Copy this header row into a spreadsheet, then fill one row per student.
          </p>
          <button
            type="button"
            onClick={() => {
              const csv = Papa.unparse([
                {
                  studentId: 'SCI/2025/0001',
                  firstName: 'Example',
                  lastName: 'Student',
                  email: 'student@example.local',
                  program: 'Computer Science',
                  department: 'Science',
                  level: 100,
                  semester: 1,
                  className: 'SCI 100 - A',
                  session: '2026/2027',
                  gender: 'Female',
                  status: 'ACTIVE',
                },
              ])
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = 'students-template.csv'
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
              URL.revokeObjectURL(url)
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Template
          </button>
        </details>
      </form>
    </Modal>
  )
}

/**
 * Extract a readable message from an API error.
 *
 * The HTTP client throws `ApiError`, whose message is the server's
 * message verbatim (e.g. "A student with this student ID already exists").
 * Axios-style `err.response.data.message` is handled as a fallback only.
 *
 * For 409 conflicts the message is augmented with guidance so the operator
 * knows the student already exists and what to do next (edit or reactivate).
 */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return `${err.message} Close this dialog, locate the student in the list, and use Edit or Suspend to update their record instead.`
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  const anyErr = err as { response?: { data?: { message?: string } } }
  return anyErr?.response?.data?.message ?? 'The request failed. Check the values and try again.'
}

/** Fallback when a parent has no data at all. */
export function StudentsEmptyState() {
  return (
    <EmptyState
      title="No students registered"
      description="Add your first student, or import a CSV export from the previous system."
    />
  )
}