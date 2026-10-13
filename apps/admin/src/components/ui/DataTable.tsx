import { ChevronDown, ChevronUp, ChevronsUpDown, Inbox, Loader2, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../utils'

/* -------------------------------------------------------------------------- */
/* Column definition                                                           */
/* -------------------------------------------------------------------------- */

export interface Column<T> {
  /** Stable key. Also the server-side `sortBy` value when `sortable` is set. */
  key: string
  header: ReactNode
  /** Cell renderer. */
  cell: (row: T) => ReactNode
  /** Tailwind width class, e.g. `w-40`. */
  width?: string
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
  /** Hide below the given breakpoint to keep narrow screens usable. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
  /** Row action column gets a tighter gutter. */
  headerClassName?: string
  cellClassName?: string
}

const HIDE_CLASS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const

/* -------------------------------------------------------------------------- */
/* DataTable                                                                   */
/* -------------------------------------------------------------------------- */

export interface DataTableProps<T> {
  columns: Array<Column<T>>
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  /** Shown while `loading` is true and no previous data is on screen. */
  emptyTitle?: string
  emptyDescription?: ReactNode
  emptyAction?: ReactNode
  error?: ReactNode
  onRetry?: () => void
  onSort?: (key: string) => void
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  /** Highlights a row and shows it as selected. */
  isRowActive?: (row: T) => boolean
  onRowClick?: (row: T) => void
  /** Sticky header for tables that scroll inside a fixed-height panel. */
  stickyHeader?: boolean
  className?: string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'There is nothing to display yet.',
  emptyAction,
  error,
  onRetry,
  onSort,
  sortBy,
  sortOrder = 'asc',
  isRowActive,
  onRowClick,
  stickyHeader = false,
  className,
}: DataTableProps<T>) {
  const showEmpty = !loading && !error && rows.length === 0

  return (
    <div
      className={cn(
        'relative w-full overflow-x-auto',
        // Reserve height so the empty/loading overlays are not zero-height.
        (showEmpty || (loading && rows.length === 0)) && 'min-h-[14rem]',
        className,
      )}
    >
      <table className="w-full min-w-full border-collapse text-sm">
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((col) => {
              const isSorted = sortBy === col.key
              const align = col.align ?? 'left'
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cn(
                    'whitespace-nowrap px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-slate-500',
                    align === 'right' && 'text-right',
                    align === 'center' && 'text-center',
                    col.hideBelow && HIDE_CLASS[col.hideBelow],
                    col.width,
                    col.headerClassName,
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className={cn(
                        'group inline-flex items-center gap-1 rounded transition-colors hover:text-slate-700',
                        isSorted && 'text-brand-700',
                        align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {col.header}
                      {isSorted ? (
                        sortOrder === 'asc' ? (
                          <ChevronUp aria-hidden className="h-3 w-3" />
                        ) : (
                          <ChevronDown aria-hidden className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown
                          aria-hidden
                          className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50"
                        />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const active = isRowActive?.(row) ?? false
            return (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-slate-50',
                  active && 'bg-brand-50/60',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-2.5 align-middle text-slate-700',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.hideBelow && HIDE_CLASS[col.hideBelow],
                      col.cellClassName,
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Overlays are positioned over the table so the layout never jumps. */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
          <Loader2 aria-hidden className="h-5 w-5 animate-spin text-brand-600" />
          <span className="sr-only">Loading</span>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              Try again
            </button>
          )}
        </div>
      )}

      {showEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-6 text-center">
          <span
            aria-hidden
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400"
          >
            <Inbox className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-700">{emptyTitle}</p>
            {emptyDescription && (
              <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{emptyDescription}</p>
            )}
          </div>
          {emptyAction}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export interface PaginationProps {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  className?: string
}

/** Compact 1-based pager that collapses long ranges around the current page. */
function pageWindow(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | 'gap'> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push('gap')
  for (let p = start; p <= end; p++) pages.push(p)
  if (end < total - 1) pages.push('gap')
  pages.push(total)
  return pages
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  className,
}: PaginationProps) {
  if (totalItems === 0) return null

  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, totalItems)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3',
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <p className="tabular text-xs text-slate-500">
          <span className="font-medium text-slate-700">{first}</span>–
          <span className="font-medium text-slate-700">{last}</span> of{' '}
          <span className="font-medium text-slate-700">{totalItems.toLocaleString()}</span>
        </p>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-7 cursor-pointer rounded border border-slate-300 bg-white pl-2 pr-1 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <PagerButton
            label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </PagerButton>
          {pageWindow(page, totalPages).map((entry, i) =>
            entry === 'gap' ? (
              <span key={`gap-${i}`} aria-hidden className="px-1 text-xs text-slate-400">
                …
              </span>
            ) : (
              <PagerButton
                key={entry}
                label={`Page ${entry}`}
                active={entry === page}
                onClick={() => onPageChange(entry)}
              >
                {entry}
              </PagerButton>
            ),
          )}
          <PagerButton
            label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </PagerButton>
        </nav>
      )}
    </div>
  )
}

function PagerButton({
  children,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'tabular inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded px-1.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        'disabled:cursor-not-allowed disabled:text-slate-300',
        active
          ? 'bg-brand-600 text-white'
          : 'text-slate-600 hover:bg-slate-100 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}
