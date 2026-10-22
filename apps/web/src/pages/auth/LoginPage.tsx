import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store'
import { Button, Input } from '../../components/common'
import { api, authAPI } from '../../services/api'
import { cn } from '../../utils'
import { applyBranding, type Branding } from '../../utils/branding'

export const LoginPage: React.FC = () => {
  const [matricNumber, setMatricNumber] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [branding, setBranding] = useState<Branding | null>(null)
  const { isAuthenticated, login } = useAuth()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await api.get<{ data: Branding }>('/system/branding')
        if (!cancelled) {
          setBranding(response.data.data)
          applyBranding(response.data.data)
        }
      } catch {
        // Branding is non-critical: fall back to the defaults in index.css.
        if (!cancelled) applyBranding(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await authAPI.studentLogin(matricNumber.trim())
      const { user, token } = response.data.data
      login(user, token)
    } catch (err) {
      // Prefer the server's own wording — a refused sign-in (for
      // example a session already live on another device) explains
      // itself far better than a bare status code.
      const detail = (err as { response?: { data?: { message?: string } } }).response?.data?.message
      setError(detail ?? (err instanceof Error ? err.message : 'Unable to sign in with that matric number'))
    } finally {
      setLoading(false)
    }
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" />
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {branding?.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.schoolName}
              className="mx-auto mb-4 w-16 h-auto rounded-2xl border border-gray-200 bg-white"
            />
          ) : (
            <div
              className={cn(
                'w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-2xl font-bold mb-4',
                branding?.primaryColor
                  ? 'bg-[var(--cb-primary)] text-[var(--cb-primary-text)]'
                  : 'bg-indigo-600 text-white',
              )}
            >
              {branding?.schoolShortName?.charAt(0) ?? 'C'}
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">
            {branding?.schoolName ?? 'CBT Platform'}
          </h1>
          <p className="text-gray-500 mt-1">Sign in with your matriculation number</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Matriculation Number"
              type="text"
              value={matricNumber}
              onChange={(e) => setMatricNumber(e.target.value)}
              placeholder="e.g. CBT/2024/0001"
              autoComplete="username"
              autoFocus
              required
            />
            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={loading}>
              Continue
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-200 text-center">
            <p className="text-sm text-gray-500">
              Accounts are created by your examination administrator.
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Contact your institution if you cannot access your account.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}