import type { ReactNode } from 'react'
import { cn } from '../../utils'

/* -------------------------------------------------------------------------- */
/* Panel — the standard surface for every block of content                     */
/* -------------------------------------------------------------------------- */

export interface PanelProps {
  children: ReactNode
  className?: string
}

export function Panel({ children, className }: PanelProps) {
  return (
    <section
      className={cn('rounded-lg border border-slate-200 bg-white shadow-panel', className)}
    >
      {children}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* PanelHeader                                                                 */
/* -------------------------------------------------------------------------- */

export interface PanelHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PanelHeader({ title, description, actions, className }: PanelHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/* -------------------------------------------------------------------------- */
/* PanelBody                                                                   */
/* -------------------------------------------------------------------------- */

export function PanelBody({
  children,
  className,
  flush = false,
}: {
  children: ReactNode
  className?: string
  flush?: boolean
}) {
  return <div className={cn(flush ? '' : 'p-5', className)}>{children}</div>
}

export function PanelFooter({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <footer
      className={cn(
        'flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3',
        className,
      )}
    >
      {children}
    </footer>
  )
}

/* -------------------------------------------------------------------------- */
/* PageHeader — title block used at the top of every page                      */
/* -------------------------------------------------------------------------- */

export interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Small contextual note, e.g. the LAN address or record counts. */
  meta?: ReactNode
}

export function PageHeader({ title, description, actions, meta }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        {meta && <div className="mt-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
