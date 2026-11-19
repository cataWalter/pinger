import { useEffect, useState } from 'react'
import { lowSpecModeEnabled } from '../dom'

// Low-spec mode counts as reduced motion so exit transitions and view transitions finish immediately.
export function prefersReducedMotion(): boolean {
  if (lowSpecModeEnabled()) return true
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// useExitTransition keeps an element mounted for exitMs after open turns false so an exit animation can finish.
// Under reduced motion the element unmounts immediately.
export function useExitTransition(open: boolean, exitMs = 120) {
  const [retained, setRetained] = useState(open)
  if (open && !retained) setRetained(true)

  useEffect(() => {
    if (open || !retained) return
    const delay = prefersReducedMotion() ? 0 : exitMs
    const timer = window.setTimeout(() => setRetained(false), delay)
    return () => window.clearTimeout(timer)
  }, [exitMs, open, retained])

  return { mounted: open || retained, closing: !open && retained }
}
