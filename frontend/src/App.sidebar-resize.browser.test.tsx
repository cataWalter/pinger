import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installAppBrowserCleanup, renderApp } from './appBrowserHarness'
import { SIDEBAR_WIDTH_STORAGE_KEY } from './sidebarWidth'

vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: vi.fn(() => Promise.resolve()) },
  Clipboard: { SetText: vi.fn(() => Promise.resolve()) },
  Events: { On: vi.fn(() => () => { }) },
}))

vi.mock('../bindings/mychat/desktop', async () => ({
  AppService: (await import('./appBrowserMocks')).service,
  LanguageTutorService: { Analyze: vi.fn(() => Promise.resolve({})) },
}))

installAppBrowserCleanup()

afterEach(() => {
  localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
})

function sidebarColumnPx() {
  const shell = document.querySelector<HTMLElement>('.app-shell')
  if (!shell) throw new Error('app shell not rendered')
  return parseFloat(getComputedStyle(shell).gridTemplateColumns)
}

describe('browser smoke: resizable room list', () => {
  it('resizes the room list with the keyboard and by dragging, and remembers the width', async () => {
    const user = userEvent.setup()
    await page.viewport(1100, 780)
    renderApp()
    await screen.findByRole('navigation', { name: 'Rooms' })
    const handle = screen.getByRole('separator', { name: 'Resize room list' })
    const initial = sidebarColumnPx()

    handle.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(sidebarColumnPx()).toBe(initial + 32)

    fireEvent.pointerDown(handle, { clientX: 300, button: 0 })
    fireEvent.pointerMove(window, { clientX: 340 })
    fireEvent.pointerUp(window, { clientX: 340 })
    expect(sidebarColumnPx()).toBe(initial + 72)
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(initial + 72))
  })
})
