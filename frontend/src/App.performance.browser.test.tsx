import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import type { AccountSummary, Room } from '../bindings/mychat/desktop/models.js'
import { service } from './appBrowserMocks'
import { captureScreenshot, installAppBrowserCleanup, renderApp } from './appBrowserHarness'

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

describe('browser smoke: performance', () => {
  it.each([75, 100, 125])('fills the visible timeline while scrolling large histories at %i percent zoom', async (zoom) => {
    await page.viewport(1100, 900)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, preferences: { ...snapshot.preferences, 'appearance.zoom': String(zoom) } })
    const history = await service.History()
    const template = history.messages[0]
    const historyMessages = Array.from({ length: 1000 }, (_, index) => ({
      ...template,
      id: `$coverage-${index}`,
      own: index % 2 === 1,
      sender: index % 2 === 1 ? '@me:example.org' : template.sender,
      body: Array.from({ length: index % 4 + 1 }, () => `Visible history message ${index}.`).join('\n'),
      timestamp: template.timestamp + index * 1000,
      timelineCursor: index + 1,
    }))
    service.History.mockResolvedValueOnce({ ...history, messages: historyMessages })
    const { container } = renderApp()
    await waitFor(() => {
      const tail = container.querySelector('[data-event-id="$coverage-999"]')
      expect(tail).not.toBeNull()
      expect(getComputedStyle(tail!).visibility).toBe('visible')
    }, { timeout: 5000 })
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    let previousFirstIndex = -1
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      let settledFirstIndex = -1
      timeline.scrollTop = (timeline.scrollHeight - timeline.clientHeight) * fraction
      fireEvent.scroll(timeline)
      await waitFor(() => {
        const viewport = timeline.getBoundingClientRect()
        const visibleRows = Array.from(timeline.querySelectorAll<HTMLElement>('.message-row'))
          .filter((row) => {
            const bounds = row.getBoundingClientRect()
            return getComputedStyle(row).visibility === 'visible' && bounds.bottom > viewport.top && bounds.top < viewport.bottom
          })
        expect(visibleRows.length).toBeGreaterThan(2)
        expect(visibleRows[0].getBoundingClientRect().top - viewport.top).toBeLessThanOrEqual(fraction === 0 ? 80 : 8)
        expect(viewport.bottom - visibleRows[visibleRows.length - 1].getBoundingClientRect().bottom).toBeLessThanOrEqual(60)
        const firstIndex = historyMessages.findIndex((message) => message.id === visibleRows[0].dataset.eventId)
        const lastIndex = historyMessages.findIndex((message) => message.id === visibleRows[visibleRows.length - 1].dataset.eventId)
        expect(firstIndex).toBeGreaterThan(previousFirstIndex)
        if (fraction === 0) expect(firstIndex).toBe(0)
        if (fraction === 1) expect(lastIndex).toBe(historyMessages.length - 1)
        else expect(lastIndex).toBeLessThan(historyMessages.length - 1)
        expect(Math.abs(visibleRows[0].getBoundingClientRect().height / visibleRows[0].offsetHeight - zoom / 100)).toBeLessThan(0.05)
        for (let index = 1; index < visibleRows.length; index++) {
          expect(visibleRows[index].getBoundingClientRect().top - visibleRows[index - 1].getBoundingClientRect().bottom).toBeLessThanOrEqual(20)
        }
        expect(timeline.querySelectorAll('.message-row').length).toBeLessThan(200)
        settledFirstIndex = firstIndex
      })
      previousFirstIndex = settledFirstIndex
    }
    await captureScreenshot({ path: `../.vitest/ui/timeline-scroll-coverage-${zoom}.png` })
  })

  it.each([
    { width: 760, count: 4 },
    { width: 2048, count: 4 },
    { width: 760, count: 1000 },
    { width: 2048, count: 1000 },
  ])('aligns incoming and outgoing messages across the timeline at $width pixels with $count messages', async ({ width, count }) => {
    await page.viewport(width, 780)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, preferences: { ...snapshot.preferences, 'composer.formatting_toolbar': true } })
    const history = await service.History()
    const template = history.messages[0]
    service.History.mockResolvedValueOnce({
      ...history, messages: Array.from({ length: count }, (_, index) => ({
        ...template,
        id: `$alignment-${index}`,
        own: index % 2 === 1,
        sender: index % 2 === 1 ? '@me:example.org' : template.sender,
        body: 'A conversation should use both sides of the available timeline.',
        timestamp: template.timestamp + index * 1000,
        timelineCursor: index + 1,
      }))
    })
    const { container } = renderApp()
    const timeline = await screen.findByRole('region', { name: 'Message timeline' })
    await waitFor(() => {
      const outgoing = container.querySelector<HTMLElement>(`[data-event-id="$alignment-${count - 1}"] .message-body`)
      const incoming = container.querySelector<HTMLElement>(`[data-event-id="$alignment-${count - 2}"] .message-body`)
      expect(outgoing).not.toBeNull()
      expect(incoming).not.toBeNull()
      expect(getComputedStyle(outgoing!).visibility).toBe('visible')
      const bounds = timeline.getBoundingClientRect()
      const style = getComputedStyle(timeline)
      const right = bounds.right - parseFloat(style.paddingRight) - (timeline.offsetWidth - timeline.clientWidth)
      const left = bounds.left + parseFloat(style.paddingLeft)
      expect(Math.abs(outgoing!.getBoundingClientRect().right - right)).toBeLessThanOrEqual(2)
      expect(Math.abs(incoming!.getBoundingClientRect().left - left)).toBeLessThanOrEqual(2)
      expect(timeline.scrollWidth).toBeLessThanOrEqual(timeline.clientWidth)
    })
    const formatting = screen.getByRole('toolbar', { name: 'Formatting' }).getBoundingClientRect()
    const tools = screen.getByRole('group', { name: 'Message tools' }).getBoundingClientRect()
    expect(formatting.bottom).toBeLessThanOrEqual(tools.top)
    if (width > 1000) {
      expect(container.querySelector('.composer')!.getBoundingClientRect().height).toBeLessThan(160)
    }
    expect(container.querySelector('.composer')!.scrollWidth).toBeLessThanOrEqual(container.querySelector('.composer')!.clientWidth)
    await captureScreenshot({ path: `../.vitest/ui/timeline-alignment-${width}-${count}.png` })
  })

  it.each([100, 500, 1000].flatMap((count) => [1, 3].map((accountCount) => ({ count, accountCount }))))('measures room lists with $count rooms across $accountCount accounts without disturbing the conversation', async ({ count, accountCount }) => {
    await page.viewport(1100, 780)
    const snapshot = await service.Snapshot()
    const accounts: AccountSummary[] = Array.from({ length: accountCount }, (_, index) => ({
      id: index === 0 ? 'primary' : `account-${index}`,
      profile: { ...snapshot.profile, displayName: `Account ${index + 1}` },
    }))
    let rooms: Room[] = Array.from({ length: count }, (_, index) => ({
      ...snapshot.rooms[0],
      id: `!benchmark-room-${Math.floor(index / accountCount)}:example.org`,
      accountId: accounts[index % accountCount].id,
      name: `Room ${index + 1}`,
      preview: `Preview ${index + 1}`,
      lastEventAt: 1793447100000 + index * 1000,
    }))
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, accounts, rooms: rooms.filter((room) => room.accountId === 'primary') })
    const accountRoomsImplementation = service.AccountRooms.getMockImplementation()!
    service.AccountRooms.mockImplementation(async () => rooms.map((room) => ({ ...room })))
    const intervalSpy = vi.spyOn(window, 'setInterval')
    try {
      const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const commits: number[] = []
      const started = performance.now()
      const { container } = renderApp((_id, _phase, actualDuration) => commits.push(actualDuration))
      const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
      const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
      await waitFor(() => expect(container.querySelector('.room-section-actions')?.textContent).toBe(String(count).padStart(2, '0')))
      await document.fonts.ready
      await paint()
      const renderMs = performance.now() - started
      const refresh = intervalSpy.mock.calls.find(([, delay]) => delay === 15000)?.[0]
      if (accountCount > 1) expect(typeof refresh).toBe('function')
      const refreshRooms = refresh as (() => void) | undefined
      const poll = async () => {
        if (refreshRooms) await act(async () => refreshRooms())
        await paint()
      }
      fireEvent.change(composer, { target: { value: 'Warm draft' } })
      await poll()
      const historyCalls = service.History.mock.calls.length
      const accountRoomCalls = service.AccountRooms.mock.calls.length
      const trackedRoom = container.querySelector('.room-button')!
      const trackedMessage = container.querySelector('.message-row')!
      const roomRows = container.querySelectorAll('.room-button').length
      const nodes = container.querySelectorAll('*').length
      expect(roomRows).toBeGreaterThan(0)
      expect(roomRows).toBeLessThanOrEqual(Math.min(count, 100))
      const inputMs: number[] = []
      const pollMs: number[] = []
      for (let sample = 0; sample < 5; sample++) {
        const inputStarted = performance.now()
        fireEvent.change(composer, { target: { value: `Draft ${sample}` } })
        await paint()
        inputMs.push(performance.now() - inputStarted)
        if (refreshRooms) {
          const pollStarted = performance.now()
          await poll()
          pollMs.push(performance.now() - pollStarted)
        }
        expect(trackedRoom.isConnected).toBe(true)
        expect(trackedMessage.isConnected).toBe(true)
      }
      expect(service.AccountRooms.mock.calls.length - accountRoomCalls).toBe(accountCount > 1 ? 5 : 0)
      const search = screen.getByRole('textbox', { name: 'Find a room' })
      const searchMs: number[] = []
      for (const query of ['Room 1', 'Room 10', 'Preview 99', 'no matching room', '']) {
        const searchStarted = performance.now()
        fireEvent.change(search, { target: { value: query } })
        await paint()
        searchMs.push(performance.now() - searchStarted)
        const expected = rooms.filter((room) => `${room.name} ${room.id} ${room.preview}`.toLowerCase().includes(query.toLowerCase())).length
        expect(container.querySelector('.room-section-actions')?.textContent).toBe(String(expected).padStart(2, '0'))
        expect(composer.value).toBe('Draft 4')
      }
      if (accountCount > 1) {
        const changedRoom = rooms.find((room) => room.accountId === 'account-1')!
        rooms = rooms.map((room) => room.id === changedRoom.id && room.accountId === changedRoom.accountId ? { ...room, preview: 'Fresh background preview', unread: 4 } : room)
        fireEvent.change(search, { target: { value: changedRoom.id } })
        await poll()
        const preview = within(roomList).getByText('Fresh background preview')
        expect(preview.closest('button')?.querySelector('.unread-count')?.textContent).toBe('4')
        expect(within(roomList).getByText('Room 1')).toBeTruthy()
        expect(within(roomList).getByText('Room 3')).toBeTruthy()
      }
      expect(service.History.mock.calls.length).toBe(historyCalls)
      expect(composer.value).toBe('Draft 4')
      expect(roomList.scrollWidth).toBeLessThanOrEqual(roomList.clientWidth)
      console.info('Room-list performance', JSON.stringify({
        rooms: count,
        accounts: accountCount,
        roomRows,
        nodes,
        renderMs: Math.round(renderMs),
        inputMs: inputMs.map((value) => Math.round(value)),
        searchMs: searchMs.map((value) => Math.round(value)),
        pollMs: pollMs.map((value) => Math.round(value)),
        maxCommitMs: Math.round(Math.max(...commits)),
      }))
    } finally {
      intervalSpy.mockRestore()
      service.AccountRooms.mockImplementation(accountRoomsImplementation)
    }
  }, 60000)

})
