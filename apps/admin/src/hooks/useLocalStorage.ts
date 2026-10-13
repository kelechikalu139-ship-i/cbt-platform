import { useCallback, useState } from 'react'

/**
 * State backed by localStorage.
 *
 * Used for per-workstation UI preferences (sidebar collapse). Never for
 * anything the server must own.
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? (JSON.parse(item) as T) : initialValue
    } catch {
      // Private mode or a corrupt entry — fall back rather than crash the shell.
      return initialValue
    }
  })

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const next = value instanceof Function ? value(prev) : value
        try {
          window.localStorage.setItem(key, JSON.stringify(next))
        } catch {
          // Quota or private mode: keep the in-memory value.
        }
        return next
      })
    },
    [key],
  )

  return [storedValue, setValue] as const
}
