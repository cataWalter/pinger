import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { type ActionMenuEntry } from './appTypes'
import { primaryModifierLabel } from './dom'

export function IconTooltip({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`icon-tooltip${className ? ` ${className}` : ''}`} data-tooltip={label}>{children}</div>
}

export function primaryShiftShortcutKey(event: globalThis.KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.repeat || event.isComposing) return ''
  return event.code.match(/^Key([A-Z])$/)?.[1] ?? event.key.toUpperCase()
}

export function primaryShiftShortcutLabel(key: string) {
  const modifier = primaryModifierLabel()
  return modifier === '⌘' ? `⌘⇧${key}` : `${modifier}+Shift+${key}`
}

export function ActionMenu({ label, icon, items, side = 'bottom', showLabel = false, disabled = false, count = 0 }: {
  label: string
  icon: ReactNode
  items: ActionMenuEntry[]
  side?: 'top' | 'bottom'
  showLabel?: boolean
  disabled?: boolean
  count?: number
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const focusLastRef = useRef(false)

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const menu = menuRef.current
      const trigger = triggerRef.current
      if (!menu || !trigger) return
      menu.style.setProperty('--menu-shift', '0px')
      const bounds = menu.getBoundingClientRect()
      const scale = menu.offsetWidth > 0 ? bounds.width / menu.offsetWidth : 1
      const anchor = trigger.getBoundingClientRect()
      const availableHeight = side === 'top' ? anchor.top - 16 : window.innerHeight - anchor.bottom - 16
      menu.style.maxHeight = `${Math.max(32, availableHeight / scale)}px`
      const shift = bounds.left < 8 ? 8 - bounds.left : bounds.right > window.innerWidth - 8 ? window.innerWidth - 8 - bounds.right : 0
      menu.style.setProperty('--menu-shift', `${shift / scale}px`)
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open, side])

  useEffect(() => {
    if (!open) return
    const enabled = menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    const initial = enabled?.[focusLastRef.current ? enabled.length - 1 : 0]
    const target = initial ?? menuRef.current
    target?.focus()
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const shortcutKey = primaryShiftShortcutKey(event.nativeEvent)
    const shortcut = shortcutKey ? items.find((item) => item.primaryShiftKey === shortcutKey) : undefined
    if (shortcut) {
      event.preventDefault()
      event.stopPropagation()
      if (!shortcut.disabled) {
        close()
        shortcut.onSelect()
      }
      return
    }
    const enabled = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      close()
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && enabled.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
      enabled[next].focus()
    }
  }

  return <div className="action-menu-control" data-side={side} ref={rootRef}>
    <IconTooltip label={label}>
      <button ref={triggerRef} className={`icon-button action-menu-trigger${showLabel ? ' has-label' : ''}`} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (open) close(); else { focusLastRef.current = false; setOpen(true) } }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          focusLastRef.current = event.key === 'ArrowUp'
          setOpen(true)
        }
      }}>
        {icon}{showLabel && <span>{label}</span>}{count > 0 && <span className="action-menu-count">{count}</span>}
      </button>
    </IconTooltip>
    {open && <div id={id} className={`action-menu${items.some((item) => item.primaryShiftKey) ? ' has-shortcuts' : ''}`} role="menu" aria-label={label} ref={menuRef} tabIndex={-1} onKeyDown={navigate}>
      {items.map((item) => <button key={item.label} type="button" role={item.active === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-label={item.label} aria-description={item.count ? `${item.count} items` : undefined} aria-keyshortcuts={item.primaryShiftKey ? `Control+Shift+${item.primaryShiftKey} Meta+Shift+${item.primaryShiftKey}` : undefined} aria-checked={item.active} title={item.title} tabIndex={-1} disabled={item.disabled} onClick={() => { close(); item.onSelect() }}>
        {item.icon}<span>{item.label}</span>{item.primaryShiftKey && <kbd aria-hidden="true">{primaryShiftShortcutLabel(item.primaryShiftKey)}</kbd>}{item.count !== undefined && item.count > 0 && <small aria-hidden="true">{item.count}</small>}{item.active && <Check className="action-menu-check" size={14} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}
