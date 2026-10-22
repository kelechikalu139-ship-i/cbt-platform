import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Lock, Mail, User as UserIcon } from 'lucide-react'
import { Alert, Button, Input, Panel } from '../components/ui'
import { useApiErrorMessage } from '../hooks/useApiErrorMessage'
import { useAuth } from '../store/auth'
import { authApi } from '../services'

/**
 * One-time super administrator registration.
 *
 * Reachable only when no valid session exists. Once an active super
 * administrator exists, the server closes this endpoint and returns 410, at
 * which point the administrator signs in through the login screen instead.
 */
export function RegisterPage() {
  const { isAuthenticated, setSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const errorMessage = useApiErrorMessage(error)

  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const { user, accessToken } = await authApi.register({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      })
      setSession(user, accessToken)
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(from, { replace: true })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Registration failed. Try again.',
      )
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--cb-primary)] text-[var(--cb-primary-text)]">
            <UserIcon size={22} aria-hidden />
          </div>
          <h1 className="text-lg font-semibold text-white">Create administrator account</h1>
          <p className="mt-1 text-sm text-ink-400">
            Register the first super administrator for this installation.
          </p>
        </div>

        <Panel className="p-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

            <div>
              <label
                htmlFor="register-email"
                className="mb-1.5 block text-xs font-medium text-ink-700"
              >
                Email address
              </label>
              <div className="relative">
                <Mail
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
                />
                <Input
                  id="register-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  autoFocus
                  className="pl-9"
                  placeholder="admin@school.local"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="register-password"
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
                  id="register-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="pl-9"
                  placeholder="••••••••"
                />
              </div>
              <p className="mt-1 text-2xs text-slate-500">
                Minimum 8 characters.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="register-first-name"
                  className="mb-1.5 block text-xs font-medium text-ink-700"
                >
                  First name
                </label>
                <Input
                  id="register-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  required
                  className="pl-9"
                  placeholder="Your first name"
                />
              </div>
              <div>
                <label
                  htmlFor="register-last-name"
                  className="mb-1.5 block text-xs font-medium text-ink-700"
                >
                  Last name
                </label>
                <Input
                  id="register-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  required
                  className="pl-9"
                  placeholder="Your last name"
                />
              </div>
            </div>

            <Button type="submit" className="w-full justify-center" loading={submitting}>
              Register administrator
            </Button>
          </form>
        </Panel>

        <p className="mt-6 text-center text-xs text-ink-500">
          This can only be done once. After registration, sign in through the
          administrator login screen.
        </p>
      </div>
    </div>
  )
}
