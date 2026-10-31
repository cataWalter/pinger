import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { commands, page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accentPaletteFor, contrastRatio } from './accent'
import { themeCssVariables, themes } from './themes'
import App from './App'
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
  const snapshot = {
    loggedIn: true,
    needsVerification: false,
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
    accounts: [],
    activeAccountId: 'primary',
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
    NativeNotificationsSupported: vi.fn(() => Promise.resolve(false)),
    ScheduledJobs: vi.fn(() => Promise.resolve([])),
    AccountRooms: vi.fn(() => Promise.resolve([])),
    History: vi.fn(() => Promise.resolve({ messages: [
      { id: '$hello', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'I have the desktop review ready. The room list and conversation should both stay readable in a smaller window.', formattedBody: '', timestamp: 1793447100000, timelineCursor: 1, own: false, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '', edited: false },
      { id: '$detail', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'Could you also check the theme colors and keyboard focus?', formattedBody: '', timestamp: 1793447120000, timelineCursor: 2, own: false, reactions: { '👍': 2 }, reacted: { '👍': true }, mediaType: '', mediaUri: '', replyToEventId: '', edited: true },
      { id: '$answer', transactionId: '', sender: '@me:example.org', senderName: 'Me', avatar: '', body: 'Yes. I will check the small window first, then the light and dark themes.', formattedBody: '', timestamp: 1793447160000, timelineCursor: 3, own: true, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '$detail', replyToSender: 'Morgan Lee', replyToPreview: 'Could you also check the theme colors and keyboard focus?', edited: false },
      { id: '$next', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'Perfect. Here is the checklist:\n\n- Minimum desktop window\n- Long room names\n- Custom accent colors\n- Reduced motion', formattedBody: '', timestamp: 1793447200000, timelineCursor: 4, own: false, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '', edited: false },
    ].map((message) => ({ seenAt: 0, sending: false, sendError: '', mediaMime: '', mediaSize: 0, mediaWidth: 0, mediaHeight: 0, mediaDurationMs: 0, encrypted: false, decryptionError: '', editHistory: [], redacted: false, replyToSender: '', replyToPreview: '', ...message })), before: 0, hasMore: false })),
    RoomMembers: vi.fn(() => Promise.resolve([])),
    ListLocalAIChats: vi.fn(() => Promise.resolve([])),
    ListLocalAIChatFolders: vi.fn(() => Promise.resolve([])),
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
})

function renderApp(onRender?: ProfilerOnRenderCallback) {
  const container = document.createElement('div')
  container.id = 'root'
  document.body.append(container)
  return render(onRender ? <Profiler id="App" onRender={onRender}><App /></Profiler> : <App />, { container })
}

async function settleSurfaces() {
  await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))
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
    await captureScreenshot({ path: `artifacts/ui/timeline-scroll-coverage-${zoom}.png` })
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
    service.History.mockResolvedValueOnce({ ...history, messages: Array.from({ length: count }, (_, index) => ({
      ...template,
      id: `$alignment-${index}`,
      own: index % 2 === 1,
      sender: index % 2 === 1 ? '@me:example.org' : template.sender,
      body: 'A conversation should use both sides of the available timeline.',
      timestamp: template.timestamp + index * 1000,
      timelineCursor: index + 1,
    })) })
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
    if (width > 1000) {
      expect(Math.max(formatting.top, tools.top)).toBeLessThan(Math.min(formatting.bottom, tools.bottom))
      expect(container.querySelector('.composer')!.getBoundingClientRect().height).toBeLessThan(130)
    }
    expect(container.querySelector('.composer')!.scrollWidth).toBeLessThanOrEqual(container.querySelector('.composer')!.clientWidth)
    await captureScreenshot({ path: `artifacts/ui/timeline-alignment-${width}-${count}.png` })
  })

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
    service.History.mockResolvedValueOnce({ ...history, messages: Array.from({ length: 1000 }, (_, index) => ({
      ...template, id: `$keyboard-${index}`, body: `Virtual keyboard message ${index}`, timestamp: template.timestamp + index * 1000,
    })) })
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
    service.History.mockResolvedValueOnce({ ...history, before: -1000, hasMore: true, messages: Array.from({ length: 1000 }, (_, index) => ({
      ...template, id: `$anchor-${index}`, body: `Anchor message ${index}`, timestamp: template.timestamp + index * 1000,
    })) })
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
    resolveOlder({ ...history, before: -1050, hasMore: true, messages: Array.from({ length: 50 }, (_, index) => ({
      ...template, id: `$older-${index}`, body: `Older message ${index}`, timestamp: template.timestamp - (50 - index) * 1000,
    })) })
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Load older messages' }).disabled).toBe(false))
    await waitFor(() => {
      expect(container.querySelector('[data-event-id="$anchor-0"]')).toBe(original)
      expect(Math.abs(original.getBoundingClientRect().top - top)).toBeLessThanOrEqual(4)
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
})
