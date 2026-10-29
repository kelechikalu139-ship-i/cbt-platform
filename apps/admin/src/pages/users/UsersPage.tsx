import { KeyRound, MoreHorizontal, Pencil, Plus, Shield, Trash2, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  PanelHeader,
  PhaseNotice,
  ResultCount,
  SearchBar,
  StatusBadge,
  Toolbar,
  ToolbarGroup,
  type Column,
} from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useTableState } from '../../hooks/useTableState'
import { PendingActionModal } from '../questions/QuestionsPage'
import { ROLES, ROLE_LABELS, type Role, type User, type UserInput } from '../../types'
import { usersApi } from '../../services'
import { formatDateTime, formatRelative, initials } from '../../utils'

interface UsersPageProps {
  users: User[]
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number }
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

const ROLE_TONE: Record<Role, 'danger' | 'brand' | 'info' | 'neutral' | 'violet'> = {
  SUPER_ADMIN: 'danger',
  ADMIN: 'brand',
  EXAM_OFFICER: 'info',
  LECTURER: 'neutral',
  INVIGILATOR: 'violet',
  STUDENT: 'neutral',
}

/** Plain-language summary of what each role can reach. */
const ROLE_SUMMARY: Record<Role, string> = {
  SUPER_ADMIN: 'Installation owner: unrestricted access including user, licence and system management. Reserved for the app owner or the school\u2019s designated system administrator.',
  ADMIN: 'Full operational access except licence and system management.',
  EXAM_OFFICER: 'Runs examinations and publishes results. No question authoring.',
  LECTURER: 'Authors and edits questions in their subjects. Read-only on results.',
  INVIGILATOR: 'Live session monitoring and candidate lookup only.',
  STUDENT: 'Sits examinations. No administrative access.',
}

const ROLE_OPTIONS = [
  { value: 'all', label: 'All roles' },
  ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
]

