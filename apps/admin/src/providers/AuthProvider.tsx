import { useEffect, type ReactNode } from 'react'
import { useAuthStore } from '../store/auth'
import { USE_MOCK, authApi } from '../services'

/**
 * Ensures the session store holds a current user.
 *
 * While the backend is absent (mock mode) a fixture administrator is seeded so
 * the shell can be reviewed. In live mode the token is validated against
 * `/auth/me`; a rejection clears the session and the router sends the user to
 * the login screen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, token, setUser, setSession, setHydrated, logout } = useAuthStore()

  useEffect(() => {
    let cancelled = false

    const hydrate = async () => {
      try {
        if (USE_MOCK) {
          if (user) return
          const fixture = await authApi.me()
          if (!cancelled) setSession(fixture, 'mock-session-token')
          return
        }

        if (!token) return
        try {
          const current = await authApi.me()
          if (!cancelled) setUser(current)
        } catch {
          if (!cancelled) logout()
        }
      } finally {
        // Every path must release the router, including a failed `me()` call.
        if (!cancelled) setHydrated(true)
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
    // Runs once on mount. Re-running on `user`/`token` changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}</>
}
