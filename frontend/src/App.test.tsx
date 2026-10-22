import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountSummary, Message, Room, Snapshot } from '../bindings/mychat/desktop/models.js'
import App from './App'
import ChatMediaRenderer, { matrixMXCMediaURL } from './ChatMediaRenderer'
import { SNIPPETS_STORAGE_KEY } from './snippets'

const harness = vi.hoisted(() => ({
  eventHandlers: new Map<string, (event: { data: unknown }) => void>(),
  markdownRenderCount: 0,
  service: {
    Snapshot: vi.fn(),
    AddAccount: vi.fn(),
    SwitchAccount: vi.fn(),
    AccountRooms: vi.fn(),
    History: vi.fn(),
    SearchMessages: vi.fn(),
    ScheduledJobs: vi.fn(),
    ScheduleMessage: vi.fn(),
    ScheduleReply: vi.fn(),
    ScheduleReminder: vi.fn(),
    UpdateScheduledJob: vi.fn(),
    CancelScheduledJob: vi.fn(),
    RetryScheduledMessage: vi.fn(),
    DismissScheduledJob: vi.fn(),
    RoomMembers: vi.fn(),
    SetActiveRoom: vi.fn(),
    UpdateVisibleRange: vi.fn(),
    SetRoomUnanswered: vi.fn(),
    RelationshipHealth: vi.fn(),
    ContactDossier: vi.fn(),
    RefreshContactDossier: vi.fn(),
    LinkRelationshipContact: vi.fn(),
    UnlinkRelationshipContact: vi.fn(),
    RelationshipDecayContacts: vi.fn(),
    SetRelationshipTier: vi.fn(),
    SnoozeRelationshipDecay: vi.fn(),
    SetTyping: vi.fn(),
    MarkRead: vi.fn(),
    MarkUnread: vi.fn(),
    SetBooleanPreference: vi.fn(),
    SetStringPreference: vi.fn(),
    NativeNotificationsSupported: vi.fn(),
    NotificationPermission: vi.fn(),
    RequestNotificationPermission: vi.fn(),
    OpenNotificationSettings: vi.fn(),
    SendNotification: vi.fn(),
    SendMessage: vi.fn(),
    SendReply: vi.fn(),
    SendMessageWithMentions: vi.fn(),
    SaveMedia: vi.fn(),
    React: vi.fn(),
    AIComplete: vi.fn(),
    CheckMessageTone: vi.fn(),
    Ghostwriter: vi.fn(),
    AITranscribeMedia: vi.fn(),
    TestAIEndpoint: vi.fn(),
    StorageUsage: vi.fn(),
    MediaCacheUsage: vi.fn(),
    ClearMediaCache: vi.fn(),
    OptimizeDatabase: vi.fn(),
    RoomStorageUsage: vi.fn(),
    ClearCachedMedia: vi.fn(),
    AppVersion: vi.fn(),
    AppBuildInfo: vi.fn(),
    CheckForUpdates: vi.fn(),
    Devices: vi.fn(),
    RevokeDevice: vi.fn(),
  },
  tutorService: {
    Analyze: vi.fn(),
  },
}))

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: vi.fn((name: string, handler: (event: { data: unknown }) => void) => {
      harness.eventHandlers.set(name, handler)
      return () => harness.eventHandlers.delete(name)
    }),
  },
}))

vi.mock('emoji-picker-react', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (emojiData: { emoji: string }) => void }) => (
    <button type="button" aria-label="grinning face" onClick={() => onEmojiClick({ emoji: '😀' })}>😀</button>
  ),
}))

vi.mock('../bindings/mychat/desktop', () => ({
  AppService: harness.service,
  TurkishTutorService: harness.tutorService,
  GhostwriterMode: {
    GhostwriterModeChips: 'chips',
    GhostwriterModeAutocomplete: 'autocomplete',
    GhostwriterModeSlash: 'slash',
  },
}))

vi.mock('./MarkdownMessage', () => ({
  default: ({ body }: { body: string }) => {
    harness.markdownRenderCount++
    return <div className="message-body">{body}</div>
  },
}))

const room: Room = {
  id: '!room:example.org',
  name: 'Test room',
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

const secondRoom: Room = { ...room, id: '!second:example.org', name: 'Second room', unanswered: true }

function message(id: string, body: string, timestamp: number): Message {
  return {
    id,
    transactionId: '',
    sender: '@alice:example.org',
    senderName: 'Alice',
    avatar: '',
    body,
    formattedBody: '',
    replyToEventId: '',
    replyToSender: '',
    replyToPreview: '',
    timestamp,
    seenAt: 0,
    timelineCursor: timestamp,
    sending: false,
    sendError: '',
    own: false,
    reactions: {},
    reacted: {},
    mediaUri: '',
    mediaType: '',
    mediaMime: '',
    mediaSize: 0,
    mediaWidth: 0,
    mediaHeight: 0,
    mediaDurationMs: 0,
    encrypted: false,
    decryptionError: '',
    edited: false,
    editHistory: [],
    redacted: false,
  }
}

// Message actions live in a right-click menu now, so tests open it the same way
// a user would.
function openMessageMenu(container: HTMLElement, eventID = '$latest') {
  const row = container.querySelector<HTMLElement>(`[data-event-id="${eventID}"]`)
  if (!row) throw new Error(`Missing timeline row for ${eventID}`)
  fireEvent.contextMenu(row, { clientX: 48, clientY: 48 })
}

const snapshot: Snapshot = {
  loggedIn: true,
  needsVerification: false,
  syncReady: true,
  connectionState: 'connected',
  profile: {
    userId: '@me:example.org',
    displayName: 'Me',
    homeserver: 'https://example.org',
    deviceId: 'DEVICE',
    avatarUri: '',
    verified: true,
  },
  accounts: [],
  activeAccountId: 'primary',
  rooms: [room],
  slidingSyncListCounts: { main: 1 },
  preferences: {},
}

function renderGhostwriterComposer() {
  harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ghostwriter.enabled': true } })
  harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
  return render(<App />)
}

describe('settings storage, integrations, help, and about', () => {
  let confirmSpy: { mockRestore: () => void; } | undefined
  let snippetDownloadClickSpy: { mockRestore: () => void; } | undefined

  afterEach(() => {
    confirmSpy?.mockRestore()
    confirmSpy = undefined
    snippetDownloadClickSpy?.mockRestore()
    snippetDownloadClickSpy = undefined
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.removeItem(SNIPPETS_STORAGE_KEY)
  })

  beforeEach(() => {
    harness.eventHandlers.clear()
    harness.service.Snapshot.mockResolvedValue(snapshot)
    harness.service.AccountRooms.mockResolvedValue([])
    harness.service.History.mockResolvedValue({ messages: [], before: 0, hasMore: false })
    harness.service.ScheduledJobs.mockResolvedValue([])
    harness.service.SetActiveRoom.mockResolvedValue(undefined)
    harness.service.SetRoomUnanswered.mockResolvedValue(undefined)
    harness.service.Devices.mockResolvedValue([])
    harness.service.RevokeDevice.mockResolvedValue(undefined)
    harness.service.RelationshipHealth.mockResolvedValue({ roomId: room.id, accountId: snapshot.activeAccountId, error: '' })
    harness.service.ContactDossier.mockResolvedValue({ accountId: 'primary', roomId: room.id, contactId: room.id, displayName: room.name, tier: 'NONE', linkedChannels: ['Matrix'], enabled: true, analyzing: false, insufficientData: true, keyFacts: [], lastRecap: '', unresolvedCommitments: [], updatedAt: 0, error: '' })
    harness.service.RefreshContactDossier.mockResolvedValue({ accountId: 'primary', roomId: room.id, contactId: room.id, displayName: room.name, tier: 'NONE', linkedChannels: ['Matrix'], enabled: true, analyzing: true, insufficientData: false, keyFacts: [], lastRecap: '', unresolvedCommitments: [], updatedAt: 0, error: '' })
    harness.service.LinkRelationshipContact.mockResolvedValue({})
    harness.service.UnlinkRelationshipContact.mockResolvedValue({})
    harness.service.RelationshipDecayContacts.mockResolvedValue({ accountId: 'primary', enabled: false, contacts: [] })
    harness.service.SetRelationshipTier.mockResolvedValue(undefined)
    harness.service.SnoozeRelationshipDecay.mockResolvedValue(undefined)
    harness.service.SaveMedia.mockResolvedValue('')
    harness.service.SetTyping.mockResolvedValue(undefined)
    harness.service.MarkRead.mockResolvedValue(undefined)
    harness.service.RoomMembers.mockResolvedValue([])
    harness.service.NativeNotificationsSupported.mockResolvedValue(false)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.OpenNotificationSettings.mockResolvedValue(undefined)
    harness.service.SetBooleanPreference.mockResolvedValue(undefined)
    harness.service.SetStringPreference.mockResolvedValue(undefined)
    harness.service.StorageUsage.mockResolvedValue({ databaseBytes: 2048, walBytes: 0 })
    harness.service.MediaCacheUsage.mockResolvedValue({ bytes: 4096, files: 3 })
    harness.service.RoomStorageUsage.mockResolvedValue([])
    harness.service.ClearCachedMedia.mockResolvedValue({ files: 0, bytes: 0 })
    harness.service.AppVersion.mockResolvedValue('1.0.0')
    harness.service.AppBuildInfo.mockResolvedValue({ commit: 'abcdef0123456789', buildDate: '2026-10-22T12:00:00Z' })
    harness.service.CheckForUpdates.mockResolvedValue({ currentVersion: '1.0.0', latestVersion: '', releaseUrl: 'https://github.com/cataWalter/pinger/releases', publishedAt: '', releaseNotes: '', updateAvailable: false, message: 'Pinger is up to date.' })
    harness.service.Ghostwriter.mockResolvedValue([])
    harness.tutorService.Analyze.mockResolvedValue({
      detected_language: 'it',
      original_text: 'Ciao, come stai?',
      corrected_text: 'Merhaba, nasılsın?',
      translation: 'Ciao, come stai?',
      has_grammar_errors: false,
      morpheme_breakdown: [{ word: 'nasılsın', breakdown: 'nasıl-sın -> come-sei', meaning: 'how are you' }],
      grammar_rule: 'The second-person ending follows vowel harmony.',
      text_to_insert: 'Merhaba, nasılsın?',
    })
  })

  async function openSettingsTab(name: string) {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name }))
    return user
  }

  it('revokes a device after password confirmation', async () => {
    const device = {
      id: 'OLDDEVICE',
      displayName: 'Old laptop',
      lastSeenIp: '',
      lastSeenAt: 0,
      current: false,
    }
    harness.service.Devices.mockResolvedValue([device])
    const user = await openSettingsTab('Devices')
    expect(await screen.findByText('Old laptop')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    await user.type(screen.getByLabelText('Account password'), 'matrix-password')
    await user.click(screen.getByRole('button', { name: 'Revoke device' }))

    await waitFor(() => expect(harness.service.RevokeDevice).toHaveBeenCalledWith('OLDDEVICE', 'matrix-password'))
    expect(screen.queryByText('Old laptop')).toBeNull()
  })


  it('opens About and Settings from native application menu events', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'Settings' })

    await act(async () => {
      harness.eventHandlers.get('application-menu:about')?.({ data: undefined })
    })
    const settingsDialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(settingsDialog).getByRole('tab', { name: 'About' }).getAttribute('aria-selected')).toBe('true')
    expect(within(settingsDialog).getByRole('button', { name: 'Check for updates' })).toBeTruthy()

    await act(async () => {
      harness.eventHandlers.get('application-menu:settings')?.({ data: undefined })
    })
    expect(within(settingsDialog).getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows chat networks detected from bridged rooms instead of placeholder statuses', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, { ...room, id: '!wa1:example.org', name: 'Alice', bridge: 'WA' }, { ...room, id: '!wa2:example.org', name: 'Bob', bridge: 'WA' }],
    })
    await openSettingsTab('Integrations')

    const status = screen.getByLabelText('Detected chat networks')
    expect(within(status).getByText('WhatsApp').nextElementSibling?.textContent).toBe('2 chats detected')
    expect(within(status).getByText('Telegram').nextElementSibling?.textContent).toBe('No chats detected')
    expect(screen.queryByText('Not connected')).toBeNull()
    expect(screen.getByText(/Connecting a network requires a bridge set up on your homeserver/)).toBeTruthy()
  })

  it('keeps Ghostwriter opt-in and rejects non-loopback settings', async () => {
    const user = await openSettingsTab('Integrations')
    const enabled = screen.getByRole('checkbox', { name: 'Enable local AI Ghostwriter' }) as HTMLInputElement
    const endpoint = screen.getByLabelText('Local endpoint') as HTMLInputElement
    const save = screen.getByRole('button', { name: 'Save Ghostwriter settings' }) as HTMLButtonElement

    expect(enabled.checked).toBe(false)
    expect(endpoint.value).toBe('http://127.0.0.1:11434')
    expect(save.disabled).toBe(false)
    await user.clear(endpoint)
    await user.type(endpoint, 'https://example.com')
    expect(save.disabled).toBe(true)
    expect(harness.service.Ghostwriter).not.toHaveBeenCalled()
  })

  it('opts into Keep in Touch reminders from Integrations', async () => {
    const user = await openSettingsTab('Integrations')
    const enabled = screen.getByRole('checkbox', { name: 'Enable relationship health and Keep in Touch' }) as HTMLInputElement

    expect(enabled.checked).toBe(false)
    expect(screen.getByText(/Suggestions stay as drafts/)).toBeTruthy()
    await user.click(enabled)
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('relationship_health.enabled', true))
  })

  it('lists per-chat storage and clears matching cached media after confirmation', async () => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    harness.service.RoomStorageUsage
      .mockResolvedValueOnce([{ roomId: '!room:example.org', name: 'Test room', messages: 12, textBytes: 1024, mediaBytes: 4096, mediaFiles: 3 }])
      .mockResolvedValue([{ roomId: '!room:example.org', name: 'Test room', messages: 12, textBytes: 1024, mediaBytes: 0, mediaFiles: 0 }])
    harness.service.ClearCachedMedia.mockResolvedValue({ files: 3, bytes: 4096 })
    const user = await openSettingsTab('Storage')

    const table = await screen.findByRole('table', { name: 'Storage used by each chat' })
    expect(within(table).getByText('Test room')).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cleanup age' }), '30')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cleanup media type' }), 'image')
    await user.click(within(table).getByRole('button', { name: 'Clear media in Test room' }))

    await waitFor(() => expect(harness.service.ClearCachedMedia).toHaveBeenCalledWith({ roomId: '!room:example.org', olderThanDays: 30, mediaType: 'image' }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(await screen.findByText(/Removed 3 cached files/)).toBeTruthy()
  })

  it('does not clear media when the cleanup confirmation is declined', async () => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    harness.service.RoomStorageUsage.mockResolvedValue([{ roomId: '!room:example.org', name: 'Test room', messages: 1, textBytes: 10, mediaBytes: 20, mediaFiles: 1 }])
    const user = await openSettingsTab('Storage')

    await user.click(await screen.findByRole('button', { name: 'Clear matching media' }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(harness.service.ClearCachedMedia).not.toHaveBeenCalled()
  })

  it('checks for updates only when requested and shows the release', async () => {
    harness.service.CheckForUpdates.mockResolvedValueOnce({
      currentVersion: '1.0.0',
      latestVersion: 'v1.1.0',
      releaseUrl: 'https://github.com/cataWalter/pinger/releases/tag/v1.1.0',
      publishedAt: '2026-03-01T00:00:00Z',
      releaseNotes: 'Adds storage cleanup.',
      updateAvailable: true,
      message: 'Version v1.1.0 is available.',
    })
    const user = await openSettingsTab('About')

    expect(await screen.findByText('1.0.0')).toBeTruthy()
    expect(await screen.findByText('abcdef0')).toBeTruthy()
    expect(screen.getByText('2026-10-22T12:00:00Z')).toBeTruthy()
    expect(harness.service.CheckForUpdates).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))

    expect(await screen.findByText('Version v1.1.0 is available.')).toBeTruthy()
    expect(screen.getByText('Adds storage cleanup.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View release' }).getAttribute('href')).toBe('https://github.com/cataWalter/pinger/releases/tag/v1.1.0')
  })

  it('reports update check failures without changing the About page', async () => {
    harness.service.CheckForUpdates.mockRejectedValueOnce(new Error('Network unavailable'))
    const user = await openSettingsTab('About')

    await user.click(await screen.findByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('Network unavailable')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'View release' })).toBeNull()
  })

  it('shows unknown build metadata when the metadata service fails', async () => {
    harness.service.AppBuildInfo.mockRejectedValueOnce(new Error('Metadata unavailable'))
    await openSettingsTab('About')

    const aboutDetails = screen.getByText('Application').parentElement
    await waitFor(() => expect(within(aboutDetails!).getAllByText('unknown')).toHaveLength(2))
  })

  it('links the help center to the keyboard and storage settings', async () => {
    const user = await openSettingsTab('Help')

    await user.click(screen.getByRole('button', { name: 'Open storage' }))
    expect((await screen.findByRole('tab', { name: 'Storage' })).getAttribute('aria-selected')).toBe('true')
  })

  it('turns single-key shortcuts off from the keyboard settings', async () => {
    const user = await openSettingsTab('Keyboard')

    await user.click(screen.getByLabelText('Enable single-key shortcuts (R, J, K and the answered key)'))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('shortcuts.single_keys', false))
    expect(await screen.findByText(/Single-key shortcuts are off/)).toBeTruthy()
  })

  it('toggles undo send and enables its delay selector', async () => {
    const user = await openSettingsTab('Keyboard')
    const toggle = screen.getByRole('checkbox', { name: 'Enable undo send' }) as HTMLInputElement
    const windowSelector = screen.getByRole('combobox', { name: 'Undo send window' }) as HTMLSelectElement

    expect(toggle.checked).toBe(false)
    expect(windowSelector.disabled).toBe(true)
    await user.click(toggle)

    await waitFor(() => {
      expect(harness.service.SetStringPreference).toHaveBeenCalledWith('composer.undo_send_seconds', '5')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('composer.undo_send_enabled', true)
    })
    expect(toggle.checked).toBe(true)
    expect(windowSelector.disabled).toBe(false)

    await user.click(toggle)
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('composer.undo_send_enabled', false))
    expect(windowSelector.disabled).toBe(true)
  })

  it('filters keyboard shortcuts by action and key combination', async () => {
    const user = await openSettingsTab('Keyboard')
    const search = screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' })

    await user.type(search, 'Turkish Tutor')
    expect(screen.getByText('Analyze draft with Turkish Tutor')).toBeTruthy()
    expect(screen.queryByText('Quick switch rooms')).toBeNull()

    await user.clear(search)
    await user.type(search, 'Ctrl / ⌘ + K')
    expect(screen.getByText('Quick switch rooms')).toBeTruthy()
    expect(screen.queryByText('Analyze draft with Turkish Tutor')).toBeNull()
  })

  it('reports when no keyboard shortcut matches the search', async () => {
    const user = await openSettingsTab('Keyboard')

    await user.type(screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' }), 'zzzzz')
    expect(await screen.findByText(/No shortcuts match/)).toBeTruthy()
    expect(screen.queryByText('Quick switch rooms')).toBeNull()
  })

  it('searches settings across tabs and jumps to the matching setting', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    const search = screen.getByLabelText('Search settings')
    await user.type(search, 'unread')

    const results = screen.getByRole('region', { name: 'Settings search results' })
    expect(within(results).getByRole('button', { name: /Show unread counts/ })).toBeTruthy()
    expect(within(results).getByRole('button', { name: /room's read state/ })).toBeTruthy()
    expect(within(results).getByRole('heading', { name: 'Appearance' })).toBeTruthy()
    expect(within(results).getByRole('heading', { name: 'General' })).toBeTruthy()

    await user.click(within(results).getByRole('button', { name: /Show unread counts/ }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('checkbox', { name: 'Show unread counts' })).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.setting-toggle.is-search-hit')).toBeTruthy())
  })

  it('reports when no setting matches the search', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    await user.type(screen.getByLabelText('Search settings'), 'zzzzz')
    expect(await screen.findByText(/No settings match/)).toBeTruthy()
  })

  it('opens a tab from the search results and clears the search', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.type(screen.getByLabelText('Search settings'), 'unread')

    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('checkbox', { name: 'Show unread counts' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Settings search results' })).toBeNull()
  })

  it('opens a tab without matches and clears the search', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.type(screen.getByLabelText('Search settings'), 'unread')

    await user.click(screen.getByRole('tab', { name: 'About' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'About' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.queryByRole('region', { name: 'Settings search results' })).toBeNull()
  })

  it('clears the settings search with the escape key without closing the dialog', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    const search = screen.getByLabelText('Search settings')
    await user.type(search, 'theme')
    expect(await screen.findByRole('region', { name: 'Settings search results' })).toBeTruthy()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Settings search results' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })

  it('formats selected composer text from the formatting toolbar', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'composer.formatting_toolbar': true } })
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'say hello', selectionStart: 4, selectionEnd: 9 } })

    const boldButton = await screen.findByRole('button', { name: 'Bold' })
    expect(boldButton.classList.contains('icon-button')).toBe(true)
    expect(boldButton.parentElement?.getAttribute('data-tooltip')).toBe('Bold text')
    fireEvent.mouseDown(boldButton)
    fireEvent.click(boldButton)

    await waitFor(() => expect(composer.value).toBe('say **hello**'))
    await waitFor(() => {
      expect(composer.selectionStart).toBe(6)
      expect(composer.selectionEnd).toBe(11)
    })
  })

  it('expands a snippet at the caret and restores its shortcut with Backspace', async () => {
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    const original = 'before ;thanks, after'
    const caret = original.indexOf(',') + 1

    fireEvent.change(composer, { target: { value: original, selectionStart: caret, selectionEnd: caret } })
    await waitFor(() => expect(composer.value).toBe('before Thanks for the update! I appreciate it., after'))

    fireEvent.keyDown(composer, { key: 'Backspace' })
    await waitFor(() => expect(composer.value).toBe(original))
    expect(composer.selectionStart).toBe(original.indexOf(';thanks') + ';thanks'.length)
  })

  it('offers matching snippets and accepts the active suggestion with Tab', async () => {
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

    fireEvent.change(composer, { target: { value: ';th', selectionStart: 3, selectionEnd: 3 } })
    expect(await screen.findByRole('listbox', { name: 'Text snippet suggestions' })).toBeTruthy()
    fireEvent.keyDown(composer, { key: 'ArrowDown' })
    fireEvent.keyDown(composer, { key: 'Tab' })

    await waitFor(() => expect(composer.value).toBe('Thanks for the update! I appreciate it.'))
  })

  it('expands an exact snippet with Enter without sending the message', async () => {
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: ';thanks', selectionStart: 7, selectionEnd: 7 } })
    expect(await screen.findByRole('listbox', { name: 'Text snippet suggestions' })).toBeTruthy()

    fireEvent.keyDown(composer, { key: 'Enter' })

    await waitFor(() => expect(composer.value).toBe('Thanks for the update! I appreciate it.'))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('creates, edits, and deletes local text snippets from settings', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Keyboard' }))
    await user.click(screen.getByRole('button', { name: 'Manage text snippets' }))
    const manager = await screen.findByRole('dialog', { name: 'Text snippets' })

    await user.click(within(manager).getByRole('button', { name: 'New snippet' }))
    await user.type(within(manager).getByLabelText('Snippet prefix'), '/')
    await user.type(within(manager).getByLabelText('Snippet trigger'), 'away')
    await user.type(within(manager).getByLabelText('Snippet title'), 'Away reply')
    await user.type(within(manager).getByLabelText('Snippet category'), 'Status')
    await user.type(within(manager).getByLabelText('Snippet content'), 'I am away.')
    await user.click(within(manager).getByRole('button', { name: 'Save snippet' }))
    expect(await within(manager).findByText('Away reply')).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem(SNIPPETS_STORAGE_KEY) ?? '{}').snippets).toHaveLength(4)
    const search = within(manager).getByRole('searchbox', { name: 'Search snippets' })
    await user.type(search, 'Away reply')
    const savedSnippets = within(manager).getByRole('list', { name: 'Saved text snippets' })
    expect(await within(savedSnippets).findByText('Away reply')).toBeTruthy()
    expect(within(savedSnippets).queryByText('Say thanks')).toBeNull()
    await user.clear(search)

    await user.click(within(manager).getByRole('button', { name: 'Edit snippet Away reply' }))
    await user.clear(within(manager).getByLabelText('Snippet title'))
    await user.type(within(manager).getByLabelText('Snippet title'), 'Out of office')
    await user.clear(within(manager).getByLabelText('Snippet content'))
    await user.type(within(manager).getByLabelText('Snippet content'), 'Away until tomorrow.')
    await user.click(within(manager).getByRole('button', { name: 'Save changes' }))
    expect(await within(manager).findByText('Out of office')).toBeTruthy()

    await user.click(within(manager).getByRole('button', { name: 'Delete snippet Out of office' }))
    expect(within(manager).queryByText('Out of office')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(SNIPPETS_STORAGE_KEY) ?? '{}').snippets).toHaveLength(3)
  })

  it('inserts snippet variables at the content caret', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Keyboard' }))
    await user.click(screen.getByRole('button', { name: 'Manage text snippets' }))
    const manager = await screen.findByRole('dialog', { name: 'Text snippets' })
    await user.click(within(manager).getByRole('button', { name: 'New snippet' }))

    const content = within(manager).getByLabelText('Snippet content') as HTMLTextAreaElement
    fireEvent.change(content, { target: { value: 'Call me ', selectionStart: 8, selectionEnd: 8 } })
    content.setSelectionRange(8, 8)
    await user.click(within(manager).getByRole('button', { name: '+ Insert {date}' }))
    await waitFor(() => expect(content.value).toBe('Call me {date}'))
    await user.click(within(manager).getByRole('button', { name: '+ Insert {cursor}' }))
    await waitFor(() => expect(content.value).toBe('Call me {date}{cursor}'))
    expect(content.selectionStart).toBe(content.value.length)
  })

  it('imports snippet JSON and merges matching shortcuts into local storage', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Keyboard' }))
    await user.click(screen.getByRole('button', { name: 'Manage text snippets' }))
    const manager = await screen.findByRole('dialog', { name: 'Text snippets' })
    const imported = {
      id: 'imported-snippet',
      prefix: ';',
      trigger: 'thanks',
      title: 'Appreciate the update',
      content: 'Thanks for letting me know.',
      createdAt: 10,
    }
    const file = new File([JSON.stringify({ version: 1, snippets: [imported] })], 'snippets.json', { type: 'application/json' })

    await user.upload(within(manager).getByLabelText('Import snippets'), file)
    expect(await within(manager).findByText('Appreciate the update')).toBeTruthy()
    expect(within(manager).getByText('Imported 1 snippet.')).toBeTruthy()
    const saved = JSON.parse(window.localStorage.getItem(SNIPPETS_STORAGE_KEY) ?? '{}').snippets
    expect(saved).toHaveLength(3)
    expect(saved.find((snippet: { trigger: string }) => snippet.trigger === 'thanks').content).toBe('Thanks for letting me know.')
  })

  it('exports snippets and reports download and import errors', async () => {
    const user = userEvent.setup()
    const NativeURL = URL
    const createObjectURL = vi.fn(() => 'blob:snippets')
    vi.stubGlobal('URL', class TestURL extends NativeURL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = vi.fn()
    })
    snippetDownloadClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Keyboard' }))
    await user.click(screen.getByRole('button', { name: 'Manage text snippets' }))
    const manager = await screen.findByRole('dialog', { name: 'Text snippets' })

    await user.click(within(manager).getByRole('button', { name: 'Export JSON' }))
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/json' }))
    expect(snippetDownloadClickSpy).toHaveBeenCalledOnce()
    expect(within(manager).getByRole('status').textContent).toBe('Snippets exported.')

    createObjectURL.mockImplementation(() => { throw new Error('download blocked') })
    await user.click(within(manager).getByRole('button', { name: 'Export JSON' }))
    expect(within(manager).getByRole('alert').textContent).toBe('Could not create the snippets download.')

    const invalidFile = new File(['{broken'], 'snippets.json', { type: 'application/json' })
    await user.upload(within(manager).getByLabelText('Import snippets'), invalidFile)
    expect((await within(manager).findByRole('alert')).textContent).toContain('not valid JSON')
    expect(within(manager).queryByRole('status')).toBeNull()
  })
})

