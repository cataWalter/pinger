import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { commands, page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountSummary, Invite, Room } from '../bindings/mychat/desktop/models.js'
import { accentPaletteFor, contrastRatio } from './accent'
import { themeCssVariables, themes } from './themes'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import './style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    setReducedMotion(reduced: boolean): Promise<void>
  }
}

const service = vi.hoisted(() => {
  const room = {
    id: '!browser-smoke:example.org',
    name: 'Browser smoke room',
    topic: '',
    avatar: '',
    preview: '',
    lastSeen: 0,
    direct: true,
    favorite: false,
    muted: false,
    unread: 0,
    markedUnread: false,
    mentions: 0,
    unanswered: false,
    needsReply: false,
    lastEventId: '',
    lastEventSender: '',
    lastEventAt: 0,
    accountId: 'primary',
    bridge: '',
  }
  const accounts: AccountSummary[] = []
  const snapshot = {
    loggedIn: true,
    needsVerification: false,
    verification: null,
    syncReady: true,
    connectionState: 'connected',
    profile: {
      userId: '@me:example.org',
      displayName: 'Me',
      homeserver: 'https://example.org',
      deviceId: 'BROWSER',
      avatarUri: '',
      verified: true,
    },
    accounts,
    activeAccountId: 'primary',
    invites: [] as Invite[],
    rooms: [room,
      { ...room, id: '!design:example.org', name: 'Design review and accessibility working group', preview: 'The updated conversation layout is ready to review.', unread: 12, mentions: 2, needsReply: true, favorite: true },
      { ...room, id: '!release:example.org', name: 'Release planning', preview: 'Can we ship the desktop improvements on Friday?', unread: 3 },
      { ...room, id: '!morgan:example.org', name: 'Morgan Lee', preview: 'Thanks, see you tomorrow.', muted: true },
    ],
    slidingSyncListCounts: { main: 1 },
    preferences: {},
  }
  const methods = {
    Snapshot: vi.fn(() => Promise.resolve(snapshot)),
    OpenExternalURL: vi.fn(() => Promise.resolve()),
    NativeNotificationsSupported: vi.fn(() => Promise.resolve(false)),
    ScheduledJobs: vi.fn(() => Promise.resolve([])),
    AccountRooms: vi.fn((): Promise<Room[]> => Promise.resolve([])),
    ThreadMessages: vi.fn((): Promise<object[]> => Promise.resolve([])),
    DeclineInvite: vi.fn(() => Promise.resolve()),
    History: vi.fn(() => Promise.resolve({
      messages: [
        { id: '$hello', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'I have the desktop review ready. The room list and conversation should both stay readable in a smaller window.', formattedBody: '', timestamp: 1793447100000, timelineCursor: 1, own: false, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '', edited: false },
        { id: '$detail', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'Could you also check the theme colors and keyboard focus?', formattedBody: '', timestamp: 1793447120000, timelineCursor: 2, own: false, reactions: { '👍': 2 }, reacted: { '👍': true }, mediaType: '', mediaUri: '', replyToEventId: '', edited: true },
        { id: '$answer', transactionId: '', sender: '@me:example.org', senderName: 'Me', avatar: '', body: 'Yes. I will check the small window first, then the light and dark themes.', formattedBody: '', timestamp: 1793447160000, timelineCursor: 3, own: true, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '$detail', replyToSender: 'Morgan Lee', replyToPreview: 'Could you also check the theme colors and keyboard focus?', edited: false },
        { id: '$next', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'Perfect. Here is the checklist:\n\n- Minimum desktop window\n- Long room names\n- Custom accent colors\n- Reduced motion', formattedBody: '', timestamp: 1793447200000, timelineCursor: 4, own: false, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '', edited: false },
      ].map((message) => ({ seenAt: 0, sending: false, sendError: '', mediaMime: '', mediaSize: 0, mediaWidth: 0, mediaHeight: 0, mediaDurationMs: 0, encrypted: false, decryptionError: '', editHistory: [], redacted: false, replyToSender: '', replyToPreview: '', threadRootId: '', ...message })), before: 0, hasMore: false
    })),
    RoomMembers: vi.fn(() => Promise.resolve([])),
    ListLocalAIChats: vi.fn(() => Promise.resolve([])),
    ListLocalAIChatFolders: vi.fn(() => Promise.resolve([])),
    AIComplete: vi.fn(() => Promise.resolve('')),
    SetActiveRoom: vi.fn(() => Promise.resolve()),
    UpdateVisibleRange: vi.fn(() => Promise.resolve()),
  }
  return new Proxy(methods, {
    get(target, property) {
      return Reflect.get(target, property) ?? vi.fn(() => Promise.resolve(undefined))
    },
  })
})

vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: vi.fn(() => Promise.resolve()) },
  Clipboard: { SetText: vi.fn(() => Promise.resolve()) },
  Events: { On: vi.fn(() => () => { }) },
}))

vi.mock('../bindings/mychat/desktop', () => ({
  AppService: service,
  LanguageTutorService: { Analyze: vi.fn(() => Promise.resolve({})) },
}))

afterEach(() => {
  cleanup()
  document.querySelectorAll('#root').forEach((root) => root.remove())
  window.localStorage.removeItem(ROOM_DRAFTS_STORAGE_KEY)
})

function renderApp(onRender?: ProfilerOnRenderCallback) {
  const container = document.createElement('div')
  container.id = 'root'
  document.body.append(container)
  return render(onRender ? <Profiler id="App" onRender={onRender}><App /></Profiler> : <App />, { container })
}

async function settleSurfaces() {
  await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => { })))
}

async function captureScreenshot(options: { path: string }) {
  await settleSurfaces()
  const engine = navigator.userAgent.includes('Chrome/') ? 'chromium' : 'webkit'
  await page.screenshot({ path: options.path.replace('/ui/', `/ui/${engine}/`) })
}

function rgbHex(value: string) {
  return `#${value.match(/\d+/g)!.slice(0, 3).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`
}

