import { NavLink } from 'react-router-dom'
import { cn } from '../../utils'

export interface TabItem {
  label: string
  /** Route the tab links to. Use paths, not hashes, so deep links work. */
  to: string
  /** Optional counter rendered beside the label. */
  count?: number
}

/**
 * Route-based tabs.
 *
 * Navigation is real routing rather than local state so a tab can be linked to
 * and survives a refresh — useful when an administrator bookmarks a specific
 * filtered view.
 */
export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <nav className={cn('flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) =>
            cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors',
              isActive
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )
          }
        >
          {item.label}
          {item.count !== undefined && (
            <span className="tabular ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-2xs text-slate-600">
              {item.count.toLocaleString()}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
