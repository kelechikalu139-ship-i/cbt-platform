import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../types'

interface AppStore {
  user: User | null
  token: string | null
  theme: 'light' | 'dark'
  setAuth: (user: User | null, token: string | null) => void
  logout: () => void
  setTheme: (theme: 'light' | 'dark') => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      theme: 'light',
      setAuth: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'cbt-app-storage',
      partialize: (state) => ({ user: state.user, token: state.token, theme: state.theme }),
    },
  ),
)

export const useAuth = () => {
  const { user, token, setAuth, logout } = useAppStore()
  return {
    user,
    token,
    isAuthenticated: !!token,
    login: setAuth,
    setAuth,
    logout,
  }
}