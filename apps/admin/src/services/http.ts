import type { ApiEnvelope, ApiErrorPayload } from '../types'

/**
 * Minimal fetch-based HTTP client for the CBT API.
 *
 * Deliberately not axios: the admin UI has modest request volume and this keeps
 * the bundle free of an extra HTTP dependency that would be dead weight in an
 * offline LAN deployment.
 *
 * Responsibilities:
 * - prefix every path with VITE_API_URL
 * - attach the bearer token held by the auth store
 * - unwrap the `{ success, data }` envelope
 * - normalise failures into a single `ApiError` shape
 */

/**
 * Base path for API calls.
 *
 * Defaults to the relative `/api/v1`, which the Vite dev server proxies to the
 * backend (see `vite.config.ts`). A relative default matters on a school LAN:
 * it keeps the request same-origin in development and, once the built app is
 * served by the same reverse proxy as the API in production, means no rebuild is
 * needed when the server's IP address changes.
 *
 * Set `VITE_API_URL` to an absolute URL only when the API is on a different host.
 * The version segment is part of the default, because the server mounts every
 * route under `/api/v1`.
 */
export const API_BASE_URL = resolveApiBaseUrl()

/** Storage key shared with the auth store; must not drift. */
export const TOKEN_STORAGE_KEY = 'cbt-admin-auth'

/**
 * Picks the API base URL, falling back to the relative default.
 *
 * `??` is not enough here: `.env.example` ships `VITE_API_URL=` as an empty
 * value so the setting is discoverable, and an empty string is neither null nor
 * undefined. Left alone it would produce base `''` and every request would hit
 * the current page instead of the API.
 */
function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.trim().replace(/\/+$/, '')
  }
  return '/api/v1'
}

export class ApiError extends Error {
  readonly status: number
  readonly errors?: Record<string, string[]>

  constructor(message: string, status: number, errors?: Record<string, string[]>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }

  /** True when the caller should be sent back to the login screen. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /**
   * Non-2xx statuses to resolve instead of throwing.
   *
   * For endpoints that treat a failure status as valid data. `GET /health` is the
   * case that matters: it answers 503 when the database is down, and that is
   * precisely the state the health screen exists to report, so throwing would turn
   * "degraded" into "no data". The body is still returned unchanged.
   */
  acceptStatuses?: number[]
}

export function buildQueryString(
  query: RequestOptions['query'] = {},
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function readToken(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: { token?: string } }
    return parsed.state?.token ?? null
  } catch {
    return null
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, acceptStatuses } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const token = readToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}${buildQueryString(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // Session cookie is not used, but keep credentials off so the API cannot
      // be coaxed into cross-origin cookie behaviour on a shared lab machine.
      credentials: 'omit',
    })
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') throw cause
    // The server PC is on the LAN and may be unreachable or restarting. Say so
    // plainly rather than surfacing a generic "Failed to fetch".
    throw new ApiError(
      'Cannot reach the CBT server. Check that the service is running on this network.',
      0,
    )
  }

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok && !acceptStatuses?.includes(response.status)) {
    const errorPayload = payload as ApiErrorPayload | null
    throw new ApiError(
      errorPayload?.message ?? `Request failed with status ${response.status}`,
      response.status,
      errorPayload?.errors,
    )
  }

  // Unwrap the `{ success, data, meta? }` envelope.
  //
  // Paginated collections send `meta` beside `data` (see the server's
  // `sendPaginated`), and the client's `Paginated<T>` is `{ data, meta }`.
  // A single resource carries no `meta`, so only `data` is returned.
  // Dropping `meta` here would hand every list page a bare array where
  // `{ data, meta }` is expected, leaving the table empty and the
  // pagination controls reading zero.
  const envelope = payload as (ApiEnvelope<T> & { meta?: unknown }) | null
  if (envelope && typeof envelope === 'object' && 'success' in envelope) {
    const { data, meta } = envelope
    return (meta !== undefined ? { data, meta } : data) as T
  }
  // Tolerate a bare payload in case the backend serves the resource directly.
  return payload as T
}

export const http = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
}