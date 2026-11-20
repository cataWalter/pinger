import { useCallback, useState } from 'react'

export const SIDEBAR_WIDTH_STORAGE_KEY = 'pinger.sidebar-width.v1'
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 440

type WidthStorage = Pick<Storage, 'getItem' | 'setItem'>

function storageOrNull(): WidthStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// Caps the room list at half the window so the conversation keeps room.
export function clampSidebarWidth(width: number, viewportWidth = window.innerWidth): number {
  const max = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.floor(viewportWidth / 2)))
  return Math.round(Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, width)))
}

export function loadSidebarWidth(storage: Pick<Storage, 'getItem'> | null = storageOrNull()): number | null {
  try {
    const raw = storage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!raw) return null
    const width = Number(raw)
    return Number.isFinite(width) ? clampSidebarWidth(width) : null
  } catch {
    return null
  }
}

export function saveSidebarWidth(width: number, storage: Pick<Storage, 'setItem'> | null = storageOrNull()): void {
  try {
    storage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Ignore storage failures; the width still applies for this session.
  }
}

// Returns null until the user resizes, so the stylesheet default applies.
export function useSidebarWidth(): [number | null, (width: number) => void] {
  const [width, setWidthState] = useState<number | null>(() => loadSidebarWidth())
  const setWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next)
    saveSidebarWidth(clamped)
    setWidthState(clamped)
  }, [])
  return [width, setWidth]
}
