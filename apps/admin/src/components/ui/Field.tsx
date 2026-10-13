import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertCircle, ChevronDown } from 'lucide-react'
import { cn } from '../../utils'

const FIELD_BASE =
  'w-full rounded-md border bg-white text-sm text-slate-800 placeholder:text-slate-400 ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

interface FieldShellProps {
  id: string
  label?: ReactNode
  hint?: ReactNode
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}

/** Shared label / hint / error chrome so every field lines up identically. */
function FieldShell({ id, label, hint, error, required, children, className }: FieldShellProps) {
  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-700">
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-red-600">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1 text-xs text-red-600">
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  /** Icon rendered inside the field on the left. */
  icon?: ReactNode
  /** Trailing static text, e.g. a fixed unit. */
  suffix?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, suffix, className, required, id, ...rest },
  ref,
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        {icon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 [&>svg]:h-4 [&>svg]:w-4"
          >
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            FIELD_BASE,
            'h-9 px-3',
            icon && 'pl-9',
            suffix && 'pr-10',
            error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-300',
            className,
          )}
          {...rest}
        />
        {suffix && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"
          >
            {suffix}
          </span>
        )}
      </div>
    </FieldShell>
  )
})

/* -------------------------------------------------------------------------- */

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  options: SelectOption[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, className, required, id, ...rest },
  ref,
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            FIELD_BASE,
            'h-9 cursor-pointer appearance-none pl-3 pr-9',
            error ? 'border-red-400' : 'border-slate-300',
            className,
          )}
          {...rest}
        >
          {placeholder && <option key="placeholder" value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
      </div>
    </FieldShell>
  )
})

/* -------------------------------------------------------------------------- */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, required, id, ...rest },
  ref,
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <textarea
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          FIELD_BASE,
          'resize-y px-3 py-2 leading-relaxed',
          error ? 'border-red-400' : 'border-slate-300',
          className,
        )}
        {...rest}
      />
    </FieldShell>
  )
})

/* -------------------------------------------------------------------------- */

export interface ComboboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  /** Known values to offer; a value outside the list is still accepted. */
  options: string[]
  /** Placeholder for the free-text part. */
  placeholder?: string
}

/**
 * Text input with a dropdown of known values.
 *
 * Suggestions come from the school's own register — programmes,
 * departments, classes — so an operator picks an existing value in one
 * click, yet is never blocked from entering one the school has not
 * registered yet. A nursing school, a polytechnic and a university all
 * work without any per-school configuration.
 */
export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  { label, hint, error, options, placeholder, className, required, id, ...rest },
  ref,
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const listId = `${fieldId}-options`
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          list={listId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          className={cn(
            FIELD_BASE,
            'h-9 px-3',
            error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30' : 'border-slate-300',
            className,
          )}
          {...rest}
        />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </div>
    </FieldShell>
  )
})

/* -------------------------------------------------------------------------- */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: ReactNode
}

export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={fieldId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        {...rest}
      />
      <label htmlFor={fieldId} className="cursor-pointer select-none text-sm leading-tight">
        <span className="font-medium text-slate-700">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </label>
    </div>
  )
}

/** Segmented switch for boolean exam rules and settings. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}
