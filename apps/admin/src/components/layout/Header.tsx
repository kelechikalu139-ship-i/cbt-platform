import { Bell, LogOut, Menu, Server, UserCog } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { authApi } from '../../services'
import { cn, initials } from '../../utils'
import { Dropdown, DropdownDivider, DropdownItem, DropdownLabel, IconButton } from '../ui'
import { findNavItem } from './nav.config'

export interface HeaderProps {
  onOpenNav: () => void
  /** True while the Node API is unreachable, shown as a persistent banner. */
  offline?: boolean
  /** Institution logo (public URL) and primary colour, from system settings. */
  logoUrl: string | null
  primaryColor: string | null
}

/**
 * Top bar: mobile nav toggle, breadcrumb, and the account menu.
 *
 * Deliberately sparse. Administrators use this screen for orientation, and any
 * persistent noise here competes with the page content below it.
 */
export function Header({
  onOpenNav,
  offline = false,
  logoUrl = null,
  primaryColor = null,
}: HeaderProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const current = findNavItem(pathname)

  const handleSignOut = async () => {
    try {
      // Revoke the server-side refresh token first: a local-only
      // sign-out leaves the old token bundle valid until it rotates.
      await authApi.logout()
    } catch {
      // A failed request still clears local state; the stored token
      // stops being accepted once it rotates.
    } finally {
      logout()
      navigate('/login')
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      {offline && (
        <div className="bg-amber-500 px-4 py-1 text-center text-2xs font-semibold text-amber-950">
          Cannot reach the CBT server on this network. Figures shown may be out of date.
        </div>
      )}

      <div className="flex h-14 items-center gap-3 px-4 sm:px-5">
        <IconButton
          label="Open navigation"
          onClick={onOpenNav}
          icon={<Menu className="h-4 w-4" />}
          className="lg:hidden"
        />

        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex items-center gap-1.5 text-xs">
            <li>
              <Link
                to="/"
                className={cn(
                  'flex items-center gap-1.5',
                  primaryColor && 'text-[var(--cb-primary-deep)] hover:text-[var(--cb-primary)]',
                  !primaryColor && 'text-slate-500 hover:text-slate-700',
                )}
              >
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt=""
                    className="h-6 w-auto rounded border border-slate-200 bg-slate-50"
                  />
                ) : (
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--cb-primary-bg)]',
                      primaryColor && 'text-[var(--cb-primary-deep)]',
                      !primaryColor && 'text-brand-700',
                    )}
                  >
                    C
                  </span>
                )}
                <span className="hidden sm:inline font-semibold text-xs">
                  CBT
                </span>
              </Link>
            </li>
            {current && current.path !== '/' && (
              <>
                <li aria-hidden className="text-slate-300">
                  /
                </li>
                <li aria-current="page" className="truncate font-medium text-slate-800">
                  {current.label}
                </li>
              </>
            )}
          </ol>
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Quick jump to the address students must be given. */}
          <Link
            to="/system-health"
            className="hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 md:inline-flex"
          >
            <Server aria-hidden className="h-4 w-4" />
            Server
          </Link>

          <IconButton
            label="Notifications"
            icon={
              <span className="relative">
                <Bell className="h-4 w-4" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
              </span>
            }
          />

          <div className="mx-1 h-6 w-px bg-slate-200" aria-hidden />

          <Dropdown
            align="right"
            trigger={
              <button
                type="button"
                className={cn(
                  'flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-100',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-primary)]',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--cb-primary-bg)] text-2xs font-semibold',
                    primaryColor ? 'text-[var(--cb-primary-deep)]' : 'text-brand-700',
                  )}
                >
                  {initials(user?.fullName)}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-[10rem] truncate text-xs font-medium text-slate-800">
                    {user?.fullName ?? 'Signed out'}
                  </span>
                  <span className="block text-2xs capitalize text-slate-500">
                    {user ? user.role.replace(/_/g, ' ') : ''}
                  </span>
                </span>
              </button>
            }
          >
            <DropdownLabel>Signed in as</DropdownLabel>
            <div className="px-3 pb-2">
              <p className="truncate text-xs font-semibold text-slate-800">
                {user?.fullName ?? '—'}
              </p>
              <p className="truncate text-2xs text-slate-500">{user?.email ?? ''}</p>
            </div>
            <DropdownDivider />
            <DropdownItem icon={<UserCog className="h-3.5 w-3.5" />} onClick={() => navigate('/users')}>
              Manage account
            </DropdownItem>
            <DropdownItem
              icon={<Server className="h-3.5 w-3.5" />}
              onClick={() => navigate('/system-health')}
            >
              System health
            </DropdownItem>
            <DropdownDivider />
            <DropdownItem icon={<LogOut className="h-3.5 w-3.5" />} destructive onClick={handleSignOut}>
              Sign out
            </DropdownItem>
          </Dropdown>
        </div>
      </div>
    </header>
  )
}
