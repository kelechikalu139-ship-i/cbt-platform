import { useEffect, useState } from 'react'

/**
 * Debounce a rapidly-changing value.
 *
 * Used by search inputs so typing does not issue a request per keystroke —
 * important on the low-bandwidth lab network this system targets.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
