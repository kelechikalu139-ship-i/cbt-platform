import { useCallback, useMemo, useState } from 'react'
import type { ListQuery, SortOrder } from '../types'

/**
 * State for a paginated, sorted, filterable server-backed table.
 *
 * All three concerns live here so every list page behaves identically:
 * page resets when filters change, sorting is server-side via `sortBy`, and
 * the current query object is ready to hand to a service function.
 */
export interface TableState<TFilters extends Record<string, unknown>> {
  page: number
  pageSize: number
  search: string
  sortBy: string | undefined
  sortOrder: SortOrder
  filters: TFilters
}

export function useTableState<TFilters extends Record<string, unknown>>(
  initialFilters: TFilters,
  options: { defaultSortBy?: string; defaultSortOrder?: SortOrder; pageSize?: number } = {},
) {
  const [state, setState] = useState<TableState<TFilters>>({
    page: 1,
    pageSize: options.pageSize ?? 20,
    search: '',
    sortBy: options.defaultSortBy,
    sortOrder: options.defaultSortOrder ?? 'asc',
    filters: initialFilters,
  })

  const setPage = useCallback((page: number) => {
    setState((s) => ({ ...s, page: Math.max(1, page) }))
  }, [])

  const setPageSize = useCallback((pageSize: number) => {
    setState((s) => ({ ...s, pageSize, page: 1 }))
  }, [])

  const setSearch = useCallback((search: string) => {
    // Back to page 1: staying on page 5 of a newly filtered list looks broken.
    setState((s) => ({ ...s, search, page: 1 }))
  }, [])

  /** Clicking the active column flips direction; a new column starts ascending. */
  const toggleSort = useCallback((column: string) => {
    setState((s) =>
      s.sortBy === column
        ? { ...s, sortOrder: s.sortOrder === 'asc' ? 'desc' : 'asc', page: 1 }
        : { ...s, sortBy: column, sortOrder: 'asc', page: 1 },
    )
  }, [])

  const setFilter = useCallback(<K extends keyof TFilters>(key: K, value: TFilters[K]) => {
    setState((s) => ({ ...s, filters: { ...s.filters, [key]: value }, page: 1 }))
  }, [])

  const resetFilters = useCallback(() => {
    setState((s) => ({ ...s, filters: initialFilters, search: '', page: 1 }))
  }, [initialFilters])

  const clearAll = useCallback(() => {
    setState({
      page: 1,
      pageSize: options.pageSize ?? 20,
      search: '',
      sortBy: options.defaultSortBy,
      sortOrder: options.defaultSortOrder ?? 'asc',
      filters: initialFilters,
    })
  }, [initialFilters, options.pageSize, options.defaultSortBy, options.defaultSortOrder])

  const hasActiveFilters = useMemo(() => {
    return (
      state.search.trim() !== '' ||
      Object.values(state.filters).some((v) => v !== undefined && v !== null && v !== '' && v !== 'all')
    )
  }, [state.search, state.filters])

  /** Query object for the service layer. */
  const query: ListQuery & TFilters = useMemo(
    () => ({
      page: state.page,
      pageSize: state.pageSize,
      search: state.search || undefined,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
      ...state.filters,
    }),
    [state],
  )

  return {
    state,
    query,
    hasActiveFilters,
    setPage,
    setPageSize,
    setSearch,
    setFilter,
    toggleSort,
    resetFilters,
    clearAll,
  }
}
