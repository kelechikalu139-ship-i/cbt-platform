import { useMemo } from 'react'
import { ApiError } from '../services/http'

/**
 * Human-readable message for any thrown value, API or otherwise.
 *
 * Keeps error text coming from the server rather than being invented in each
 * component, which matters because operators need the specific cause (server
 * unreachable vs. database refused connection vs. bad credentials).
 */
export function useApiErrorMessage(error: unknown): string | null {
  return useMemo(() => {
    if (!error) return null
    if (error instanceof ApiError) return error.message
    if (typeof error === 'object' && error !== null && 'response' in error) {
      const response = (error as { response?: { data?: { message?: string } } }).response
      if (response?.data?.message) return response.data.message
    }
    if (error instanceof Error) return error.message
    return 'The request could not be completed.'
  }, [error])
}
