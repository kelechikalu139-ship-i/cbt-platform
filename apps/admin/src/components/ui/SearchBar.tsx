import { Search, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../../utils'
import { Button } from './Button'

export interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Accessible label; also used as the input's aria-label fallback. */
  label?: string
  className?: string
}

/**
 * Search input that keeps its own draft state so typing stays responsive while
 * the parent debounces before querying the server.
 */
export function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
  label = 'Search',
  className,
}: SearchBarProps) {
  const [draft, setDraft] = useState(value)

  // Re-sync when the parent resets the search externally (e.g. "Clear filters").
  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <div className={cn('relative w-full max-w-xs', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      />
      <input
        type="search"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(e.target.value)
        }}
        className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-8 text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:border-[var(--cb-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--cb-primary-a30)] [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('')
            onChange('')
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export interface FilterSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  className?: string
  /** Width of the select; defaults to auto. */
  width?: string
}

/** Compact labelled select used in a toolbar above a data table. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
  width = 'w-auto',
}: FilterSelectProps) {
  return (
    <label className={cn('flex items-center gap-2', className)}>
      <span className="whitespace-nowrap text-xs font-medium text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          'h-9 cursor-pointer rounded-md border border-slate-300 bg-white pl-2.5 pr-7 text-xs font-medium text-slate-700 transition-colors',
          'focus:border-[var(--cb-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--cb-primary-a30)]',
          width,
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/* -------------------------------------------------------------------------- */

export interface ToolbarProps {
  children: ReactNode
  className?: string
}

/** Row above a table holding search, filters and actions. */
export function Toolbar({ children, className }: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface ToolbarGroupProps {
  children: ReactNode
  className?: string
}

export function ToolbarGroup({ children, className }: ToolbarGroupProps) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
}

/** "Showing 42 of 1,248" style summary, shown in toolbars. */
export function ResultCount({ shown, total }: { shown: number; total: number }) {
  return (
    <p className="tabular whitespace-nowrap text-xs text-slate-500">
      <span className="font-medium text-slate-700">{shown.toLocaleString()}</span>
      {total !== shown && <> of {total.toLocaleString()}</>} record{(total === 1 ? '' : 's')}
    </p>
  )
}

/* -------------------------------------------------------------------------- */

export interface PhaseNoticeProps {
  /** Which phase of the roadmap this section belongs to. */
  phase: string
  children: ReactNode
  className?: string
}

/**
 * Shown on placeholder pages to be explicit that a section is deliberately not
 * built yet, rather than appearing broken or forgotten.
 */
export function PhaseNotice({ phase, children, className }: PhaseNoticeProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3',
        className,
      )}
    >
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
      <div className="min-w-0 text-xs leading-relaxed text-amber-900">
        <p className="font-semibold">Scheduled for {phase}</p>
        <div className="mt-0.5 text-amber-800">{children}</div>
      </div>
    </div>
  )
}

export interface ClearButtonProps {
  onClick: () => void
  children?: ReactNode
}

export function ClearFiltersButton({ onClick, children = 'Clear filters' }: ClearButtonProps) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} icon={<X className="h-3.5 w-3.5" />}>
      {children}
    </Button>
  )
}
