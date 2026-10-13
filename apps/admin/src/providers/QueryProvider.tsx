import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ApiError } from '../services/http'

/**
 * TanStack Query configuration.
 *
 * Defaults are chosen for a school LAN rather than the public internet:
 * short stale windows so an exam going live is reflected quickly, and retries
 * disabled for 4xx because a 404 will never succeed on its own.
 */

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    // Client errors are deterministic — do not hammer the server.
    if (error.status >= 400 && error.status < 500) return false
    // No server at all (LAN down / service restarting) — a couple of quick tries.
    if (error.status === 0) return failureCount < 2
  }
  return failureCount < 2
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
