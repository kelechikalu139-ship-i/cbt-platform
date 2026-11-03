import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 208 })

  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('touchstart', dismiss)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('touchstart', dismiss)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = 208
      const left = align === 'right' ? rect.right - width : rect.left
      setPosition({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
        width,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, align])

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div ref={triggerRef}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        {trigger}
      </div>
      {open && createPortal(
        <div
          ref={menuRef}
          onClick={(event) => {
            event.stopPropagation()
            setOpen(false)
          }}
          className={cn(
            'fixed z-[100] animate-slide-up overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-pop',
          )}
          style={{ top: position.top, left: position.left, width: position.width }}
        >
          {children}
        </div>,
        document.body,
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
