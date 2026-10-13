import { AlertTriangle, Inbox, Loader2, RefreshCw, ServerCrash } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { cn } from '../../utils'
import { Button } from './Button'
import { Panel } from './Panel'

/* -------------------------------------------------------------------------- */
/* LoadingState                                                                */
/* -------------------------------------------------------------------------- */

export interface LoadingStateProps {
  label?: string
  className?: string
  /** Renders skeleton rows instead of a spinner, for table bodies. */
  rows?: number
}

export function LoadingState({ label = 'Loading…', className, rows = 5 }: LoadingStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 py-14', className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 aria-hidden className="h-5 w-5 animate-spin text-brand-600" />
      <p className="text-sm text-slate-500">{label}</p>
      <span className="sr-only">{label}</span>
      {/* Skeletons are decorative; the live region above carries the message. */}
      <div aria-hidden className="mt-2 w-full max-w-lg space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="h-9 animate-pulse rounded bg-slate-100"
            style={{ animationDelay: `${i * 70}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                  */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
  /** `inline` sits inside a panel; `page` fills the content area. */
  variant?: 'inline' | 'page'
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  variant = 'inline',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        variant === 'page' ? 'py-20' : 'py-14',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"
      >
        {icon ?? <Inbox className="h-5 w-5" />}
      </span>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* ErrorState                                                                  */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps {
  title?: string
  message?: ReactNode
  onRetry?: () => void
  className?: string
  /** Hides the retry button when a retry would not help. */
  retryable?: boolean
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'The request could not be completed.',
  onRetry,
  className,
  retryable = true,
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span
        aria-hidden
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500"
      >
        <ServerCrash className="h-5 w-5" />
      </span>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">{message}</p>
      {retryable && onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={onRetry}
          icon={<RefreshCw className="h-3.5 w-3.5" />}
        >
          Try again
        </Button>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* InlineAlert                                                                 */
/* -------------------------------------------------------------------------- */

export type AlertTone = 'info' | 'warning' | 'danger' | 'success'

const ALERT_TONES: Record<AlertTone, string> = {
  info: 'border-brand-200 bg-brand-50 text-brand-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
}

const ALERT_ICON: Record<AlertTone, ReactNode> = {
  info: <span aria-hidden className="block h-2 w-2 rounded-full bg-brand-500" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-600" />,
  danger: <AlertTriangle className="h-4 w-4 text-red-600" />,
  success: <span aria-hidden className="block h-2 w-2 rounded-full bg-emerald-500" />,
}

export interface AlertProps {
  tone?: AlertTone
  title?: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
  /**
   * `assertive` interrupts a screen reader immediately, which is what an error
   * or warning raised by a user action needs. Defaults to `polite` for
   * informational notices, which should not cut off the current utterance.
   */
  live?: 'assertive' | 'polite' | 'off'
}

/** Inline message block for contextual warnings inside a page. */
export function Alert({ tone = 'info', title, children, actions, className, live }: AlertProps) {
  const urgency = live ?? (tone === 'danger' || tone === 'warning' ? 'assertive' : 'polite')

  return (
    <div
      role={urgency === 'off' ? undefined : 'alert'}
      aria-live={urgency === 'off' ? undefined : urgency}
      className={cn('rounded-md border px-4 py-3', ALERT_TONES[tone], className)}
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="mt-1 shrink-0">
          {ALERT_ICON[tone]}
        </span>
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          {title && <p className="font-semibold">{title}</p>}
          <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* ErrorBoundary                                                               */
/* -------------------------------------------------------------------------- */

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches render errors so one broken widget cannot blank the whole admin
 * shell — important when a section is mid-build.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Replace with the application's logger once one exists.
    console.error('[admin-ui] render error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <Panel className="m-5">
          <div className="p-6">
            <ErrorState
              title={this.props.label ? `${this.props.label} failed to render` : 'Something went wrong'}
              message={this.state.error.message}
              onRetry={() => this.setState({ error: null })}
            />
          </div>
        </Panel>
      )
    }
    return this.props.children
  }
}
