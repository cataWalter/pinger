import { flushSync } from 'react-dom'
import { prefersReducedMotion } from './hooks/useExitTransition'

type ViewTransitionDocument = Document & { startViewTransition?: (callback: () => void) => unknown }

// runWithViewTransition applies update inside a View Transition so the change cross-fades.
// flushSync commits the React update before the browser captures the new frame.
// Falls back to a plain update when the API is missing or reduced motion is requested.
export function runWithViewTransition(update: () => void) {
  const doc = typeof document === 'undefined' ? undefined : (document as ViewTransitionDocument)
  if (!doc || typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    update()
    return
  }
  doc.startViewTransition(() => flushSync(update))
}
