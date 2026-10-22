import { useState, useEffect } from 'react'
import { Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, User as UserIcon } from 'lucide-react'
import { Alert, Button, Input, Panel } from '../components/ui'
import { useApiErrorMessage } from '../hooks/useApiErrorMessage'
import { useAuth } from '../store/auth'
import { authApi } from '../services'
import { systemApi } from '../services'
import { useQuery } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { applyBrandColor } from '../utils/theme'
import { cn } from '../utils'
import type { SystemSettings } from '../types'

/**
 * Sign-in screen.
 *
 * Reachable only when no valid session exists. In mock mode the provider
 * hydrates a session automatically, so this screen is only ever seen in real
 * mode, but it works against either API without conditional branching.
 */
export function LoginPage() {
  const { isAuthenticated, user, logout, setSession } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const errorMessage = useApiErrorMessage(error)

  const { data: settings } = useQuery<SystemSettings>({
    queryKey: ['settings'],
    queryFn: () => systemApi.settings(),
    staleTime: 5 * 60_000,
  })

  // Apply the institution's brand colour so the sign-in screen matches the
  // rest of the admin shell. Pass `null` to restore the compile-time default.
  useEffect(() => {
    applyBrandColor(settings?.primaryColor ?? null)
  }, [settings?.primaryColor])

  if (isAuthenticated) {
    // A staff session is required. A persisted student account (e.g. from an
    // older sign-in through this endpoint) must not reach the admin shell.
    if (!user || user.role === 'STUDENT') {
      if (user) logout()
      return null
    }
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      // The API returns the user and the access token together, so the session
      // is established from one response instead of a follow-up /auth/me call.
      const { user, accessToken } = await authApi.login(identifier.trim(), password)
      setSession(user, accessToken)
      await queryClient.invalidateQueries()
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {settings?.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt=""
              className="mx-auto mb-4 h-11 w-auto rounded-lg border border-white/20 bg-white/10"
            />
          ) : (
            <div
              className={cn(
                'mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg',
                settings?.primaryColor
                  ? 'bg-[var(--cb-primary)] text-[var(--cb-primary-text)]'
                  : 'bg-brand-600 text-white',
              )}
            >
              C
            </div>
          )}
          <h1 className="text-lg font-semibold text-white">CBT Administration</h1>
          <p className="mt-1 text-sm text-ink-400">Sign in to manage examinations.</p>
        </div>

        <Panel className="p-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

            <div>
              <label
                htmlFor="login-username"
                className="mb-1.5 block text-xs font-medium text-ink-700"
              >
                Email address
              </label>
              <div className="relative">
                <UserIcon
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
                />
                <Input
                  id="login-username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                  className="pl-9"
                  placeholder="admin@cbt.local"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 block text-xs font-medium text-ink-700"
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
                />
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="pl-9 pr-10"
                  placeholder="••••••••"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600 p-0"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </Button>
              </div>
            </div>

            <Button type="submit" className="w-full justify-center" loading={submitting}>
              Sign in
            </Button>
          </form>
        </Panel>

        <p className="mt-6 text-center text-xs text-ink-500">
          Authorised staff only. All sign-in attempts are recorded.
        </p>

        <p className="mt-4 text-center text-xs text-ink-500">
          No administrator account yet?{' '}
          <Link
            to="/register"
            className={cn(
              'font-medium hover:underline',
              settings?.primaryColor ? 'text-[var(--cb-primary)]' : 'text-brand-600',
            )}
          >
            Register administrator
          </Link>
        </p>
      </div>
    </div>
  )
}
