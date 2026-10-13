import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  escapeSearchTerm,
  normaliseSearch,
  resolvePagination,
  resolveSortField,
  resolveSortOrder,
  buildMeta,
} from '../src/utils/pagination.js'

/**
 * Pagination and search tests (§49, §50).
 *
 * These guard the clamp that keeps one request from asking the database for the
 * entire question bank, which matters a great deal when a whole lab queries at
 * once.
 */
describe('pagination', () => {
  it('defaults to the first page with the standard size', () => {
    const result = resolvePagination(undefined, undefined)

    expect(result.page).toBe(1)
    expect(result.limit).toBe(DEFAULT_PAGE_SIZE)
    expect(result.skip).toBe(0)
    expect(result.take).toBe(DEFAULT_PAGE_SIZE)
  })

  it('computes skip from page and limit', () => {
    const result = resolvePagination(3, 25)

    expect(result.skip).toBe(50)
    expect(result.take).toBe(25)
  })

  it('clamps an oversized page size instead of honouring it', () => {
    const result = resolvePagination(1, 100_000)

    expect(result.limit).toBe(MAX_PAGE_SIZE)
    expect(result.take).toBe(MAX_PAGE_SIZE)
  })

  it('coerces numeric strings from the query string', () => {
    const result = resolvePagination('2', '10')

    expect(result.page).toBe(2)
    expect(result.limit).toBe(10)
  })

  it('falls back safely on nonsense input', () => {
    for (const [page, limit] of [
      ['abc', 'abc'],
      [-5, -10],
      [0, 0],
      ['', ''],
    ]) {
      const result = resolvePagination(page, limit)
      expect(result.page).toBeGreaterThanOrEqual(1)
      expect(result.limit).toBeGreaterThanOrEqual(1)
      expect(result.limit).toBeLessThanOrEqual(MAX_PAGE_SIZE)
    }
  })

  it('defaults sort order to descending', () => {
    expect(resolveSortOrder(undefined)).toBe('desc')
    expect(resolveSortOrder('DESC')).toBe('desc')
    expect(resolveSortOrder('asc')).toBe('asc')
    expect(resolveSortOrder('anything-else')).toBe('desc')
  })
})

describe('sort field allow-list', () => {
  const allowed = ['studentId', 'lastName', 'program'] as const

  it('accepts a permitted field', () => {
    expect(resolveSortField('lastName', allowed, 'createdAt')).toBe('lastName')
  })

  it('falls back for a field outside the allow-list', () => {
    // This is the security-relevant case: an arbitrary column must never reach
    // the ORM's orderBy, or a caller could sort by and infer columns they should
    // not know about.
    expect(resolveSortField('passwordHash', allowed, 'createdAt')).toBe('createdAt')
    expect(resolveSortField('roleId; DROP TABLE users', allowed, 'createdAt')).toBe('createdAt')
    expect(resolveSortField(undefined, allowed, 'createdAt')).toBe('createdAt')
  })
})

describe('search normalisation', () => {
  it('trims and lowercases nothing else', () => {
    expect(normaliseSearch('  Adeyinka ')).toBe('Adeyinka')
  })

  it('returns undefined for empty or whitespace input', () => {
    expect(normaliseSearch('')).toBeUndefined()
    expect(normaliseSearch('    ')).toBeUndefined()
    expect(normaliseSearch(undefined)).toBeUndefined()
    expect(normaliseSearch(123)).toBeUndefined()
  })

  it('escapes LIKE wildcards so a literal % matches itself', () => {
    expect(escapeSearchTerm('100%')).toBe('100\\%')
    expect(escapeSearchTerm('a_b')).toBe('a\\_b')
    expect(escapeSearchTerm('back\\slash')).toBe('back\\\\slash')
  })
})

describe('pagination metadata', () => {
  it('reports totals and page count', () => {
    expect(buildMeta(100, 1, 20)).toEqual({ page: 1, pageSize: 20, totalItems: 100, totalPages: 5 })
  })

  it('rounds a partial final page up', () => {
    expect(buildMeta(21, 2, 20).totalPages).toBe(2)
  })

  it('handles an empty collection', () => {
    expect(buildMeta(0, 1, 20)).toEqual({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 })
  })
})