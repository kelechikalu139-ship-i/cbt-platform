import React from 'react'
import { cn } from '../../utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  /** Leading glyph, rendered before the label. */
  icon?: React.ReactNode
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}) => {
  const base = 'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2'
  const variants = {
    primary: 'bg-[var(--cb-primary)] text-[var(--cb-primary-text)] hover:bg-[var(--cb-primary-dark)] focus:ring-[var(--cb-primary)]',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-indigo-500',
    ghost: 'text-gray-700 hover:bg-gray-100 focus:ring-gray-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        icon && (
          <span className="-ml-0.5 mr-2 flex shrink-0 items-center" aria-hidden>
            {icon}
          </span>
        )
      )}
      {children}
    </button>
  )
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input: React.FC<InputProps> = ({ label, error, className, ...props }) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
        </label>
      )}
      <input
        className={cn(
          'w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors',
          error && 'border-red-500 focus:ring-red-500',
          className,
        )}
        {...props}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
}

interface CardProps {
  children: React.ReactNode
  className?: string
  title?: string
  action?: React.ReactNode
}

export const Card: React.FC<CardProps> = ({ children, className, title, action }) => {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-200 shadow-sm', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          {title && <h3 className="text-lg font-semibold text-gray-900">{title}</h3>}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  )
}

export const Badge: React.FC<{ children: React.ReactNode; variant?: 'success' | 'warning' | 'error' | 'info' | 'default'; className?: string }> = ({
  children,
  variant = 'default',
  className,
}) => {
  const variants = {
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    default: 'bg-gray-100 text-gray-800',
  }
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  )
}

export const Spinner: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={cn('animate-spin h-5 w-5', className)} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
)

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="text-center py-12">
      {icon && <div className="mx-auto w-12 h-12 text-gray-400 mb-4">{icon}</div>}
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      {description && <p className="text-gray-500 mb-6">{description}</p>}
      {action}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                      */
/* -------------------------------------------------------------------------- */

interface ModalProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Blocks the backdrop click and Escape while a decision is in flight. */
  dismissible?: boolean
}

const MODAL_SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }

/**
 * Dialog rendered above the page with a backdrop.
 *
 * Escape and a backdrop click close it only while `dismissible` is true,
 * so a submit confirmation cannot be dismissed by a stray keypress while
 * the request is in flight. Focus moves into the dialog on open and back
 * to the caller on close, so the keyboard never gets lost behind it.
 */
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = 'md',
  dismissible = true,
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previouslyFocused = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus()
    }, 0)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(timer)
      previouslyFocused?.focus?.()
    }
  }, [open, dismissible, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-gray-900/50 backdrop-blur-[1px]"
        onClick={dismissible ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'relative w-full bg-white rounded-xl shadow-xl animate-[fadeIn_.15s_ease-out]',
          MODAL_SIZES[size],
        )}
      >
        <div className="p-6">
          {icon && (
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              {icon}
            </div>
          )}
          <h2 className="text-lg font-semibold text-gray-900 text-center">{title}</h2>
          {description && (
            <p className="mt-1.5 text-sm text-gray-500 text-center">{description}</p>
          )}
          {children && <div className="mt-5">{children}</div>}
        </div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-6 py-4 sm:flex-row sm:justify-center">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Loading state                                                               */
/* -------------------------------------------------------------------------- */

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('animate-pulse rounded-md bg-gray-200', className)} aria-hidden />
)

/** Placeholder matching one exam card, so the grid does not jump on load. */
export const ExamCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
    <div className="flex items-start justify-between mb-3">
      <Skeleton className="h-6 w-24 rounded-full" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
    <Skeleton className="h-5 w-3/4" />
    <Skeleton className="mt-2 h-4 w-full" />
    <Skeleton className="mt-1.5 h-4 w-2/3" />
    <div className="mt-4 flex items-center gap-4">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-14" />
    </div>
    <div className="mt-5 flex items-center justify-between">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-9 w-24 rounded-lg" />
    </div>
  </div>
)

export const ProgressBar: React.FC<{
  value: number
  max: number
  className?: string
}> = ({ value, max, className }) => (
  <div className={cn('h-2 w-full overflow-hidden rounded-full bg-gray-200', className)}>
    <div
      className="h-full rounded-full bg-indigo-600 transition-[width] duration-300"
      style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }}
    />
  </div>
)