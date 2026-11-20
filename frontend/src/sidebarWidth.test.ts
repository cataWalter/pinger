import { describe, expect, it } from 'vitest'
import { clampSidebarWidth, loadSidebarWidth, saveSidebarWidth, SIDEBAR_WIDTH_STORAGE_KEY } from './sidebarWidth'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('sidebar width', () => {
  it('clamps to the room list limits and to half the window', () => {
    expect(clampSidebarWidth(120, 1200)).toBe(200)
    expect(clampSidebarWidth(900, 1200)).toBe(440)
    expect(clampSidebarWidth(360, 600)).toBe(300)
  })

  it('loads a saved width and ignores missing or invalid values', () => {
    expect(loadSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: '320' }))).toBe(320)
    expect(loadSidebarWidth(memoryStorage())).toBeNull()
    expect(loadSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: 'wide' }))).toBeNull()
    expect(loadSidebarWidth(null)).toBeNull()
  })

  it('saves the width as text', () => {
    const storage = memoryStorage()
    saveSidebarWidth(330, storage)
    expect(storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe('330')
  })
})
