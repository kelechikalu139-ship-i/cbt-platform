import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { TOKEN_STORAGE_KEY, useAuthStore } from '../store/auth'
import { ApiError, USE_MOCK, authApi } from '../services'

/**
 * Ensures the session store holds a current user.
 *
 * While the backend is absent (mock mode) a fixture administrator is seeded so
 * the shell can be reviewed. In live mode the token is validated against
 * `/auth/me`; a rejection clears the session and the router sends the user to
 * the login screen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, token, refreshToken, setUser, setSession, setHydrated, logout } = useAuthStore()
  const refreshing = useRef(false)

  const renewSession = useCallback(async () => {
    if (USE_MOCK || !refreshToken || refreshing.current) return
    const lockKey = `${TOKEN_STORAGE_KEY}-refresh-lock`
    const lockOwner = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      const persisted = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) ?? '{}') as {
        state?: { user?: typeof user; token?: string; refreshToken?: string | null }
      }
      const latest = persisted.state
      if (latest?.token && latest.refreshToken && latest.refreshToken !== refreshToken && latest.user) {
        setSession(latest.user, latest.token, latest.refreshToken)
        return
      }
      const existingLock = JSON.parse(localStorage.getItem(lockKey) ?? 'null') as { expiresAt?: number } | null
      if ((existingLock?.expiresAt ?? 0) > Date.now()) return
      localStorage.setItem(lockKey, JSON.stringify({ owner: lockOwner, expiresAt: Date.now() + 20_000 }))
      const acquiredLock = JSON.parse(localStorage.getItem(lockKey) ?? 'null') as { owner?: string } | null
      if (acquiredLock?.owner !== lockOwner) return
    } catch {
      // Continue without a cross-tab lock if storage is unavailable.
    }
    refreshing.current = true
    try {
      const session = await authApi.refresh(refreshToken)
      setSession(session.user, session.accessToken, session.refreshToken)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) logout()
    } finally {
      refreshing.current = false
      try {
        const lock = JSON.parse(localStorage.getItem(lockKey) ?? 'null') as { owner?: string } | null
        if (lock?.owner === lockOwner) localStorage.removeItem(lockKey)
      } catch {
        // The lock expires on its own if browser storage is unavailable.
      }
    }
  }, [refreshToken, setSession, logout])

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
        } catch (error) {
          if (!cancelled && refreshToken) {
            try {
              const refreshed = await authApi.refresh(refreshToken)
              if (!cancelled) setSession(refreshed.user, refreshed.accessToken, refreshed.refreshToken)
            } catch (refreshError) {
              if (!cancelled && refreshError instanceof ApiError && refreshError.status === 401) logout()
            }
          } else if (!cancelled && error instanceof ApiError && error.status === 401) logout()
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

  useEffect(() => {
    if (USE_MOCK || !token || !refreshToken) return
    const timer = window.setInterval(() => void renewSession(), 10 * 60 * 1000)
    const onFocus = () => {
      if (document.visibilityState === 'visible') void renewSession()
    }
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [token, refreshToken, renewSession])

  useEffect(() => {
    const syncSession = (event: StorageEvent) => {
      if (event.key !== TOKEN_STORAGE_KEY) return
      if (!event.newValue) {
        logout()
        return
      }
      try {
        const state = (JSON.parse(event.newValue) as {
          state?: { user?: typeof user; token?: string; refreshToken?: string | null }
        }).state
        if (state?.user && state.token && state.refreshToken) {
          setSession(state.user, state.token, state.refreshToken)
        } else {
          logout()
        }
      } catch {
        logout()
      }
    }
    window.addEventListener('storage', syncSession)
    return () => window.removeEventListener('storage', syncSession)
  }, [setSession, logout])

  return <>{children}</>
}
