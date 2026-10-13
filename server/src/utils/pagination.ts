/**
 * Pagination, sorting and search normalisation (§49, §50).
 *
 * Runs before any database call so that a client cannot request an unbounded
 * page size, an unsupported sort column, or a malformed search term. Every
 * collection endpoint accepts the same query shape.
 */

/**
 * Hard ceiling on page size. Without it a single request could ask for the whole
 * question bank and stall the server while every student waits.
 */
export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 20

export interface PaginationInput {
  page: number
  limit: number
  skip: number
  take: number
}

export interface SortInput {
  order: 'asc' | 'desc'
}

/** Clamp caller-supplied paging into a safe range. */
export function resolvePagination(
  rawPage: unknown,
  rawLimit: unknown,
): PaginationInput {
  const parsedPage = Number(rawPage)
  const page =
    Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1

  const parsedLimit = Number(rawLimit)
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(Math.floor(parsedLimit), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE

  return { page, limit, skip: (page - 1) * limit, take: limit }
}

export function resolveSortOrder(rawOrder: unknown): 'asc' | 'desc' {
  return String(rawOrder ?? '').toLowerCase() === 'asc' ? 'asc' : 'desc'
}

/**
 * Resolve a requested sort field against an allow-list.
 *
 * The allow-list is the important part: passing an arbitrary column straight to
 * Prisma's `orderBy` would let a caller sort by any column, including ones they
 * should not learn about, and would fail loudly on non-existent fields. Falling
 * back to the default keeps the endpoint predictable.
 */
export function resolveSortField(
  rawField: unknown,
  allowed: readonly string[],
  fallback: string,
): string {
  const candidate = String(rawField ?? '').trim()
  return allowed.includes(candidate) ? candidate : fallback
}

/** Build pagination metadata for a response body. */
export function buildMeta(totalItems: number, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0,
  }
}

/**
 * Escape LIKE wildcards in user-supplied search text.
 *
 * Prisma's `contains` parameterises the value, so this is not an injection
 * defence — it exists so that a student searching for `100%` does not match every
 * row, and so `_` is treated as a literal rather than a single-character wildcard.
 */
export function escapeSearchTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Trim a search term and return undefined when it is effectively empty. */
export function normaliseSearch(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}