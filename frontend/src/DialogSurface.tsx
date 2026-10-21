import { useEffect, useRef, type MouseEventHandler, type ReactNode } from 'react'

export interface DialogSurfaceProps {
  children: ReactNode
  className: string
  role?: 'dialog' | 'alertdialog'
  labelledBy?: string
  label?: string
  onClose: () => void
  onClick?: MouseEventHandler<HTMLElement>
}

export function DialogSurface({ children, className, role = 'dialog', labelledBy, label, onClose, onClick }: DialogSurfaceProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const firstFocusable = dialog.querySelector<HTMLElement>(focusableSelector)
    ;(firstFocusable ?? dialog).focus()

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const openDialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
      if (openDialogs[openDialogs.length - 1] !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <section
      ref={dialogRef}
      className={className}
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={label}
      tabIndex={-1}
      onClick={onClick}
    >
      {children}
    </section>
  )
}