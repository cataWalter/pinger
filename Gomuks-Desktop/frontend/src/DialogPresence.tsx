import { useState, type ReactNode } from 'react'
import { useExitTransition } from './hooks/useExitTransition'

// DialogPresence keeps the last open dialog rendered while its exit animation plays.
// The wrapper uses display: contents, so dialog layout is unchanged.
export function DialogPresence({ open, children }: { open: boolean; children: ReactNode }) {
  const exit = useExitTransition(open)
  const [held, setHeld] = useState<ReactNode>(null)
  if (open && children !== held) setHeld(children)
  if (!exit.mounted) return null
  return (
    <div className="dialog-presence" data-closing={exit.closing ? 'true' : undefined} inert={exit.closing}>
      {open ? children : held}
    </div>
  )
}