describe('room history updates', () => {
  const geometrySpies: Array<{ mockRestore: () => void }> = []

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    for (const spy of geometrySpies.splice(0)) spy.mockRestore()
  })

  beforeEach(() => {
    harness.markdownRenderCount = 0
    harness.eventHandlers.clear()
    harness.service.Snapshot.mockResolvedValue(snapshot)
    harness.service.AccountRooms.mockResolvedValue([])
    harness.service.AddAccount.mockResolvedValue(snapshot)
    harness.service.SwitchAccount.mockResolvedValue(snapshot)
    harness.service.RoomMembers.mockResolvedValue([])
    harness.service.RelationshipHealth.mockResolvedValue({ roomId: room.id, accountId: snapshot.activeAccountId, error: '' })
    harness.service.ContactDossier.mockResolvedValue({ accountId: 'primary', roomId: room.id, contactId: room.id, displayName: room.name, tier: 'NONE', linkedChannels: ['Matrix'], enabled: true, analyzing: false, insufficientData: true, keyFacts: [], lastRecap: '', unresolvedCommitments: [], updatedAt: 0, error: '' })
    harness.service.RefreshContactDossier.mockResolvedValue({ accountId: 'primary', roomId: room.id, contactId: room.id, displayName: room.name, tier: 'NONE', linkedChannels: ['Matrix'], enabled: true, analyzing: true, insufficientData: false, keyFacts: [], lastRecap: '', unresolvedCommitments: [], updatedAt: 0, error: '' })
    harness.service.RelationshipDecayContacts.mockResolvedValue({ accountId: 'primary', enabled: false, contacts: [] })
    harness.service.SetRelationshipTier.mockResolvedValue(undefined)
    harness.service.SnoozeRelationshipDecay.mockResolvedValue(undefined)
    harness.service.SearchMessages.mockResolvedValue({ results: [], nextBatch: '' })
    harness.service.ScheduledJobs.mockResolvedValue([])
    harness.service.ScheduleMessage.mockResolvedValue({})
    harness.service.ScheduleReply.mockResolvedValue({})
    harness.service.ScheduleReminder.mockResolvedValue({})
    harness.service.UpdateScheduledJob.mockResolvedValue(undefined)
    harness.service.CancelScheduledJob.mockResolvedValue(undefined)
    harness.service.RetryScheduledMessage.mockResolvedValue(undefined)
    harness.service.DismissScheduledJob.mockResolvedValue(undefined)
    harness.service.SetActiveRoom.mockResolvedValue(undefined)
    harness.service.SetRoomUnanswered.mockResolvedValue(undefined)
    harness.service.SetTyping.mockResolvedValue(undefined)
    harness.service.MarkRead.mockResolvedValue(undefined)
    harness.service.SetBooleanPreference.mockResolvedValue(undefined)
    harness.service.SetStringPreference.mockResolvedValue(undefined)
    harness.service.SendMessage.mockResolvedValue(undefined)
    harness.service.SendReply.mockResolvedValue(undefined)
    harness.service.SendMessageWithMentions.mockResolvedValue(undefined)
    harness.service.React.mockResolvedValue(undefined)
    harness.service.NativeNotificationsSupported.mockResolvedValue(false)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.RequestNotificationPermission.mockResolvedValue('granted')
    harness.service.SendNotification.mockResolvedValue(false)
    harness.service.AIComplete.mockResolvedValue('')
    harness.service.CheckMessageTone.mockResolvedValue(JSON.stringify({ is_hostile_or_unprofessional: false, severity: 'LOW', tone_tags: [], calmer_alternative: '' }))
    harness.tutorService.Analyze.mockResolvedValue({
      detected_language: 'it',
      original_text: 'Ciao, come stai?',
      corrected_text: 'Merhaba, nasılsın?',
      translation: 'Ciao, come stai?',
      has_grammar_errors: false,
      morpheme_breakdown: [{ word: 'nasılsın', breakdown: 'nasıl-sın -> come-sei', meaning: 'how are you' }],
      grammar_rule: 'The second-person ending follows vowel harmony.',
      text_to_insert: 'Merhaba, nasılsın?',
    })
    harness.service.Ghostwriter.mockResolvedValue([])
    harness.service.TestAIEndpoint.mockResolvedValue(undefined)

    let firstPageRequest = true
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => {
      if (before === 0 && firstPageRequest) {
        firstPageRequest = false
        return { messages: [message('$latest', 'latest message', 300)], before: 50, hasMore: true }
      }
      if (before === 50) {
        return { messages: [message('$older', 'older history', 100)], before: 20, hasMore: true }
      }
      if (before === 20) {
        return { messages: [message('$oldest', 'oldest history', 50)], before: 10, hasMore: false }
      }
      return {
        messages: [message('$latest', 'latest message updated', 300), message('$new', 'new live message', 400)],
        before: 75,
        hasMore: true,
      }
    })
  })

  it('opens and closes the contact dossier from the direct-chat header', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')

    await user.click(screen.getByRole('button', { name: 'Show contact dossier' }))
    expect(await screen.findByRole('complementary', { name: 'Contact dossier' })).toBeTruthy()
    expect(harness.service.ContactDossier).toHaveBeenCalledWith(room.id)
    await user.click(screen.getByRole('button', { name: 'Close contact dossier' }))
    expect(screen.queryByRole('complementary', { name: 'Contact dossier' })).toBeNull()
  })

  it('links and unlinks direct chats in the contact dossier', async () => {
    const linked = { accountId: 'primary', roomId: room.id, contactId: 'contact', displayName: room.name, tier: 'VIP', linkedChannels: ['Matrix', 'WA'], linkedRoomIds: [room.id, secondRoom.id], enabled: true, analyzing: false, insufficientData: false, keyFacts: ['Location: Berlin'], lastRecap: 'They discussed the move. They plan to meet soon.', unresolvedCommitments: [], updatedAt: 1, error: '' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, { ...secondRoom, bridge: 'WA' }] })
    harness.service.ContactDossier
      .mockResolvedValueOnce({ ...linked, linkedRoomIds: [room.id] })
      .mockResolvedValueOnce(linked)
      .mockResolvedValueOnce({ ...linked, linkedRoomIds: [room.id] })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Show contact dossier' }))

    const hud = await screen.findByRole('complementary', { name: 'Contact dossier' })
    await user.selectOptions(within(hud).getByRole('combobox', { name: 'Chat to link' }), secondRoom.id)
    await user.click(within(hud).getByRole('button', { name: /Link chat/ }))
    await waitFor(() => expect(harness.service.LinkRelationshipContact).toHaveBeenCalledWith(room.id, secondRoom.id))
    expect(await within(hud).findByText('Second room')).toBeTruthy()

    await user.click(within(hud).getByRole('button', { name: 'Unlink Second room' }))
    await waitFor(() => expect(harness.service.UnlinkRelationshipContact).toHaveBeenCalledWith(secondRoom.id))
  })

  it('shows active relationship alerts in the sidebar drawer', async () => {
    const contact = {
      contactId: '@alex:example.org',
      displayName: 'Alex',
      tier: 'CLOSE_FRIEND',
      roomIds: [room.id],
      lastInteractionTimestamp: Date.now() - 20 * 86400000,
      lastDecayAlertTimestamp: Date.now(),
      snoozedUntil: 0,
      nudge: 'Ask Alex how the new role is going.',
      alerted: true,
    }
    harness.service.RelationshipDecayContacts.mockResolvedValue({ accountId: 'primary', enabled: true, contacts: [contact] })
    const user = userEvent.setup()
    render(<App />)

    const shortcut = await screen.findByRole('button', { name: /Keep in Touch/ })
    expect(shortcut.textContent).toContain('1')
    await user.click(shortcut)
    expect(await screen.findByRole('dialog', { name: 'Keep in Touch' })).toBeTruthy()
    expect(screen.getByText('Ask Alex how the new role is going.')).toBeTruthy()
  })

  it('persists relationship tier changes and snoozes', async () => {
    const contact = {
      contactId: '@alex:example.org',
      displayName: 'Alex',
      tier: 'CLOSE_FRIEND',
      roomIds: [room.id],
      lastInteractionTimestamp: Date.now() - 20 * 86400000,
      lastDecayAlertTimestamp: Date.now(),
      snoozedUntil: 0,
      nudge: 'Ask Alex how the new role is going.',
      alerted: true,
    }
    const decay = { accountId: 'primary', enabled: true, contacts: [contact] }
    harness.service.RelationshipDecayContacts.mockResolvedValue(decay)
    harness.service.SetRelationshipTier.mockResolvedValue({ ...decay, contacts: [{ ...contact, tier: 'VIP' }] })
    harness.service.SnoozeRelationshipDecay.mockResolvedValue({ ...decay, contacts: [{ ...contact, alerted: false }] })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Keep in Touch/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Relationship tier for Alex' }), 'VIP')
    await waitFor(() => expect(harness.service.SetRelationshipTier).toHaveBeenCalledWith(room.id, 'VIP'))
    await user.click(screen.getByRole('button', { name: 'Snooze for a week' }))
    await waitFor(() => expect(harness.service.SnoozeRelationshipDecay).toHaveBeenCalledWith(contact.contactId))
  })

  it('switches to the contact room and drafts a nudge without sending', async () => {
    const contact = {
      contactId: '@alex:example.org',
      displayName: 'Alex',
      tier: 'CLOSE_FRIEND',
      roomIds: [secondRoom.id],
      lastInteractionTimestamp: Date.now() - 20 * 86400000,
      lastDecayAlertTimestamp: Date.now(),
      snoozedUntil: 0,
      nudge: 'Ask Alex how the new role is going.',
      alerted: true,
    }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    harness.service.RelationshipDecayContacts.mockResolvedValue({ accountId: 'primary', enabled: true, contacts: [contact] })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Keep in Touch/ }))
    await user.click(screen.getByRole('button', { name: 'Send Nudge' }))
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.value).toBe(contact.nudge))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
    expect(harness.service.SendMessageWithMentions).not.toHaveBeenCalled()
  })

  it('drafts a nudge directly when its room is already open', async () => {
    const contact = {
      contactId: '@alex:example.org',
      displayName: 'Alex',
      tier: 'CLOSE_FRIEND',
      roomIds: [room.id],
      lastInteractionTimestamp: Date.now() - 20 * 86400000,
      lastDecayAlertTimestamp: Date.now(),
      snoozedUntil: 0,
      nudge: 'Ask Alex how the new role is going.',
      alerted: true,
    }
    harness.service.RelationshipDecayContacts.mockResolvedValue({ accountId: 'primary', enabled: true, contacts: [contact] })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Keep in Touch/ }))
    await user.click(screen.getByRole('button', { name: 'Send Nudge' }))
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.value).toBe(contact.nudge))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
  })

  it('reports the overscanned room range and prefetches when scrolling reaches the loaded tail', async () => {
    const rooms = Array.from({ length: 20 }, (_, index) => ({
      ...room,
      id: `!room-${index}:example.org`,
      name: `Room ${index}`,
    }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms, slidingSyncListCounts: { main: 40 } })
    render(<App />)

    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
    await waitFor(() => expect(harness.service.UpdateVisibleRange).toHaveBeenCalledWith('main', 0, 18))

    act(() => {
      Object.defineProperty(roomList, 'scrollTop', { configurable: true, value: 1000 })
      fireEvent.scroll(roomList)
    })
    await waitFor(() => expect(harness.service.UpdateVisibleRange).toHaveBeenLastCalledWith('main', 8, 40))
  })

  it('keeps AI actions disabled until an AI endpoint is set', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Summarize recent messages' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Ask AI about the composer text' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Analyze conversation' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains when Ask AI needs a question in the composer', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const askAIButton = screen.getByRole('button', { name: 'Ask AI about the composer text' }) as HTMLButtonElement
    await waitFor(() => expect(askAIButton.parentElement?.getAttribute('data-tooltip')).toBe('Write a question first'))
    expect(askAIButton.disabled).toBe(true)

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'What happened earlier?')

    await waitFor(() => {
      expect(askAIButton.disabled).toBe(false)
      expect(askAIButton.parentElement?.getAttribute('data-tooltip')).toBe('Ask AI about draft')
    })
  })

  it('analyzes a direct conversation only on demand and keeps the result read-only', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('Chat summary\n- Alice asked about the plan.\n\nHow they communicate\n- Alice asks direct questions and Bob responds with details.')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const analyzeButton = screen.getByRole('button', { name: 'Analyze conversation' })
    expect((analyzeButton as HTMLButtonElement).disabled).toBe(false)
    expect(harness.service.AIComplete).not.toHaveBeenCalled()
    await user.click(analyzeButton)

    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    const request = harness.service.AIComplete.mock.calls[0][0]
    expect(request[0].content).toContain('untrusted data')
    expect(request[0].content).toContain('How they communicate')
    expect(request[1].content).toContain('Alice: latest message')

    const result = await screen.findByRole('dialog', { name: 'Conversation analysis' })
    await within(result).findByText(/Alice asks direct questions/)
    expect(within(result).queryByRole('button', { name: /draft/i })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
  })

  it('does not show conversation analysis in group rooms', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [{ ...room, direct: false }],
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Analyze conversation' })).toBeNull()
  })

  it('inserts a local quick reply into the composer without sending it', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ghostwriter.enabled': true } })
    harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
    harness.service.Ghostwriter.mockResolvedValue([{ id: 'affirmative', type: 'chip', label: 'Yes', text: 'Sounds good!' }])
    render(<App />)

    await screen.findByText('Can you review this?')
    await user.click(await screen.findByRole('button', { name: 'Use Yes: Sounds good!' }))

    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Sounds good!')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
  })

  it('shows a local-model offline state and retries quick replies', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ghostwriter.enabled': true } })
    harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
    harness.service.Ghostwriter.mockRejectedValueOnce(new Error('local model unavailable'))
    render(<App />)

    await screen.findByText('Can you review this?')
    expect(await screen.findByText('Local model unavailable')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry local reply suggestions' }))
    await waitFor(() => expect(harness.service.Ghostwriter).toHaveBeenCalledTimes(2))
  })

  it('shows a debounced inline continuation and accepts it with Tab', async () => {
    const user = userEvent.setup()
    const { container } = renderGhostwriterComposer()
    await screen.findByText('Can you review this?')
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await waitFor(() => expect(harness.service.Ghostwriter).toHaveBeenCalledTimes(1))
    harness.service.Ghostwriter.mockResolvedValueOnce([{ id: 'completion', type: 'autocomplete', text: 'there' }])
    await user.type(composer, 'hello')
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 350)) })

    await waitFor(() => expect(container.querySelector('.ghostwriter-inline-preview')?.textContent).toBe('hello there'))
    fireEvent.keyDown(composer, { key: 'Tab' })

    expect(composer.value).toBe('hello there')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('does not apply an autocomplete response after the draft changes', async () => {
    let resolveAutocomplete!: (suggestions: { id: string; type: string; text: string }[]) => void
    renderGhostwriterComposer()
    await screen.findByText('Can you review this?')
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await waitFor(() => expect(harness.service.Ghostwriter).toHaveBeenCalledTimes(1))
    harness.service.Ghostwriter.mockImplementationOnce(() => new Promise((resolve) => { resolveAutocomplete = resolve }))
    fireEvent.change(composer, { target: { value: 'first draft' } })
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 350)) })
    await waitFor(() => expect(harness.service.Ghostwriter).toHaveBeenCalledTimes(2))

    fireEvent.change(composer, { target: { value: 'newer draft' } })
    await act(async () => resolveAutocomplete([{ id: 'completion', type: 'autocomplete', text: 'stale text' }]))

    expect(composer.value).toBe('newer draft')
    expect(document.querySelector('.ghostwriter-inline-preview')).toBeNull()
  })

  it('turns /ghost into an unsent draft and never sends the command', async () => {
    harness.service.Ghostwriter.mockResolvedValueOnce([])
    renderGhostwriterComposer()
    await screen.findByText('Can you review this?')
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await waitFor(() => expect(harness.service.Ghostwriter).toHaveBeenCalledTimes(1))
    harness.service.Ghostwriter.mockResolvedValueOnce([{ id: 'slash', type: 'slash_result', label: 'decline politely', text: 'I appreciate the offer, but I cannot.' }])
    fireEvent.change(composer, { target: { value: '/ghost decline politely' } })
    fireEvent.submit(composer.closest('form') as HTMLFormElement)

    expect(await screen.findByText('Draft ready to review. It has not been sent.')).toBeTruthy()
    expect(composer.value).toBe('I appreciate the offer, but I cannot.')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
    expect(harness.service.Ghostwriter).toHaveBeenLastCalledWith({ roomId: room.id, mode: 'slash', draft: '', intent: 'decline politely' })
  })

  it('keeps /ghost from falling through to Matrix sending while disabled', async () => {
    render(<App />)
    await screen.findByText('latest message')
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '/ghost decline politely' } })
    fireEvent.submit(composer.closest('form') as HTMLFormElement)

    expect(await screen.findByText('Enable Ghostwriter in Settings > Integrations first.')).toBeTruthy()
    expect(harness.service.Ghostwriter).not.toHaveBeenCalled()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('shows hover descriptions for message and composer controls', async () => {
    harness.service.History.mockResolvedValue({
      messages: [{ ...message('$latest', 'latest message', 300), reactions: { '👍': 1 } }],
      before: 0,
      hasMore: false,
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    expect(screen.getByRole('button', { name: 'Send message' }).parentElement?.getAttribute('data-tooltip')).toBe('Send message')
    expect(screen.getByRole('button', { name: 'Attach file' }).parentElement?.getAttribute('data-tooltip')).toBe('Attach file')
    expect(screen.getByRole('button', { name: 'Scheduled messages and reminders' }).parentElement?.getAttribute('data-tooltip')).toBe('Scheduled messages')
    expect(screen.getByRole('button', { name: 'Ask AI about the composer text' }).parentElement?.getAttribute('data-tooltip')).toBe('Ask AI · unavailable')
    expect((screen.getByRole('button', { name: 'Add 👍 reaction' }) as HTMLButtonElement).title).toBe('Add 👍 reaction')
    openMessageMenu(container)
    expect((screen.getByRole('menuitem', { name: 'Copy message' }) as HTMLButtonElement).title).toBe('Copy message')
  })

  it('shows when an outgoing direct message has been seen', async () => {
    const seenAt = new Date(2026, 9, 20, 16, 40).getTime()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'appearance.time_24_hour': true },
    })
    harness.service.History.mockResolvedValue({
      messages: [{
        ...message('$seen', 'heyyyy', seenAt - 60_000),
        sender: snapshot.profile.userId,
        senderName: snapshot.profile.displayName,
        own: true,
        seenAt,
      }],
      before: 0,
      hasMore: false,
    })
    const { container } = render(<App />)

    expect(await screen.findByText('Seen at 16:40')).toBeTruthy()
    expect(container.querySelector('[data-event-id="$seen"] .message-seen-status')?.textContent).toContain('Seen at 16:40')
  })

  it('does not rerender timeline messages while typing in the composer', async () => {
    const user = userEvent.setup()
    const typingRooms = [room, ...Array.from({ length: 24 }, (_, index) => ({
      ...room,
      id: `!typing-${index}:example.org`,
      name: `Typing room ${index}`,
    }))]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: typingRooms })
    harness.service.History.mockResolvedValue({
      messages: [message('$one', 'one', 100), message('$two', 'two', 200), message('$three', 'three', 300)],
      before: 0,
      hasMore: false,
    })
    render(<App />)
    expect(await screen.findByText('three')).toBeTruthy()
    await waitFor(() => expect(harness.markdownRenderCount).toBe(3))
    const initialRenderCount = harness.markdownRenderCount

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'typing')

    expect(harness.markdownRenderCount).toBe(initialRenderCount)
  })

  it('skips rerendering for unchanged Matrix room snapshots', async () => {
    const onRender = vi.fn()
    render(<Profiler id="App" onRender={onRender}><App /></Profiler>)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const emitUnchangedUpdate = async () => {
      await act(async () => {
        harness.eventHandlers.get('matrix:update')?.({
          data: {
            rooms: [room],
            changedRoomId: [],
            timelineChangedRoomId: [],
            typingUsers: { [room.id]: [] },
            notifications: [],
            error: '',
            initialSyncComplete: true,
            needsVerification: false,
            connectionState: 'connected',
          },
        })
        await Promise.resolve()
      })
    }

    await emitUnchangedUpdate()
    const renderCount = onRender.mock.calls.length
    await emitUnchangedUpdate()

    expect(onRender).toHaveBeenCalledTimes(renderCount)
  })

  it('applies room updates from a consolidated Matrix batch', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [],
          read_receipts: [],
          typing_updates: [],
          room_deltas: [{
            update: {
              rooms: [{ ...room, name: 'Batched room' }],
              slidingSyncListCounts: snapshot.slidingSyncListCounts,
              timelineChangedRoomId: [],
              typingUsers: { [room.id]: [] },
              notifications: [],
              error: '',
              initialSyncComplete: true,
              needsVerification: false,
              connectionState: 'connected',
            },
          }],
        },
      })
      await Promise.resolve()
    })

    expect(await screen.findAllByText('Batched room')).toHaveLength(2)
  })

  it('does not show a room ID beneath a room name when there is no topic', async () => {
    const roomWithoutTopic = { ...room, id: '!group:example.org', name: 'Actual room name', direct: false }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [roomWithoutTopic] })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Actual room name' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Conversation' }).querySelector('.conversation-title')?.textContent).toBe('Actual room name')
  })

  it('shows only the contact name in a direct-message header', async () => {
    const directRoom = { ...room, name: 'Lory', direct: true, topic: '' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [directRoom] })

    render(<App />)

    const title = await screen.findByRole('heading', { name: 'Lory' })
    expect(title.parentElement?.textContent).toBe('Lory')
  })

  it('sends an Ask AI question to the local endpoint and only drafts the reply', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('Here is a draft reply.')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'What did Alice ask?')
    await user.click(screen.getByRole('button', { name: 'Ask AI about the composer text' }))

    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    const request = harness.service.AIComplete.mock.calls[0][0]
    expect(request[request.length - 1]).toEqual({ role: 'user', content: 'What did Alice ask?' })
    expect(request[1].content).toContain('Alice: latest message')

    const dialog = await screen.findByRole('dialog', { name: 'Ask AI' })
    await within(dialog).findByText('Here is a draft reply.')
    await user.click(within(dialog).getByRole('button', { name: 'Use as draft' }))

    expect(composer.value).toBe('Here is a draft reply.')
    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendMessageWithMentions).not.toHaveBeenCalled()
  })

  it('translates a message into the composer using the configured language', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('Hola')
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:8080', 'ai.translate_language': 'Spanish' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Translate message with local AI' }))

    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    const request = harness.service.AIComplete.mock.calls[0][0]
    expect(request[0].content).toContain('Spanish')
    expect(request[1]).toEqual({ role: 'user', content: 'latest message' })

    const dialog = await screen.findByRole('dialog', { name: 'Translate message' })
    await within(dialog).findByText('Hola')
    await user.click(within(dialog).getByRole('button', { name: 'Use as draft' }))
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Hola')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('analyzes an outgoing draft and replaces it with ready-to-send Turkish', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await user.click(screen.getByRole('button', { name: 'Analyze draft with Turkish Tutor' }))

    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Ciao, come stai?')
    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    expect(within(dialog).getByText('Merhaba, nasılsın?')).toBeTruthy()
    expect(within(dialog).getByText('nasıl-sın -> come-sei')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Replace draft with Turkish' }))

    expect(composer.value).toBe('Merhaba, nasılsın?')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('analyzes the composer draft with Ctrl+Shift+T', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(composer, { target: { value: 'Ben iyiyim.' } })
    fireEvent.keyDown(composer, { key: 't', ctrlKey: true, shiftKey: true })

    await waitFor(() => expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Ben iyiyim.'))
    expect(await screen.findByRole('dialog', { name: 'Tutor this draft' })).toBeTruthy()
  })

  it('opens the read-only Turkish Tutor analysis from a message context menu', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Analyze message with Turkish Tutor' }))

    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('latest message')
    const dialog = await screen.findByRole('dialog', { name: 'Analyze message' })
    expect(await within(dialog).findByText('The second-person ending follows vowel harmony.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Replace draft with Turkish' })).toBeNull()
  })

  it('translates incoming chat messages beside their originals and excludes own messages', async () => {
    const user = userEvent.setup()
    const recentMessages = [
      { ...message('$latest-own', 'My latest message', 300), own: true, sender: snapshot.profile.userId },
      message('$latest-turkish', 'Günaydın', 400),
    ]
    const olderMessages = [
      message('$older-turkish', 'Merhaba', 100),
      { ...message('$redacted-turkish', 'Silinmiş mesaj', 200), redacted: true },
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => before === 0
      ? { messages: recentMessages, before: 80, hasMore: true }
      : { messages: olderMessages, before: 40, hasMore: false })
    harness.service.AIComplete.mockResolvedValue(JSON.stringify(['Hello', 'Good morning']))

    const { container } = render(<App />)
    expect(await screen.findByText('Günaydın')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Translate latest 10 received messages to English' }))

    await screen.findByText('Good morning')
    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    expect(harness.service.History).toHaveBeenCalledWith(room.id, 80)
    expect(container.querySelector('[data-event-id="$older-turkish"] .message-translation')?.textContent).toContain('Hello')
    expect(container.querySelector('[data-event-id="$latest-turkish"] .message-translation')?.textContent).toContain('Good morning')
    expect(container.querySelector('[data-event-id="$latest-own"] .message-translation')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Chat translation' })).toBeNull()
    const request = harness.service.AIComplete.mock.calls[0][0]
    expect(request[0].content).toContain('Translate every message body into English')
    expect(request[0].content).toContain('valid JSON array')
    expect(request[1].content).toContain('Merhaba')
    expect(request[1].content).toContain('Günaydın')
    expect(request[1].content).not.toContain('My latest message')
    expect(request[1].content).not.toContain('Silinmiş mesaj')
    expect(container.querySelector('[data-event-id="$latest-turkish"] .message-body')?.textContent).toBe('Günaydın')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('explains malformed translation responses and reveals the raw AI output', async () => {
    const user = userEvent.setup()
    const rawResponse = 'The translation is Hola, not JSON.'
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$latest-turkish', 'Günaydın', 400)], before: 0, hasMore: false })
    harness.service.AIComplete.mockResolvedValue(rawResponse)

    render(<App />)
    expect(await screen.findByText('Günaydın')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Translate latest 10 received messages to English' }))

    expect(await screen.findByText(/not valid JSON/)).toBeTruthy()
    const responseDetails = screen.getByText('Show raw AI response').closest('details') as HTMLDetailsElement
    expect(responseDetails.open).toBe(false)
    await user.click(screen.getByText('Show raw AI response'))
    expect(responseDetails.open).toBe(true)
    expect(responseDetails.textContent).toContain(rawResponse)
  })

  it('translates only the latest 10 incoming messages and loads just enough history', async () => {
    const user = userEvent.setup()
    const latestMessages = Array.from({ length: 16 }, (_, index) => {
      const sequence = index + 1
      const isOwn = sequence % 2 === 0
      const current = message(isOwn ? `$own-${sequence}` : `$received-${sequence}`, isOwn ? `my message ${sequence}` : `received message ${sequence}`, 100 + sequence)
      return isOwn ? { ...current, own: true, sender: snapshot.profile.userId } : current
    })
    const olderMessages = [
      message('$outside-last-ten', 'outside last ten received', 1),
      message('$older-received-1', 'older received one', 2),
      message('$older-received-2', 'older received two', 3),
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => before === 0
      ? { messages: latestMessages, before: 80, hasMore: true }
      : before === 80
        ? { messages: olderMessages, before: 40, hasMore: true }
        : { messages: [message('$older-unrequested', 'older unrequested message', 0)], before: 0, hasMore: false })
    harness.service.AIComplete.mockResolvedValue(JSON.stringify(Array.from({ length: 10 }, (_, index) => `Translated ${index + 1}`)))

    render(<App />)
    expect(await screen.findByText('received message 15')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Translate latest 10 received messages to English' }))
    await screen.findByText('Translated 10')
    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))

    expect(harness.service.History.mock.calls.filter(([, before]) => before !== 0)).toEqual([[room.id, 80]])
    const submittedContent = harness.service.AIComplete.mock.calls
      .flatMap(([request]) => request.map((item: { content: string }) => item.content))
      .join('\n')
    expect(submittedContent).toContain('older received one')
    expect(submittedContent).toContain('older received two')
    expect(submittedContent).toContain('received message 15')
    expect(submittedContent).not.toContain('outside last ten received')
    expect(submittedContent).not.toContain('my message')
    expect(submittedContent).not.toContain('older unrequested message')
    expect(document.querySelector('[data-event-id="$outside-last-ten"] .message-translation')).toBeNull()
    expect(document.querySelector('[data-event-id="$own-16"] .message-translation')).toBeNull()
    expect(document.querySelector('[data-event-id="$received-15"] .message-translation')?.textContent).toContain('Translated 10')
  })

  it('drafts a reply from nearby context and keeps the selected message as the reply target', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('A suggested reply')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Draft reply with local AI' }))

    const request = await waitFor(() => {
      expect(harness.service.AIComplete).toHaveBeenCalledTimes(1)
      return harness.service.AIComplete.mock.calls[0][0]
    })
    expect(request[1].content).toContain('earlier context')
    expect(request[1].content).toContain('selected message')
    const dialog = await screen.findByRole('dialog', { name: 'Draft reply' })
    await user.click(within(dialog).getByRole('button', { name: 'Use as reply draft' }))

    expect(screen.getByText('Replying to Alice')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('A suggested reply')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
  })

  it('explains only the selected message and keeps the result read-only', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('This is an explanation.')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'unrelated earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Explain message with local AI' }))
    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    expect(harness.service.AIComplete.mock.calls[0][0]).toHaveLength(2)
    expect(harness.service.AIComplete.mock.calls[0][0][1].content).toContain('selected message')
    expect(harness.service.AIComplete.mock.calls[0][0][1].content).not.toContain('unrelated earlier context')

    const dialog = await screen.findByRole('dialog', { name: 'Explain message' })
    await within(dialog).findByText('This is an explanation.')
    expect(within(dialog).queryByRole('button', { name: 'Use as draft' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('requires acceptance for rewrites and keeps topic analysis read-only', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValueOnce('A clearer version').mockResolvedValueOnce('A shorter version').mockResolvedValueOnce('Main topic: planning')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'Original draft')

    await user.click(screen.getByRole('button', { name: 'Rewrite composer draft' }))
    const rewriteDialog = await screen.findByRole('dialog', { name: 'Rewrite draft' })
    expect(rewriteDialog.querySelector('.ai-result-content')).toBeTruthy()
    expect(rewriteDialog.querySelector('.ai-result-disclaimer')).toBeTruthy()
    expect(composer.value).toBe('Original draft')
    await user.click(screen.getByRole('button', { name: 'Replace draft' }))
    expect(composer.value).toBe('A clearer version')

    await user.click(screen.getByRole('button', { name: 'Shorten composer draft' }))
    await screen.findByRole('dialog', { name: 'Shorten draft' })
    expect(harness.service.AIComplete.mock.calls[1][0][1].content).toBe('A clearer version')
    await user.click(screen.getByRole('button', { name: 'Replace draft' }))
    expect(composer.value).toBe('A shorter version')

    await user.click(screen.getByRole('button', { name: 'Analyze chat topics' }))
    const topics = await screen.findByRole('dialog', { name: 'Chat topics and themes' })
    await within(topics).findByText('Main topic: planning')
    expect(within(topics).queryByRole('button', { name: 'Replace draft' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('saves per-room agent profiles and runs the selected profile without sending a message', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('A language-learning suggestion')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Room details' }))
    const roomDialog = await screen.findByRole('dialog', { name: 'Test room' })
    await user.click(within(roomDialog).getByRole('button', { name: 'Add agent' }))
    await user.type(within(roomDialog).getByLabelText('Name'), 'Language coach')
    await user.type(within(roomDialog).getByLabelText('Instructions'), 'Explain idioms and suggest a natural alternative.')
    await user.click(within(roomDialog).getByRole('button', { name: 'Save agent' }))

    const key = `room.ai_agents.${room.id}`
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith(key, expect.any(String)))
    const savedCollection = JSON.parse(harness.service.SetStringPreference.mock.calls[harness.service.SetStringPreference.mock.calls.length - 1]?.[1] as string)
    expect(savedCollection.agents[0]).toMatchObject({ name: 'Language coach', instructions: 'Explain idioms and suggest a natural alternative.' })
    await user.selectOptions(within(roomDialog).getByRole('combobox', { name: 'Default chat agent' }), savedCollection.agents[0].id)
    await waitFor(() => expect(JSON.parse(harness.service.SetStringPreference.mock.calls[harness.service.SetStringPreference.mock.calls.length - 1]?.[1] as string).defaultAgentId).toBe(savedCollection.agents[0].id))
    await user.click(within(roomDialog).getByRole('button', { name: 'Close room details' }))

    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'Can you help me reply more naturally?')
    await user.click(screen.getByRole('button', { name: 'Run a chat agent' }))
    const picker = await screen.findByRole('dialog', { name: 'Run an agent' })
    expect((within(picker).getByRole('combobox', { name: 'Chat agent profile' }) as HTMLSelectElement).value).toBe(savedCollection.agents[0].id)
    await user.type(within(picker).getByRole('textbox', { name: 'Request (optional)' }), 'Help me practice this phrase')
    await user.click(within(picker).getByRole('button', { name: 'Run agent' }))

    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    const request = harness.service.AIComplete.mock.calls[0][0]
    expect(request[0].content).toContain('Explain idioms and suggest a natural alternative.')
    expect(request[1].content).toContain('Help me practice this phrase')
    expect(request[1].content).toContain('Current composer draft:\nCan you help me reply more naturally?')
    const result = await screen.findByRole('dialog', { name: 'Agent: Language coach' })
    await within(result).findByText('A language-learning suggestion')
    await user.click(within(result).getByRole('button', { name: 'Use as draft' }))
    expect(composer.value).toBe('A language-learning suggestion')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
  })

  it('opens chat agent creation from the composer when a room has no agents', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Create a chat agent' }))

    const roomDialog = await screen.findByRole('dialog', { name: 'Test room' })
    expect(within(roomDialog).getByRole('heading', { name: 'Chat agents' })).toBeTruthy()
    expect(within(roomDialog).getByRole('textbox', { name: 'Name' })).toBeTruthy()
    expect(within(roomDialog).getByRole('textbox', { name: 'Instructions' })).toBeTruthy()
  })

  it('loads chat agent preferences from the active account when room IDs overlap', async () => {
    const user = userEvent.setup()
    const secondProfile = {
      userId: '@two:example.net',
      displayName: 'Two',
      homeserver: 'https://example.net',
      deviceId: 'DEVICE_TWO',
      avatarUri: '',
      verified: true,
    }
    const secondAccount: AccountSummary = { id: 'second', profile: secondProfile }
    const preferenceKey = `room.ai_agents.${room.id}`
    const agentValue = (id: string, name: string) => JSON.stringify({ agents: [{ id, name, instructions: 'Offer a suggestion.' }], defaultAgentId: id })
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      accounts: [{ id: 'primary', profile: snapshot.profile }, secondAccount],
      preferences: { [preferenceKey]: agentValue('primary-agent', 'Primary profile') },
    })
    harness.service.SwitchAccount.mockResolvedValue({
      ...snapshot,
      activeAccountId: secondAccount.id,
      profile: secondProfile,
      rooms: [{ ...room, accountId: 'second' }],
      preferences: { [preferenceKey]: agentValue('second-agent', 'Second profile') },
    })
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Manage Matrix accounts' }))
    await user.click(screen.getByRole('button', { name: /@two:example\.net/ }))
    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith('second'))
    await user.click(await screen.findByRole('button', { name: 'Room details' }))

    const roomDialog = await screen.findByRole('dialog', { name: 'Test room' })
    expect(within(roomDialog).getByRole('option', { name: 'Second profile' })).toBeTruthy()
    expect(within(roomDialog).queryByRole('option', { name: 'Primary profile' })).toBeNull()
  })

  it('summarizes recent messages in a read-only panel', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('- Alice shared an update')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Summarize recent messages' }))
    const dialog = await screen.findByRole('dialog', { name: 'Summarize room' })
    await within(dialog).findByText('- Alice shared an update')
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('')

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Summarize room' })).toBeNull())
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('saves the AI endpoint and reports whether the model is ready', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.TestAIEndpoint.mockRejectedValueOnce(new Error('AI model is still loading'))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Integrations' }))

    await user.click(screen.getByRole('button', { name: 'Test endpoint' }))
    expect(await screen.findByText('AI model is still loading')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Test endpoint' }))
    expect(await screen.findByText('Model is loaded and ready.')).toBeTruthy()

    const endpoint = screen.getByLabelText('Endpoint')
    await user.clear(endpoint)
    await user.type(endpoint, 'http://localhost:9090')
    expect((screen.getByRole('button', { name: 'Test endpoint' }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Transcription model (optional)'), 'whisper-test')

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.endpoint', 'http://localhost:9090'))
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.transcription_model', 'whisper-test')
  })

  it('keeps loaded older messages when the selected room receives a live update', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Load older messages' }))
    expect(await screen.findByText('older history')).toBeTruthy()

    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [room],
          timelineChangedRoomId: [room.id],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    expect(await screen.findByText('new live message')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('older history')).toBeTruthy())
    expect(harness.service.History).toHaveBeenCalledTimes(3)

    await user.click(screen.getByRole('button', { name: 'Load older messages' }))
    expect(await screen.findByText('oldest history')).toBeTruthy()
    expect(screen.getByText('older history')).toBeTruthy()
    expect(harness.service.History).toHaveBeenLastCalledWith(room.id, 20)
  })

  it('sends one busy-mode reply in the language of the latest chat messages', async () => {
    const user = userEvent.setup()
    const spanishMessage = 'Podemos revisar los detalles del proyecto después de la reunión de mañana.'
    const recentMessages = Array.from({ length: 10 }, (_, index) => message(`$spanish-${index}`, spanishMessage, 100 + index))
    harness.service.SetBooleanPreference.mockResolvedValue(undefined)
    harness.service.SendMessage.mockResolvedValue(undefined)
    harness.service.History.mockResolvedValue({ messages: recentMessages, before: 0, hasMore: false })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Turn busy mode on' }))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('busy_mode.enabled', true))

    const sendIncomingUpdate = () => act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [{ ...room, lastEventId: '$incoming-spanish', lastEventSender: '@alice:example.org' }],
          timelineChangedRoomId: [room.id],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })
    sendIncomingUpdate()

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledTimes(1))
    expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, expect.stringContaining('Soy el asistente de IA de Me'))
    sendIncomingUpdate()
    expect(harness.service.SendMessage).toHaveBeenCalledTimes(1)
  })

  it('translates only the generic busy reply for an unsupported chat language', async () => {
    const czechMessage = 'Můžeme zítra po schůzce společně projít podrobnosti projektu a domluvit další postup.'
    const recentMessages = Array.from({ length: 10 }, (_, index) => message(`$czech-${index}`, czechMessage, 100 + index))
    const translatedReply = 'Dobrý den! Jsem AI asistent pro {name}. Vaše zpráva dorazila; odpoví, jakmile to bude možné. Děkuji za trpělivost.'
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'busy_mode.enabled': true, 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: recentMessages, before: 0, hasMore: false })
    harness.service.AIComplete.mockResolvedValue(translatedReply)
    harness.service.SendMessage.mockResolvedValue(undefined)
    render(<App />)

    await screen.findByRole('button', { name: 'Turn busy mode off' })
    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [{ ...room, lastEventId: '$incoming-czech', lastEventSender: '@alice:example.org' }],
          timelineChangedRoomId: [room.id],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledTimes(1))
    expect(harness.service.AIComplete).toHaveBeenCalledTimes(1)
    const prompt = harness.service.AIComplete.mock.calls[0][0]
    expect(JSON.stringify(prompt)).toContain('Czech')
    expect(JSON.stringify(prompt)).not.toContain(czechMessage)
    expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, expect.stringContaining('Me'))
  })

  it('switches the active Matrix account and loads its rooms', async () => {
    const user = userEvent.setup()
    harness.service.ScheduledJobs.mockResolvedValueOnce([{
      id: 'primary-scheduled',
      kind: 'message',
      roomId: room.id,
      text: 'primary job',
      eventId: '',
      dueAt: Date.now() + 60_000,
      createdAt: Date.now(),
      status: 'pending',
      error: '',
    }]).mockResolvedValueOnce([])
    const secondProfile = {
      userId: '@two:example.net',
      displayName: 'Two',
      homeserver: 'https://example.net',
      deviceId: 'DEVICE_TWO',
      avatarUri: '',
      verified: true,
    }
    const secondAccount: AccountSummary = { id: 'second', profile: secondProfile }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      accounts: [{ id: 'primary', profile: snapshot.profile }, secondAccount],
    })
    harness.service.SwitchAccount.mockResolvedValue({
      ...snapshot,
      activeAccountId: secondAccount.id,
      profile: secondProfile,
      rooms: [secondRoom],
    })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('.scheduled-job-count')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Manage Matrix accounts' }))
    await user.click(screen.getByRole('button', { name: /@two:example\.net/ }))

    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith(secondAccount.id))
    await waitFor(() => expect(container.querySelector('.scheduled-job-count')).toBeNull())
    expect(await screen.findByText('@two:example.net')).toBeTruthy()
    await waitFor(() => expect(harness.service.History).toHaveBeenCalledWith(secondRoom.id, 0))
  })

  it('filters the inbox by account and switches accounts when opening another account room', async () => {
    const user = userEvent.setup()
    const secondProfile = {
      userId: '@two:example.net',
      displayName: 'Two',
      homeserver: 'https://example.net',
      deviceId: 'DEVICE_TWO',
      avatarUri: '',
      verified: true,
    }
    const secondAccount: AccountSummary = { id: 'second', profile: secondProfile }
    const otherRoom: Room = { ...room, id: '!other:example.net', name: 'Other account room', accountId: 'second' }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      accounts: [{ id: 'primary', profile: snapshot.profile }, secondAccount],
    })
    harness.service.AccountRooms.mockResolvedValue([room, otherRoom])
    harness.service.SwitchAccount.mockResolvedValue({
      ...snapshot,
      activeAccountId: secondAccount.id,
      profile: secondProfile,
      rooms: [otherRoom],
    })
    render(<App />)

    expect(await screen.findByText('Other account room')).toBeTruthy()
    const accountFilter = screen.getByRole('combobox', { name: 'Filter rooms by account' })
    await user.selectOptions(accountFilter, 'second')
    const roomList = screen.getByRole('navigation', { name: 'Rooms' })
    expect(within(roomList).queryByText('Test room')).toBeNull()
    expect(within(roomList).getByText('Other account room')).toBeTruthy()

    await user.click(within(roomList).getByText('Other account room'))
    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith(secondAccount.id))
  })

  it('switches Matrix accounts with the account number shortcut', async () => {
    const secondProfile = {
      userId: '@two:example.net',
      displayName: 'Two',
      homeserver: 'https://example.net',
      deviceId: 'DEVICE_TWO',
      avatarUri: '',
      verified: true,
    }
    const secondAccount: AccountSummary = { id: 'second', profile: secondProfile }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      accounts: [{ id: 'primary', profile: snapshot.profile }, secondAccount],
    })
    harness.service.SwitchAccount.mockResolvedValue({
      ...snapshot,
      activeAccountId: secondAccount.id,
      profile: secondProfile,
      rooms: [secondRoom],
    })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: '2', code: 'Digit2', ctrlKey: true, altKey: true })

    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith(secondAccount.id))
    expect(await screen.findByText('@two:example.net')).toBeTruthy()
  })

  it('adds another Matrix account from the account manager', async () => {
    const user = userEvent.setup()
    const secondProfile = {
      userId: '@two:example.net',
      displayName: 'Two',
      homeserver: 'https://example.net',
      deviceId: 'DEVICE_TWO',
      avatarUri: '',
      verified: true,
    }
    const secondAccount: AccountSummary = { id: 'second', profile: secondProfile }
    harness.service.AddAccount.mockResolvedValue({
      ...snapshot,
      activeAccountId: secondAccount.id,
      accounts: [{ id: 'primary', profile: snapshot.profile }, secondAccount],
      profile: secondProfile,
      rooms: [secondRoom],
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Manage Matrix accounts' }))
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.clear(screen.getByLabelText('Homeserver'))
    await user.type(screen.getByLabelText('Homeserver'), 'https://example.net')
    await user.type(screen.getByLabelText('Username'), '@two:example.net')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(harness.service.AddAccount).toHaveBeenCalledWith('https://example.net', '@two:example.net', 'secret'))
    expect(await screen.findByText('@two:example.net')).toBeTruthy()
  })

  it('sends incoming alerts through the native notification service when available', async () => {
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.SendNotification.mockResolvedValue(true)
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, secondRoom],
      preferences: { 'notifications.only_when_unfocused': false },
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          notifications: [{ roomId: secondRoom.id, room: secondRoom.name, sender: 'Alice', body: 'A native alert' }],
        },
      })
    })

    await waitFor(() => expect(harness.service.SendNotification).toHaveBeenCalledWith('Alice · Second room', 'A native alert', secondRoom.id))
    act(() => {
      harness.eventHandlers.get('notification:open-room')?.({ data: secondRoom.id })
    })
    await waitFor(() => expect(harness.service.History).toHaveBeenCalledWith(secondRoom.id, 0))
  })

  it('keeps group alerts off by default and sends them when enabled', async () => {
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.SendNotification.mockClear()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, secondRoom],
      preferences: { 'notifications.only_when_unfocused': false },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          notifications: [{ roomId: secondRoom.id, room: secondRoom.name, sender: 'Bob', body: 'group chatter', category: 'group' }],
        },
      })
    })
    expect(harness.service.SendNotification).not.toHaveBeenCalled()
  })

  it('sends group alerts when the group setting is on', async () => {
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.SendNotification.mockClear()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, secondRoom],
      preferences: { 'notifications.only_when_unfocused': false, 'notifications.group': true },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          notifications: [{ roomId: secondRoom.id, room: secondRoom.name, sender: 'Bob', body: 'group chatter', category: 'group' }],
        },
      })
    })
    await waitFor(() => expect(harness.service.SendNotification).toHaveBeenCalledWith('Bob · Second room', 'group chatter', secondRoom.id))
  })

  it('combines batched alerts from one room into a single notification', async () => {
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.SendNotification.mockClear()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, secondRoom],
      preferences: { 'notifications.only_when_unfocused': false, 'notifications.batch_seconds': '3' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    vi.useFakeTimers()
    try {
      act(() => {
        harness.eventHandlers.get('matrix:update')?.({
          data: {
            notifications: [
              { roomId: secondRoom.id, room: secondRoom.name, sender: 'Alice', body: 'one', category: 'direct' },
              { roomId: secondRoom.id, room: secondRoom.name, sender: 'Bob', body: 'two', category: 'direct' },
            ],
          },
        })
      })
      expect(harness.service.SendNotification).not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })
      expect(harness.service.SendNotification).toHaveBeenCalledTimes(1)
      expect(harness.service.SendNotification).toHaveBeenCalledWith('Second room', '2 new messages from Alice, Bob', secondRoom.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends the default reaction directly when the quick picker is off', async () => {
    const user = userEvent.setup()
    harness.service.React.mockClear()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'reactions.quick_enabled': false, 'reactions.default_emoji': '🎉' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Add reaction' }))
    await waitFor(() => expect(harness.service.React).toHaveBeenCalledWith(room.id, '$latest', '🎉'))
  })

  it('starts a reply on double-click when configured', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'messages.double_click': 'Reply' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const row = container.querySelector<HTMLElement>('[data-event-id="$latest"]')
    if (!row) throw new Error('Missing timeline row for $latest')
    fireEvent.doubleClick(row)
    expect(await screen.findByText('Replying to Alice')).toBeTruthy()
  })

  it('shows the bridge network label only when the setting is on', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [{ ...room, bridge: 'WhatsApp' }],
      preferences: { 'sidebar.network_icons': true },
    })
    render(<App />)
    expect(await screen.findByText('WhatsApp')).toBeTruthy()
  })

  it('loads older messages automatically when the timeline is scrolled to the top', async () => {
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const timeline = screen.getByRole('region', { name: 'Message timeline' })

    fireEvent.scroll(timeline)

    expect(await screen.findByText('older history')).toBeTruthy()
    expect(harness.service.History).toHaveBeenLastCalledWith(room.id, 50)
  })

  it('returns to the latest messages when reopening the active room', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 400 })
    timeline.scrollTop = 12

    await user.click(screen.getByRole('button', { name: /Test room/ }))

    await waitFor(() => expect(timeline.scrollTop).toBe(400))
    expect(await screen.findByText('new live message')).toBeTruthy()
    expect(harness.service.History).toHaveBeenLastCalledWith(room.id, 0)
    expect(container.querySelector('.room-button.is-active')).toBeTruthy()
  })

  it('composes room, needs reply, favorites, and search filters', async () => {
    const user = userEvent.setup()
    const favoriteDirect = { ...secondRoom, name: 'Favorite direct', unread: 2, favorite: true }
    const favoriteGroup: Room = { ...room, id: '!group:example.org', name: 'Favorite project', direct: false, favorite: true, unread: 1, unanswered: true }
    const favoriteInstagramDM: Room = { ...room, id: '!instagram:example.org', name: 'Favorite Instagram DM', bridge: 'IG', direct: false, favorite: true, unanswered: true }
    const unreadDirect: Room = { ...room, id: '!unread:example.org', name: 'Unread direct', unread: 1 }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, favoriteDirect, favoriteGroup, favoriteInstagramDM, unreadDirect] })
    render(<App />)

    await screen.findByText('latest message')
    const roomList = screen.getByRole('navigation', { name: 'Rooms' })
    expect(screen.queryByRole('button', { name: 'Unread rooms' })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite project/ })).toBeTruthy()
    const unreadDirectButton = within(roomList).getByRole('button', { name: /Unread direct/ })
    expect(unreadDirectButton.querySelector('.unread-count')?.textContent).toBe('1')
    expect(unreadDirectButton.querySelector('.unread-dot')).toBeNull()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')?.textContent).toBe('2')

    await user.click(screen.getByRole('button', { name: 'Needs reply' }))
    await user.click(screen.getByRole('button', { name: 'Favorite rooms' }))
    await user.type(screen.getByRole('textbox', { name: 'Find a room' }), 'Favorite')
    expect(within(roomList).queryByRole('button', { name: /Favorite project/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite Instagram DM/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Unread direct/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Needs reply' }))
    await user.click(screen.getByRole('button', { name: 'Favorite rooms' }))
    await user.clear(screen.getByRole('textbox', { name: 'Find a room' }))
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite project/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite Instagram DM/ })).toBeTruthy()
  })

  it('labels each room filter with an icon', async () => {
    render(<App />)
    await screen.findByText('latest message')

    const filters = screen.getByRole('group', { name: 'Filter rooms' })
    expect(within(filters).getByText('All')).toBeTruthy()
    expect(within(filters).getByText('Archive')).toBeTruthy()
    expect(within(filters).getByText('Needs reply')).toBeTruthy()
    expect(within(filters).getByText('Favorites')).toBeTruthy()
    expect(filters.querySelectorAll('button svg')).toHaveLength(4)
  })

  it('adds a chat to Favorites from the room menu', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Add to Favorites' }))

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.favorite.${room.id}`, true))
    expect(screen.getByRole('button', { name: 'Remove from Favorites' })).toBeTruthy()
  })

  it('explains when active inbox filters hide every room', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')

    await user.click(screen.getByRole('button', { name: 'Needs reply' }))

    expect(screen.getByText('No rooms match these filters')).toBeTruthy()
  })

  it('follows the operating system color scheme for System default', async () => {
    let changeHandler: ((event: MediaQueryListEvent) => void) | undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { changeHandler = listener },
      removeEventListener: vi.fn(),
    })))
    const { container } = render(<App />)

    await waitFor(() => expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('dark'))
    act(() => changeHandler?.({ matches: false } as MediaQueryListEvent))
    await waitFor(() => expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('light'))
  })

  it('supports keyboard settings tabs and restores focus when dismissed', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')

    const settingsButton = screen.getByRole('button', { name: 'Settings' })
    await user.click(settingsButton)
    const closeSettings = screen.getByRole('button', { name: 'Close settings' })
    const settingsDialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(document.activeElement).toBe(closeSettings)
    await user.tab({ shift: true })
    expect(settingsDialog.contains(document.activeElement)).toBe(true)
    await user.tab()
    expect(document.activeElement).toBe(closeSettings)

    await user.click(screen.getByRole('tab', { name: 'General' }))
    expect(screen.getByRole('checkbox', { name: 'Launch Pinger at login' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Minimize to tray when closing the window' })).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    fireEvent.keyDown(settingsDialog, { key: 'k', metaKey: true })
    expect(screen.queryByRole('dialog', { name: 'Quick switcher' })).toBeNull()
    await user.keyboard('{ArrowRight}')
    const notificationsTab = screen.getByRole('tab', { name: 'Notifications' })
    expect(notificationsTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('settings-tab-notifications')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
    expect(document.activeElement).toBe(settingsButton)
  })

  it('shows the incognito indicator while read receipts are suppressed', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'privacy.incognito': true } })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(document.querySelector('.app-shell')?.getAttribute('data-incognito')).toBe('true')
    const incognitoIndicator = screen.getByRole('status', { name: 'Incognito mode is on' })
    expect(incognitoIndicator).toBeTruthy()
    expect(incognitoIndicator.textContent).toBe('')
    expect(document.querySelector('.conversation-room-avatar')).toBeTruthy()
  })

  it('ignores the retired compact message layout preference', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.compact': true } })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(container.querySelector('.app-shell')?.hasAttribute('data-compact')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    expect(screen.queryByRole('checkbox', { name: 'Compact message layout' })).toBeNull()
  })

  it('honors the spellcheck preference in the message composer', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'composer.spellcheck': false } })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('spellcheck')).toBe('false')
  })

  it('moves focus from the empty composer to the message list when configured', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'composer.arrow_up_focus_timeline': true } })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' })
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    composer.focus()
    fireEvent.keyDown(composer, { key: 'ArrowUp' })

    expect(document.activeElement).toBe(timeline)
  })

  it('hides deleted messages when the appearance preference is enabled', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.hide_deleted_messages': true } })
    harness.service.History.mockResolvedValueOnce({
      messages: [
        { ...message('$removed', 'removed body', 200), redacted: true },
        message('$latest', 'latest message', 300),
      ],
      before: 50,
      hasMore: true,
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.queryByText('Message removed')).toBeNull()
  })

  function stubImageIntersectionObserver() {
    const callbacks = new Map<Element, IntersectionObserverCallback>()
    vi.stubGlobal('IntersectionObserver', class {
      private callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        callbacks.set(target, this.callback)
      }
      unobserve(target: Element) {
        callbacks.delete(target)
      }
      disconnect() {
        callbacks.clear()
      }
    })
    return {
      setIntersecting(target: Element, isIntersecting: boolean) {
        const callback = callbacks.get(target)
        if (!callback) throw new Error('Element is not observed')
        const entry = {
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
          time: performance.now(),
        } as IntersectionObserverEntry
        act(() => callback([entry], {} as IntersectionObserver))
      },
    }
  }

  it('opens a gallery with media collected from older room history', async () => {
    const user = userEvent.setup()
    const photo = { ...message('$gallery-photo', 'photo.png', 300), mediaUri: 'mxc://example.org/gallery-photo', mediaMime: 'image/png' }
    const olderFile = { ...message('$gallery-file', 'report.pdf', 100), mediaUri: 'mxc://example.org/gallery-file', mediaType: 'm.file', mediaMime: 'application/pdf' }
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => {
      if (before === 0) return { messages: [photo], before: 50, hasMore: true }
      if (before === 50) return { messages: [olderFile], before: 20, hasMore: false }
      return { messages: [], before, hasMore: false }
    })
    stubImageIntersectionObserver()
    render(<App />)

    expect(await screen.findByText('photo.png')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Media gallery' }))

    const dialog = await screen.findByRole('dialog', { name: 'Media in Test room' })
    await waitFor(() => expect(within(dialog).getAllByRole('article')).toHaveLength(2))
    expect(harness.service.History.mock.calls.filter(([, before]) => before === 0).length).toBeGreaterThanOrEqual(2)
    await user.click(within(dialog).getByRole('button', { name: 'Files, 1' }))
    expect(within(dialog).getAllByRole('article')).toHaveLength(1)
    expect(dialog.querySelector('.file-card-copy strong')?.textContent).toBe('report.pdf')
  })

  it('streams image previews from the local media endpoint without a click', async () => {
    const mediaURL = 'mxc://example.org/photo'
    const imageMessage = { ...message('$photo', 'Attachment', 300), mediaUri: mediaURL, mediaMime: 'image/png', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [imageMessage], before: 0, hasMore: false })
    const intersection = stubImageIntersectionObserver()

    const { container } = render(<App />)
    const attachment = await waitFor(() => {
      const element = container.querySelector('[data-event-id="$photo"] .message-attachment')
      expect(element).toBeTruthy()
      return element
    })
    intersection.setIntersecting(attachment!, true)

    const preview = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>('[data-event-id="$photo"] .media-preview')
      expect(image).toBeTruthy()
      return image
    })
    expect(preview?.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$photo')}`)
    expect(container.querySelector('[data-event-id="$photo"] .media-load')).toBeNull()

    intersection.setIntersecting(attachment!, false)
    await waitFor(() => expect(container.querySelector('[data-event-id="$photo"] .media-preview')).toBeNull())
    expect(container.querySelector('[data-event-id="$photo"] .media-preview')).toBeNull()
  })

  it('renders native image, audio, and video tags from Matrix event URLs', () => {
    const { container } = render(<div>
      <ChatMediaRenderer roomID={room.id} eventID="$photo" kind="image" alt="Photo" />
      <ChatMediaRenderer roomID={room.id} eventID="$voice" kind="audio" alt="Voice note" />
      <ChatMediaRenderer roomID={room.id} eventID="$clip" kind="video" alt="Clip" />
    </div>)
    const expectedURL = (eventID: string) => `/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent(eventID)}`

    expect(container.querySelector('img')?.getAttribute('src')).toBe(expectedURL('$photo'))
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    expect(container.querySelector('audio')?.getAttribute('src')).toBe(expectedURL('$voice'))
    expect(container.querySelector('audio')?.hasAttribute('controls')).toBe(true)
    expect(container.querySelector('video')?.getAttribute('src')).toBe(expectedURL('$clip'))
    expect(container.querySelector('video')?.hasAttribute('controls')).toBe(true)
  })

  it('maps avatar MXC URIs to the local media endpoint', () => {
    expect(matrixMXCMediaURL('mxc://example.org/avatar')).toBe('/media/mxc/example.org/avatar')
    expect(matrixMXCMediaURL('not-an-mxc-uri')).toBe('')
  })

  it('hides images and videos from chat when enabled in Appearance settings', async () => {
    const user = userEvent.setup()
    const imageMessage = { ...message('$photo-hidden', 'Photo attachment', 300), mediaUri: 'mxc://example.org/photo-hidden', mediaMime: 'image/png', mediaSize: 12 }
    const videoMessage = { ...message('$video-hidden', 'Video attachment', 400), mediaUri: 'mxc://example.org/video-hidden', mediaMime: 'video/mp4', mediaSize: 24 }
    const audioMessage = { ...message('$audio-visible', 'Voice message.ogg', 500), mediaUri: 'mxc://example.org/audio-visible', mediaMime: 'audio/ogg', mediaSize: 12 }
    const audioWebMMessage = { ...message('$audio-webm-visible', 'Voice message.webm', 600), mediaUri: 'mxc://example.org/audio-webm-visible', mediaMime: 'video/webm', mediaType: 'm.audio', mediaSize: 18 }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.hide_images_and_videos': true } })
    harness.service.History.mockResolvedValueOnce({ messages: [imageMessage, videoMessage, audioMessage, audioWebMMessage], before: 0, hasMore: false })
    stubImageIntersectionObserver()
    const { container } = render(<App />)

    expect(await screen.findByText('Photo attachment')).toBeTruthy()
    expect(container.querySelector('[data-event-id="$photo-hidden"] .message-attachment')).toBeNull()
    expect(container.querySelector('[data-event-id="$video-hidden"] .message-attachment')).toBeNull()
    expect(container.querySelector('[data-event-id="$audio-visible"] .audio-attachment')).toBeTruthy()
    expect(container.querySelector('[data-event-id="$audio-webm-visible"] .audio-attachment')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    await user.click(screen.getByRole('checkbox', { name: 'Hide images and videos' }))

    await waitFor(() => {
      expect(container.querySelector('[data-event-id="$photo-hidden"] .media-load')).toBeTruthy()
      expect(container.querySelector('[data-event-id="$video-hidden"] .media-load')).toBeTruthy()
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('appearance.hide_images_and_videos', false)
    })
  })

  it('renders a file attachment in its media card without a duplicate message bubble', async () => {
    const user = userEvent.setup()
    const filename = '02 - Descrovi-Iotti-Bosia.pdf'
    const savedPath = `/Users/test/Downloads/${filename}`
    const fileMessage = { ...message('$file', filename, 300), mediaUri: 'mxc://example.org/file', mediaType: 'm.file', mediaMime: 'application/pdf', mediaSize: 200_300 }
    harness.service.History.mockResolvedValueOnce({ messages: [fileMessage], before: 0, hasMore: false })
    harness.service.SaveMedia.mockResolvedValueOnce(savedPath)
    const { container } = render(<App />)

    const fileCard = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-event-id="$file"] .file-card')
      if (!element) throw new Error('File card did not render')
      return element
    })
    expect(fileCard.querySelector('.file-card-copy strong')?.textContent).toBe(filename)
    expect(container.querySelector('[data-event-id="$file"] .message-body')).toBeNull()

    await user.click(within(fileCard).getByRole('button', { name: `Download ${filename}` }))
    expect(harness.service.SaveMedia).toHaveBeenCalledWith(fileMessage.mediaUri, filename)
    expect(await screen.findByText(`Saved to ${savedPath}`)).toBeTruthy()
  })

  it('renders an audio attachment as one player card', async () => {
    const audioMessage = { ...message('$audio', 'Voice message.ogg', 300), mediaUri: 'mxc://example.org/audio', mediaMime: 'audio/ogg', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [audioMessage], before: 0, hasMore: false })

    const { container } = render(<App />)
    const card = await waitFor(() => {
      const audioCard = container.querySelector('[data-event-id="$audio"] .audio-attachment')
      expect(audioCard).toBeTruthy()
      return audioCard
    })

    const row = container.querySelector('[data-event-id="$audio"]')
    expect(card?.querySelector('.audio-filename')?.textContent).toBe('Voice message.ogg')
    expect((within(card as HTMLElement).getByRole('button', { name: 'Transcribe with AI' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(card?.querySelector('.media-load') as HTMLButtonElement)
    await waitFor(() => expect(card?.querySelector('audio')).toBeTruthy())
    expect(card?.querySelector('audio')).toBeTruthy()
    expect(card?.querySelector('audio')?.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$audio')}`)
    expect(row?.querySelector('.message-body')).toBeNull()
    expect(row?.querySelector('.media-download')).toBeNull()
  })

  it('renders Matrix audio with a video MIME as one compact audio bar', async () => {
    const user = userEvent.setup()
    const audioMessage = { ...message('$audio-webm', 'Voice message.mp4', 300), mediaUri: 'mxc://example.org/audio-webm', mediaMime: 'video/mp4', mediaType: 'm.audio', mediaDurationMs: 19_840 }
    harness.service.History.mockResolvedValueOnce({ messages: [audioMessage], before: 0, hasMore: false })

    const { container } = render(<App />)
    const card = await waitFor(() => {
      const audioCard = container.querySelector('[data-event-id="$audio-webm"] .audio-attachment')
      expect(audioCard).toBeTruthy()
      return audioCard
    })
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Load audio' }))

    expect(await within(card as HTMLElement).findByRole('button', { name: 'Play audio' })).toBeTruthy()
    expect(card?.querySelector('.audio-player-bar')).toBeTruthy()
    expect(card?.querySelector('video')).toBeNull()
    expect(card?.querySelector('audio')?.hasAttribute('controls')).toBe(false)
    expect(card?.querySelector('audio')?.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$audio-webm')}`)
    expect(card?.querySelector('.audio-duration')?.textContent).toBe('0:19')
  })

  it('transcribes audio and only puts the result in the composer when accepted', async () => {
    const user = userEvent.setup()
    const audioMessage = { ...message('$audio-transcription', 'Voice message.ogg', 300), mediaUri: 'mxc://example.org/audio-transcription', mediaMime: 'audio/ogg', mediaSize: 12 }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValueOnce({ messages: [audioMessage], before: 0, hasMore: false })
    harness.service.AITranscribeMedia.mockResolvedValueOnce('Please meet at noon.')

    const { container } = render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Transcribe with AI' }))

    expect(await screen.findByText('Please meet at noon.')).toBeTruthy()
    expect(harness.service.AITranscribeMedia).toHaveBeenCalledWith(audioMessage.mediaUri, audioMessage.body, audioMessage.mediaMime)
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Use as draft' }))
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Please meet at noon.')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(container.querySelector('[data-event-id="$audio-transcription"] .audio-transcript')).toBeTruthy()
  })

  function stubTimelineGeometry(contentHeight: number) {
    let height = contentHeight
    const resizeCallbacks: ResizeObserverCallback[] = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
      }
      observe() { }
      unobserve() { }
      disconnect() { }
    })
    geometrySpies.push(
      vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(() => height),
      vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(300),
    )
    return {
      setContentHeight(next: number) {
        height = next
      },
      notifyResize() {
        act(() => {
          for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
        })
      },
    }
  }

  // Opens a room whose newest message is an auto-previewed image. The image loads after the
  // timeline has been pinned to the bottom, which is the order that leaves the view above the newest message.
  async function renderRoomWithImageAtBottom() {
    const image = { ...message('$photo', 'Attachment', 300), mediaUri: 'mxc://example.org/photo', mediaMime: 'image/png', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [message('$older', 'older history', 100), image], before: 0, hasMore: false })
    const geometry = stubTimelineGeometry(700)
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('[data-event-id="$photo"] .media-preview')).toBeTruthy())
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    expect(timeline.scrollTop).toBe(700)
    return { geometry, timeline }
  }

  it('keeps the newest message in view when media loads after the room opens', async () => {
    const { geometry, timeline } = await renderRoomWithImageAtBottom()

    geometry.setContentHeight(1000)
    geometry.notifyResize()

    expect(timeline.scrollTop).toBe(1000)
  })

  it('stops following new content after the reader scrolls up', async () => {
    const { geometry, timeline } = await renderRoomWithImageAtBottom()

    timeline.scrollTop = 150
    fireEvent.scroll(timeline)
    geometry.setContentHeight(1000)
    geometry.notifyResize()

    expect(timeline.scrollTop).toBe(150)
  })

  it('keeps following when the scroll event from an earlier pin arrives after media grew', async () => {
    const { geometry, timeline } = await renderRoomWithImageAtBottom()

    geometry.setContentHeight(1500)
    fireEvent.scroll(timeline)
    geometry.notifyResize()

    expect(timeline.scrollTop).toBe(1500)
  })

  it('hides message timestamps when configured', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.show_timestamps': false } })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(container.querySelector('[data-event-id="$latest"] .message-meta time')).toBeNull()
  })

  it.each([false, true])('shows date and time in message headers with 24-hour clock preference %s', async (use24Hour) => {
    const recent = Date.now() - 5 * 60_000
    const old = Date.now() - 2 * 24 * 60 * 60_000
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.time_24_hour': use24Hour } })
    harness.service.History.mockResolvedValue({
      messages: [message('$old', 'older message', old), message('$latest', 'latest message', recent)],
      before: 50,
      hasMore: false,
    })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const oldMeta = container.querySelector('[data-event-id="$old"] .message-meta')
    const latestMeta = container.querySelector('[data-event-id="$latest"] .message-meta')
    const formatDateTime = (timestamp: number) => new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
      hour12: !use24Hour,
    }).format(new Date(timestamp))
    expect(oldMeta?.querySelector('strong')).toBeNull()
    expect(oldMeta?.textContent).toBe(formatDateTime(old))
    expect(latestMeta?.querySelector('strong')).toBeNull()
    expect(latestMeta?.textContent).toBe(formatDateTime(recent))
  })

  it('clears the previous timeline while the selected chat history loads', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    let resolveSecondPage: ((page: { messages: Message[]; before: number; hasMore: boolean }) => void) | undefined
    const secondPage = new Promise<{ messages: Message[]; before: number; hasMore: boolean }>((resolve) => {
      resolveSecondPage = resolve
    })
    harness.service.History.mockImplementation(async (roomID: string) => {
      if (roomID === room.id) return { messages: [message('$first-room', 'First room message', 100)], before: 0, hasMore: false }
      return secondPage
    })
    const { container } = render(<App />)

    expect(await screen.findByText('First room message')).toBeTruthy()
    await user.click(container.querySelector('.room-button[title="Second room"]')!)
    expect(await screen.findByText('Loading messages')).toBeTruthy()
    expect(screen.queryByText('First room message')).toBeNull()
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 500 })

    await act(async () => {
      resolveSecondPage?.({ messages: [message('$second-latest', 'Second room latest', 200)], before: 0, hasMore: false })
      await secondPage
    })
    expect(await screen.findByText('Second room latest')).toBeTruthy()
    expect(timeline.scrollTop).toBe(500)
  })

  it('uses the same calendar date for yesterday messages in the sidebar and timeline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 0, 2, 12))
      const yesterday = new Date(2026, 0, 1, 13).getTime()
      harness.service.Snapshot.mockResolvedValue({
        ...snapshot,
        rooms: [{ ...room, preview: 'message from yesterday', lastEventAt: yesterday }],
      })
      harness.service.History.mockResolvedValue({
        messages: [message('$yesterday', 'message from yesterday', yesterday)],
        before: 0,
        hasMore: false,
      })
      const { container } = render(<App />)
      const timeline = await screen.findByRole('region', { name: 'Message timeline' })
      await within(timeline).findByText('message from yesterday')

      const expectedDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(yesterday))
      const expectedDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short', hour12: true }).format(new Date(yesterday))
      expect(container.querySelector('.room-button[title="Test room"] .room-meta time')?.textContent).toBe(expectedDate)
      expect(timeline.querySelector('[data-event-id="$yesterday"] .message-meta time')?.textContent).toBe(expectedDateTime)
      expect(timeline.querySelector('.day-divider')?.textContent).toBe('Yesterday')
    } finally {
      vi.useRealTimers()
    }
  })

  it('disables message entrance animations when configured', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.message_animations': false } })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(container.querySelector('.app-shell')?.getAttribute('data-message-animations')).toBe('false')
  })

  it('reloads the initial page when the history count preference changes', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.selectOptions(screen.getByRole('combobox'), '250')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('history.initial_messages', '250'))
    await waitFor(() => expect(harness.service.History).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('new live message')).toBeTruthy()
  })

  it('enables older paging if live sync grows an initially complete page', async () => {
    const user = userEvent.setup()
    let firstPageRequest = true
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => {
      if (before === 0 && firstPageRequest) {
        firstPageRequest = false
        return { messages: [message('$latest', 'latest message', 300)], before: 10, hasMore: false }
      }
      if (before === 20) {
        return { messages: [message('$older', 'older after growth', 100)], before: 5, hasMore: false }
      }
      return {
        messages: [message('$latest', 'latest message updated', 300), message('$new', 'new live message', 400)],
        before: 20,
        hasMore: true,
      }
    })

    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull()

    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [room],
          timelineChangedRoomId: [room.id],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    expect(await screen.findByText('new live message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Load older messages' }))
    expect(await screen.findByText('older after growth')).toBeTruthy()
    expect(harness.service.History).toHaveBeenLastCalledWith(room.id, 20)
  })

  it('shows typing status below the timeline and above the composer', async () => {
    const typingUserID = '@aldo:example.org'
    harness.service.RoomMembers.mockResolvedValue([{ id: typingUserID, displayName: 'aldo rossi' }])
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [room],
          timelineChangedRoomId: [],
          typingUsers: { [room.id]: [typingUserID] },
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    expect(await screen.findByText('aldo rossi is typing')).toBeTruthy()
    expect(container.textContent).not.toContain(typingUserID)
    expect(container.querySelector('.timeline + .typing-indicator + .composer')).not.toBeNull()
  })

  it('uses the direct-room name when a member has no display name', async () => {
    const typingUserID = '@aldo:example.org'
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, name: 'aldo rossi' }] })
    harness.service.RoomMembers.mockResolvedValue([{ id: typingUserID, displayName: typingUserID }])
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [{ ...room, name: 'aldo rossi' }],
          timelineChangedRoomId: [],
          typingUsers: { [room.id]: [typingUserID] },
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    expect(await screen.findByText('aldo rossi is typing')).toBeTruthy()
    expect(document.body.textContent).not.toContain(typingUserID)
  })

  it('moves room focus with arrows and switches rooms with the primary modifier', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.keyDown(roomButtons[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(roomButtons[1])
    await user.keyboard('{Enter}')
    await waitFor(() => expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(secondRoom.id))

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: '1', ctrlKey: true })
    await waitFor(() => expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(room.id))
  })

  it('shift-selects a room range and applies context-menu actions to all selected rooms', async () => {
    const user = userEvent.setup()
    const thirdRoom = { ...room, id: '!third:example.org', name: 'Third room' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom, thirdRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    let roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.click(roomButtons[0])
    roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.click(roomButtons[2], { shiftKey: true })
    expect(container.querySelectorAll('.room-button.is-multiselected')).toHaveLength(3)

    roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.contextMenu(roomButtons[2], { clientX: 48, clientY: 48 })
    expect(await screen.findByText('3 chats selected')).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: 'Add 3 to Favorites' }))

    await waitFor(() => {
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.favorite.${room.id}`, true)
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.favorite.${secondRoom.id}`, true)
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.favorite.${thirdRoom.id}`, true)
    })
    expect(container.querySelectorAll('.room-button.is-multiselected')).toHaveLength(0)
  })

  it('archives unread rooms after marking them read and restores them from Archived', async () => {
    const user = userEvent.setup()
    const unreadRoom = { ...room, unread: 2, lastEventId: '$latest' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [unreadRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Archive room' }))
    await waitFor(() => {
      expect(harness.service.MarkRead).toHaveBeenCalledWith(room.id, '$latest')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true)
    })
    expect(container.querySelector('.room-list .room-button')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Archived rooms' }))
    expect(container.querySelector('.room-list .room-button')).toBeTruthy()
    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Restore room' }))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${room.id}`, false))
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(container.querySelector('.room-list .room-button')).toBeTruthy()
  })

  it('includes archived rooms in inbox search results', async () => {
    const user = userEvent.setup()
    const archivedRoom = { ...secondRoom, name: 'Archived project' }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, archivedRoom],
      preferences: { [`room.archived.primary.${archivedRoom.id}`]: true },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.type(screen.getByRole('textbox', { name: 'Find a room' }), 'Archived')

    expect(container.querySelectorAll('.room-list .room-button')).toHaveLength(1)
    expect(container.querySelector('.room-list .room-button')?.textContent).toContain('Archived project')
  })

  it.each([
    ['incoming', '@alice:example.org'],
    ['outgoing', '@me:example.org'],
  ])('restores archived rooms to the inbox after an %s message', async (_direction, sender) => {
    const user = userEvent.setup()
    const archivedRoom = { ...room, lastEventId: '$before-archive-update' }
    const archiveKey = `room.archived.primary.${archivedRoom.id}`
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { [archiveKey]: true } })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Archived rooms' }))
    expect(container.querySelector('.room-list .room-button')).toBeTruthy()
    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [{ ...archivedRoom, lastEventId: '$after-archive-update', lastEventSender: sender, lastEventAt: archivedRoom.lastEventAt + 1 }],
          timelineChangedRoomId: [archivedRoom.id],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(archiveKey, false))
    await waitFor(() => expect(container.querySelector('.room-list .room-button')?.textContent).toContain('Test room'))
  })

  it('keeps archived rooms archived when initial sync loads their history', async () => {
    const archivedRoom = { ...room, lastEventId: '$before-sync' }
    const archiveKey = `room.archived.primary.${archivedRoom.id}`
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      syncReady: false,
      rooms: [archivedRoom],
      preferences: { [archiveKey]: true },
    })
    const { container } = render(<App />)

    expect(await screen.findByRole('button', { name: 'Archived rooms' })).toBeTruthy()
    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [{ ...archivedRoom, lastEventId: '$historical-event' }],
          timelineChangedRoomId: [archivedRoom.id],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(archiveKey, false)
    expect(container.querySelector('.room-list .room-button')).toBeNull()
  })

  it('archives all currently read rooms', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Archive all read rooms' }))

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true))
    expect(container.querySelector('.room-list .room-button')).toBeNull()
  })

  it('uses the configured next-unread room after archiving the selected room', async () => {
    const user = userEvent.setup()
    const unreadDestination = { ...secondRoom, unread: 1 }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, unreadDestination] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'After archiving a room' }), 'next_unread')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('archive.next_room', 'next_unread'))
    await user.keyboard('{Escape}')

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Archive room' }))
    await waitFor(() => expect(container.querySelector('.room-button.is-active')?.textContent).toContain(unreadDestination.name))
  })

  it('archives rooms older than the selected age after marking unread rooms read', async () => {
    const user = userEvent.setup()
    const staleRoom = { ...room, unread: 1, lastEventId: '$stale', lastEventAt: Date.now() - 20 * 24 * 60 * 60 * 1000 }
    const currentRoom = { ...secondRoom, lastEventAt: Date.now() }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [staleRoom, currentRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const ageInput = screen.getByRole('spinbutton', { name: 'Inactive room age' })
    await user.clear(ageInput)
    await user.type(ageInput, '7')
    await user.tab()
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('archive.older_than_days', '7'))
    await user.click(screen.getByRole('button', { name: 'Archive inactive rooms' }))

    await waitFor(() => {
      expect(harness.service.MarkRead).toHaveBeenCalledWith(staleRoom.id, '$stale')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${staleRoom.id}`, true)
    })
    expect(container.querySelector('.room-list .room-button')?.textContent).toContain(currentRoom.name)
  })

  it('automatically archives inactive rooms using the selected age', async () => {
    const user = userEvent.setup()
    const staleRoom = { ...secondRoom, lastEventAt: Date.now() - 45 * 24 * 60 * 60 * 1000 }
    const currentRoom = { ...room, lastEventAt: Date.now() }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [currentRoom, staleRoom],
      preferences: { 'archive.older_than_days': '90' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const ageInput = screen.getByRole('spinbutton', { name: 'Inactive room age' })
    await user.clear(ageInput)
    await user.type(ageInput, '30')
    await user.tab()
    await user.click(screen.getByRole('checkbox', { name: 'Automatically archive inactive rooms' }))

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('archive.older_than_days', '30'))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('archive.automatic', true))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${staleRoom.id}`, true))
  })

  it('navigates to the next unread room after an explicit mark-read action', async () => {
    const user = userEvent.setup()
    const markedRoom = { ...secondRoom, unread: 1, lastEventId: '$second' }
    const nextUnreadRoom = { ...secondRoom, id: '!third:example.org', name: 'Third room', unread: 1, lastEventId: '$third' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, markedRoom, nextUnreadRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'General' }))
    await user.selectOptions(screen.getByRole('combobox', { name: "After changing a room's read state" }), 'next_unread')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('inbox.after_read', 'next_unread'))
    await user.keyboard('{Escape}')

    const roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.contextMenu(roomButtons[1], { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Mark room read' }))

    await waitFor(() => {
      expect(harness.service.MarkRead).toHaveBeenCalledWith(markedRoom.id, '$second')
      expect(container.querySelector('.room-button.is-active')?.textContent).toContain(nextUnreadRoom.name)
    })
  })

  it('marks a room unread and navigates to the next unread room', async () => {
    const user = userEvent.setup()
    const nextUnreadRoom = { ...secondRoom, id: '!third:example.org', name: 'Third room', unread: 1, lastEventId: '$third' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, nextUnreadRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'General' }))
    await user.selectOptions(screen.getByRole('combobox', { name: "After changing a room's read state" }), 'next_unread')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('inbox.after_read', 'next_unread'))
    await user.keyboard('{Escape}')

    const roomButton = container.querySelector<HTMLButtonElement>('.room-list .room-button')!
    fireEvent.contextMenu(roomButton, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Mark room unread' }))

    await waitFor(() => {
      expect(harness.service.MarkUnread).toHaveBeenCalledWith(room.id)
      expect(container.querySelector('.room-button.is-active')?.textContent).toContain(nextUnreadRoom.name)
    })
  })

  it('switches between the room list and conversation on mobile', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    expect(appShell.getAttribute('data-mobile-pane')).toBe('rooms')

    await user.click(screen.getByRole('button', { name: /Test room/ }))
    expect(appShell.getAttribute('data-mobile-pane')).toBe('conversation')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })))
    await user.click(screen.getByRole('button', { name: 'Back to rooms' }))
    expect(appShell.getAttribute('data-mobile-pane')).toBe('rooms')

    fireEvent.keyDown(appShell, { key: 'k', metaKey: true })
    const quickSwitcher = await screen.findByRole('textbox', { name: 'Search rooms' })
    fireEvent.keyDown(quickSwitcher, { key: 'Enter' })
    expect(appShell.getAttribute('data-mobile-pane')).toBe('conversation')
  })

  it('shows room previews without sender names', async () => {
    const ownMessageRoom: Room = {
      ...room,
      id: '!own-message:example.org',
      name: 'Sent by me',
      preview: 'My latest message',
      lastEventSender: snapshot.profile.userId,
    }
    const incomingMessageRoom: Room = {
      ...room,
      id: '!incoming-message:example.org',
      name: 'Sent by them',
      preview: 'Their latest message',
      lastEventSender: '@alice:example.org',
    }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [ownMessageRoom, incomingMessageRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const previews = container.querySelectorAll('.room-preview')
    expect(previews[0].textContent).toBe('My latest message')
    expect(previews[1].textContent).toBe('Their latest message')
    expect(previews[0].querySelector('.room-preview-sent')).toBeTruthy()
    expect(previews[1].querySelector('.room-preview-sent')).toBeNull()
    expect(previews[0].querySelector('.room-preview-text')?.classList.contains('is-received')).toBe(false)
    expect(previews[1].querySelector('.room-preview-text')?.classList.contains('is-received')).toBe(true)
  })

  it('shows the time for rooms active today and the date for rooms active on earlier days', async () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(23, 59, 0, 0)
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [
        { ...room, id: '!today:example.org', name: 'Today room', lastEventAt: today.getTime() },
        { ...room, id: '!yesterday:example.org', name: 'Yesterday room', lastEventAt: yesterday.getTime() },
      ],
    })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.room-button[title="Yesterday room"]')).toBeTruthy())

    expect(container.querySelector('.room-button[title="Today room"] .room-meta time')?.textContent).toBe(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(today))
    expect(container.querySelector('.room-button[title="Yesterday room"] .room-meta time')?.textContent).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(yesterday))
  })

  it('leaves the preview empty instead of showing the room ID', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [{ ...room, id: '!quiet:example.org', name: 'Quiet room', preview: '', topic: '' }],
    })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.room-button[title="Quiet room"]')).toBeTruthy())

    expect(container.querySelector('.room-button[title="Quiet room"] .room-preview')?.textContent).toBe('')
  })

  it('dates rooms without a message time by their last activity', async () => {
    const activity = Date.now() - 2 * 24 * 60 * 60_000
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [
        { ...room, id: '!backfilled:example.org', name: 'Backfilled room', lastEventAt: 0, lastSeen: activity },
        { ...room, id: '!silent:example.org', name: 'Silent room', lastEventAt: 0, lastSeen: 0 },
      ],
    })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.room-button[title="Silent room"]')).toBeTruthy())

    expect(container.querySelector('.room-button[title="Backfilled room"] .room-meta time')?.textContent).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(activity)))
    expect(container.querySelector('.room-button[title="Silent room"] .room-meta time')).toBeNull()
  })

  it('sorts chats by activity date while keeping favorites pinned', async () => {
    const dayAt = (daysAgo: number) => {
      const date = new Date()
      date.setHours(12, 0, 0, 0)
      date.setDate(date.getDate() - daysAgo)
      return date.getTime()
    }
    const oldest = { ...room, id: '!oldest:example.org', name: 'Oldest', lastEventAt: dayAt(3) }
    const middle = { ...room, id: '!middle:example.org', name: 'Middle', lastEventAt: 0, lastSeen: dayAt(2) }
    const newest = { ...room, id: '!newest:example.org', name: 'Newest', lastEventAt: dayAt(1) }
    const favorite = { ...room, id: '!favorite:example.org', name: 'Favorite', favorite: true, lastEventAt: dayAt(4) }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [oldest, middle, newest, favorite] })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const names = Array.from(container.querySelectorAll('.room-list .room-name-text'), (element) => element.textContent)
    expect(names).toEqual(['Favorite', 'Newest', 'Middle', 'Oldest'])
  })

  it('sorts rooms from today by time and older rooms by date', async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const timestampAt = (daysAgo: number, hour: number) => {
      const date = new Date(today)
      date.setDate(date.getDate() - daysAgo)
      date.setHours(hour, 0, 0, 0)
      return date.getTime()
    }
    const todayEarlier = { ...room, id: '!today-earlier:example.org', name: 'Today earlier', lastEventAt: timestampAt(0, 10) }
    const yesterday = { ...room, id: '!yesterday:example.org', name: 'Yesterday', lastEventAt: timestampAt(1, 18) }
    const todayLater = { ...room, id: '!today-later:example.org', name: 'Today later', lastEventAt: timestampAt(0, 15) }
    const twoDaysAgo = { ...room, id: '!two-days-ago:example.org', name: 'Two days ago', lastEventAt: timestampAt(2, 20) }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [todayEarlier, yesterday, todayLater, twoDaysAgo] })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const names = Array.from(container.querySelectorAll('.room-list .room-name-text'), (element) => element.textContent)
    expect(names).toEqual(['Today later', 'Today earlier', 'Yesterday', 'Two days ago'])
  })

  it('uses the latest event timestamp when it differs from the room sorting timestamp', async () => {
    const activityAt = (daysAgo: number) => {
      const date = new Date()
      date.setHours(12, 0, 0, 0)
      date.setDate(date.getDate() - daysAgo)
      return date.getTime()
    }
    const mostRecent = {
      ...room,
      id: '!most-recent:example.org',
      name: 'Most recent activity',
      lastSeen: activityAt(0),
      lastEventAt: activityAt(1),
    }
    const older = {
      ...room,
      id: '!older:example.org',
      name: 'Older activity',
      lastSeen: activityAt(1),
      lastEventAt: activityAt(3),
    }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [older, mostRecent] })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.room-list .room-button'))
    expect(buttons.map((button) => button.querySelector('.room-name-text')?.textContent)).toEqual(['Most recent activity', 'Older activity'])
    expect(buttons.map((button) => button.querySelector('.room-meta time')?.textContent)).toEqual([
      new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(mostRecent.lastEventAt)),
      new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(older.lastEventAt)),
    ])
  })

  it('mounts only a window of rooms when the inbox contains many chats', async () => {
    const rooms = Array.from({ length: 1_000 }, (_, index) => ({
      ...room,
      id: `!room-${index}:example.org`,
      name: `Room ${index}`,
    }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(container.querySelectorAll('.room-list .room-button').length).toBeLessThan(40)
    expect(container.querySelector('.room-section-label')?.textContent).toContain('1000')
  })

  it('moves keyboard focus into off-screen rooms in a large inbox', async () => {
    const rooms = Array.from({ length: 1_000 }, (_, index) => ({
      ...room,
      id: `!room-${index}:example.org`,
      name: `Room ${index}`,
    }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const buttons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    const lastVisibleButton = buttons[buttons.length - 1]
    const nextIndex = Number(lastVisibleButton.dataset.roomIndex) + 1

    fireEvent.keyDown(lastVisibleButton, { key: 'ArrowDown' })

    await waitFor(() => expect(container.querySelector(`.room-button[data-room-index="${nextIndex}"]`)).toBeTruthy())
    expect(container.querySelectorAll('.room-list .room-button').length).toBeLessThan(40)
  })

  it('dismisses the answered notification after 10 seconds', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    const answerAction = screen.getByRole('menuitem', { name: /Remove from Needs reply/ })

    vi.useFakeTimers()
    try {
      await act(async () => {
        fireEvent.click(answerAction)
        await Promise.resolve()
      })
      expect(screen.getByText('Marked Test room answered')).toBeTruthy()
      expect(container.querySelector('.conversation .chat-notice-stack .triage-toast')).not.toBeNull()

      act(() => vi.advanceTimersByTime(9_999))
      expect(screen.getByText('Marked Test room answered')).toBeTruthy()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.queryByText('Marked Test room answered')).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it('dismisses an answered notification immediately from the chat area', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: /Remove from Needs reply/ }))

    expect(await screen.findByText('Marked Test room answered')).toBeTruthy()
    expect(container.querySelector('.conversation .chat-notice-stack .triage-toast')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Marked Test room answered')).toBeNull()
  })

  it('dismisses scheduled reminder notices after 10 seconds', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    vi.useFakeTimers()
    try {
      await act(async () => {
        harness.eventHandlers.get('scheduler:reminder')?.({ data: { roomId: room.id, text: 'Take a break' } })
        await Promise.resolve()
      })
      expect(screen.getByText('Test room: Take a break')).toBeTruthy()
      expect(container.querySelector('.conversation .chat-notice-stack .scheduled-notice')).not.toBeNull()

      act(() => vi.advanceTimersByTime(9_999))
      expect(screen.getByText('Test room: Take a break')).toBeTruthy()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.queryByText('Test room: Take a break')).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it('shows the recovery key form while initial sync is pending', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, needsVerification: true, syncReady: false })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Verify this device' })).toBeTruthy()

    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [room],
          timelineChangedRoomId: [],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Verify this device' })).toBeNull()

    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [room],
          timelineChangedRoomId: [],
          initialSyncComplete: true,
          needsVerification: true,
          connectionState: 'connected',
        },
      })
    })

    expect(await screen.findByRole('heading', { name: 'Verify this device' })).toBeTruthy()
  })

  it('applies and persists the additional appearance themes', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    const themeSelect = container.querySelector<HTMLSelectElement>('.settings-content select')!
    expect(Array.from(themeSelect.options).map((option) => option.textContent)).toEqual([
      'System default',
      'Light (light)',
      'Dark (dark)',
      'VS Code (dark)',
      'OLED black (dark)',
      'Bosco (light)',
      'Rosa (light)',
      'Dracula (dark)',
      'Midnight (dark)',
      'Slate (dark)',
      'Solarized (light)',
      'Sepia (light)',
    ])

    await user.selectOptions(themeSelect, 'VS Code')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('vs-code')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'VS Code'))
    expect(screen.getByText(/VS Code is a dark theme\./)).toBeTruthy()

    await user.selectOptions(themeSelect, 'Bosco')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('bosco')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'Bosco'))

    await user.selectOptions(themeSelect, 'Rosa')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('rosa')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'Rosa'))

    await user.selectOptions(themeSelect, 'Dracula')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('dracula')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'Dracula'))
    expect(screen.getByText(/Dracula is a dark theme\./)).toBeTruthy()

    await user.selectOptions(themeSelect, 'Sepia')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('sepia')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'Sepia'))
    expect(screen.getByText(/Sepia is a light theme\./)).toBeTruthy()
  })

  it('applies a theme accent independently from the outgoing message color', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    await user.click(screen.getByRole('button', { name: 'Ocean accent color' }))

    expect(container.querySelector('.app-shell')?.getAttribute('style')).toContain('--accent: #28718f')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.accent_color', 'Ocean'))
  })

  it('applies and persists a chat wallpaper', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    await user.click(screen.getByRole('button', { name: 'Meadow wallpaper' }))

    expect(container.querySelector('.app-shell')?.getAttribute('data-wallpaper')).toBe('meadow')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.chat_wallpaper', 'Meadow'))
  })

  it('controls room previews, unread counts, and chat-list density independently', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'sidebar.transparent': true } })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    await user.click(screen.getByLabelText('Show room previews'))
    await user.click(screen.getByLabelText('Show unread counts'))
    await user.click(screen.getByLabelText('Compact chat list'))

    const appShell = container.querySelector('.app-shell')
    expect(container.querySelector('.sidebar')?.classList.contains('is-transparent')).toBe(false)
    expect(screen.queryByRole('checkbox', { name: 'Transparent sidebar' })).toBeNull()
    await waitFor(() => {
      expect(appShell?.getAttribute('data-room-previews')).toBe('false')
      expect(appShell?.getAttribute('data-unread-counts')).toBe('false')
      expect(appShell?.getAttribute('data-compact-chat-list')).toBe('true')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('sidebar.show_previews', false)
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('sidebar.show_unread_counts', false)
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('sidebar.compact_chat_list', true)
    })
  })

  it('allows disabling the pointer cursor on clickable controls', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    await user.click(screen.getByLabelText('Use pointer cursor on clickable controls'))

    await waitFor(() => {
      expect(container.querySelector('.app-shell')?.getAttribute('data-pointer-cursor')).toBe('false')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('appearance.pointer_cursor', false)
    })
  })

  it('sets app zoom from the Appearance slider', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    const slider = screen.getByRole('slider', { name: 'App zoom' })
    fireEvent.change(slider, { target: { value: '105' } })
    fireEvent.change(slider, { target: { value: '110' } })

    expect(screen.getByText('110%')).toBeTruthy()
    expect(harness.service.SetStringPreference).not.toHaveBeenCalledWith('appearance.zoom', expect.any(String))

    fireEvent.pointerUp(slider)

    await waitFor(() => {
      expect(container.querySelector('.app-shell')?.getAttribute('style')).toContain('--app-zoom: 110%')
      expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.zoom', '110')
    })
    expect(harness.service.SetStringPreference).not.toHaveBeenCalledWith('appearance.zoom', '105')
  })

  it('adjusts and resets app zoom with primary-modifier shortcuts', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    fireEvent.keyDown(appShell, { key: '=', metaKey: true })
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.zoom', '105'))

    fireEvent.keyDown(appShell, { key: '0', metaKey: true })
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.zoom', '100'))
  })

  it('toggles Incognito blur with the privacy shortcut and preserves the draft', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'private draft' } })
    composer.focus()

    fireEvent.keyDown(composer, { key: 'p', metaKey: true, shiftKey: true })
    await waitFor(() => expect(appShell.getAttribute('data-incognito')).toBe('true'))
    expect(screen.queryByRole('button', { name: 'Show screen content' })).toBeNull()
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('privacy.incognito', true))
    expect(composer.value).toBe('private draft')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'p', metaKey: true, shiftKey: true })
    await waitFor(() => expect(appShell.getAttribute('data-incognito')).toBe('false'))
    expect(screen.queryByRole('button', { name: 'Show screen content' })).toBeNull()
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('privacy.incognito', false))
    expect(composer.value).toBe('private draft')
  })

  it('toggles hiding images and videos with Cmd+Shift+I without losing the draft', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'keep this draft' } })
    composer.focus()

    fireEvent.keyDown(composer, { key: 'i', metaKey: true, shiftKey: true })
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('appearance.hide_images_and_videos', true))
    expect(composer.value).toBe('keep this draft')

    fireEvent.keyDown(window, { key: 'i', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('appearance.hide_images_and_videos', false))
    expect(composer.value).toBe('keep this draft')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('opens keyboard help and focuses room search with unmodified shortcuts', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!

    fireEvent.keyDown(appShell, { key: '/' })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find a room' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find a room' }), { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'Quick switcher' })).toBeNull()

    fireEvent.keyDown(appShell, { key: 'f', ctrlKey: true })
    const messageSearch = await screen.findByRole('textbox', { name: 'Search local message history' })
    fireEvent.keyDown(messageSearch, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search local message history' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search messages' })))

    fireEvent.keyDown(appShell, { key: 'f', ctrlKey: true })
    await screen.findByRole('textbox', { name: 'Search local message history' })
    await user.click(screen.getByRole('button', { name: 'Close message search' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search messages' })))

    fireEvent.keyDown(appShell, { key: '?' })
    expect((await screen.findByRole('tab', { name: 'Keyboard' })).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Navigate the focused timeline')).toBeTruthy()
    expect(screen.getByText('Reply to the focused message')).toBeTruthy()
    expect(screen.getByText('Toggle Incognito blur')).toBeTruthy()
  })

  it('disables spelling correction in search and filter inputs', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const expectNoCorrection = (input: HTMLElement) => {
      expect(input.getAttribute('spellcheck')).toBe('false')
      expect(input.getAttribute('autocorrect')).toBe('off')
      expect(input.getAttribute('autocapitalize')).toBe('off')
    }
    expectNoCorrection(screen.getByRole('textbox', { name: 'Find a room' }))

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'k', ctrlKey: true })
    const quickSearch = await screen.findByRole('textbox', { name: 'Search rooms' })
    expectNoCorrection(quickSearch)
    fireEvent.keyDown(quickSearch, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quick switcher' })).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Search messages' }))
    const messageSearch = await screen.findByRole('textbox', { name: 'Search local message history' })
    expectNoCorrection(messageSearch)
    await user.click(screen.getByText('Filters'))
    expectNoCorrection(screen.getByRole('textbox', { name: 'Filter by sender' }))
    fireEvent.keyDown(messageSearch, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search local message history' })).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expectNoCorrection(screen.getByRole('searchbox', { name: 'Search settings' }))
  })

  it('searches all chats, paginates results, and opens the matching message', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    harness.service.SearchMessages
      .mockResolvedValueOnce({
        results: [{ roomID: secondRoom.id, message: message('$new', 'needle from another chat', 400) }],
        nextBatch: 'local_offset:50',
      })
      .mockResolvedValueOnce({ results: [], nextBatch: '' })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'f', ctrlKey: true })
    const query = screen.getByRole('textbox', { name: 'Search local message history' })
    await user.type(query, 'needle')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByRole('button', { name: 'Open message in Second room' })).toBeTruthy()
    expect(harness.service.SearchMessages).toHaveBeenNthCalledWith(1, {
      query: 'needle',
      roomID: '',
      sender: '',
      minTimestamp: 0,
      maxTimestamp: 0,
      limit: 50,
      nextBatch: '',
    })

    await user.click(screen.getByRole('button', { name: 'Load more results' }))
    await waitFor(() => expect(harness.service.SearchMessages).toHaveBeenCalledTimes(2))
    expect(harness.service.SearchMessages).toHaveBeenNthCalledWith(2, expect.objectContaining({ nextBatch: 'local_offset:50' }))

    await user.click(screen.getByRole('button', { name: 'Open message in Second room' }))
    expect(await screen.findByText('new live message')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Second room' })).toBeTruthy()
  })

  it('opens global search with no selected room', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [] })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Matrix' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Search messages' }))
    await user.type(screen.getByRole('textbox', { name: 'Search local message history' }), 'invoice')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(harness.service.SearchMessages).toHaveBeenCalledWith(expect.objectContaining({
      query: 'invoice',
      roomID: '',
      limit: 50,
    })))
  })

  it('passes room, sender, and date filters to local message search', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'f', ctrlKey: true })
    await user.type(screen.getByRole('textbox', { name: 'Search local message history' }), 'report')
    await user.click(screen.getByText('Filters'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by room' }), secondRoom.id)
    await user.type(screen.getByRole('textbox', { name: 'Filter by sender' }), '@alice:example.org')
    fireEvent.change(screen.getByLabelText('Search from date'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Search to date'), { target: { value: '2026-10-17' } })
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(harness.service.SearchMessages).toHaveBeenCalledWith({
      query: 'report',
      roomID: secondRoom.id,
      sender: '@alice:example.org',
      minTimestamp: new Date('2026-10-01T00:00:00').getTime(),
      maxTimestamp: new Date('2026-10-17T23:59:59.999').getTime(),
      limit: 50,
      nextBatch: '',
    }))
  })

  it('navigates the timeline and replies from a focused message', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    fireEvent.keyDown(timeline, { key: 'ArrowDown' })

    const messageRow = container.querySelector<HTMLElement>('.message-row')!
    expect(document.activeElement).toBe(messageRow)
    fireEvent.keyDown(messageRow, { key: 'r' })

    expect(await screen.findByText('Replying to Alice')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })))
  })

  it('shows all previous versions in the edited-message tooltip', async () => {
    harness.service.History.mockResolvedValueOnce({
      messages: [{ ...message('$edited', 'current version', Date.now()), edited: true, editHistory: ['original version', 'first edit'] }],
      before: 0,
      hasMore: false,
    })
    render(<App />)

    expect(await screen.findByText('current version')).toBeTruthy()
    expect(screen.getByText('edited (2 prior)').getAttribute('title')).toBe('original version\nfirst edit')
  })

  it('schedules a composer draft for a future time', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'schedule.default_send_minutes': '30' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'send this later')
    await user.click(screen.getByRole('button', { name: 'Schedule message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Schedule message' })
    const sendAt = within(dialog).getByLabelText('Send at') as HTMLInputElement
    const defaultSendAt = new Date(sendAt.value).getTime()
    expect(defaultSendAt).toBeGreaterThanOrEqual(Date.now() + 29 * 60_000)
    expect(defaultSendAt).toBeLessThanOrEqual(Date.now() + 31 * 60_000)
    await user.click(within(dialog).getByRole('button', { name: 'Schedule message' }))

    await waitFor(() => expect(harness.service.ScheduleMessage).toHaveBeenCalledWith(room.id, 'send this later', expect.any(Number)))
    expect(harness.service.ScheduleMessage.mock.calls[0][2]).toBeGreaterThan(Date.now())
  })

  it('holds a sent message until the undo window is cancelled', async () => {
    const user = userEvent.setup()
    harness.service.SendMessage.mockClear()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unread: 1, unanswered: true }], preferences: { 'composer.undo_send_seconds': '5' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const needsReplyButton = screen.getByRole('button', { name: 'Needs reply' })
    expect(needsReplyButton.querySelector('.filter-count')?.textContent).toBe('1')
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'undo this')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByRole('group', { name: 'Message queued' })).toBeTruthy()
    await waitFor(() => expect(needsReplyButton.querySelector('.filter-count')).toBeNull())
    expect(screen.getByText('undo this')).toBeTruthy()
    expect(screen.getByText('Sending in 5s')).toBeTruthy()
    expect(composer.value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Undo send' }))

    expect(composer.value).toBe('undo this')
    await waitFor(() => expect(needsReplyButton.querySelector('.filter-count')?.textContent).toBe('1'))
    expect(screen.queryByText('Message queued')).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('sends a queued message when the undo window expires', async () => {
    harness.service.SendMessage.mockClear()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'composer.undo_send_seconds': '5' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'send after window' } })
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(harness.service.SendMessage).not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByText('Sending in 4s')).toBeTruthy()
      await act(async () => {
        vi.advanceTimersByTime(4000)
      })
      expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, 'send after window')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends immediately when undo send is disabled', async () => {
    const user = userEvent.setup()
    harness.service.SendMessage.mockClear()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'composer.undo_send_seconds': '5', 'composer.undo_send_enabled': false } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'send immediately')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, 'send immediately'))
    expect(screen.queryByRole('group', { name: 'Message queued' })).toBeNull()
  })

  it('puts the tail on the final message in an outgoing group', async () => {
    const ownMessages = [100, 200, 300].map((timestamp, index) => ({
      ...message(`$own-${index}`, `sent ${index + 1}`, timestamp),
      sender: snapshot.profile.userId,
      senderName: snapshot.profile.displayName,
      own: true,
    }))
    harness.service.History.mockResolvedValueOnce({ messages: ownMessages, before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('sent 1')).toBeTruthy()
    const rows = [...container.querySelectorAll<HTMLElement>('.message-row')]
    expect(rows).toHaveLength(3)
    expect(rows[0].classList.contains('is-first')).toBe(true)
    expect(rows[0].classList.contains('is-tail')).toBe(false)
    expect(rows[1].classList.contains('is-grouped')).toBe(true)
    expect(rows[2].classList.contains('is-last')).toBe(true)
    expect(rows[2].classList.contains('is-tail')).toBe(true)
  })

  it('hides the avatar and encryption lock on incoming and outgoing messages', async () => {
    const incomingMessage = {
      ...message('$incoming', 'hello from alice', 100),
      avatar: 'mxc://example.org/alice-avatar',
      encrypted: true,
    }
    const outgoingMessage = {
      ...message('$outgoing', 'sent by me', 200),
      sender: snapshot.profile.userId,
      senderName: snapshot.profile.displayName,
      own: true,
      avatar: 'mxc://example.org/me-avatar',
      encrypted: true,
    }
    harness.service.History.mockResolvedValueOnce({ messages: [incomingMessage, outgoingMessage], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('hello from alice')).toBeTruthy()
    expect(screen.getByText('sent by me')).toBeTruthy()
    expect(container.querySelectorAll('.message-row')).toHaveLength(2)
    expect(container.querySelector('.message-row .message-avatar')).toBeNull()
    expect(container.querySelector('.message-row img')).toBeNull()
    expect(screen.queryByTitle('Encrypted message')).toBeNull()
  })

  it('refreshes the room preview after sending a message', async () => {
    const updatedRoom = { ...room, preview: 'sent from the composer', lastEventSender: snapshot.profile.userId, lastEventAt: 400 }
    harness.service.Snapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, rooms: [updatedRoom] })
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'sent from the composer')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, 'sent from the composer'))
    await waitFor(() => expect(container.querySelector('.room-preview')?.textContent).toBe('sent from the composer'))
  })

  it('replaces emoticons as you type when enabled in Keyboard settings', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, direct: false }], preferences: { 'emoji.replace_emoticons': true } })
    render(<App />)

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'Hi :)')

    expect(composer.value).toBe('Hi 🙂')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('replaces emoticons as you type by default', async () => {
    const user = userEvent.setup()
    render(<App />)

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'Hi :) <3')

    expect(composer.value).toBe('Hi 🙂 ❤️')
  })

  it('inserts a picked emoji at the current selection without sending', async () => {
    const user = userEvent.setup()
    render(<App />)

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'ab')
    composer.setSelectionRange(1, 1)
    await user.click(screen.getByRole('button', { name: 'Emoji picker' }))

    const picker = await screen.findByRole('dialog', { name: 'Choose an emoji' })
    await user.click(await within(picker).findByRole('button', { name: /grinning face/i }))

    await waitFor(() => expect(composer.value).toBe('a😀b'))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('saves a custom emoji replacement and uses it while typing', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Keyboard' }))

    await user.click(screen.getByRole('button', { name: 'Add mapping' }))
    await user.type(screen.getByRole('textbox', { name: 'Symbol for replacement 1' }), ':)')
    await user.type(screen.getByRole('textbox', { name: 'Emoji for replacement 1' }), '😎')
    await user.click(screen.getByRole('button', { name: 'Save mappings' }))
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('emoji.emoticon_replacements', '[[":)","😎"]]'))

    await user.click(screen.getByRole('button', { name: 'Close settings' }))
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, ':)')
    expect(composer.value).toBe('😎')
  })

  it('holds a concerning draft and sends the calmer alternative', async () => {
    const user = userEvent.setup()
    const toneRoom = { ...room, direct: false }
    const draft = 'This message has enough words to make the optional tone review run.'
    const calmer = 'Could we review the plan together?'
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [toneRoom], preferences: { [`room.tone_guard.${room.id}`]: true } })
    harness.service.History.mockResolvedValueOnce({
      messages: [
        message('$oldest', 'Earlier context should not be included.', 100),
        message('$incoming-one', 'Can you explain the change?', 200),
        message('$incoming-two', 'You never listen when I explain the issue.', 300),
      ],
      before: 0,
      hasMore: false,
    })
    harness.service.CheckMessageTone.mockResolvedValueOnce(JSON.stringify({
      is_hostile_or_unprofessional: true,
      severity: 'MEDIUM',
      tone_tags: ['accusatory'],
      calmer_alternative: calmer,
    }))
    render(<App />)

    expect(await screen.findByText('You never listen when I explain the issue.')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, draft)
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByRole('alert', { name: 'Tone Guard warning' })).toBeTruthy()
    expect(composer.value).toBe(draft)
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    const request = harness.service.CheckMessageTone.mock.calls[0][0]
    expect(JSON.parse(request[1].content)).toEqual({
      draft,
      recent_incoming_messages: ['Can you explain the change?', 'You never listen when I explain the issue.'],
    })

    await user.click(screen.getByRole('button', { name: 'Replace & Send' }))
    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, calmer))
    expect(composer.value).toBe('')
  })

  it('allows Send Anyway and cancels a hold with Escape', async () => {
    const user = userEvent.setup()
    const toneRoom = { ...room, direct: false }
    const draft = 'This message contains enough words to trigger the configured tone review.'
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [toneRoom], preferences: { [`room.tone_guard.${room.id}`]: true } })
    harness.service.CheckMessageTone.mockResolvedValue(JSON.stringify({
      is_hostile_or_unprofessional: true,
      severity: 'HIGH',
      tone_tags: ['insulting'],
      calmer_alternative: 'I see this differently; can we discuss it?'
    }))
    render(<App />)

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, draft)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    let warning = await screen.findByRole('alert', { name: 'Tone Guard warning' })
    fireEvent.keyDown(warning, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alert', { name: 'Tone Guard warning' })).toBeNull())
    expect(composer.value).toBe(draft)
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Send message' }))
    warning = await screen.findByRole('alert', { name: 'Tone Guard warning' })
    await user.click(within(warning).getByRole('button', { name: 'Send Anyway' }))
    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, draft))
  })

  it('accepts the calmer alternative with Enter and fails open when the local model errors', async () => {
    const user = userEvent.setup()
    const toneRoom = { ...room, direct: false }
    const draft = 'This message has enough words to trigger the tone review.'
    const calmer = 'Could we talk through this together?'
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [toneRoom], preferences: { [`room.tone_guard.${room.id}`]: true } })
    harness.service.CheckMessageTone
      .mockResolvedValueOnce(JSON.stringify({ is_hostile_or_unprofessional: true, severity: 'HIGH', tone_tags: [], calmer_alternative: calmer }))
      .mockRejectedValueOnce(new Error('local model unavailable'))
    render(<App />)

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, draft)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    const warning = await screen.findByRole('alert', { name: 'Tone Guard warning' })
    fireEvent.keyDown(warning, { key: 'Enter' })
    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, calmer))

    await user.type(composer, draft)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, draft))
    expect(screen.queryByRole('alert', { name: 'Tone Guard warning' })).toBeNull()
  })

  it('uses the configured time suggestions in the schedule dialog', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'schedule.suggestions_minutes': '10,30,180' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'send this later')
    await user.click(screen.getByRole('button', { name: 'Schedule message' }))
    const sendAt = screen.getByLabelText('Send at') as HTMLInputElement
    const previousDueAt = new Date(sendAt.value).getTime()
    await user.click(screen.getByRole('button', { name: '30 min' }))

    const updatedDueAt = new Date(sendAt.value).getTime()
    expect(updatedDueAt - previousDueAt).toBeGreaterThanOrEqual(24 * 60_000)
    expect(updatedDueAt - previousDueAt).toBeLessThan(26 * 60_000)
  })

  it('persists the system-default voice-note microphone selection', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Voice-note microphone' }), '')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('audio.input_device', ''))
  })

  it('lists available microphones and persists the selected input', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'audioinput', deviceId: 'mic-one', label: 'Desk microphone' },
          { kind: 'audiooutput', deviceId: 'speaker-one', label: 'Speakers' },
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const microphone = await screen.findByRole('combobox', { name: 'Voice-note microphone' })
    expect(within(microphone).getByRole('option', { name: 'Desk microphone' })).toBeTruthy()
    await user.selectOptions(microphone, 'mic-one')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('audio.input_device', 'mic-one'))
  })

  it('saves a validated editable schedule suggestion list', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const suggestions = screen.getByRole('textbox', { name: 'Schedule time suggestions' })
    await user.clear(suggestions)
    await user.type(suggestions, '10, 30, 180')
    await user.tab()

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('schedule.suggestions_minutes', '10,30,180'))
  })

  it('saves configurable default delays for reminders and scheduled sends', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'General' }))

    const sendDelay = screen.getByRole('spinbutton', { name: 'Default Send Later delay in minutes' })
    await user.clear(sendDelay)
    await user.type(sendDelay, '25')
    fireEvent.blur(sendDelay)
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('schedule.default_send_minutes', '25'))

    const reminderDelay = screen.getByRole('spinbutton', { name: 'Default Remind Later delay in minutes' })
    await user.clear(reminderDelay)
    await user.type(reminderDelay, '120')
    fireEvent.blur(reminderDelay)
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('schedule.default_reminder_minutes', '120'))
  })

  it('enables focused notifications through a positively worded setting', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'notifications.only_when_unfocused': true } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Notifications' }))

    const notifyWhileFocused = screen.getByRole('checkbox', { name: 'Notify while Pinger is focused' }) as HTMLInputElement
    expect(notifyWhileFocused.checked).toBe(false)
    await user.click(notifyWhileFocused)

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('notifications.only_when_unfocused', false))
  })

  it('requests native system authorization when notifications are enabled', async () => {
    const user = userEvent.setup()
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.RequestNotificationPermission.mockResolvedValue('granted')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'notifications.enabled': false } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Notifications' }))

    await user.click(screen.getByRole('checkbox', { name: 'Enable notifications' }))

    await waitFor(() => expect(harness.service.RequestNotificationPermission).toHaveBeenCalledTimes(1))
    expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('notifications.enabled', true)
  })

  it('opens macOS notification settings after native authorization is denied', async () => {
    const user = userEvent.setup()
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.RequestNotificationPermission.mockResolvedValue('denied')
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Notifications' }))

    await user.click(screen.getByRole('button', { name: 'Enable' }))

    await waitFor(() => expect(harness.service.RequestNotificationPermission).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(harness.service.OpenNotificationSettings).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy()
  })

  it('does not use browser permission as native notification permission', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
    try {
      const user = userEvent.setup()
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Settings' }))
      await user.click(screen.getByRole('tab', { name: 'Notifications' }))

      expect(await screen.findByText('Native notifications are unavailable. On macOS, launch the bundled Pinger.app; on Linux or Windows, use a desktop session with notifications enabled.')).toBeTruthy()
      expect(screen.queryByText('Blocked by the system')).toBeNull()
      expect((screen.getByRole('button', { name: 'Unavailable' }) as HTMLButtonElement).disabled).toBe(true)
      expect(harness.service.RequestNotificationPermission).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('previews the selected notification tone at the configured volume', async () => {
    const oscillator = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    }
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
    class MockAudioContext {
      currentTime = 1
      destination = {}
      createOscillator = vi.fn(() => oscillator)
      createGain = vi.fn(() => gain)
      resume = vi.fn().mockResolvedValue(undefined)
      close = vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('AudioContext', MockAudioContext)
    try {
      const user = userEvent.setup()
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Settings' }))
      await user.click(screen.getByRole('tab', { name: 'Notifications' }))
      await user.selectOptions(screen.getByRole('combobox', { name: 'Direct message tone' }), 'Pulse')

      await waitFor(() => expect(oscillator.start).toHaveBeenCalledTimes(1))
      expect(oscillator.type).toBe('square')
      expect(harness.service.SetStringPreference).toHaveBeenCalledWith('notifications.sound_direct', 'Pulse')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('schedules a reminder for a specific Matrix message', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'schedule.default_reminder_minutes': '120' } })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Set reminder for message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set reminder' })
    const remindAt = within(dialog).getByLabelText('Remind me at') as HTMLInputElement
    const defaultRemindAt = new Date(remindAt.value).getTime()
    expect(defaultRemindAt).toBeGreaterThanOrEqual(Date.now() + 119 * 60_000)
    expect(defaultRemindAt).toBeLessThanOrEqual(Date.now() + 121 * 60_000)
    expect(within(dialog).getByRole('checkbox', { name: 'Archive room after setting reminder' }).getAttribute('checked')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Set reminder' }))

    await waitFor(() => expect(harness.service.ScheduleReminder).toHaveBeenCalledWith(room.id, '$latest', '', expect.any(Number)))
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true)
  })

  it('archives the room after successfully setting a reminder when requested', async () => {
    const user = userEvent.setup()
    const unreadRoom = { ...room, unread: 1, lastEventId: '$latest' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [unreadRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Set reminder for message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set reminder' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Archive room after setting reminder' }))
    await user.click(within(dialog).getByRole('button', { name: 'Set reminder' }))

    await waitFor(() => {
      expect(harness.service.ScheduleReminder).toHaveBeenCalledWith(room.id, '$latest', '', expect.any(Number))
      expect(harness.service.MarkRead).toHaveBeenCalledWith(room.id, '$latest')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true)
    })
    expect(container.querySelector('.room-list .room-button')).toBeNull()
  })

  it('does not archive the room when setting a reminder fails', async () => {
    const user = userEvent.setup()
    harness.service.ScheduleReminder.mockRejectedValueOnce(new Error('schedule failed'))
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Set reminder for message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set reminder' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Archive room after setting reminder' }))
    await user.click(within(dialog).getByRole('button', { name: 'Set reminder' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('schedule failed')
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true)
  })

  it('cancels a pending job from the scheduled queue', async () => {
    const user = userEvent.setup()
    harness.service.ScheduledJobs.mockResolvedValue([{
      id: 'scheduled-1',
      kind: 'message',
      roomId: room.id,
      text: 'scheduled text',
      eventId: '',
      dueAt: Date.now() + 60_000,
      createdAt: Date.now(),
      status: 'pending',
      error: '',
    }])
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Scheduled messages and reminders' }))
    const dialog = await screen.findByRole('dialog', { name: 'Scheduled messages and reminders' })
    expect(within(dialog).getByText('scheduled text')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(harness.service.CancelScheduledJob).toHaveBeenCalledWith('scheduled-1'))
  })

  it('surfaces a due reminder and keeps it available in the queue', async () => {
    const user = userEvent.setup()
    const reminder = {
      id: 'reminder-1',
      kind: 'reminder',
      roomId: room.id,
      text: 'Stand up',
      eventId: '$latest',
      dueAt: Date.now() - 1_000,
      createdAt: Date.now() - 3_600_000,
      status: 'fired',
      error: '',
    }
    harness.service.ScheduledJobs.mockResolvedValue([reminder])
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    act(() => harness.eventHandlers.get('scheduler:reminder')?.({ data: reminder }))
    expect(await screen.findByText('Test room: Stand up')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'View reminders' }))
    const dialog = await screen.findByRole('dialog', { name: 'Scheduled messages and reminders' })

    expect(within(dialog).getByText('Stand up')).toBeTruthy()
    expect(within(dialog).getByText('Due now')).toBeTruthy()
  })

  it('schedules a reply with its original Matrix event target', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Reply to Alice' }))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Answer later')
    await user.click(screen.getByRole('button', { name: 'Schedule reply' }))
    const dialog = await screen.findByRole('dialog', { name: 'Schedule reply' })
    expect(within(dialog).getByText('Replying to Alice')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Schedule reply' }))

    await waitFor(() => expect(harness.service.ScheduleReply).toHaveBeenCalledWith(room.id, 'Answer later', '$latest', expect.any(Number)))
    expect(harness.service.ScheduleMessage).not.toHaveBeenCalled()
  })

  it('keeps message actions out of sight until the message is right-clicked', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    expect(container.querySelector('.message-actions')).toBeNull()

    openMessageMenu(container)
    const menu = await screen.findByRole('menu', { name: 'Message actions' })
    const target = container.querySelector('[data-event-id="$latest"]')
    expect(container.querySelector('.message-context-scrim')).not.toBeNull()
    expect(container.querySelectorAll('.message-context-scrim-panel')).toHaveLength(4)
    expect(target?.classList.contains('is-context-target')).toBe(true)
    expect(within(menu).getByRole('menuitem', { name: 'Reply to Alice' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Set reminder for message' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Add reaction' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Copy message' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Bookmark message' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Mark room as unread' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Copy message with timestamp' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Forward message' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull())
    expect(container.querySelector('.message-context-scrim')).toBeNull()
    expect(target?.classList.contains('is-context-target')).toBe(false)
  })

  it('opens message actions when right-clicking selected bubble text', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const body = container.querySelector<HTMLElement>('[data-event-id="$latest"] .message-body')
    if (!body) throw new Error('Message body did not render')
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(body)
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.contextMenu(body, { clientX: 48, clientY: 48 })

    expect(await screen.findByRole('menu', { name: 'Message actions' })).toBeTruthy()
  })

  it('marks a Matrix reply even when its original message preview is unavailable', async () => {
    const reply = { ...message('$reply', 'Reply text', 300), replyToEventId: '$missing-parent' }
    harness.service.History.mockResolvedValueOnce({ messages: [reply], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('Reply text')).toBeTruthy()
    const preview = container.querySelector('[data-event-id="$reply"] .reply-preview')
    expect(preview?.textContent).toContain('Original message unavailable')
  })

  it('persists a bookmark toggle for a message', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Bookmark message' }))

    const key = `message.bookmark.${encodeURIComponent(room.id)}.${encodeURIComponent('$latest')}`
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(key, true))
    openMessageMenu(container)
    expect(await screen.findByRole('menuitem', { name: 'Remove message bookmark' })).toBeTruthy()
  })

  it('marks the current room unread from the message menu', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Mark room as unread' }))

    await waitFor(() => expect(harness.service.MarkUnread).toHaveBeenCalledWith(room.id))
  })

  it('copies a message with a timestamp from the context menu', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Copy message with timestamp' }))

    const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(300))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`[${timestamp}] Alice: latest message`))
  })

  it('forwards a text message to another room', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Forward message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Forward message' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Forward destination' }), secondRoom.id)
    await user.click(within(dialog).getByRole('button', { name: 'Forward' }))

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(secondRoom.id, 'Forwarded from Alice:\n\nlatest message'))
  })

  it('disables text forwarding for media messages', async () => {
    harness.service.History.mockResolvedValue({
      messages: [{ ...message('$latest', 'image caption', 300), mediaUri: 'mxc://example.org/image', mediaType: 'm.image', mediaMime: 'image/png' }],
      before: '',
      hasMore: false,
    })
    const { container } = render(<App />)
    expect(await screen.findByText('image caption')).toBeTruthy()

    openMessageMenu(container)

    expect((await screen.findByRole('menuitem', { name: 'Forward message' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('copies a message with its timestamp when configured', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'clipboard.copy_timestamp': true } })
    const writeText = vi.fn().mockResolvedValue(undefined)
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    openMessageMenu(document.body)
    await user.click(screen.getByRole('menuitem', { name: 'Copy message' }))

    const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(300))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`[${timestamp}] Alice: latest message`))
  })
})
