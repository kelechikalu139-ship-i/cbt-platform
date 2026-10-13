import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Permission, User } from '../types'
import { hasAnyPermission, hasPermission } from '../utils/permissions'

/**
 * Session state for the admin application.
 *
 * The token is persisted so a page refresh during UI review does not sign the
 * administrator out. The token is short-lived and server-validated; nothing here
 * is a trust boundary.
 *
 * Permissions are stored as the server issued them. They are never recomputed
 * locally, because a client-side grant table is a second source of truth that
 * drifts out of step with the database.
 */

interface AuthStore {
  user: User | null
  token: string | null
  /**
   * False until the provider has decided whether a persisted token is still
   * valid. Routes wait on this to avoid flashing protected chrome for a
   * signed-out visitor.
   */
  isHydrated: boolean
  setSession: (user: User, token: string) => void
  setUser: (user: User | null) => void
  setHydrated: (value: boolean) => void
  logout: () => void
}

export const TOKEN_STORAGE_KEY = 'cbt-admin-auth'

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isHydrated: false,
      setSession: (user, token) => set({ user, token }),
      setUser: (user) => set({ user }),
      setHydrated: (isHydrated) => set({ isHydrated }),
      logout: () => set({ user: null, token: null }),
    }),
    {
      name: TOKEN_STORAGE_KEY,
      // `isHydrated` is deliberately not persisted: it must re-run on every load.
      partialize: (state) => ({ user: state.user, token: state.token }),
      // Do NOT release the router from `onRehydrateStorage`. It fires as soon as
      // localStorage is read, which is before the async session check in
      // AuthProvider finishes, and that raced a signed-in user to the login
      // screen. AuthProvider's `finally` is the single release point.
    },
  ),
)

export function useAuth() {
  const { user, token, logout, isHydrated, setSession } = useAuthStore()
  const isAuthenticated = !!token && !!user

  return {
    user,
    token,
    isHydrated,
    isAuthenticated,
    logout,
    setSession,
    /**
     * Checks one permission against the server-issued grant list. Passing the
     * user rather than a role is deliberate: the role is only a label, and
     * looking permissions up by role is what previously emptied the sidebar.
     */
    can: (permission: Permission) => hasPermission(user, permission),
    canAny: (permissions: readonly Permission[]) => hasAnyPermission(user, permissions),
    permissions: user?.permissions ?? [],
  }
}

/** Read the token outside React, for the HTTP client. */
export function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    return (JSON.parse(raw) as { state?: { token?: string } }).state?.token ?? null
  } catch {
    return null
  }
}
