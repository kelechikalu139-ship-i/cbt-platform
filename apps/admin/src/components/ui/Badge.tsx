import type { ReactNode } from 'react'
import { STATUS_TONE } from '../../utils'
import { cn } from '../../utils'

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'violet'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
}

export interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  className?: string
  /** Adds a leading dot, useful for live statuses. */
  dot?: boolean
}

export function Badge({ children, tone = 'neutral', className, dot = false }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-2xs font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  )
}

/**
 * Status badge driven by the domain status string.
 *
 * Tones come from `STATUS_TONE` so that "ongoing", "active", "ok" and "passed"
 * all read consistently across the dashboard, tables and detail panels.
 */
export function StatusBadge({
  status,
  label,
  dot = true,
  className,
}: {
  status: string
  label?: ReactNode
  dot?: boolean
  className?: string
}) {
  const toneClass = STATUS_TONE[status] ?? TONES.neutral

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-2xs font-medium capitalize ring-1 ring-inset',
        toneClass,
        className,
      )}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {label ?? status.replace(/_/g, ' ')}
    </span>
  )
}
