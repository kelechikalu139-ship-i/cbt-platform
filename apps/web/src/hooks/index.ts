import { useEffect, useState } from 'react'
import { useAuth } from '../store'

export const useAuthCheck = () => {
  const [isLoading, setIsLoading] = useState(true)
  const { token } = useAuth()

  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const { authAPI } = await import('../services/api')
          await authAPI.me()
        } catch {
          localStorage.removeItem('cbt-app-storage')
        }
      }
      setIsLoading(false)
    }
    checkAuth()
  }, [token])

  return { isLoading, isAuthenticated: !!token }
}

export const useTheme = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | null
    if (saved) {
      setTheme(saved)
      document.documentElement.classList.toggle('dark', saved === 'dark')
    }
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  return { theme, toggleTheme }
}

export const useCountdown = (initialSeconds: number, onZero?: () => void) => {
  const [seconds, setSeconds] = useState(initialSeconds)

  useEffect(() => {
    if (seconds <= 0) {
      onZero?.()
      return
    }

    const interval = setInterval(() => {
      setSeconds((s) => s - 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [seconds, onZero])

  const reset = (newSeconds: number) => setSeconds(newSeconds)

  return { seconds, reset }
}