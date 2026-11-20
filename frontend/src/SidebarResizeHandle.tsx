import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { clampSidebarWidth, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from './sidebarWidth'

const KEYBOARD_STEP = 16

type SidebarResizeHandleProps = {
  width: number | null
  zoom: number
  onWidthChange: (width: number) => void
}

export function SidebarResizeHandle({ width, zoom, onWidthChange }: SidebarResizeHandleProps) {
  const removeDragListeners = useRef<(() => void) | null>(null)

  useEffect(() => () => removeDragListeners.current?.(), [])

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const sidebar = event.currentTarget.parentElement
    const shell = event.currentTarget.closest<HTMLElement>('.app-shell')
    if (event.button !== 0 || !sidebar || !shell) return
    event.preventDefault()
    const startX = event.clientX
    // Dividing by zoom converts rendered pixels back to the CSS width the grid uses.
    const startWidth = sidebar.getBoundingClientRect().width / zoom
    let nextWidth: number | null = null

    const handleMove = (move: PointerEvent) => {
      nextWidth = clampSidebarWidth(startWidth + (move.clientX - startX) / zoom)
      shell.style.setProperty('--sidebar-width', `${nextWidth}px`)
    }
    const removeListeners = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
      window.removeEventListener('pointercancel', handleEnd)
      removeDragListeners.current = null
    }
    const handleEnd = () => {
      removeListeners()
      if (nextWidth !== null) onWidthChange(nextWidth)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleEnd)
    window.addEventListener('pointercancel', handleEnd)
    removeDragListeners.current = removeListeners
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const sidebar = event.currentTarget.parentElement
    if (!sidebar) return
    event.preventDefault()
    event.stopPropagation()
    const current = width ?? sidebar.getBoundingClientRect().width / zoom
    onWidthChange(current + (event.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP))
  }

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label="Resize room list"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={width ?? undefined}
      onPointerDown={startDrag}
      onKeyDown={handleKeyDown}
    />
  )
}
