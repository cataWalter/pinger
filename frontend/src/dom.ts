export function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]')))
}

export function primaryModifierLabel() {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
}

export function lowSpecModeEnabled(): boolean {
  return document.documentElement.dataset.lowSpec === 'true'
}

export function preferredScrollBehavior(behavior: ScrollBehavior = 'smooth'): ScrollBehavior {
  if (lowSpecModeEnabled()) return 'auto'
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior
}
