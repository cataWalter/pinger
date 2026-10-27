import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

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
    rooms: [room],
    slidingSyncListCounts: { main: 1 },
    preferences: {},
  }
  const methods = {
    Snapshot: vi.fn(() => Promise.resolve(snapshot)),
    NativeNotificationsSupported: vi.fn(() => Promise.resolve(false)),
    ScheduledJobs: vi.fn(() => Promise.resolve([])),
    AccountRooms: vi.fn(() => Promise.resolve([])),
    History: vi.fn(() => Promise.resolve({ messages: [], before: 0, hasMore: false })),
    RoomMembers: vi.fn(() => Promise.resolve([])),
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
  Events: { On: vi.fn(() => () => { }) },
}))

vi.mock('../bindings/mychat/desktop', () => ({
  AppService: service,
  GhostwriterMode: {
    GhostwriterModeChips: 'chips',
    GhostwriterModeSlash: 'slash',
  },
  LanguageTutorService: { Analyze: vi.fn(() => Promise.resolve({})) },
}))

afterEach(() => {
  cleanup()
})

describe('browser smoke', () => {
  it('renders a room and opens the snippet manager', async () => {
    const user = userEvent.setup()
    render(<App />)

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
