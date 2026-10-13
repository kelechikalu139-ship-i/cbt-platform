import { ScrollText } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  FilterSelect,
  PageHeader,
  Pagination,
  Panel,
  PhaseNotice,
  ResultCount,
  SearchBar,
  Toolbar,
  ToolbarGroup,
  type Column,
} from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useTableState } from '../../hooks/useTableState'
import {
  auditActionLabel,
  type AuditLog,
} from '../../types'
import { formatDateTime, formatRelative } from '../../utils'

interface AuditLogsPageProps {
  logs: AuditLog[]
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number }
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

/**
 * Badge tone per action.
 *
 * Keyed by a suffix rather than an exact identifier, so a new server-side action
 * inherits a sensible tone instead of rendering as an unknown neutral chip.
 */
function toneForAction(action: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' {
  if (action.includes('DELETE')) return 'danger'
  if (action.includes('CREATE')) return 'success'
  if (action.includes('PUBLISH')) return action.includes('UNPUBLISH') ? 'warning' : 'success'
  if (action.includes('UPDATE')) return 'info'
  if (action.startsWith('LOGIN') || action.startsWith('LOGOUT')) {
    return action === 'LOGIN_FAILED' ? 'danger' : 'neutral'
  }
  return 'neutral'
}

/** Entity labels, mirroring the server's resource names. */
const ENTITY_OPTIONS = [
  { value: 'all', label: 'All resources' },
  ...['STUDENT', 'QUESTION', 'CATEGORY', 'SUBJECT', 'EXAM', 'USER', 'AUTH'].map((entity) => ({
    value: entity,
    label: entity.replace(/_/g, ' ').toLowerCase(),
  })),
]

/**
 * Audit log.
 *
 * Append-only by design: there is no edit or delete affordance anywhere on this
 * page, by intent. Ordinary administrative accounts should be unable to alter
 * history, so the backend rejects update and delete on this table outright.
 */
export function AuditLogsPage({
  logs,
  meta,
  loading = false,
  error = null,
  onRetry,
}: AuditLogsPageProps) {
  const table = useTableState<{ action: string; entity: string }>({
    action: 'all',
    entity: 'all',
  })
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)

  /**
   * Action filter options, derived from the rows on screen.
   *
   * The server owns the action vocabulary (`GET /audit-logs/actions` returns it),
   * so a hardcoded list here would drift and would hide actions the admin has not
   * seen yet. Deriving from the loaded page keeps the filter honest for whatever
   * has been returned.
   */
  const actionOptions = useMemo(() => {
    const distinct = [...new Set(logs.map((log) => log.action))].sort()
    return [
      { value: 'all', label: 'All actions' },
      ...distinct.map((action) => ({ value: action, label: auditActionLabel(action) })),
    ]
  }, [logs])

  const visible = useMemo(() => {
    const term = debounced.trim().toLowerCase()
    return logs.filter((log) => {
      const f = table.state.filters
      if (f.action !== 'all' && log.action !== f.action) return false
      if (f.entity !== 'all' && log.entity !== f.entity) return false
      if (!term) return true
      return [log.description, log.actorName, log.actorEmail, log.ipAddress].some((v) =>
        String(v ?? '').toLowerCase().includes(term),
      )
    })
  }, [logs, debounced, table.state.filters])

  const columns: Array<Column<AuditLog>> = [
    {
      key: 'createdAt',
      header: 'When',
      width: 'w-44',
      sortable: true,
      cell: (log) => (
        <span className="tabular text-slate-600" title={formatDateTime(log.createdAt)}>
          {formatRelative(log.createdAt)}
        </span>
      ),
    },
    {
      // A rejected sign-in has no actor, so the actor columns must tolerate null
      // rather than rendering "undefined".
      key: 'actorName',
      header: 'User',
      width: 'w-48',
      sortable: true,
      cell: (log) => (
        <div className="min-w-0">
          <p className="truncate text-slate-800">
            {log.actorName ?? <span className="text-slate-400">Unauthenticated</span>}
          </p>
          {log.actorEmail ? (
            <p className="truncate text-2xs text-slate-400">{log.actorEmail}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      width: 'w-40',
      sortable: true,
      cell: (log) => (
        <Badge tone={toneForAction(log.action)} dot={false}>
          {auditActionLabel(log.action)}
        </Badge>
      ),
    },
    {
      key: 'entity',
      header: 'Resource',
      width: 'w-32',
      hideBelow: 'md',
      cell: (log) => (
        <span className="capitalize text-slate-500">
          {(log.entity ?? '—').replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Detail',
      cell: (log) => <span className="text-slate-700">{log.description ?? '—'}</span>,
    },
    {
      key: 'ipAddress',
      header: 'IP Address',
      width: 'w-32',
      sortable: true,
      hideBelow: 'xl',
      cell: (log) => <span className="tabular text-slate-500">{log.ipAddress ?? '—'}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Logs"
        description="An append-only record of administrative and examination activity."
        meta={<Badge tone="neutral">{meta.totalItems} entries retained</Badge>}
      />

      <PhaseNotice phase="Phase 11 — Audit Logs">
        Every entry records the actor, the action, the affected resource, the server-observed IP
        address and a timestamp. Entries are written by the API and cannot be edited from this
        interface.
      </PhaseNotice>

      <Panel>
        <Toolbar>
          <ToolbarGroup>
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search description, user or IP…"
              label="Search audit log"
            />
            <FilterSelect
              label="Action"
              value={table.state.filters.action}
              onChange={(v) => table.setFilter('action', v)}
              options={actionOptions}
            />
            <FilterSelect
              label="Resource"
              value={table.state.filters.entity}
              onChange={(v) => table.setFilter('entity', v)}
              options={ENTITY_OPTIONS}
            />
          </ToolbarGroup>
          <ResultCount shown={visible.length} total={meta.totalItems} />
        </Toolbar>

        {error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : logs.length === 0 && !loading ? (
          <EmptyState
            icon={<ScrollText className="h-5 w-5" />}
            title="No audit entries"
            description="Administrative actions will be recorded here as they happen."
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={visible}
              rowKey={(log) => log.id}
              loading={loading}
              stickyHeader
              emptyTitle="No entries match these filters"
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
  )
}