export function UsersPage({ users, meta, loading = false, error = null, onRetry }: UsersPageProps) {
  const table = useTableState<{ role: string; status: string }>({ role: 'all', status: 'all' })
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const [notice, setNotice] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const [roleUser, setRoleUser] = useState<User | null>(null)
  const [roleDraft, setRoleDraft] = useState<Exclude<Role, 'STUDENT'>>('LECTURER')
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ email: '', password: '', firstName: '', lastName: '', roleCode: 'LECTURER' as Exclude<Role, 'STUDENT'>, status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' })
  const [addError, setAddError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (payload: { email: string; password: string; firstName: string; lastName: string; roleCode: Exclude<Role, 'STUDENT'>; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' }) =>
      usersApi.create(payload satisfies UserInput),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      setAddOpen(false)
      setAddForm({ email: '', password: '', firstName: '', lastName: '', roleCode: 'LECTURER', status: 'ACTIVE' })
      setAddError(null)
    },
    onError: (err) => setAddError(err instanceof Error ? err.message : 'Failed to create user'),
  })

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Exclude<Role, 'STUDENT'> }) =>
      usersApi.update(id, { roleCode: role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      setRoleUser(null)
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : 'Failed to change role'),
  })

  const visible = useMemo(() => {
    const term = debounced.trim().toLowerCase()
    return users.filter((u) => {
      const f = table.state.filters
      if (f.role !== 'all' && u.role !== f.role) return false
      if (f.status !== 'all' && u.status !== f.status) return false
      if (!term) return true
      return [u.fullName, u.email].some((v) =>
        String(v ?? '').toLowerCase().includes(term),
      )
    })
  }, [users, debounced, table.state.filters])

  const columns: Array<Column<User>> = [
    {
      key: 'fullName',
      header: 'User',
      sortable: true,
      cell: (u) => (
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--cb-primary-bg)] text-2xs font-semibold text-[var(--cb-primary-deep)]"
          >
            {initials(u.fullName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{u.fullName}</p>
            <p className="truncate text-2xs text-slate-500">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: 'w-36',
      sortable: true,
      cell: (u) => (
        <Badge tone={ROLE_TONE[u.role]} dot={false}>
          {ROLE_LABELS[u.role]}
        </Badge>
      ),
    },
    {
      key: 'lastLoginAt',
      header: 'Last sign-in',
      width: 'w-36',
      hideBelow: 'md',
      cell: (u) => (
        <span
          className="text-slate-500"
          title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}
        >
          {u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-24',
      cell: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'actions',
      header: '',
      width: 'w-12',
      align: 'right',
      cell: (u) => (
        <Dropdown
          align="right"
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${u.fullName}`}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          <DropdownItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setNotice('Edit user')}>
            Edit
          </DropdownItem>
          <DropdownItem
            icon={<Shield className="h-3.5 w-3.5" />}
            onClick={() => {
              setRoleUser(u)
              setRoleDraft(u.role === 'STUDENT' ? 'LECTURER' : (u.role as Exclude<Role, 'STUDENT'>))
            }}
          >
            Change role
          </DropdownItem>
          <DropdownItem
            icon={<KeyRound className="h-3.5 w-3.5" />}
            onClick={() => setNotice('Reset password')}
          >
            Reset password
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem
            icon={<UserX className="h-3.5 w-3.5" />}
            destructive
            onClick={() => setNotice('Deactivate user')}
          >
            Deactivate
          </DropdownItem>
          <DropdownItem icon={<Trash2 className="h-3.5 w-3.5" />} destructive onClick={() => setNotice('Delete user')}>
            Delete
          </DropdownItem>
        </Dropdown>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Administrative accounts and the permissions attached to each role."
        meta={<Badge tone="brand">{users.length} accounts</Badge>}
        actions={
          <button
            type="button"
                  onClick={() => setAddOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 text-sm font-medium shadow-sm transition-colors hover:bg-[var(--cb-primary-dark)]"
          >
            <Plus className="h-4 w-4" />
            Add user
          </button>
        }
      />

      <PhaseNotice phase="Phase 10 — Users and Permissions">
        Role permissions are modelled in <code className="rounded bg-amber-100 px-1">utils/permissions.ts</code>{' '}
        and used to decide what the interface renders. The API must enforce every one of them
        independently — hiding a menu item is not access control.
      </PhaseNotice>

      <Panel>
        <Toolbar>
          <ToolbarGroup>
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search name, email or username…"
              label="Search users"
            />
            <FilterSelect
              label="Role"
              value={table.state.filters.role}
              onChange={(v) => table.setFilter('role', v)}
              options={ROLE_OPTIONS}
            />
            <FilterSelect
              label="Status"
              value={table.state.filters.status}
              onChange={(v) => table.setFilter('status', v)}
              options={STATUS_OPTIONS}
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
              rowKey={(u) => u.id}
              loading={loading}
              stickyHeader
              emptyTitle="No users match these filters"
              emptyAction={
                <button
                  type="button"
            onClick={() => setAddOpen(true)}
                  className="text-xs font-medium text-[var(--cb-primary-deep)] hover:underline"
                >
                  Add the first user
                </button>
              }
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

      <Panel>
        <PanelHeader
          title="Role permissions"
          description="What each role is expected to reach"
          actions={
            <span className="flex items-center gap-1.5 text-2xs text-slate-400">
              <Shield className="h-3.5 w-3.5" />
              Server enforced
            </span>
          }
        />
        <PanelBody flush>
          <dl className="divide-y divide-slate-100">
            {ROLES.map((role) => (
              <div key={role} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <dt className="w-40 shrink-0">
                  <Badge tone={ROLE_TONE[role]} dot={false}>
                    {ROLE_LABELS[role]}
                  </Badge>
                </dt>
                <dd className="min-w-0 flex-1 text-xs text-slate-600">{ROLE_SUMMARY[role]}</dd>
                <dd className="tabular shrink-0 text-2xs text-slate-400">
                  {users.filter((u) => u.role === role).length} account
                  {users.filter((u) => u.role === role).length === 1 ? '' : 's'}
                </dd>
              </div>
            ))}
          </dl>
        </PanelBody>
      </Panel>

      <Modal
        open={roleUser !== null}
        onClose={() => setRoleUser(null)}
        title="Change role"
        description={roleUser ? `Assign a new role to ${roleUser.fullName}.` : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={() => setRoleUser(null)}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={changeRoleMutation.isPending}
              onClick={() => roleUser && changeRoleMutation.mutate({ id: roleUser.id, role: roleDraft })}
              className="inline-flex h-9 items-center rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 text-sm font-medium shadow-sm hover:bg-[var(--cb-primary-dark)] disabled:opacity-50"
            >
              {changeRoleMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <label className="block text-sm font-medium text-slate-700">
          Role
          <select
            value={roleDraft}
            onChange={(e) => setRoleDraft(e.target.value as Exclude<Role, 'STUDENT'>)}
            className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
          >
            {ROLES.filter((r) => r !== 'STUDENT').map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => { setAddOpen(false); setAddError(null) }}
        title="Add user"
        description="Create a staff account. Super administrator is limited to one per installation."
        footer={
          <>
            <button type="button" onClick={() => { setAddOpen(false); setAddError(null) }} className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate(addForm)}
              className="inline-flex h-9 items-center rounded-md bg-[var(--cb-primary)] text-[var(--cb-primary-text)] px-3.5 text-sm font-medium shadow-sm hover:bg-[var(--cb-primary-dark)] disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {addError && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{addError}</p>}
          <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="First name" value={addForm.firstName} onChange={(e) => setAddForm({ ...addForm, firstName: e.target.value })} />
          <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="Last name" value={addForm.lastName} onChange={(e) => setAddForm({ ...addForm, lastName: e.target.value })} />
          <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="Email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
          <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" type="password" placeholder="Password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} />
          <select className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" value={addForm.roleCode} onChange={(e) => setAddForm({ ...addForm, roleCode: e.target.value as Exclude<Role, 'STUDENT'> })}>
            {ROLES.filter((r) => r !== 'STUDENT' && r !== 'SUPER_ADMIN').map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
      </Modal>

      <PendingActionModal
        action={notice}
        phase="Phase 10 — Users and Permissions"
        onClose={() => setNotice(null)}
      />
    </div>
  )
}
