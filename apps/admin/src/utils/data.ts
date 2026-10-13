import type { ListQuery, Paginated, SortOrder } from '../types'

/**
 * In-memory query helper used by the mock layer to imitate the shape of a
 * paginated server response. Once the backend exists this becomes unnecessary
 * — the real API does this in SQL.
 */
export function paginate<T extends Record<string, unknown>>(
  rows: T[],
  query: ListQuery = {},
): Paginated<T> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20))

  let result = rows

  const search = query.search?.trim().toLowerCase()
  if (search) {
    result = result.filter((row) =>
      Object.values(row).some((value) => {
        if (value == null) return false
        if (typeof value === 'boolean') return String(value).includes(search)
        if (Array.isArray(value)) return value.map(String).join(' ').toLowerCase().includes(search)
        if (typeof value === 'object') return JSON.stringify(value).toLowerCase().includes(search)
        return String(value).toLowerCase().includes(search)
      }),
    )
  }

  if (query.sortBy) {
    const key = query.sortBy as keyof T
    const dir: SortOrder = query.sortOrder ?? 'asc'
    const sorted = [...result].sort((a, b) => {
      const av = a[key]
      const bv = b[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'asc' ? av - bv : bv - av
      }
      return dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
    result = sorted
  }

  const totalItems = result.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const start = (page - 1) * pageSize

  return {
    data: result.slice(start, start + pageSize),
    meta: { page, pageSize, totalItems, totalPages },
  }
}

/** Case-insensitive substring match across the given string fields. */
export function matchesSearch(search: string, ...fields: Array<string | number | null | undefined>): boolean {
  const term = search.trim().toLowerCase()
  if (!term) return true
  return fields.some((f) => f != null && String(f).toLowerCase().includes(term))
}

/** Deterministic pseudo-random generator so mock data is stable between renders. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
