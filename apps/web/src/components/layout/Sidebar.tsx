import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../store'
import { authAPI } from '../../services/api'
import { cn } from '../../utils'

interface NavItem {
  label: string
  href: string
  icon?: React.ReactNode
}

interface SidebarProps {
  branding: {
    schoolName: string
    schoolShortName: string
    primaryColor: string | null
    logoUrl: string | null
  } | null
}

export const Sidebar = ({ branding }: SidebarProps) => {
  const { user, logout } = useAuth()
  const location = useLocation()

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: <DashboardIcon /> },
    { label: 'Exams', href: '/exams', icon: <ExamIcon /> },
    { label: 'Results', href: '/results', icon: <ResultsIcon /> },
    { label: 'Profile', href: '/profile', icon: <ProfileIcon /> },
  ]

  const handleLogout = async () => {
    try {
      await authAPI.logout()
    } catch {
      // A failed request still clears local state.
    } finally {
      logout()
    }
  }

  const schoolName = branding?.schoolName ?? 'CBT Platform'

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-white border-r border-gray-200">
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-200">
          {branding?.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={schoolName}
              className="w-8 h-8 rounded-md object-cover border border-slate-200 bg-slate-50"
            />
          ) : (
            <div
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center font-bold',
                'bg-[var(--cb-primary)] text-[var(--cb-primary-text)]',
              )}
            >
              {branding?.schoolShortName?.charAt(0) ?? 'C'}
            </div>
          )}
          <span className="text-xl font-semibold text-gray-900 truncate">{schoolName}</span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--cb-primary-a10)] text-[var(--cb-primary-deep)]'
                    : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="px-4 py-4 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-[var(--cb-primary-a10)] flex items-center justify-center text-[var(--cb-primary-deep)] font-semibold">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">{user?.matricNumber}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </aside>
  )
}

const DashboardIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
)

const ExamIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)

const ResultsIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
)

const ProfileIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14c0-4 8-4 8 0 0 4-8 4-8 0z" />
  </svg>
)
