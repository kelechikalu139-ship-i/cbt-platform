import { ChevronsLeft, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { cn, initials } from '../../utils'
import { NAV_GROUPS } from './nav.config'

export interface SidebarProps {
  /** False on desktop, where the sidebar is persistent. */
  open: boolean
  onClose: () => void
  /** Desktop-only collapse affordance. */
  collapsed: boolean
  onToggleCollapse: () => void
  /** Institution logo (public URL), from system settings. */
  logoUrl: string | null
}

/**
 * Primary admin navigation.
 *
 * Dark chrome is deliberate: it frames the working area and keeps attention on
 * the data. Collapsible because examination staff often want the table wide.
 */
export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapse,
  logoUrl = null,
}: SidebarProps) {
  const { user, can } = useAuth()

  return (
    <>
      {/* Mobile scrim */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-30 bg-slate-900/50 transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        aria-label="Main navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-[var(--cb-primary)] transition-all duration-200',
          'lg:translate-x-0',
          collapsed ? 'lg:w-16' : 'lg:w-60',
          open ? 'w-60 translate-x-0' : 'w-60 -translate-x-full',
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-4',
            collapsed && 'lg:justify-center lg:px-0',
          )}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className={cn(
                collapsed ? 'h-7 w-7' : 'h-8 w-auto',
                'rounded border border-white/20 bg-white/10 shrink-0',
              )}
            />
          ) : (
            <span
              aria-hidden
              className={cn(
                'flex items-center justify-center rounded bg-[var(--cb-primary)] text-sm font-bold text-[var(--cb-primary-text)]',
                collapsed ? 'h-7 w-7' : 'h-7 w-7',
              )}
            >
              C
            </span>
          )}
          <div className={cn('min-w-0 flex-1', collapsed && 'lg:hidden')}>
            <p className="truncate text-sm font-semibold text-[var(--cb-primary-text)]">CBT System</p>
            <p className="truncate text-2xs text-[var(--cb-primary-text-a80)]">Administration</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded p-1 text-[var(--cb-primary-text)] hover:bg-[var(--cb-primary-text-a10)] hover:text-[var(--cb-primary-text)] lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Links */}
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2.5 py-3">
          {NAV_GROUPS.map((group) => {
            const visible = group.items.filter((item) => can(item.permission))
            if (visible.length === 0) return null

            return (
              <div key={group.heading} className="mb-4 last:mb-0">
                <p
                  className={cn(
                    'mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wider text-slate-500',
                    collapsed && 'lg:hidden',
                  )}
                >
                  {group.heading}
                </p>
                <ul className="space-y-0.5">
                  {visible.map((item) => (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        end={item.path === '/'}
                        onClick={onClose}
                        title={collapsed ? item.label : undefined}
                         className={({ isActive }) =>
                           cn(
                             'group relative flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-primary)]',
                              collapsed && 'lg:justify-center lg:px-0',
                             isActive
                               ? 'bg-[var(--cb-primary-dark)] text-[var(--cb-primary-text)]'
                               : 'text-[var(--cb-primary-text-a60)] hover:bg-[var(--cb-primary-text-a10)] hover:text-[var(--cb-primary-text)]',
                           )
                         }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon
                              aria-hidden
                              className={cn(
                                'h-4 w-4 shrink-0',
                                isActive ? 'text-[var(--cb-primary-text)]' : 'text-[var(--cb-primary-text-a60)] group-hover:text-[var(--cb-primary-text)]',
                              )}
                            />
                            <span className={cn('truncate', collapsed && 'lg:hidden')}>
                              {item.label}
                            </span>
                            {item.badge !== undefined && (
                              <span
                                className={cn(
                                   'tabular ml-auto rounded px-1.5 py-0.5 text-2xs',
                                   isActive ? 'bg-[var(--cb-primary-text-a20)] text-[var(--cb-primary-text)]' : 'bg-[var(--cb-primary-text-a10)] text-[var(--cb-primary-text-a80)]',
                                   collapsed && 'lg:hidden',
                                )}
                              >
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>

        {/* Signed-in user */}
        <div className="shrink-0 border-t border-white/10 p-2.5">
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2 py-1.5',
              collapsed && 'lg:justify-center lg:px-0',
            )}
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--cb-primary-bg)] text-xs font-semibold text-[var(--cb-primary-deep)]"
            >
              {initials(user?.fullName)}
            </span>
            <div className={cn('min-w-0 flex-1', collapsed && 'lg:hidden')}>
              <p className="truncate text-xs font-medium text-white">{user?.fullName ?? '—'}</p>
              <p className="truncate text-2xs text-slate-400">
                {user ? user.role.replace(/_/g, ' ') : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Desktop collapse control */}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="hidden h-9 shrink-0 items-center justify-center border-t border-white/10 text-slate-400 transition-colors hover:bg-white/10 hover:text-white lg:flex"
        >
          <ChevronsLeft
            className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')}
          />
        </button>
      </aside>
    </>
  )
}
