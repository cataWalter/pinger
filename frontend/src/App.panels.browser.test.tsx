import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import type { Invite } from '../bindings/mychat/desktop/models.js'
import { contrastRatio } from './accent'
import { service } from './appBrowserMocks'
import { captureScreenshot, installAppBrowserCleanup, renderApp, rgbHex, settleSurfaces } from './appBrowserHarness'

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

describe('browser smoke: panels', () => {
  it('keeps media, scheduling, quick switching, and private chat usable at minimum width', async () => {
    const user = userEvent.setup()
    await page.viewport(760, 600)
    renderApp()
    await screen.findByRole('button', { name: 'Room actions' })

    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Media gallery' }))
    const gallery = await screen.findByRole('dialog', { name: 'Media in Browser smoke room' })
    await settleSurfaces()
    expect(gallery.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/media-gallery-760.png' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Media in Browser smoke room' })).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Scheduled messages and reminders' }))
    const scheduled = await screen.findByRole('dialog', { name: 'Scheduled messages and reminders' })
    await settleSurfaces()
    expect(scheduled.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/scheduled-queue-760.png' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Scheduled messages and reminders' })).toBeNull())

    await user.keyboard('{Control>}k{/Control}')
    const switcher = await screen.findByRole('dialog', { name: 'Quick switcher' })
    await user.type(within(switcher).getByRole('textbox', { name: 'Search rooms' }), 'design')
    await captureScreenshot({ path: '../.vitest/ui/quick-switcher-760.png' })
    await user.keyboard('{Enter}')
    await screen.findByRole('heading', { name: 'Design review and accessibility working group' })
    expect(screen.getByRole('button', { name: 'Room actions' }).getBoundingClientRect().right).toBeLessThanOrEqual(761)
    await captureScreenshot({ path: '../.vitest/ui/long-room-name-760.png' })

    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))
    await user.click(screen.getByRole('button', { name: 'New private chat' }))
    await screen.findByRole('textbox', { name: 'Message local AI' })
    const empty = getComputedStyle(screen.getByText('No private model chats yet'))
    const sidebar = getComputedStyle(document.querySelector('.sidebar')!)
    expect(contrastRatio(rgbHex(empty.color), rgbHex(sidebar.backgroundColor))).toBeGreaterThanOrEqual(4.5)
    expect(screen.getByRole('button', { name: 'Send to local AI' }).getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/local-ai-760.png' })
    await page.viewport(1100, 780)
  })

  it('renders a room and opens the snippet manager', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByRole('navigation', { name: 'Rooms' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Browser smoke room' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(settings).getByRole('tab', { name: 'Keyboard' }))
    await user.click(within(settings).getByRole('button', { name: 'Manage text snippets' }))

    const snippets = await screen.findByRole('dialog', { name: 'Text snippets' })
    expect(within(snippets).getByText('Say thanks')).toBeTruthy()
    expect(within(snippets).queryByText('Imported 1 snippet.')).toBeNull()
  })

  it.each([
    [390, 844],
    [760, 600],
    [1100, 780],
  ] as const)('keeps the thread panel inside %i x %i', async (width, height) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const history = await service.History()
    const root = { ...history.messages[0], id: '$thread-root', body: 'Thread starter', threadRootId: '' }
    const replies = [
      { ...root, id: '$thread-one', body: 'First thread reply', timestamp: root.timestamp + 1_000, threadRootId: root.id },
      { ...root, id: '$thread-two', body: 'Second thread reply', timestamp: root.timestamp + 2_000, threadRootId: root.id },
    ]
    const threadPage = {
      ...history,
      messages: [root, ...replies, { ...root, id: '$thread-after', body: 'Main conversation continues', timestamp: root.timestamp + 3_000, threadRootId: '' }],
    }
    service.History.mockResolvedValueOnce(threadPage).mockResolvedValueOnce(threadPage)
    service.ThreadMessages.mockResolvedValueOnce([root, ...replies])
    const { container } = renderApp()

    await waitFor(() => expect(container.querySelector('[data-event-id="$thread-after"]')).not.toBeNull())
    const rooms = await screen.findByRole('navigation', { name: 'Rooms' })
    await user.click(within(rooms).getByRole('button', { name: /Browser smoke room/ }))
    await user.click(await screen.findByRole('button', { name: 'Open thread, 2 replies' }))
    const panel = await screen.findByRole('dialog', { name: '2 replies' })
    await within(panel).findByText('First thread reply')
    await settleSurfaces()
    const bounds = panel.getBoundingClientRect()
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width + 1)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(height + 1)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width + 1)
    await user.click(within(panel).getByRole('button', { name: 'Close thread' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '2 replies' })).toBeNull())
  })

  it.each([
    [390, 844],
    [760, 600],
    [1100, 780],
  ] as const)('keeps invitation actions visible at %i x %i', async (width, height) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    const invite: Invite = {
      roomId: '!design-invite:example.org',
      name: 'Design review and accessibility working group',
      topic: '',
      avatar: '',
      inviter: '@morgan:example.org',
      inviterName: 'Morgan Lee',
      direct: false,
      invitedAt: 1,
    }
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, invites: [invite] })
    const { container } = renderApp()

    const invites = await screen.findByRole('region', { name: 'Invitations' })
    await settleSurfaces()
    const accept = within(invites).getByRole('button', { name: `Accept invitation to ${invite.name}` })
    const decline = within(invites).getByRole('button', { name: `Decline invitation to ${invite.name}` })
    for (const button of [accept, decline]) {
      const bounds = button.getBoundingClientRect()
      expect(bounds.width).toBeGreaterThan(0)
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width + 1)
    }
    expect(container.querySelector('.invite-row')?.scrollWidth).toBeLessThanOrEqual(container.querySelector('.invite-row')?.clientWidth ?? 0)
    await user.click(decline)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Invitations' })).toBeNull())
    expect(service.DeclineInvite).toHaveBeenCalledWith(invite.roomId)
  })

  it.each([
    [390, 844],
    [760, 600],
    [1100, 780],
  ] as const)('keeps the unread jump usable at %i x %i', async (width, height) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    const history = await service.History()
    const room = snapshot.rooms[0]
    const unreadHistory = {
      ...history,
      messages: Array.from({ length: 30 }, (_, index) => ({
        ...history.messages[0],
        id: `$unread-${index}`,
        transactionId: '',
        body: `Unread timeline message ${index}`,
        timestamp: history.messages[0].timestamp + index * 1_000,
        timelineCursor: index + 1,
        own: false,
      })),
    }
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, rooms: [{ ...room, unread: 30 }] })
    service.History.mockResolvedValueOnce(unreadHistory).mockResolvedValueOnce(unreadHistory)
    const { container } = renderApp()

    await waitFor(() => expect(container.querySelector('[data-event-id="$unread-29"]')).not.toBeNull())
    const rooms = await screen.findByRole('navigation', { name: 'Rooms' })
    expect(rooms.querySelector('.unread-count')?.textContent).toBe('30')
    await user.click(within(rooms).getByRole('button', { name: /Browser smoke room/ }))
    await screen.findByRole('region', { name: 'Message timeline' })
    await screen.findByRole('separator', { name: 'New messages' })
    const jump = await screen.findByRole('button', { name: '30 new messages' })
    const bounds = jump.getBoundingClientRect()
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width + 1)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(height + 1)
    await user.click(jump)
    await waitFor(() => expect(document.activeElement?.getAttribute('data-event-id')).toBe('$unread-0'))
    expect(screen.queryByRole('button', { name: '30 new messages' })).toBeNull()
  })
})
