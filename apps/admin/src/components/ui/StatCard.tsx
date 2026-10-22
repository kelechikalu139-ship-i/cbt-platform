import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn, formatNumber } from '../../utils'

export interface StatCardProps {
  label: string
  value: ReactNode
  /** Optional secondary figure rendered under the value. */
  hint?: ReactNode
  icon?: LucideIcon
  /** Accent colour for the icon plate. */
  tone?: 'brand' | 'emerald' | 'amber' | 'violet' | 'sky' | 'slate'
  onClick?: () => void
  className?: string
}

const TONE_PLATE: Record<NonNullable<StatCardProps['tone']>, string> = {
  brand: 'bg-[var(--cb-primary-bg)] text-[var(--cb-primary-deep)]',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  sky: 'bg-sky-50 text-sky-600',
  slate: 'bg-slate-100 text-slate-500',
}

/**
 * Dashboard counter.
 *
 * Deliberately compact and flat: an examination department scans these at a
 * glance, so the value dominates and everything else is secondary.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  onClick,
  className,
}: StatCardProps) {
  const Wrapper = onClick ? 'button' : 'div'

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4 text-left shadow-panel',
        onClick &&
          'cursor-pointer transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-primary)]',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="tabular mt-1.5 text-2xl font-semibold leading-none text-slate-900">
          {typeof value === 'number' ? formatNumber(value) : value}
        </p>
        {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {Icon && (
        <span
          aria-hidden
          className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md', TONE_PLATE[tone])}
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
    </Wrapper>
  )
}

/** Compact label/value row used in detail panels. */
export function DataPoint({
  label,
  value,
  className,
}: {
  label: ReactNode
  value: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', className)}>
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="tabular min-w-0 truncate text-right text-sm font-medium text-slate-800">
        {value}
      </dd>
    </div>
  )
}

/**
 * Horizontal proportion bar. Used for pass rate and grade distribution.
 * Colour communicates the band without needing a legend.
 */
export function ProportionBar({
  value,
  max = 100,
  tone = 'brand',
  className,
}: {
  value: number
  max?: number
  tone?: 'brand' | 'emerald' | 'amber' | 'red'
  className?: string
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const bar =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : tone === 'red'
          ? 'bg-red-500'
          : 'bg-[var(--cb-primary)]'

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full rounded-full transition-[width]', bar)} style={{ width: `${pct}%` }} />
    </div>
  )
}
