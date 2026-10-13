import { useRef, useState, type ReactNode } from 'react'
import { useDismissable } from '../../hooks/useDismissable'
import { cn } from '../../utils'

export interface DropdownProps {
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}

/** Lightweight popover menu anchored to its trigger. */
export function Dropdown({ trigger, children, align = 'right', className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useDismissable(open, () => setOpen(false), containerRef)

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            'absolute z-30 mt-1.5 min-w-[13rem] animate-slide-up overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export interface DropdownItemProps {
  children: ReactNode
  onClick?: () => void
  icon?: ReactNode
  destructive?: boolean
  disabled?: boolean
}

export function DropdownItem({
  children,
  onClick,
  icon,
  destructive = false,
  disabled = false,
}: DropdownItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        destructive
          ? 'text-red-600 hover:bg-red-50'
          : 'text-slate-700 hover:bg-slate-50',
      )}
    >
      {icon && <span aria-hidden className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
      {children}
    </button>
  )
}

export function DropdownDivider() {
  return <div className="my-1 border-t border-slate-100" role="separator" />
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </p>
  )
}
