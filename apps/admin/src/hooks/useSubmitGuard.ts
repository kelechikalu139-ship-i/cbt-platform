import { useEffect, useRef } from 'react'

/**
 * Stops one logical submit from being dispatched twice.
 *
 * The submit button only becomes disabled after the mutation flips
 * `isPending`, which happens on the render *after* `mutate()` is
 * called. A fast double-click can therefore fire the request twice,
 * and the second call races the first and hits a unique constraint —
 * surfacing as a spurious "already exists" (Prisma P2002) even though
 * the details were new.
 *
 * The guard is armed synchronously inside the submit handler and
 * disarmed once the pending flag clears, so a legitimate retry after
 * a real failure still works.
 */
export function useSubmitGuard(submitting: boolean) {
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!submitting) inFlightRef.current = false
  }, [submitting])

  return {
    /**
     * Returns true the first time and arms the guard; returns false
     * for any call while a submit is still in flight.
     */
    begin: (): boolean => {
      if (inFlightRef.current) return false
      inFlightRef.current = true
      return true
    },
  }
}
