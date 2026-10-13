import { useEffect, useRef } from 'react'

/**
 * Close a popover or modal when the user clicks outside it or presses Escape.
 */
export function useDismissable(
  active: boolean,
  onDismiss: () => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  const handlerRef = useRef(onDismiss)
  handlerRef.current = onDismiss

  useEffect(() => {
    if (!active) return

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const el = ref.current
      if (el && !el.contains(event.target as Node)) {
        handlerRef.current()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handlerRef.current()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [active, ref])
}