describe('browser smoke', () => {
  it.each([
    [390, 844],
    [760, 600],
    [1100, 780],
  ] as const)('keeps Beeper onboarding usable at %i x %i', async (width, height) => {
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, loggedIn: false })
    const { container } = renderApp()
    await screen.findByRole('heading', { name: 'Sign in' })
    await document.fonts.ready
    await settleSurfaces()
    const main = container.querySelector<HTMLElement>('.auth-screen-signin')!
    const guide = container.querySelector<HTMLDetailsElement>('.beeper-onboarding')!
    const logo = container.querySelector<HTMLImageElement>('.auth-brand img')!
    await logo.decode()
    expect(logo.naturalWidth).toBeGreaterThan(0)
    expect(logo.getBoundingClientRect().width).toBeLessThanOrEqual(48)
    const homeserver = screen.getByLabelText('Homeserver') as HTMLInputElement
    const username = screen.getByLabelText('Username') as HTMLInputElement
    const password = screen.getByLabelText('Password') as HTMLInputElement
    fireEvent.change(homeserver, { target: { value: 'https://other.example.org/' } })
    fireEvent.change(username, { target: { value: '@test_user:beeper.com' } })
    fireEvent.change(password, { target: { value: 'test matrix password' } })
    await page.getByRole('button', { name: 'Use Beeper Homeserver' }).click()
    expect(homeserver.value).toBe('https://matrix.beeper.com/')
    expect(username.value).toBe('@test_user:beeper.com')
    expect(password.value).toBe('test matrix password')
    expect(guide.open).toBe(false)
    await expect.element(guide.querySelector('button')!).not.toBeVisible()
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
    const shortcut = screen.getByRole('button', { name: 'Use Beeper Homeserver' }).getBoundingClientRect()
    const label = screen.getByText('Homeserver').getBoundingClientRect()
    expect(shortcut.left).toBeGreaterThanOrEqual(label.right)
    expect(shortcut.bottom).toBeLessThanOrEqual(homeserver.getBoundingClientRect().top)
    await captureScreenshot({ path: `../.vitest/ui/beeper-signin-${width}.png` })
    await page.getByText('Using Beeper with Pinger?').click()
    expect(guide.open).toBe(true)
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3)
    await expect.element(page.getByRole('button', { name: 'Download official Beeper app' })).toBeVisible()
    for (const element of main.querySelectorAll<HTMLElement>('.auth-form input, .auth-helper-button, .beeper-onboarding summary, .beeper-onboarding li')) {
      const bounds = element.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(-1)
      expect(bounds.right).toBeLessThanOrEqual(width + 1)
    }
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
    for (const button of main.querySelectorAll<HTMLElement>('.auth-helper-button')) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1)
    }
    const calls = service.OpenExternalURL.mock.calls.length
    await page.getByRole('button', { name: 'Download official Beeper app' }).click()
    expect(service.OpenExternalURL.mock.calls.length).toBe(calls + 1)
    expect(service.OpenExternalURL).toHaveBeenLastCalledWith('https://www.beeper.com/download')
    expect(username.value).toBe('@test_user:beeper.com')
    expect(password.value).toBe('test matrix password')
    const downloadBounds = screen.getByRole('button', { name: 'Download official Beeper app' }).getBoundingClientRect()
    expect(downloadBounds.top).toBeGreaterThanOrEqual(0)
    expect(downloadBounds.bottom).toBeLessThanOrEqual(height + 1)
    await captureScreenshot({ path: `../.vitest/ui/beeper-onboarding-${width}.png` })
    await page.getByText('Using Beeper with Pinger?').click()
    expect(guide.open).toBe(false)
    expect(username.value).toBe('@test_user:beeper.com')
    expect(password.value).toBe('test matrix password')
  })

  it.each([
    [390, 844, 100, 'Light', true],
    [760, 600, 125, 'Dark', true],
    [1440, 900, 100, 'Light', false],
  ] as const)('keeps the refreshed chat view readable at %i x %i and %i percent zoom in %s with formatting %s', async (width, height, zoom, theme, formatting) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    const history = await service.History()
    const historyImplementation = service.History.getMockImplementation()!
    const conversation = [
      [false, 'Found a lovely place for Saturday.'],
      [false, 'Small tables, good coffee, and a terrace by the water.'],
      [true, 'That sounds perfect.'],
      [true, 'Shall we go after the market?'],
      [false, 'Yes! I can be there around 11.'],
      [false, 'I saved the address for us.'],
      [true, 'See you there.'],
    ] as const
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, rooms: [{ ...snapshot.rooms[0], name: 'Nora Bennett', topic: 'Coffee, markets, and weekend plans' }], preferences: { 'appearance.theme': theme, 'appearance.zoom': String(zoom), 'appearance.font_size': zoom === 125 ? 'Large' : 'Medium', 'composer.formatting_toolbar': formatting } })
    service.History.mockResolvedValue({
      ...history, messages: conversation.map(([own, body], index) => ({
        ...history.messages[index === 1 ? 1 : 0], id: `$chat-preview-${index}`, own, body,
        sender: own ? '@me:example.org' : '@nora:example.org', senderName: own ? 'Me' : 'Nora Bennett',
        timestamp: history.messages[0].timestamp + index * 20000, timelineCursor: index + 1,
        replyToEventId: index === 6 ? '$chat-preview-4' : '', replyToSender: index === 6 ? 'Nora Bennett' : '', replyToPreview: index === 6 ? conversation[4][1] : '',
      }))
    })
    try {
      const { container } = renderApp()
      const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
      await user.click(await within(roomList).findByRole('button', { name: /Nora Bennett/ }))
      await screen.findByText('See you there.')
      await document.fonts.ready
      await settleSurfaces()
      const draft = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
      await user.type(draft, 'I will bring my camera.')
      if (formatting) {
        await user.click(screen.getByRole('button', { name: 'Hide formatting toolbar' }))
        await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull())
        await user.click(screen.getByRole('button', { name: 'Formatting' }))
        await user.click(screen.getByRole('menuitem', { name: 'Show formatting toolbar' }))
        await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy())
        const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
        expect(getComputedStyle(toolbar).overflowY).toBe('visible')
        const buttons = within(toolbar).getAllByRole('button')
        for (let index = 1; index < buttons.length; index++) {
          const previous = buttons[index - 1].getBoundingClientRect()
          const current = buttons[index].getBoundingClientRect()
          if (Math.abs(current.top - previous.top) < 1) expect(current.left).toBeGreaterThanOrEqual(previous.right)
        }
        const bold = within(toolbar).getByRole('button', { name: 'Bold' })
        await page.getByRole('button', { name: /^Bold$/ }).hover()
        await waitFor(() => expect(getComputedStyle(bold.parentElement!, '::after').opacity).toBe('1'))
        await page.getByRole('textbox', { name: 'Message' }).hover()
      }
      expect(draft.value).toBe('I will bring my camera.')
      const composer = container.querySelector<HTMLElement>('.composer')!
      const composerBounds = composer.getBoundingClientRect()
      expect(composerBounds.left).toBeGreaterThanOrEqual(0)
      expect(composerBounds.right).toBeLessThanOrEqual(width + 1)
      expect(composerBounds.bottom).toBeLessThanOrEqual(height + 1)
      expect(composer.scrollWidth).toBeLessThanOrEqual(composer.clientWidth)
      for (const name of ['Attach file', 'Emoji picker', 'Record voice note', 'Delivery options', 'AI tools', 'Send message']) {
        const bounds = screen.getByRole('button', { name }).getBoundingClientRect()
        expect(bounds.width).toBeGreaterThanOrEqual(32)
        expect(bounds.height).toBeGreaterThanOrEqual(32)
        expect(bounds.left).toBeGreaterThanOrEqual(composerBounds.left)
        expect(bounds.right).toBeLessThanOrEqual(composerBounds.right)
        expect(bounds.top).toBeGreaterThanOrEqual(draft.getBoundingClientRect().bottom)
      }
      const bodies = Array.from(container.querySelectorAll<HTMLElement>('.timeline .message-body'))
      expect(bodies).toHaveLength(conversation.length)
      for (let index = 0; index < bodies.length; index++) {
        expect(parseFloat(getComputedStyle(bodies[index]).fontSize)).toBe(zoom === 125 ? 16 : 14)
        expect(bodies[index].scrollWidth).toBeLessThanOrEqual(bodies[index].clientWidth + 1)
        if (index > 0) expect(bodies[index].getBoundingClientRect().top).toBeGreaterThanOrEqual(bodies[index - 1].getBoundingClientRect().bottom + 3)
      }
      expect(container.querySelector('.reply-preview')?.textContent).toContain(conversation[4][1])
      await captureScreenshot({ path: `../.vitest/ui/chat-view-${width}.png` })
    } finally {
      service.History.mockImplementation(historyImplementation)
    }
  })

  it.each([
    [390, 844, 100, 'Light'],
    [760, 600, 125, 'Dark'],
    [1100, 780, 100, 'Light'],
  ] as const)('keeps exclusive room filters labeled and aligned at %i x %i and %i percent zoom in %s', async (width, height, zoom, theme) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, rooms: snapshot.rooms.map((room) => ({ ...room, unanswered: room.needsReply })), preferences: { 'appearance.theme': theme, 'appearance.zoom': String(zoom), 'appearance.font_size': zoom === 125 ? 'Large' : 'Medium' } })
    renderApp()
    await screen.findByRole('button', { name: /Browser smoke room/ })
    await document.fonts.ready
    await settleSurfaces()
    const filters = screen.getByRole('group', { name: 'Filter rooms' })
    const scope = screen.getByRole('group', { name: 'Room visibility' })
    const categories = screen.getByRole('group', { name: 'Room categories' })
    const bounds = categories.getBoundingClientRect()
    const buttons = within(categories).getAllByRole('button')
    const initialBounds = buttons.map((button) => button.getBoundingClientRect())
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width + 1)
    expect(Math.abs(bounds.left - scope.getBoundingClientRect().left)).toBeLessThanOrEqual(1)
    expect(Math.abs(bounds.right - scope.getBoundingClientRect().right)).toBeLessThanOrEqual(1)
    expect(categories.scrollWidth).toBeLessThanOrEqual(categories.clientWidth + 1)
    expect(buttons).toHaveLength(3)
    expect(categories.querySelector('.filter-count')?.textContent).toBe('1')
    for (const button of buttons) {
      const buttonBounds = button.getBoundingClientRect()
      const label = button.querySelector<HTMLElement>('.filter-label')!
      const symbol = button.querySelector<HTMLElement>('.filter-symbol')!
      const labelBounds = label.getBoundingClientRect()
      expect(getComputedStyle(label).display).not.toBe('none')
      expect(getComputedStyle(label).whiteSpace).toBe('nowrap')
      expect(buttonBounds.height).toBeGreaterThanOrEqual(48)
      expect(Math.abs(buttonBounds.width - initialBounds[0].width)).toBeLessThanOrEqual(1)
      expect(Math.abs(buttonBounds.top - initialBounds[0].top)).toBeLessThanOrEqual(1)
      expect(labelBounds.top).toBeGreaterThanOrEqual(symbol.getBoundingClientRect().bottom)
      expect(labelBounds.left).toBeGreaterThanOrEqual(buttonBounds.left)
      expect(labelBounds.right).toBeLessThanOrEqual(buttonBounds.right)
      expect(labelBounds.bottom).toBeLessThanOrEqual(buttonBounds.bottom)
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
      const badge = symbol.querySelector('.filter-count')
      if (badge) expect(badge.getBoundingClientRect().left).toBeGreaterThanOrEqual(symbol.querySelector('svg')!.getBoundingClientRect().right)
    }
    for (const name of ['Unanswered rooms', 'Needs reply', 'Favorite rooms', 'Archived rooms', 'Local AI chats', 'All']) {
      const button = within(filters).getByRole('button', { name })
      await user.click(button)
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(button.parentElement!.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
      buttons.forEach((category, index) => {
        expect(Math.abs(category.getBoundingClientRect().width - initialBounds[index].width)).toBeLessThanOrEqual(1)
        expect(Math.abs(category.getBoundingClientRect().height - initialBounds[index].height)).toBeLessThanOrEqual(1)
      })
    }
    await user.click(within(categories).getByRole('button', { name: 'Needs reply' }))
    await captureScreenshot({ path: `../.vitest/ui/room-filters-${width}.png` })
  })

  it.each([
    [390, 844, 100],
    [760, 600, 125],
    [1100, 780, 100],
  ])('keeps AI shortcuts bounded without automatic text suggestions at %i x %i and %i percent zoom', async (width, height, zoom) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080', 'appearance.zoom': String(zoom), 'appearance.font_size': zoom === 125 ? 'Large' : 'Medium' } })
    renderApp()
    const roomButton = await screen.findByRole('button', { name: /Browser smoke room/ })
    if (width < 521) await user.click(roomButton)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'I arrived')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
    expect(document.querySelector('.composer-ghost')).toBeNull()
    expect(service.AIComplete).not.toHaveBeenCalled()
    expect(composer.value).toBe('I arrived')

    await user.click(screen.getByRole('button', { name: 'AI tools' }))
    const menu = await screen.findByRole('menu', { name: 'AI tools' })
    await document.fonts.ready
    await settleSurfaces()
    const bounds = menu.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width + 1)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(height + 1)
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1)
    expect(menu.querySelectorAll('kbd')).toHaveLength(5)
    for (const item of within(menu).getAllByRole('menuitem')) {
      const label = item.querySelector('span')!
      const shortcut = item.querySelector('kbd')!
      const itemBounds = item.getBoundingClientRect()
      const shortcutBounds = shortcut.getBoundingClientRect()
      expect(shortcutBounds.left).toBeGreaterThanOrEqual(label.getBoundingClientRect().right)
      expect(shortcutBounds.right).toBeLessThanOrEqual(itemBounds.right)
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
      expect(item.getAttribute('aria-keyshortcuts')).toContain('Control+Shift+')
      expect(item.getAttribute('aria-keyshortcuts')).toContain('Meta+Shift+')
    }
    await captureScreenshot({ path: `../.vitest/ui/ai-tools-${width}.png` })
  })

  it('loads the app artwork on the sign-in screen', async () => {
    await page.viewport(1100, 780)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, loggedIn: false })
    renderApp()
    await waitFor(() => expect(document.querySelector('.auth-side-mark')).not.toBeNull())
    const artwork = document.querySelector<HTMLImageElement>('.auth-side-mark')!
    await artwork.decode()
    const brand = document.querySelector<HTMLImageElement>('.auth-brand .brand-glyph')!
    await brand.decode()
    expect(brand.src).toBe(artwork.src)
    expect(artwork.naturalWidth).toBe(1024)
    expect(artwork.naturalHeight).toBe(1024)
    const bounds = artwork.getBoundingClientRect()
    expect(bounds.width).toBe(112)
    expect(bounds.height).toBe(112)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(1100)
    await captureScreenshot({ path: '../.vitest/ui/sign-in-artwork.png' })
  })

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
    })
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

  it.each([100, 1000, 10000])('measures large history with %i messages without replacing rows while typing', async (count) => {
    await page.viewport(1100, 780)
    const history = await service.History()
    const template = history.messages[0]
    service.History.mockResolvedValueOnce({
      ...history,
      messages: Array.from({ length: count }, (_, index) => ({
        ...template,
        id: `$benchmark-${index}`,
        body: `Benchmark message ${index + 1}`,
        timestamp: template.timestamp + index * 1000,
        timelineCursor: index + 1,
      })),
    })
    const commits: number[] = []
    const started = performance.now()
    const { container } = renderApp((_id, _phase, actualDuration) => commits.push(actualDuration))
    await waitFor(() => expect(container.querySelector(`[data-event-id="$benchmark-${count - 1}"]`)).not.toBeNull(), { timeout: 45000 })
    const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await paint()
    const renderMs = performance.now() - started
    const trackedRowSelector = `[data-event-id="$benchmark-${count - 1}"]`
    const trackedRow = container.querySelector(trackedRowSelector)
    const rows = container.querySelectorAll('.message-row').length
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThanOrEqual(Math.min(count, 200))
    const composer = container.querySelector<HTMLTextAreaElement>('.composer textarea')!
    const inputMs: number[] = []
    for (let sample = 0; sample < 5; sample++) {
      const inputStarted = performance.now()
      fireEvent.change(composer, { target: { value: `Draft ${sample}` } })
      await paint()
      inputMs.push(performance.now() - inputStarted)
      expect(container.querySelector(trackedRowSelector)).toBe(trackedRow)
    }
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    console.info('Timeline performance', JSON.stringify({
      messages: count,
      rows,
      nodes: container.querySelectorAll('*').length,
      renderMs: Math.round(renderMs),
      inputMs: inputMs.map((value) => Math.round(value)),
      maxCommitMs: Math.round(Math.max(...commits)),
      heapBytes: memory?.usedJSHeapSize ?? null,
    }))
  }, 60000)

  it('navigates to unmounted virtual timeline rows with Home, End, and arrow keys', async () => {
    await page.viewport(1100, 780)
    const history = await service.History()
    const template = history.messages[0]
    service.History.mockResolvedValueOnce({
      ...history, messages: Array.from({ length: 1000 }, (_, index) => ({
        ...template, id: `$keyboard-${index}`, body: `Virtual keyboard message ${index}`, timestamp: template.timestamp + index * 1000,
      }))
    })
    const { container } = renderApp()
    await waitFor(() => expect(container.querySelector('[data-event-id="$keyboard-999"]')).not.toBeNull())
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    await waitFor(() => expect(timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight).toBeLessThanOrEqual(4))
    fireEvent.keyDown(timeline, { key: 'Home' })
    await waitFor(() => expect((document.activeElement as HTMLElement)?.dataset.eventId).toBe('$keyboard-0'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect((document.activeElement as HTMLElement)?.dataset.eventId).toBe('$keyboard-1'))
    fireEvent.keyDown(timeline, { key: 'End' })
    await waitFor(() => expect((document.activeElement as HTMLElement)?.dataset.eventId).toBe('$keyboard-999'))
    expect(container.querySelectorAll('.message-row').length).toBeLessThan(200)
  })

  it('retains the virtual reading anchor when an older negative-cursor page arrives', async () => {
    await page.viewport(1100, 780)
    const history = await service.History()
    const template = history.messages[0]
    service.History.mockResolvedValueOnce({
      ...history, before: -1000, hasMore: true, messages: Array.from({ length: 1000 }, (_, index) => ({
        ...template, id: `$anchor-${index}`, body: `Anchor message ${index}`, timestamp: template.timestamp + index * 1000,
      }))
    })
    let resolveOlder!: (page: typeof history) => void
    service.History.mockReturnValueOnce(new Promise<typeof history>((resolve) => { resolveOlder = resolve }))
    const { container } = renderApp()
    await waitFor(() => expect(container.querySelector('[data-event-id="$anchor-999"]')).not.toBeNull())
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    await waitFor(() => expect(timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight).toBeLessThanOrEqual(4))
    await waitFor(() => expect(getComputedStyle(container.querySelector('[data-event-id="$anchor-999"]')!).visibility).toBe('visible'))
    fireEvent.keyDown(timeline, { key: 'Home' })
    await waitFor(() => expect((document.activeElement as HTMLElement)?.dataset.eventId).toBe('$anchor-0'))
    await waitFor(() => expect(service.History).toHaveBeenCalledWith('!browser-smoke:example.org', -1000))
    const original = container.querySelector<HTMLElement>('[data-event-id="$anchor-0"]')!
    const top = original.getBoundingClientRect().top
    resolveOlder({
      ...history, before: -1050, hasMore: true, messages: Array.from({ length: 50 }, (_, index) => ({
        ...template, id: `$older-${index}`, body: `Older message ${index}`, timestamp: template.timestamp - (50 - index) * 1000,
      }))
    })
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Load older messages' }).disabled).toBe(false))
    await waitFor(() => {
      const current = container.querySelector<HTMLElement>('[data-event-id="$anchor-0"]')
      expect(current).not.toBeNull()
      expect(Math.abs(current!.getBoundingClientRect().top - top)).toBeLessThanOrEqual(4)
    })
  })

  it('shows real staged image previews without filenames and keeps file attachments named', async () => {
    const user = userEvent.setup()
    await page.viewport(760, 600)
    renderApp()
    await screen.findByText('Minimum desktop window')
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 200
    const context = canvas.getContext('2d')!
    context.fillStyle = '#e7edf2'
    context.fillRect(0, 0, 320, 200)
    context.fillStyle = '#2b7389'
    context.fillRect(24, 24, 168, 152)
    context.fillStyle = '#b75a56'
    context.fillRect(208, 24, 88, 64)
    context.fillStyle = '#578362'
    context.fillRect(208, 104, 88, 72)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG fixture could not be created')), 'image/png'))
    const input = document.querySelector<HTMLInputElement>('.composer input[type="file"]')!
    await user.upload(input, new File([png], 'image.png', { type: 'image/png' }))
    const attachments = await screen.findByRole('list', { name: 'Attachments to send' })
    const preview = within(attachments).getByRole<HTMLImageElement>('img', { name: 'Image attachment preview' })
    await preview.decode()
    expect(preview.complete).toBe(true)
    expect(preview.naturalWidth).toBe(320)
    expect(getComputedStyle(preview).objectFit).toBe('contain')
    expect(preview.closest('li')!.getBoundingClientRect().width).toBe(120)
    expect(preview.closest('li')!.getBoundingClientRect().height).toBe(96)
    expect(within(attachments).queryByText('image.png')).toBeNull()
    expect(within(attachments).getByRole('button', { name: 'Remove image.png' }).getAttribute('title')).toBe('Remove attachment')
    await captureScreenshot({ path: '../.vitest/ui/staged-image-760.png' })

    for (const name of ['second.png', 'third.png', 'fourth.png']) {
      await user.upload(input, new File([png], name, { type: 'image/png' }))
    }
    await user.upload(input, new File(['Review notes'], 'notes.txt', { type: 'text/plain' }))
    expect(within(attachments).getByText('notes.txt')).toBeTruthy()
    expect(within(attachments).getAllByRole('img', { name: 'Image attachment preview' })).toHaveLength(4)
    const shell = document.querySelector<HTMLElement>('.app-shell')!
    for (const themeID of ['light', 'dark']) {
      shell.dataset.theme = themeID
      shell.dataset.themeMode = themeID
      for (const [key, value] of Object.entries(themeCssVariables(themeID, accentPaletteFor('Ocean'), '#236b52'))) shell.style.setProperty(key, value)
      shell.style.setProperty('--app-zoom', '125%')
      shell.dataset.fontSize = 'large'
      expect(attachments.scrollHeight).toBeGreaterThan(attachments.clientHeight)
      expect(attachments.getBoundingClientRect().right).toBeLessThanOrEqual(761)
      expect(screen.getByRole('button', { name: 'Send message' }).getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
      await captureScreenshot({ path: `../.vitest/ui/staged-images-${themeID}-125-percent.png` })
    }
    await user.click(within(attachments).getByRole('button', { name: 'Remove image.png' }))
    expect(within(attachments).getAllByRole('img', { name: 'Image attachment preview' })).toHaveLength(3)
    expect(within(attachments).getByText('notes.txt')).toBeTruthy()
    await page.viewport(1100, 780)
  })

  it('keeps themes and menus usable across native desktop window sizes', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText('I have the desktop review ready. The room list and conversation should both stay readable in a smaller window.')
    await screen.findByText('Minimum desktop window')
    expect(document.querySelector<HTMLElement>('.markdown-message ul')!.clientHeight).toBeLessThan(140)
    await document.fonts.ready
    const shell = document.querySelector<HTMLElement>('.app-shell')!

    for (const [width, height] of [[760, 600], [1100, 780], [1440, 900]]) {
      await page.viewport(width, height)
      expect(shell.getBoundingClientRect().right).toBeLessThanOrEqual(width + 1)
      for (const theme of themes) {
        shell.dataset.theme = theme.id
        shell.dataset.themeMode = theme.mode
        const variables = themeCssVariables(theme.id, accentPaletteFor('Ocean'), theme.bubbleColor)
        for (const [key, value] of Object.entries(variables)) shell.style.setProperty(key, value)
        shell.style.setProperty('--own-bubble', theme.bubbleColor)
        for (const selector of ['.conversation-header', '.composer', '.timeline']) {
          const element = document.querySelector<HTMLElement>(selector)!
          const bounds = element.getBoundingClientRect()
          expect(bounds.left, `${theme.name} ${selector}`).toBeGreaterThanOrEqual(0)
          expect(bounds.right, `${theme.name} ${selector}`).toBeLessThanOrEqual(width + 1)
          expect(bounds.bottom, `${theme.name} ${selector}`).toBeLessThanOrEqual(height + 1)
        }
        const header = getComputedStyle(document.querySelector('.conversation-header')!)
        expect(contrastRatio(rgbHex(header.color), rgbHex(header.backgroundColor)), theme.name).toBeGreaterThanOrEqual(4.5)
        const unread = getComputedStyle(document.querySelector('.unread-count')!)
        expect(contrastRatio(rgbHex(unread.color), rgbHex(unread.backgroundColor)), `${theme.name} unread count`).toBeGreaterThanOrEqual(4.5)
        const actionIcons = shell.querySelectorAll<SVGSVGElement>('.icon-button > .lucide')
        expect(actionIcons.length).toBeGreaterThan(5)
        for (const icon of actionIcons) {
          const style = getComputedStyle(icon)
          expect(style.width).toBe('18px')
          expect(style.height).toBe('18px')
          expect(style.strokeWidth).toBe('1.8px')
          const bounds = icon.getBoundingClientRect()
          const button = icon.parentElement!.getBoundingClientRect()
          expect(bounds.left).toBeGreaterThanOrEqual(button.left)
          expect(bounds.right).toBeLessThanOrEqual(button.right)
          expect(bounds.top).toBeGreaterThanOrEqual(button.top)
          expect(bounds.bottom).toBeLessThanOrEqual(button.bottom)
        }
        if (width !== 1440 || theme.id === 'light') await captureScreenshot({ path: `../.vitest/ui/${theme.id}-${width}.png` })
      }
    }

    await page.viewport(760, 600)
    shell.dataset.fontSize = 'large'
    shell.style.setProperty('--app-zoom', '125%')
    const send = screen.getByRole('button', { name: 'Send message' }).getBoundingClientRect()
    expect(send.right).toBeLessThanOrEqual(761)
    expect(send.bottom).toBeLessThanOrEqual(601)
    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    const roomMenu = await screen.findByRole('menu', { name: 'Room actions' })
    expect(within(roomMenu).getByRole('menuitem', { name: 'Media gallery' })).toBeTruthy()
    await user.keyboard('{End}')
    expect(document.activeElement?.textContent).toContain('Mute room')
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    expect(screen.queryByRole('menu', { name: 'Room actions' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('button', { name: 'Formatting' }))
    const formatMenu = await screen.findByRole('menu', { name: 'Formatting' })
    expect(formatMenu.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'AI tools' }))
    const aiMenu = await screen.findByRole('menu', { name: 'AI tools' })
    expect(aiMenu.getBoundingClientRect().right).toBeLessThanOrEqual(761)
    expect(aiMenu.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    await user.keyboard('{Escape}')
    await captureScreenshot({ path: '../.vitest/ui/large-font-125-percent.png' })
    await page.viewport(1100, 780)
  })

  it('keeps settings and room details bounded at large-font minimum desktop size', async () => {
    const user = userEvent.setup()
    await page.viewport(760, 600)
    renderApp()
    await screen.findByRole('textbox', { name: 'Message' })
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(settings).getByRole('tab', { name: 'Appearance' }))
    await settleSurfaces()
    for (const theme of themes) {
      await user.click(within(settings).getByRole('button', { name: `${theme.name} theme` }))
      expect(document.querySelector<HTMLElement>('.app-shell')!.dataset.theme).toBe(theme.id)
      expect(settings.getBoundingClientRect().right).toBeLessThanOrEqual(761)
      expect(settings.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
      await captureScreenshot({ path: `../.vitest/ui/settings-${theme.id}-760.png` })
    }
    await user.selectOptions(within(settings).getByRole('combobox', { name: /Font size/ }), 'Large')
    const zoom = within(settings).getByRole('slider', { name: 'App zoom' })
    fireEvent.change(zoom, { target: { value: '125' } })
    fireEvent.pointerUp(zoom)
    expect(settings.getBoundingClientRect().right).toBeLessThanOrEqual(761)
    expect(settings.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/settings-large-font-125-percent.png' })
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Room details' }))
    const details = await screen.findByRole('dialog', { name: 'Browser smoke room' })
    await settleSurfaces()
    expect(details.getBoundingClientRect().right).toBeLessThanOrEqual(761)
    expect(details.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/room-details-large-font.png' })
    await user.keyboard('{Escape}')
    await page.viewport(1100, 780)
  })

  it('suppresses decorative motion when reduced motion is requested', async () => {
    await commands.setReducedMotion(true)
    try {
      renderApp()
      await screen.findByRole('textbox', { name: 'Message' })
      await screen.findByText('I have the desktop review ready. The room list and conversation should both stay readable in a smaller window.')
      expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
      const row = document.querySelector<HTMLElement>('.message-row')!
      row.dataset.liveMessage = 'true'
      expect(getComputedStyle(row).animationName).toBe('none')
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Room actions' }))
      const menu = await screen.findByRole('menu', { name: 'Room actions' })
      expect(parseFloat(getComputedStyle(menu).animationDuration)).toBeLessThanOrEqual(0.00001)
    } finally {
      await commands.setReducedMotion(false)
    }
  })

  it('keeps media, scheduling, quick switching, and private chat usable at minimum width', async () => {
    const user = userEvent.setup()
    await page.viewport(760, 600)
    renderApp()
    await screen.findByText('Minimum desktop window')

    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Media gallery' }))
    const gallery = await screen.findByRole('dialog', { name: 'Media in Browser smoke room' })
    await settleSurfaces()
    expect(gallery.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/media-gallery-760.png' })
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Scheduled messages and reminders' }))
    const scheduled = await screen.findByRole('dialog', { name: 'Scheduled messages and reminders' })
    await settleSurfaces()
    expect(scheduled.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/scheduled-queue-760.png' })
    await user.keyboard('{Escape}')

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
