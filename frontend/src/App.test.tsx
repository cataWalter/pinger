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
    RevealFile: vi.fn(),
    React: vi.fn(),
    RemoveReaction: vi.fn(),
    StartDirectChat: vi.fn(),
    AIComplete: vi.fn(),
    AICancel: vi.fn(),
    GenerateRoomImage: vi.fn(),
    SendRoomImage: vi.fn(),
    AIFeatureDefaults: vi.fn(),
    LocalAIChat: vi.fn(),
    ListLocalAIChats: vi.fn(),
    LoadLocalAIChatMessages: vi.fn(),
    CreateLocalAIChat: vi.fn(),
    GenerateLocalAIChatTitle: vi.fn(),
    AppendLocalAIChatMessage: vi.fn(),
    TruncateLocalAIChat: vi.fn(),
    SetLocalAIChatAgent: vi.fn(),
    RenameLocalAIChat: vi.fn(),
    DeleteLocalAIChat: vi.fn(),
    ListLocalAIChatFolders: vi.fn(),
    CreateLocalAIChatFolder: vi.fn(),
    RenameLocalAIChatFolder: vi.fn(),
    DeleteLocalAIChatFolder: vi.fn(),
    SetLocalAIChatFolder: vi.fn(),
    ExportLocalAIChat: vi.fn(),
    ChooseDownloadFolder: vi.fn(),
    ExportRoomChat: vi.fn(),
    CancelChatExport: vi.fn(),
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
    SetMenuState: vi.fn(),
  },
  tutorService: {
    Analyze: vi.fn(),
  },
}))

const clipboardSetText = vi.hoisted(() => vi.fn())

vi.mock('@wailsio/runtime', () => ({
  Clipboard: { SetText: clipboardSetText },
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
  LanguageTutorService: harness.tutorService,
}))

vi.mock('./MarkdownMessage', () => ({
  default: ({ body, className = 'message-body' }: { body: string; className?: string }) => {
    harness.markdownRenderCount++
    return <div className={className}>{body}</div>
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
  needsReply: false,
  lastEventId: '',
  lastEventSender: '',
  lastEventAt: 0,
  accountId: 'primary',
  bridge: '',
}

const secondRoom: Room = { ...room, id: '!second:example.org', name: 'Second room', unanswered: true, needsReply: true }

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
    harness.service.SaveMedia.mockResolvedValue('')
    harness.service.RevealFile.mockResolvedValue(undefined)
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
    harness.service.AICancel.mockResolvedValue(false)
    harness.service.GenerateRoomImage.mockResolvedValue('iVBORw0KGgo=')
    harness.service.SendRoomImage.mockResolvedValue(undefined)
    harness.service.AIFeatureDefaults.mockResolvedValue([])
    harness.service.ListLocalAIChats.mockResolvedValue([])
    harness.service.ListLocalAIChatFolders.mockResolvedValue([])
    harness.service.LoadLocalAIChatMessages.mockResolvedValue([])
    harness.service.LocalAIChat.mockResolvedValue('Hello from the local model.')
    harness.service.GenerateLocalAIChatTitle.mockResolvedValue('')
    harness.tutorService.Analyze.mockResolvedValue({
      detected_language: 'it',
      target_language: 'tr',
      explanation_language: 'it',
      original_text: 'Ciao, come stai?',
      corrected_text: 'Merhaba, nasılsın?',
      translation: 'Ciao, come stai?',
      has_grammar_errors: false,
      phrases: [
        { text: 'Merhaba,', meaning: 'hello,', words: [{ word: 'Merhaba', breakdown: 'merhaba -> ciao', meaning: 'hello' }] },
        { text: 'nasılsın?', meaning: 'how are you?', words: [{ word: 'nasılsın', breakdown: 'nasıl-sın -> come-sei', meaning: 'how are you' }] },
      ],
      grammar_rule: 'The second-person ending follows vowel harmony.',
      text_to_insert: 'Merhaba, nasılsın?',
    })
  })

  async function openSettingsTab(name: string) {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name }))
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

  it('groups AI features and prompt tuning under the AI tab', async () => {
    await openSettingsTab('AI')

    const prompts = await screen.findByRole('region', { name: 'AI prompts and tuning' })
    expect(within(prompts).getByRole('heading', { name: 'Writing and assistants' })).toBeTruthy()
    expect(prompts.querySelector('[data-ai-feature="explain"]')).not.toBeNull()
  })

  it('rejects an AI temperature below 0.6 without saving', async () => {
    const user = await openSettingsTab('AI')
    const prompts = await screen.findByRole('region', { name: 'AI prompts and tuning' })
    const card = prompts.querySelector<HTMLElement>('[data-ai-feature="explain"]')!
    const temperature = within(card).getByLabelText('Temperature')

    await user.clear(temperature)
    await user.type(temperature, '0.3')
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('Temperature must be a number from 0.6 to 2.')).toBeTruthy()
    expect(harness.service.SetStringPreference.mock.calls.filter(([key]) => String(key).startsWith('ai.feature.explain'))).toEqual([])
  })

  it('saves an AI temperature at the 0.6 minimum', async () => {
    const user = await openSettingsTab('AI')
    const prompts = await screen.findByRole('region', { name: 'AI prompts and tuning' })
    const card = prompts.querySelector<HTMLElement>('[data-ai-feature="explain"]')!
    const temperature = within(card).getByLabelText('Temperature')

    await user.clear(temperature)
    await user.type(temperature, '0.6')
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.feature.explain.temperature', '0.6'))
  })

  it('adds a chat agent from AI settings', async () => {
    const user = await openSettingsTab('AI')
    await user.click(await screen.findByRole('button', { name: 'Add agent' }))
    await user.type(screen.getByRole('textbox', { name: 'Agent name' }), 'Tutor')
    await user.type(screen.getByRole('textbox', { name: 'Agent instructions' }), 'Answer in short sentences.')
    await user.click(screen.getByRole('button', { name: 'Save agent' }))

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.local_agents', expect.stringContaining('"name":"Tutor"')))
  })

  it('saves the language to learn from AI settings', async () => {
    const user = await openSettingsTab('AI')

    await user.selectOptions(screen.getByLabelText('Language to learn'), 'de')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.tutor_language', 'de'))
    expect(await screen.findByText('Language to learn saved.')).toBeTruthy()
  })

  it('blocks choosing the default language as the language to learn', async () => {
    const user = await openSettingsTab('AI')
    const learning = screen.getByLabelText('Language to learn') as HTMLSelectElement

    await user.selectOptions(learning, 'en')

    expect(await screen.findByText('Choose two different languages.')).toBeTruthy()
    expect(learning.value).toBe('tr')
    expect(harness.service.SetStringPreference.mock.calls.filter(([key]) => key === 'ai.tutor_language')).toEqual([])
  })

  it('saves the default language and adds it to the known languages', async () => {
    const user = await openSettingsTab('AI')

    await user.selectOptions(screen.getByLabelText('Default language'), 'fr')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.default_language', 'fr'))
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.known_languages', '["en","fr"]'))
    expect(await screen.findByText('Default language saved.')).toBeTruthy()
  })

  it('saves the languages you know and keeps the default language checked', async () => {
    const user = await openSettingsTab('AI')
    const known = within(screen.getByRole('group', { name: 'Languages you know' }))

    expect((known.getByRole('checkbox', { name: 'English' }) as HTMLInputElement).disabled).toBe(true)
    await user.click(known.getByRole('checkbox', { name: 'Spanish' }))

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.known_languages', '["en","es"]'))
    expect(await screen.findByText('Known languages saved.')).toBeTruthy()
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

    await user.click(screen.getByLabelText(/Enable single-key shortcuts/))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('shortcuts.single_keys', false))
    expect(await screen.findByText(/Single-key shortcuts are off/)).toBeTruthy()
  })

  it('filters keyboard shortcuts by action and key combination', async () => {
    const user = await openSettingsTab('Keyboard')
    const search = screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' })

    await user.type(search, 'Language Tutor')
    expect(screen.getByText('Analyze draft with Language Tutor')).toBeTruthy()
    expect(screen.queryByText('Quick switch rooms')).toBeNull()

    await user.clear(search)
    await user.type(search, 'Ctrl / ⌘ + K')
    expect(screen.getByText('Quick switch rooms')).toBeTruthy()
    expect(screen.queryByText('Analyze draft with Language Tutor')).toBeNull()
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

    const formattingToolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    expect(within(formattingToolbar).getByRole('group', { name: 'Inline formatting' })).toBeTruthy()
    expect(within(formattingToolbar).getByRole('group', { name: 'Link insertion' })).toBeTruthy()
    expect(within(formattingToolbar).getByRole('group', { name: 'Block formatting' })).toBeTruthy()
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

  it('groups AI actions separately from message tools in the composer', async () => {
    render(<App />)
    await screen.findByRole('textbox', { name: 'Message' })

    const aiTools = screen.getByRole('group', { name: 'AI tools' })
    const messageTools = screen.getByRole('group', { name: 'Message tools' })
    const draftAssistance = within(aiTools).getByRole('group', { name: 'Draft assistance' })
    const conversationAnalysis = within(aiTools).getByRole('group', { name: 'Conversation analysis and translation' })
    const contentTools = within(messageTools).getByRole('group', { name: 'Add content' })
    const deliveryTools = within(messageTools).getByRole('group', { name: 'Delivery options' })
    expect(within(draftAssistance).getByRole('button', { name: 'Analyze draft with Language Tutor' })).toBeTruthy()
    expect(within(draftAssistance).getByRole('button', { name: 'Generate image from draft' })).toBeTruthy()
    expect(within(draftAssistance).getAllByRole('button')).toHaveLength(2)
    expect(within(conversationAnalysis).getByRole('button', { name: 'Summarize with Local AI' })).toBeTruthy()
    expect(within(conversationAnalysis).queryByRole('button', { name: 'Analyze chat topics' })).toBeNull()
    expect(within(conversationAnalysis).queryByRole('button', { name: 'Analyze conversation' })).toBeNull()
    expect(within(aiTools).queryByRole('button', { name: 'Attach file' })).toBeNull()
    expect(within(contentTools).getByRole('button', { name: 'Attach file' })).toBeTruthy()
    expect(within(contentTools).getByRole('button', { name: 'Emoji picker' })).toBeTruthy()
    expect(within(deliveryTools).getByRole('button', { name: 'Record voice note' })).toBeTruthy()
    expect(within(deliveryTools).getByRole('button', { name: 'Record video message' })).toBeTruthy()
    expect(within(deliveryTools).getByRole('button', { name: 'Schedule message' })).toBeTruthy()
  })

  it('generates an image from the draft, shows progress, and sends it only after approval', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.image.binary_path': '/opt/sd-server', 'ai.image.model_path': '/models/realistic.safetensors' } })
    harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
    let resolveImage: (encoded: string) => void = () => { }
    harness.service.GenerateRoomImage.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveImage = resolve }))
    render(<App />)
    await screen.findByText('Can you review this?')
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'a red fox')
    await user.click(screen.getByRole('button', { name: 'Generate image from draft' }))

    await waitFor(() => expect(harness.service.GenerateRoomImage).toHaveBeenCalledTimes(1))
    const [prompt, requestID] = harness.service.GenerateRoomImage.mock.calls[0] as [string, string]
    expect(prompt).toBe('a red fox')
    expect(requestID).toEqual(expect.any(String))
    act(() => harness.eventHandlers.get('local-ai:image-progress')?.({ data: { requestId: requestID, stage: 'generating', step: 3, totalSteps: 8 } }))
    expect(await screen.findByText('Generating image · step 3 of 8')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop image generation' })).toBeTruthy()

    await act(async () => resolveImage('iVBORw0KGgo='))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send generated image to this room?' })
    expect(within(dialog).getByRole('img', { name: 'Generated image preview' }).getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(harness.service.SendRoomImage).not.toHaveBeenCalled()
    expect(composer.value).toBe('a red fox')

    await user.click(within(dialog).getByRole('button', { name: 'Approve and send' }))
    await waitFor(() => expect(harness.service.SendRoomImage).toHaveBeenCalledWith(room.id, 'iVBORw0KGgo='))
    await waitFor(() => expect(composer.value).toBe(''))
    expect(screen.getByRole('button', { name: 'Generate image from draft' })).toBeTruthy()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('discards a generated image without sending it and keeps the draft', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.image.binary_path': '/opt/sd-server', 'ai.image.model_path': '/models/realistic.safetensors' } })
    harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
    render(<App />)
    await screen.findByText('Can you review this?')
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'a red fox')
    await user.click(screen.getByRole('button', { name: 'Generate image from draft' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Send generated image to this room?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Send generated image to this room?' })).toBeNull())
    expect(harness.service.SendRoomImage).not.toHaveBeenCalled()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(composer.value).toBe('a red fox')
    expect((screen.getByRole('button', { name: 'Generate image from draft' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('stops image generation from the composer and keeps the draft', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.image.binary_path': '/opt/sd-server', 'ai.image.model_path': '/models/realistic.safetensors' } })
    harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
    let rejectImage: (error: Error) => void = () => { }
    harness.service.GenerateRoomImage.mockImplementationOnce(() => new Promise<string>((_, reject) => { rejectImage = reject }))
    harness.service.AICancel.mockImplementationOnce(async () => {
      rejectImage(new Error('image generation stopped'))
      return true
    })
    render(<App />)
    await screen.findByText('Can you review this?')
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'a red fox')
    await user.click(screen.getByRole('button', { name: 'Generate image from draft' }))

    await waitFor(() => expect(harness.service.GenerateRoomImage).toHaveBeenCalledTimes(1))
    const requestID = harness.service.GenerateRoomImage.mock.calls[0][1]
    await user.click(await screen.findByRole('button', { name: 'Stop image generation' }))

    expect(harness.service.AICancel).toHaveBeenCalledWith(requestID)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate image from draft' })).toBeTruthy())
    expect(composer.value).toBe('a red fox')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendRoomImage).not.toHaveBeenCalled()
  })

  it('records a video message and uploads it with the video-message flag', async () => {
    const user = userEvent.setup()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    class FakeMediaRecorder {
      static isTypeSupported = (type: string) => type === 'video/webm'
      state: 'inactive' | 'recording' = 'inactive'
      mimeType: string
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      constructor(_stream: MediaStream, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? 'video/webm'
      }
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['video bytes'], { type: 'video/webm' }) })
        this.onstop?.()
      }
    }
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Record video message' }))
      await user.click(await screen.findByRole('button', { name: 'Stop and send video message' }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve and send' }))

      await waitFor(() => expect(uploadFetch).toHaveBeenCalledWith(expect.stringContaining('videoMessage=true'), expect.objectContaining({ method: 'POST' })))
      expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything(), audio: true }))
      const uploadURL = String(uploadFetch.mock.calls.find(([input]) => String(input).includes('/media/ipc/attachment/'))?.[0])
      expect(uploadURL).toContain('voiceNote=false')
      const uploadQuery = new URL(uploadURL, 'http://localhost').searchParams
      expect(uploadQuery.get('videoMessage')).toBe('true')
      expect(Number(uploadQuery.get('durationMs'))).toBeGreaterThan(0)
      expect(Number(uploadQuery.get('durationMs'))).toBeLessThanOrEqual(3 * 60 * 1000)
      const uploadRequest = uploadFetch.mock.calls.find(([input]) => String(input).includes('/media/ipc/attachment/'))?.[1]
      expect((uploadRequest?.headers as Record<string, string>)['Content-Type']).toBe('video/webm')
      expect(track.stop).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('records a voice note and uploads WAV audio with duration metadata', async () => {
    const user = userEvent.setup()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const audioBuffer = {
      duration: 0.25,
      length: 2,
      numberOfChannels: 1,
      sampleRate: 8000,
      getChannelData: () => Float32Array.of(0.25, -0.25),
    } as unknown as AudioBuffer
    class FakeAudioContext {
      decodeAudioData = vi.fn(async () => audioBuffer)
      close = vi.fn(async () => undefined)
    }
    class FakeMediaRecorder {
      state: 'inactive' | 'recording' = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      constructor() { }
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['audio bytes'], { type: this.mimeType }) })
        this.onstop?.()
      }
    }
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Record voice note' }))
      await user.click(await screen.findByRole('button', { name: 'Stop and send voice note' }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve and send' }))

      await waitFor(() => expect(uploadFetch).toHaveBeenCalledWith(expect.stringContaining('voiceNote=true'), expect.objectContaining({ method: 'POST' })))
      const [uploadURL, request] = uploadFetch.mock.calls.find(([input]) => String(input).includes('/media/ipc/attachment/')) ?? []
      expect(String(uploadURL)).toContain('durationMs=250')
      expect((request?.headers as Record<string, string>)['Content-Type']).toBe('audio/wav')
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
      expect(track.stop).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stages a pasted clipboard image and uploads it only when sent', async () => {
    const user = userEvent.setup()
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const screenshot = new File([Uint8Array.of(137, 80, 78, 71)], '', { type: 'image/png' })
    URL.createObjectURL = vi.fn(() => 'blob:pasted-image')
    URL.revokeObjectURL = vi.fn()
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      const composer = await screen.findByRole('textbox', { name: 'Message' })
      fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }], files: [] } })

      expect(await screen.findByText(/^pasted-image-.*\.png$/)).toBeTruthy()
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)

      await user.click(screen.getByRole('button', { name: 'Send message' }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve and send' }))

      await waitFor(() => expect(uploadFetch).toHaveBeenCalledWith(expect.stringContaining('/media/ipc/attachment/'), expect.objectContaining({ method: 'POST' })))
      const [uploadURL, request] = uploadFetch.mock.calls.find(([input]) => String(input).includes('/media/ipc/attachment/')) ?? []
      expect(new URL(String(uploadURL), 'http://localhost').searchParams.get('filename')).toMatch(/^pasted-image-.*\.png$/)
      expect((request?.body as Uint8Array).byteLength).toBe(4)
      await waitFor(() => expect(screen.queryByText(/^pasted-image-/)).toBeNull())
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('keeps a staged image in the composer when its send approval is cancelled', async () => {
    const user = userEvent.setup()
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const screenshot = new File([Uint8Array.of(137, 80, 78, 71)], '', { type: 'image/png' })
    URL.createObjectURL = vi.fn(() => 'blob:pasted-image')
    URL.revokeObjectURL = vi.fn()
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      const composer = await screen.findByRole('textbox', { name: 'Message' })
      fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }], files: [] } })
      expect(await screen.findByText(/^pasted-image-.*\.png$/)).toBeTruthy()

      await user.click(screen.getByRole('button', { name: 'Send message' }))

      const approval = await screen.findByRole('alertdialog', { name: 'Send media to this room?' })
      expect(within(approval).getByText(/^pasted-image-.*\.png$/)).toBeTruthy()
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)

      await user.click(within(approval).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(screen.getByText(/^pasted-image-.*\.png$/)).toBeTruthy()
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)
      expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('discards a recorded voice note when its send approval is cancelled', async () => {
    const user = userEvent.setup()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const audioBuffer = {
      duration: 0.25,
      length: 2,
      numberOfChannels: 1,
      sampleRate: 8000,
      getChannelData: () => Float32Array.of(0.25, -0.25),
    } as unknown as AudioBuffer
    class FakeAudioContext {
      decodeAudioData = vi.fn(async () => audioBuffer)
      close = vi.fn(async () => undefined)
    }
    class FakeMediaRecorder {
      state: 'inactive' | 'recording' = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      constructor() { }
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['audio bytes'], { type: this.mimeType }) })
        this.onstop?.()
      }
    }
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Record voice note' }))
      await user.click(await screen.findByRole('button', { name: 'Stop and send voice note' }))

      const approval = await screen.findByRole('alertdialog', { name: 'Send media to this room?' })
      expect(within(approval).getByText(/^voice-note-.*\.wav$/)).toBeTruthy()
      await user.click(within(approval).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)
      expect(track.stop).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('removes a staged pasted image without uploading it', async () => {
    const user = userEvent.setup()
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const screenshot = new File([Uint8Array.of(137, 80, 78, 71)], '', { type: 'image/png' })
    URL.createObjectURL = vi.fn(() => 'blob:pasted-image')
    URL.revokeObjectURL = vi.fn()
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      const composer = await screen.findByRole('textbox', { name: 'Message' })
      fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }], files: [] } })

      await user.click(await screen.findByRole('button', { name: /^Remove pasted-image-.*\.png$/ }))

      await waitFor(() => expect(screen.queryByText(/^pasted-image-/)).toBeNull())
      expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('reports a pasted clipboard image that has no bytes instead of uploading it', async () => {
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const emptyScreenshot = new File([], '', { type: 'image/png' })
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      const composer = await screen.findByRole('textbox', { name: 'Message' })
      fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => emptyScreenshot }], files: [] } })

      expect(await screen.findByText(/The pasted image could not be read/)).toBeTruthy()
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
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
    snippetDownloadClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { })

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
    harness.service.ListLocalAIChats.mockResolvedValue([])
    harness.service.ListLocalAIChatFolders.mockResolvedValue([])
    harness.service.LoadLocalAIChatMessages.mockResolvedValue([])
    harness.service.LocalAIChat.mockResolvedValue('Hello from the local model.')
    harness.service.GenerateLocalAIChatTitle.mockResolvedValue('')
    harness.tutorService.Analyze.mockResolvedValue({
      detected_language: 'it',
      target_language: 'tr',
      explanation_language: 'it',
      original_text: 'Ciao, come stai?',
      corrected_text: 'Merhaba, nasılsın?',
      translation: 'Ciao, come stai?',
      has_grammar_errors: false,
      phrases: [
        { text: 'Merhaba,', meaning: 'hello,', words: [{ word: 'Merhaba', breakdown: 'merhaba -> ciao', meaning: 'hello' }] },
        { text: 'nasılsın?', meaning: 'how are you?', words: [{ word: 'nasılsın', breakdown: 'nasıl-sın -> come-sei', meaning: 'how are you' }] },
      ],
      grammar_rule: 'The second-person ending follows vowel harmony.',
      text_to_insert: 'Merhaba, nasılsın?',
    })
    harness.service.TestAIEndpoint.mockResolvedValue(undefined)
    harness.service.ChooseDownloadFolder.mockResolvedValue('')
    harness.service.ExportRoomChat.mockResolvedValue({ path: '', messages: 0, media: 0, mediaFailed: 0 })
    harness.service.CancelChatExport.mockResolvedValue(false)

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
    expect((screen.getByRole('button', { name: 'Summarize with Local AI' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Analyze chat topics' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Analyze conversation' })).toBeNull()
  })

  it('keeps only the Local AI summary action among the room analysis buttons', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Summarize with Local AI' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Analyze chat topics' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Analyze conversation' })).toBeNull()
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
    const utilities = screen.getByRole('group', { name: 'Conversation utilities' })
    expect(within(utilities).getByRole('button', { name: 'Media gallery' })).toBeTruthy()
    const roomControls = screen.getByRole('group', { name: 'Room controls' })
    const roomDetails = screen.getByRole('group', { name: 'Room details' })
    const favoriteButton = within(roomControls).getByRole('button', { name: /Favorites/ })
    expect(favoriteButton.parentElement?.getAttribute('data-tooltip')).toBe(favoriteButton.getAttribute('aria-label'))
    expect(within(roomDetails).getByRole('button', { name: 'Room details' }).parentElement?.getAttribute('data-tooltip')).toBe('Room details')
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

  it('does not show background sync errors as a banner', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await act(async () => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [room],
          changedRoomId: [],
          timelineChangedRoomId: [],
          typingUsers: { [room.id]: [] },
          notifications: [],
          error: 'request error: http2: server sent GOAWAY and closed the connection',
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'offline',
        },
      })
      await Promise.resolve()
    })

    expect(screen.queryByText(/GOAWAY/)).toBeNull()
  })

  it('shows an offline notice when the browser loses its network connection', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const offlineNotice = 'No internet connection. Pinger will reconnect automatically.'

    try {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
      await act(async () => {
        window.dispatchEvent(new Event('offline'))
      })
      expect(screen.getByText(offlineNotice)).toBeTruthy()

      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
      await act(async () => {
        window.dispatchEvent(new Event('online'))
      })
      expect(screen.queryByText(offlineNotice)).toBeNull()
    } finally {
      delete (window.navigator as { onLine?: boolean }).onLine
    }
  })

  it('shows a server notice only after sync stays offline and clears it when sync recovers', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const serverNotice = "Can't reach the Matrix server. Retrying…"
    const emitConnectionState = async (connectionState: string) => {
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
            connectionState,
          },
        })
        await Promise.resolve()
      })
    }

    vi.useFakeTimers()
    try {
      await emitConnectionState('offline')
      act(() => vi.advanceTimersByTime(4_999))
      expect(screen.queryByText(serverNotice)).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByText(serverNotice)).toBeTruthy()

      await emitConnectionState('connected')
      expect(screen.queryByText(serverNotice)).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
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

  it('offers the Language Tutor in the message menu instead of a separate translation', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)

    expect(await screen.findByRole('menuitem', { name: 'Analyze message with Language Tutor' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Translate message with local AI' })).toBeNull()
  })

  it('analyzes an outgoing draft and replaces it with ready-to-send tutor-language text', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await user.click(screen.getByRole('button', { name: 'Analyze draft with Language Tutor' }))

    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Ciao, come stai?', 'draft', 'en', expect.any(String))
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

    await waitFor(() => expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Ben iyiyim.', 'draft', 'en', expect.any(String)))
    expect(await screen.findByRole('dialog', { name: 'Tutor this draft' })).toBeTruthy()
  })

  it('opens the read-only Language Tutor analysis from a message context menu', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Analyze message with Language Tutor' }))

    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('latest message', 'message', 'en', expect.any(String))
    const dialog = await screen.findByRole('dialog', { name: 'Analyze message' })
    expect(await within(dialog).findByText('The second-person ending follows vowel harmony.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Replace draft with Turkish' })).toBeNull()
  })

  it('labels the Language Tutor dialog with the selected languages', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434', 'ai.tutor_language': 'es', 'ai.default_language': 'en' },
    })
    harness.tutorService.Analyze.mockResolvedValueOnce({
      detected_language: 'en',
      target_language: 'es',
      explanation_language: 'en',
      original_text: 'Hello, how are you?',
      corrected_text: 'Hola, ¿cómo estás?',
      translation: 'Hello, how are you?',
      has_grammar_errors: false,
      phrases: [{ text: 'Hola, ¿cómo estás?', meaning: 'how are you?', words: [{ word: 'estás', breakdown: 'estar + ás', meaning: 'you are' }] }],
      grammar_rule: 'Estar conjugates for the second person.',
      text_to_insert: 'Hola, ¿cómo estás?',
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hello, how are you?' } })
    await user.click(screen.getByRole('button', { name: 'Analyze draft with Language Tutor' }))

    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Hello, how are you?', 'draft', 'en', expect.any(String))
    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    expect(await within(dialog).findByText('CORRECTED · SPANISH')).toBeTruthy()
    expect(within(dialog).getByText('ORIGINAL · ENGLISH')).toBeTruthy()
    expect(dialog.querySelector('p[lang="es"]')?.textContent).toBe('Hola, ¿cómo estás?')
    expect(within(dialog).getByRole('button', { name: 'Replace draft with Spanish' })).toBeTruthy()
  })

  it('translates messages received after your last message and skips own and redacted messages', async () => {
    const user = userEvent.setup()
    const timeline = [
      message('$before-own', 'Eski mesaj', 100),
      { ...message('$own-latest', 'My latest message', 200), own: true, sender: snapshot.profile.userId },
      message('$received-first', 'Günaydın', 300),
      { ...message('$received-redacted', 'Silinmiş mesaj', 350), redacted: true },
      message('$received-second', 'Nasılsın?', 400),
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: timeline, before: 80, hasMore: true })
    harness.tutorService.Analyze.mockImplementation(async (body: string) => ({ translation: body === 'Günaydın' ? 'Good morning' : 'How are you?' }))

    const { container } = render(<App />)
    expect(await screen.findByText('Günaydın')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Translate messages received since your last message to English' }))

    await screen.findByText('Good morning')
    await screen.findByText('How are you?')
    expect(harness.tutorService.Analyze.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['Günaydın', 'message', 'en'],
      ['Nasılsın?', 'message', 'en'],
    ])
    expect(container.querySelector('[data-event-id="$received-first"] .message-translation')?.textContent).toContain('Good morning')
    expect(container.querySelector('[data-event-id="$received-second"] .message-translation')?.textContent).toContain('How are you?')
    expect(container.querySelector('[data-event-id="$before-own"] .message-translation')).toBeNull()
    expect(container.querySelector('[data-event-id="$own-latest"] .message-translation')).toBeNull()
    expect(container.querySelector('[data-event-id="$received-redacted"] .message-translation')).toBeNull()
    expect(harness.service.History.mock.calls.filter(([, before]) => before !== 0)).toEqual([])
    expect(harness.service.AIComplete).not.toHaveBeenCalled()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('translates every incoming message after your last message without a fixed cap', async () => {
    const user = userEvent.setup()
    const timeline = [
      { ...message('$own-latest', 'my message', 100), own: true, sender: snapshot.profile.userId },
      ...Array.from({ length: 12 }, (_, index) => message(`$received-${index + 1}`, `received message ${index + 1}`, 200 + index)),
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: timeline, before: 80, hasMore: true })
    harness.tutorService.Analyze.mockImplementation(async (body: string) => ({ translation: `Translated ${body}` }))

    const { container } = render(<App />)
    expect(await screen.findByText('received message 12')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Translate messages received since your last message to English' }))

    await waitFor(() => expect(container.querySelector('[data-event-id="$received-12"] .message-translation')?.textContent).toContain('Translated received message 12'))
    expect(harness.tutorService.Analyze).toHaveBeenCalledTimes(12)
    expect(container.querySelector('[data-event-id="$own-latest"] .message-translation')).toBeNull()
  })

  it('loads older history only until your last message and translates what follows it', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => before === 0
      ? { messages: [message('$received-late', 'late received', 300)], before: 80, hasMore: true }
      : {
        messages: [
          message('$outside', 'outside received', 50),
          { ...message('$own-older', 'my older message', 200), own: true, sender: snapshot.profile.userId },
          message('$received-older', 'older received', 250),
        ],
        before: 40,
        hasMore: true,
      })
    harness.tutorService.Analyze.mockImplementation(async (body: string) => ({ translation: `EN ${body}` }))

    const { container } = render(<App />)
    expect(await screen.findByText('late received')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Translate messages received since your last message to English' }))

    await screen.findByText('EN late received')
    expect(harness.service.History.mock.calls.filter(([, before]) => before !== 0)).toEqual([[room.id, 80]])
    expect(harness.tutorService.Analyze.mock.calls.map((call) => call[0])).toEqual(['older received', 'late received'])
    expect(container.querySelector('[data-event-id="$received-older"] .message-translation')?.textContent).toContain('EN older received')
    expect(container.querySelector('[data-event-id="$outside"] .message-translation')).toBeNull()
    expect(container.querySelector('[data-event-id="$own-older"] .message-translation')).toBeNull()
  })

  it('explains when no incoming messages follow your last message', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [{ ...message('$own-latest', 'My latest message', 300), own: true, sender: snapshot.profile.userId }], before: 0, hasMore: false })

    render(<App />)
    expect(await screen.findByText('My latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Translate messages received since your last message to English' }))

    expect(await screen.findByText(/There are no incoming text messages since your last message/)).toBeTruthy()
    expect(harness.tutorService.Analyze).not.toHaveBeenCalled()
  })

  it('shows the Language Tutor analysis for each translated message', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$received-turkish', 'Nasılsın?', 300)], before: 0, hasMore: false })
    harness.tutorService.Analyze.mockResolvedValueOnce({
      detected_language: 'tr',
      target_language: 'tr',
      explanation_language: 'en',
      original_text: 'Nasılsın?',
      corrected_text: 'Nasılsın?',
      translation: 'How are you?',
      has_grammar_errors: false,
      error_explanation: '',
      phrases: [{ text: 'Nasılsın?', meaning: 'how are you (informal)', words: [{ word: 'Nasılsın?', breakdown: 'nasıl-sın -> come-sei', meaning: 'how are you' }] }],
      grammar_rule: 'The second-person ending follows vowel harmony.',
      text_to_insert: '',
    })

    const { container } = render(<App />)
    expect(await screen.findByText('Nasılsın?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Translate messages received since your last message to English' }))

    await waitFor(() => expect(container.querySelector('[data-event-id="$received-turkish"] .message-translation')?.textContent).toContain('How are you?'))
    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Nasılsın?', 'message', 'en', expect.any(String))
    const translation = container.querySelector<HTMLElement>('[data-event-id="$received-turkish"] .message-translation')
    expect(translation).toBeTruthy()
    expect(within(translation as HTMLElement).getByText('WORD-BY-WORD')).toBeTruthy()
    expect((translation as HTMLElement).querySelectorAll('.language-tutor-phrase')).toHaveLength(1)
    expect(within(translation as HTMLElement).getByText('how are you (informal)')).toBeTruthy()
    expect(within(translation as HTMLElement).getByText('nasıl-sın -> come-sei')).toBeTruthy()
    expect(within(translation as HTMLElement).getByText('GRAMMAR RULE')).toBeTruthy()
    expect(within(translation as HTMLElement).getByText('The second-person ending follows vowel harmony.')).toBeTruthy()
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

  it('streams an AI answer into the panel before the request resolves', async () => {
    const user = userEvent.setup()
    let finishRequest: (reply: string) => void = () => { }
    harness.service.AIComplete.mockImplementationOnce(() => new Promise<string>((resolve) => { finishRequest = resolve }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'unrelated earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Explain message with local AI' }))
    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    const requestID = harness.service.AIComplete.mock.calls[0][1]
    expect(requestID).toEqual(expect.any(String))
    const dialog = await screen.findByRole('dialog', { name: 'Explain message' })

    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: 'This is ' } }))
    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: 'streamed.' } }))
    await within(dialog).findByText('This is streamed.')
    expect(within(dialog).getByRole('button', { name: 'Stop' })).toBeTruthy()

    act(() => finishRequest('This is streamed.'))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Regenerate' })).toBeTruthy())
    expect(within(dialog).queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(within(dialog).getByText('This is streamed.')).toBeTruthy()
  })

  it('stops a streaming answer, keeps the partial text, and offers Regenerate', async () => {
    const user = userEvent.setup()
    let rejectRequest: (error: Error) => void = () => { }
    harness.service.AIComplete.mockImplementationOnce(() => new Promise<string>((_, reject) => { rejectRequest = reject }))
    harness.service.AICancel.mockImplementationOnce(async () => {
      rejectRequest(new Error('request cancelled'))
      return true
    })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'unrelated earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Explain message with local AI' }))
    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    const requestID = harness.service.AIComplete.mock.calls[0][1]
    const dialog = await screen.findByRole('dialog', { name: 'Explain message' })

    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: 'Partial answer' } }))
    await within(dialog).findByText('Partial answer')
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }))

    expect(harness.service.AICancel).toHaveBeenCalledWith(requestID)
    await within(dialog).findByText('Generation stopped. The text above may be incomplete.')
    expect(within(dialog).getByText('Partial answer')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Regenerate' })).toBeTruthy()
  })

  it('sends a follow-up with the earlier answer as context', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValueOnce('This is an explanation.').mockResolvedValueOnce('It explains the message briefly.')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'unrelated earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Explain message with local AI' }))
    const dialog = await screen.findByRole('dialog', { name: 'Explain message' })
    await within(dialog).findByText('This is an explanation.')

    await user.type(within(dialog).getByRole('textbox', { name: 'Follow-up question' }), 'Make it shorter')
    await user.click(within(dialog).getByRole('button', { name: 'Send follow-up' }))

    await within(dialog).findByText('It explains the message briefly.')
    expect(harness.service.AIComplete).toHaveBeenCalledTimes(2)
    const followUpRequest = harness.service.AIComplete.mock.calls[1][0]
    expect(followUpRequest).toHaveLength(4)
    expect(followUpRequest[2]).toEqual({ role: 'assistant', content: 'This is an explanation.' })
    expect(followUpRequest[3]).toEqual({ role: 'user', content: 'Make it shorter' })
  })

  it('saves per-room agent profiles and default chat agent', async () => {
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
  })

  it('exports the room chat to a chosen folder with progress and reveals the result', async () => {
    const user = userEvent.setup()
    const exportPath = '/tmp/exports/Test room chat 2026-01-01 1200/chat.html'
    let finishExport: (result: { path: string; messages: number; media: number; mediaFailed: number }) => void = () => { }
    harness.service.ChooseDownloadFolder.mockResolvedValue('/tmp/exports')
    harness.service.ExportRoomChat.mockReturnValue(new Promise((resolve) => { finishExport = resolve }))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Export chat' }))
    await waitFor(() => expect(harness.service.ExportRoomChat).toHaveBeenCalledWith(room.id, '/tmp/exports'))
    await waitFor(() => expect(harness.eventHandlers.has('chat-export:progress')).toBe(true))

    act(() => {
      harness.eventHandlers.get('chat-export:progress')?.({ data: { roomId: room.id, stage: 'media', messages: 3, mediaDone: 1, mediaTotal: 2 } })
    })
    expect(await screen.findByText('Saving media 1 of 2')).toBeTruthy()

    await act(async () => finishExport({ path: exportPath, messages: 3, media: 2, mediaFailed: 0 }))
    expect(await screen.findByText(/Exported 3 messages and 2 media files/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show in file manager' }))
    expect(harness.service.RevealFile).toHaveBeenCalledWith(exportPath)
  })

  it('cancels a running room chat export and reports the failure', async () => {
    const user = userEvent.setup()
    let abortExport: (reason: Error) => void = () => { }
    harness.service.ChooseDownloadFolder.mockResolvedValue('/tmp/exports')
    harness.service.ExportRoomChat.mockReturnValue(new Promise((_resolve, reject) => { abortExport = reject }))
    harness.service.CancelChatExport.mockImplementation(async () => {
      abortExport(new Error('chat export was cancelled'))
      return true
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Export chat' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel export' }))

    expect(harness.service.CancelChatExport).toHaveBeenCalledTimes(1)
    expect((await screen.findByRole('alert')).textContent).toContain('chat export was cancelled')
    expect(screen.getByRole('button', { name: 'Export chat' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Cancel export' })).toBeNull()
  })

  it('does not start an export when the folder picker is dismissed', async () => {
    const user = userEvent.setup()
    harness.service.ChooseDownloadFolder.mockResolvedValue('')
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Export chat' }))

    await waitFor(() => expect(harness.service.ChooseDownloadFolder).toHaveBeenCalledTimes(1))
    expect(harness.service.ExportRoomChat).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Cancel export' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
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

  it('opens a Local AI summary chat with an editable full-conversation prompt', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => before === 0
      ? { messages: [message('$latest', 'latest message', 300)], before: 50, hasMore: true }
      : { messages: [message('$older', 'older history', 100)], before: 0, hasMore: false })
    harness.service.CreateLocalAIChat.mockResolvedValue({ id: 'summary-chat', title: '', agentId: '', updatedAt: 1 })
    harness.service.AppendLocalAIChatMessage.mockImplementation(async (_chatID: string, saved: object) => ({ ...saved, seq: 1, createdAt: 1 }))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Summarize with Local AI' }))
    expect(await screen.findByRole('heading', { name: 'Local AI' })).toBeTruthy()
    const draft = screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(draft.value).toContain('Alice: older history'))
    expect(draft.value).toContain('Summarize')
    expect(draft.value).toContain('Alice: latest message')
    expect(draft.value.indexOf('Alice: older history')).toBeLessThan(draft.value.indexOf('Alice: latest message'))
    expect(harness.service.History).toHaveBeenCalledWith(room.id, 50)
    expect(harness.service.CreateLocalAIChat).not.toHaveBeenCalled()
    expect(harness.service.LocalAIChat).not.toHaveBeenCalled()

    const editedDraft = `${draft.value}\nAlso note the dates mentioned.`
    fireEvent.change(draft, { target: { value: editedDraft } })
    expect(draft.value).toBe(editedDraft)
    await user.click(screen.getByRole('button', { name: 'Send to local AI' }))
    await waitFor(() => expect(harness.service.LocalAIChat).toHaveBeenCalled())
    expect(harness.service.CreateLocalAIChat).toHaveBeenCalledWith('', 'summary')
    expect(harness.service.AppendLocalAIChatMessage).toHaveBeenCalledWith('summary-chat', expect.objectContaining({ role: 'user', content: editedDraft }))
    expect(harness.service.LocalAIChat).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ role: 'user', content: editedDraft })],
    }))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.AIComplete).not.toHaveBeenCalled()
  })

  it('saves the AI endpoint and reports whether the model is ready', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.TestAIEndpoint.mockRejectedValueOnce(new Error('AI model is still loading'))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'AI' }))

    await user.click(screen.getByRole('button', { name: 'Test endpoint' }))
    expect(await screen.findByText('AI model is still loading')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Test endpoint' }))
    expect(await screen.findByText('Model is loaded and ready.')).toBeTruthy()

    const endpoint = screen.getByLabelText('Endpoint')
    await user.clear(endpoint)
    await user.type(endpoint, 'http://localhost:9090')
    expect((screen.getByRole('button', { name: 'Test endpoint' }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Transcription model (optional)'), 'whisper-test')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model thinking level' }), 'high')

    const aiForm = endpoint.closest('form') as HTMLElement
    await user.click(within(aiForm).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.endpoint', 'http://localhost:9090'))
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.thinking_level', 'high')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.transcription_model', 'whisper-test')
  })

  it('saves image generation settings under the ai.image preference keys', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'AI' }))

    const imageForm = screen.getByRole('form', { name: 'Image generation settings' })
    await user.type(within(imageForm).getByRole('textbox', { name: 'Image engine binary' }), '/usr/local/bin/sd-server')
    await user.type(within(imageForm).getByRole('textbox', { name: 'Image model checkpoint' }), '/models/sd.safetensors')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image engine idle timeout' }), '10')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image size' }), '768x512')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image steps' }), '8')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image guidance scale' }), '1')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image sampler' }), 'lcm')
    await user.type(within(imageForm).getByRole('textbox', { name: 'Default negative prompt' }), 'blurry')
    await user.click(within(imageForm).getByRole('button', { name: 'Save image settings' }))

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.binary_path', '/usr/local/bin/sd-server'))
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.model_path', '/models/sd.safetensors')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.idle_minutes', '10')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.size', '768x512')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.steps', '8')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.cfg_scale', '1')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.sampler', 'lcm')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.negative_prompt', 'blurry')
    expect(await within(imageForm).findByText('Image settings saved.')).toBeTruthy()
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

  it('removes your own reaction when its chip is clicked', async () => {
    const user = userEvent.setup()
    harness.service.React.mockClear()
    harness.service.RemoveReaction.mockClear()
    harness.service.History.mockResolvedValue({
      messages: [{ ...message('$latest', 'latest message', 300), reactions: { '👍': 1 }, reacted: { '👍': true } }],
      before: 0,
      hasMore: false,
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const chip = screen.getByRole('button', { name: 'Remove 👍 reaction' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await user.click(chip)
    await waitFor(() => expect(harness.service.RemoveReaction).toHaveBeenCalledWith(room.id, '$latest', '👍'))
    expect(harness.service.React).not.toHaveBeenCalled()
  })

  it('adds a reaction when a chip you have not set is clicked', async () => {
    const user = userEvent.setup()
    harness.service.React.mockClear()
    harness.service.RemoveReaction.mockClear()
    harness.service.History.mockResolvedValue({
      messages: [{ ...message('$latest', 'latest message', 300), reactions: { '👍': 1 }, reacted: {} }],
      before: 0,
      hasMore: false,
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Add 👍 reaction' }))
    await waitFor(() => expect(harness.service.React).toHaveBeenCalledWith(room.id, '$latest', '👍'))
    expect(harness.service.RemoveReaction).not.toHaveBeenCalled()
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

  it('keeps group chats out of Unanswered and Needs reply except Instagram', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Study group', direct: false, unanswered: true, needsReply: true }
    const instagramGroup: Room = { ...room, id: '!instagram-group:example.org', name: 'Instagram group', direct: false, bridge: 'IG', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, group, instagramGroup] })
    render(<App />)

    await screen.findByText('latest message')
    const roomList = screen.getByRole('navigation', { name: 'Rooms' })
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')?.textContent).toBe('1')
    expect(within(roomList).getByRole('button', { name: /Study group/ }).querySelector('.needs-reply-dot')).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Instagram group/ }).querySelector('.needs-reply-dot')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))
    expect(within(roomList).queryByRole('button', { name: /Study group/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Instagram group/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))

    await user.click(screen.getByRole('button', { name: 'Needs reply' }))
    expect(within(roomList).queryByRole('button', { name: /Study group/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Instagram group/ })).toBeTruthy()
  })

  it('composes room, needs reply, favorites, and search filters', async () => {
    const user = userEvent.setup()
    const favoriteDirect = { ...secondRoom, name: 'Favorite direct', unread: 2, favorite: true }
    const favoriteGroup: Room = { ...room, id: '!group:example.org', name: 'Favorite project', direct: false, favorite: true, unread: 1, unanswered: true, needsReply: true }
    const favoriteInstagramDM: Room = { ...room, id: '!instagram:example.org', name: 'Favorite Instagram DM', bridge: 'IG', direct: false, favorite: true, unanswered: true, needsReply: true }
    const unreadDirect: Room = { ...room, id: '!unread:example.org', name: 'Unread direct', unread: 1 }
    const markedUnreadRoom: Room = { ...room, id: '!marked-unread:example.org', name: 'Marked unread', markedUnread: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, favoriteDirect, favoriteGroup, favoriteInstagramDM, unreadDirect, markedUnreadRoom] })
    render(<App />)

    await screen.findByText('latest message')
    const roomList = screen.getByRole('navigation', { name: 'Rooms' })
    const unansweredFilter = screen.getByRole('button', { name: 'Unanswered rooms' })
    expect(unansweredFilter.querySelector('.filter-count')).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite project/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ }).querySelector('.needs-reply-dot')).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite project/ }).querySelector('.needs-reply-dot')).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite Instagram DM/ }).querySelector('.needs-reply-dot')).toBeTruthy()
    const unreadDirectButton = within(roomList).getByRole('button', { name: /Unread direct/ })
    expect(unreadDirectButton.querySelector('.unread-count')?.textContent).toBe('1')
    expect(unreadDirectButton.querySelector('.unread-dot')).toBeNull()
    expect(unreadDirectButton.querySelector('.needs-reply-dot')).toBeNull()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')?.textContent).toBe('2')

    await user.click(unansweredFilter)
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Favorite project/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite Instagram DM/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Unread direct/ })).toBeNull()
    expect(within(roomList).queryByRole('button', { name: /Marked unread/ })).toBeNull()
    await user.click(unansweredFilter)

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

  it('opens a separate local AI chat and sends only its conversation', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))
    expect(screen.getByText('No private model chats yet')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'New private chat' }))

    expect(screen.getByRole('heading', { name: 'Local AI' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Message timeline' })).toBeNull()
    let savedSeq = 0
    harness.service.CreateLocalAIChat.mockResolvedValue({ id: 'chat-1', title: '', agentId: '', updatedAt: 1 })
    harness.service.AppendLocalAIChatMessage.mockImplementation(async (_chatID: string, message: object) => ({ ...message, seq: ++savedSeq, createdAt: 1 }))
    await user.type(screen.getByRole('textbox', { name: 'Message local AI' }), 'Only local')
    await user.click(screen.getByRole('button', { name: 'Send to local AI' }))

    expect(await screen.findByText('Hello from the local model.')).toBeTruthy()
    expect(harness.service.CreateLocalAIChat).toHaveBeenCalledWith('', 'chat')
    expect(harness.service.LocalAIChat).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'Only local' }], requestId: expect.any(String), agentInstructions: '' })
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: 'Message local AI' }), 'Follow-up')
    await user.click(screen.getByRole('button', { name: 'Send to local AI' }))
    await waitFor(() => expect(harness.service.LocalAIChat).toHaveBeenLastCalledWith({
      messages: [
        { role: 'user', content: 'Only local' },
        { role: 'assistant', content: 'Hello from the local model.' },
        { role: 'user', content: 'Follow-up' },
      ],
      requestId: expect.any(String),
      agentInstructions: '',
    }))
    expect(harness.service.CreateLocalAIChat).toHaveBeenCalledTimes(1)
    expect(harness.service.AppendLocalAIChatMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({ role: 'user', content: 'Follow-up' }))
  })

  it('marks local AI rows with an icon for their kind', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([
      { id: 'chat-1', title: 'Trip plan', agentId: '', kind: 'chat', updatedAt: 1_700_000_000_000, preview: '' },
      { id: 'chat-2', title: 'Long article', agentId: '', kind: 'summary', updatedAt: 1_700_000_000_001, preview: '' },
    ])
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    expect((await screen.findByRole('button', { name: /Trip plan/ })).querySelector('svg.lucide-message-square')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Long article/ }).querySelector('svg.lucide-file-text')).not.toBeNull()
  })

  it('opens a new private chat with Ctrl or Command+Shift+M', async () => {
    const { container } = render(<App />)
    await screen.findByText('latest message')

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'm', ctrlKey: true, shiftKey: true })

    expect(await screen.findByRole('heading', { name: 'Local AI' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Message timeline' })).toBeNull()
  })

  it('keeps private chats out of All rooms by default and opens one from the Local AI filter', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: 'Here is a draft' }])
    render(<App />)
    await screen.findByText('latest message')
    expect(screen.queryByRole('button', { name: /Trip plan/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    const row = await screen.findByRole('button', { name: /Trip plan/ })
    expect(within(row).getByText('Here is a draft')).toBeTruthy()
    await user.click(row)

    expect(await screen.findByRole('heading', { name: 'Trip plan' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Message timeline' })).toBeNull()
    await waitFor(() => expect(harness.service.LoadLocalAIChatMessages).toHaveBeenCalledWith('chat-1'))
  })

  it('keeps private chats out of the Unanswered filter', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([
      { id: 'chat-1', title: 'Trip plan', agentId: '', kind: 'chat', folderId: '', updatedAt: 1_700_000_000_000, preview: 'Here is a draft', unanswered: true },
    ])
    render(<App />)
    await screen.findByText('latest message')
    expect(screen.queryByRole('button', { name: /Trip plan/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Unanswered rooms' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.queryByRole('button', { name: /Trip plan/ })).toBeNull()
  })

  it('lists direct and Instagram rooms whose last message is not from you in the Unanswered filter', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Group project', direct: false, unanswered: true }
    const bridgedDM: Room = { ...room, id: '!whatsapp:example.org', name: 'WhatsApp contact', bridge: 'WA', unanswered: true }
    const answeredGroup: Room = { ...room, id: '!answered:example.org', name: 'Answered group', direct: false, unanswered: false }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, group, bridgedDM, answeredGroup] })
    render(<App />)
    await screen.findByText('latest message')
    const roomList = screen.getByRole('navigation', { name: 'Rooms' })

    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Unanswered rooms' }).getAttribute('aria-pressed')).toBe('true'))
    expect(within(roomList).queryByRole('button', { name: /Group project/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /WhatsApp contact/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Answered group/ })).toBeNull()
    expect(within(roomList).queryByRole('button', { name: /Test room/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')).toBeNull()
  })

  it('adds a private chat to All rooms from its context menu', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Add to All rooms' }))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('ai.local_chat.in_all.chat-1', true))
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
  })

  it('adds an open private chat to All rooms with Ctrl or Command+Shift+G', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    const { container } = render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))
    await user.click(await screen.findByRole('button', { name: /Trip plan/ }))

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'g', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('ai.local_chat.in_all.chat-1', true))
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
  })

  it('renames a private chat from its menu; Enter saves and Escape cancels', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    harness.service.RenameLocalAIChat.mockResolvedValue(undefined)
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Rename chat' }))
    expect((screen.getByRole('textbox', { name: 'Chat title' }) as HTMLInputElement).value).toBe('Trip plan')
    await user.clear(screen.getByRole('textbox', { name: 'Chat title' }))
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), 'Discarded{Escape}')
    expect(screen.getByRole('heading', { name: 'Trip plan' })).toBeTruthy()
    expect(harness.service.RenameLocalAIChat).not.toHaveBeenCalled()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Rename chat' }))
    await user.clear(screen.getByRole('textbox', { name: 'Chat title' }))
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), 'Renamed trip{Enter}')

    await waitFor(() => expect(harness.service.RenameLocalAIChat).toHaveBeenCalledWith('chat-1', 'Renamed trip'))
    expect(screen.queryByRole('textbox', { name: 'Chat title' })).toBeNull()
  })

  it('does not save the placeholder name when renaming an untitled chat', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: '', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Untitled chat/ }), { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Rename chat' }))
    expect((screen.getByRole('textbox', { name: 'Chat title' }) as HTMLInputElement).value).toBe('')
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), '{Enter}')

    expect(screen.queryByRole('textbox', { name: 'Chat title' })).toBeNull()
    expect(harness.service.RenameLocalAIChat).not.toHaveBeenCalled()
  })

  it('favorites and deletes a private chat from its menu', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    harness.service.DeleteLocalAIChat.mockResolvedValue(undefined)
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Add to Favorites' }))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('ai.local_chat.favorite.chat-1', true))

    fireEvent.contextMenu(screen.getByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Delete chat' }))
    expect(harness.service.DeleteLocalAIChat).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Confirm delete' }))

    await waitFor(() => expect(harness.service.DeleteLocalAIChat).toHaveBeenCalledWith('chat-1'))
  })

  it('creates a folder, files a private chat into it, and filters by the folder', async () => {
    const user = userEvent.setup()
    let chats = [
      { id: 'chat-1', title: 'Trip plan', agentId: '', kind: 'chat', folderId: '', updatedAt: 1_700_000_000_000, preview: '' },
      { id: 'chat-2', title: 'Essay notes', agentId: '', kind: 'chat', folderId: '', updatedAt: 1_700_000_000_001, preview: '' },
    ]
    let folders: Array<{ id: string; name: string }> = []
    harness.service.ListLocalAIChats.mockImplementation(async () => chats)
    harness.service.ListLocalAIChatFolders.mockImplementation(async () => folders)
    harness.service.CreateLocalAIChatFolder.mockImplementation(async (name: string) => {
      folders = [...folders, { id: 'folder-1', name }]
      return { id: 'folder-1', name }
    })
    harness.service.SetLocalAIChatFolder.mockImplementation(async (chatID: string, folderID: string) => {
      chats = chats.map((chat) => (chat.id === chatID ? { ...chat, folderId: folderID } : chat))
    })
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    await user.click(await screen.findByRole('button', { name: 'New folder' }))
    await user.type(screen.getByRole('textbox', { name: 'New folder name' }), 'Work{Enter}')

    await waitFor(() => expect(harness.service.CreateLocalAIChatFolder).toHaveBeenCalledWith('Work'))
    expect(await screen.findByText('No chats in this folder')).toBeTruthy()
    expect((await screen.findByRole('button', { name: 'Work' })).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'All AI chats' }))
    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitemradio', { name: 'Work' }))

    await waitFor(() => expect(harness.service.SetLocalAIChatFolder).toHaveBeenCalledWith('chat-1', 'folder-1'))
    await user.click(await screen.findByRole('button', { name: 'Work' }))
    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Essay notes/ })).toBeNull()
  })

  it('renames a folder, and deleting it unfiles its chats and resets the filter', async () => {
    const user = userEvent.setup()
    let chats = [
      { id: 'chat-1', title: 'Trip plan', agentId: '', kind: 'chat', folderId: 'folder-1', updatedAt: 1_700_000_000_000, preview: '' },
      { id: 'chat-2', title: 'Essay notes', agentId: '', kind: 'chat', folderId: '', updatedAt: 1_700_000_000_001, preview: '' },
    ]
    let folders: Array<{ id: string; name: string }> = [{ id: 'folder-1', name: 'Work' }]
    harness.service.ListLocalAIChats.mockImplementation(async () => chats)
    harness.service.ListLocalAIChatFolders.mockImplementation(async () => folders)
    harness.service.RenameLocalAIChatFolder.mockImplementation(async (folderID: string, name: string) => {
      folders = folders.map((folder) => (folder.id === folderID ? { ...folder, name } : folder))
    })
    harness.service.DeleteLocalAIChatFolder.mockImplementation(async (folderID: string) => {
      folders = folders.filter((folder) => folder.id !== folderID)
      chats = chats.map((chat) => (chat.folderId === folderID ? { ...chat, folderId: '' } : chat))
    })
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    await user.click(await screen.findByRole('button', { name: 'Work' }))
    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Essay notes/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Rename folder' }))
    await user.clear(screen.getByRole('textbox', { name: 'Folder name' }))
    await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Projects{Enter}')
    await waitFor(() => expect(harness.service.RenameLocalAIChatFolder).toHaveBeenCalledWith('folder-1', 'Projects'))
    expect(await screen.findByRole('button', { name: 'Projects' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete folder' }))
    expect(harness.service.DeleteLocalAIChatFolder).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm delete folder' }))

    await waitFor(() => expect(harness.service.DeleteLocalAIChatFolder).toHaveBeenCalledWith('folder-1'))
    expect(await screen.findByRole('button', { name: /Essay notes/ })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All AI chats' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('cancels a new folder with Escape without creating it', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))

    await user.click(await screen.findByRole('button', { name: 'New folder' }))
    await user.type(screen.getByRole('textbox', { name: 'New folder name' }), 'Discarded{Escape}')

    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull()
    expect(harness.service.CreateLocalAIChatFolder).not.toHaveBeenCalled()
  })

  it('labels each room filter with an icon', async () => {
    render(<App />)
    await screen.findByText('latest message')

    const filters = screen.getByRole('group', { name: 'Filter rooms' })
    expect(within(filters).getByText('All')).toBeTruthy()
    expect(within(filters).getByText('Archive')).toBeTruthy()
    expect(within(filters).getByText('Needs reply')).toBeTruthy()
    expect(within(filters).getByText('Favorites')).toBeTruthy()
    expect(within(filters).getByText('Unanswered')).toBeTruthy()
    expect(within(filters).getByText('Local AI')).toBeTruthy()
    expect(filters.querySelectorAll('button svg')).toHaveLength(6)
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

  it('sends read receipts when content blur is enabled by a legacy preference', async () => {
    const blurredRoom = { ...room, direct: false, unread: 2, lastEventId: '$blur-latest' }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [blurredRoom],
      preferences: { 'privacy.incognito': true },
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(document.querySelector('.app-shell')?.getAttribute('data-content-blur')).toBe('true')
    const blurIndicator = screen.getByRole('status', { name: 'Content blur is on' })
    expect(blurIndicator).toBeTruthy()
    expect(blurIndicator.textContent).toBe('')
    expect(document.querySelector('.conversation-room-avatar')).toBeTruthy()
    await waitFor(() => expect(harness.service.MarkRead).toHaveBeenCalledWith(blurredRoom.id, '$blur-latest'))
    await waitFor(() => expect(document.querySelector('.room-button.is-active .unread-count')).toBeNull())
  })

  it('sends a read receipt when opening an unread room with content blur enabled', async () => {
    const user = userEvent.setup()
    const unreadRoom = { ...secondRoom, name: 'Unread chat', unread: 3, mentions: 1, lastEventId: '$unread' }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, unreadRoom],
      preferences: { 'privacy.incognito': true },
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const unreadButton = screen.getByRole('button', { name: /Unread chat/ })
    expect(unreadButton.querySelector('.unread-count')?.textContent).toBe('3')

    await user.click(unreadButton)
    await waitFor(() => expect(harness.service.MarkRead).toHaveBeenCalledWith(unreadRoom.id, '$unread'))
    await waitFor(() => expect(unreadButton.querySelector('.unread-count')).toBeNull())
  })

  it('marks a group read through its latest synced event when local history is behind', async () => {
    const group = { ...room, direct: false, unread: 2, lastEventId: '$sync-latest' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [group] })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await waitFor(() => expect(harness.service.MarkRead).toHaveBeenCalledWith(group.id, '$sync-latest'))
    await waitFor(() => expect(document.querySelector('.room-button.is-active .unread-count')).toBeNull())
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

  it('disables spelling and autocorrect in the message composer by default', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: {} })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' })
    expect(composer.getAttribute('spellcheck')).toBe('false')
    expect(composer.getAttribute('autocorrect')).toBe('off')
    expect(composer.getAttribute('autocapitalize')).toBe('off')
  })

  it('keeps spelling off in the message composer even when a stored spellcheck preference is on', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'composer.spellcheck': true } })
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

    await waitFor(() => expect(document.querySelector('[data-event-id="$gallery-photo"] .message-attachment')).toBeTruthy())
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

  it('saves an image from its toolbar through the app download path', async () => {
    const user = userEvent.setup()
    const filename = 'photo-save.png'
    const savedPath = `/Users/test/Downloads/${filename}`
    const imageMessage = { ...message('$photo-save', filename, 300), mediaUri: 'mxc://example.org/photo-save', mediaMime: 'image/png', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [imageMessage], before: 0, hasMore: false })
    harness.service.SaveMedia.mockResolvedValueOnce(savedPath)
    const intersection = stubImageIntersectionObserver()

    const { container } = render(<App />)
    const attachment = await waitFor(() => {
      const element = container.querySelector('[data-event-id="$photo-save"] .message-attachment')
      expect(element).toBeTruthy()
      return element
    })
    intersection.setIntersecting(attachment!, true)
    const toolbar = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-event-id="$photo-save"] .media-toolbar')
      expect(element).toBeTruthy()
      return element
    })

    await user.click(within(toolbar!).getByRole('button', { name: `Download ${filename}` }))
    expect(harness.service.SaveMedia).toHaveBeenCalledWith(imageMessage.mediaUri, filename)
    await waitFor(() => expect(toolbar?.querySelector('.media-download-status')?.textContent).toBe(`Saved to ${savedPath}`))
    await user.click(within(toolbar!).getByRole('button', { name: savedPath }))
    expect(harness.service.RevealFile).toHaveBeenCalledWith(savedPath)
    expect(toolbar?.querySelector('a')).toBeNull()
  })

  it('hides a bare image filename above the preview but keeps real captions', async () => {
    const mediaURL = 'mxc://example.org/photo'
    const fileNameMessage = { ...message('$photo', 'image.jpg', 300), mediaUri: mediaURL, mediaMime: 'image/png', mediaSize: 12 }
    const captionMessage = { ...message('$captioned', 'Sunset over the bay', 400), mediaUri: mediaURL, mediaMime: 'image/png', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [fileNameMessage, captionMessage], before: 0, hasMore: false })
    const intersection = stubImageIntersectionObserver()

    const { container } = render(<App />)
    const attachments = await waitFor(() => {
      const elements = container.querySelectorAll('.message-attachment')
      expect(elements).toHaveLength(2)
      return elements
    })
    attachments.forEach((attachment) => intersection.setIntersecting(attachment, true))
    await waitFor(() => expect(container.querySelectorAll('.media-preview')).toHaveLength(2))

    const photoRow = container.querySelector<HTMLElement>('[data-event-id="$photo"]')!
    expect(within(photoRow).queryByText('image.jpg')).toBeNull()
    expect(photoRow.querySelector('.media-toolbar span')).toBeNull()
    const captionRow = container.querySelector<HTMLElement>('[data-event-id="$captioned"]')!
    expect(await within(captionRow).findByText('Sunset over the bay')).toBeTruthy()
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

  it('opens the conversation profile photo and restores focus when closed', async () => {
    const user = userEvent.setup()
    const contactRoom = { ...room, avatar: 'mxc://example.org/contact-avatar' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [contactRoom] })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const trigger = screen.getByRole('button', { name: 'Open profile photo for Test room' })
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Profile photo for Test room' })
    expect(within(dialog).getByRole('img', { name: 'Test room' }).getAttribute('src')).toBe('/media/mxc/example.org/contact-avatar')

    await user.click(within(dialog).getByRole('button', { name: 'Close profile photo' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Profile photo for Test room' })).toBeNull())
    expect(document.activeElement).toBe(trigger)

    await user.click(trigger)
    await screen.findByRole('dialog', { name: 'Profile photo for Test room' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Profile photo for Test room' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
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
    await user.click(await within(fileCard).findByRole('button', { name: savedPath }))
    expect(harness.service.RevealFile).toHaveBeenCalledWith(savedPath)
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
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    fireEvent.click(card?.querySelector('.audio-play-button') as HTMLButtonElement)
    await waitFor(() => expect(card?.querySelector('audio')).toBeTruthy())
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1))
    playSpy.mockRestore()
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
    expect(card?.querySelector('.audio-clock')?.textContent).toBe('0:00 / 0:19')
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Play audio' }))
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1))

    const audio = card?.querySelector('audio') as HTMLAudioElement
    fireEvent.play(audio)
    expect(await within(card as HTMLElement).findByRole('button', { name: 'Pause audio' })).toBeTruthy()
    expect(card?.querySelector('.audio-player-bar')).toBeTruthy()
    expect(card?.querySelector('video')).toBeNull()
    expect(audio.hasAttribute('controls')).toBe(false)
    expect(audio.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$audio-webm')}`)
    expect(card?.querySelector('.audio-clock')?.textContent).toBe('0:00 / 0:19')
    playSpy.mockRestore()
  })

  it('loads an incoming Matrix video message into the native video player', async () => {
    const user = userEvent.setup()
    const videoMessage = { ...message('$video-playback', 'Video message', 300), mediaUri: 'mxc://example.org/video-playback', mediaMime: 'video/webm', mediaType: 'm.video', mediaDurationMs: 2500 }
    harness.service.History.mockResolvedValueOnce({ messages: [videoMessage], before: 0, hasMore: false })
    const { container } = render(<App />)

    const card = await waitFor(() => {
      const videoCard = container.querySelector('[data-event-id="$video-playback"] .message-attachment')
      expect(videoCard).toBeTruthy()
      return videoCard
    })
    await user.click(within(card as HTMLElement).getByRole('button', { name: /Load video/ }))

    const video = await waitFor(() => {
      const element = card?.querySelector('video')
      expect(element).toBeTruthy()
      return element
    })
    expect(video?.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$video-playback')}`)
    expect(video?.hasAttribute('controls')).toBe(true)
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

  it.each([false, true])('shows only time in message headers with 24-hour clock preference %s', async (use24Hour) => {
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
    const formatClockTime = (timestamp: number) => new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !use24Hour,
    }).format(new Date(timestamp))
    expect(oldMeta?.querySelector('strong')).toBeNull()
    expect(oldMeta?.textContent).toBe(formatClockTime(old))
    expect(latestMeta?.querySelector('strong')).toBeNull()
    expect(latestMeta?.textContent).toBe(formatClockTime(recent))
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
      const expectedTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(yesterday))
      expect(container.querySelector('.room-button[title="Test room"] .room-meta time')?.textContent).toBe(expectedDate)
      expect(timeline.querySelector('[data-event-id="$yesterday"] .message-meta time')?.textContent).toBe(expectedTime)
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
    const thirdRoom = { ...room, id: '!third:example.org', name: 'Third room', unanswered: true }
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
    await user.click(screen.getByRole('menuitem', { name: 'Add 1 to Needs reply' }))

    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenCalledWith(thirdRoom.id, true))
    expect(harness.service.SetRoomUnanswered).not.toHaveBeenCalledWith(secondRoom.id, true)
    expect(harness.service.SetRoomUnanswered).not.toHaveBeenCalledWith(room.id, true)

    roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.click(roomButtons[0])
    roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.click(roomButtons[2], { shiftKey: true })
    roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.contextMenu(roomButtons[2], { clientX: 48, clientY: 48 })
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

  it('restores archived rooms to the inbox when their latest event changes', async () => {
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
          rooms: [{ ...archivedRoom, lastEventId: '$after-archive-update', lastEventAt: archivedRoom.lastEventAt + 1 }],
          timelineChangedRoomId: [archivedRoom.id],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(archiveKey, false))
    await waitFor(() => expect(container.querySelector('.room-list .room-button')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(container.querySelector('.room-list .room-button')).toBeTruthy()
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

  it('archives inactive rooms that only have a list activity timestamp', async () => {
    const user = userEvent.setup()
    const staleRoom = { ...secondRoom, lastEventAt: 0, lastSeen: Date.now() - 20 * 24 * 60 * 60 * 1000 }
    const currentRoom = { ...room, lastEventAt: Date.now() }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [currentRoom, staleRoom],
      preferences: { 'archive.older_than_days': '7' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Archive inactive rooms' }))

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${staleRoom.id}`, true))
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(`room.archived.primary.${currentRoom.id}`, true)
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
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true, needsReply: true }] })
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
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true, needsReply: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: /Remove from Needs reply/ }))

    expect(await screen.findByText('Marked Test room answered')).toBeTruthy()
    expect(container.querySelector('.conversation .chat-notice-stack .triage-toast')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Marked Test room answered')).toBeNull()
  })

  it('adds an answered Matrix room back to Needs reply from its context menu', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: 'Add to Needs reply' }))

    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenCalledWith(room.id, true))
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(expect.stringContaining('needs_reply'), expect.anything())
    expect(container.querySelector('.room-list .needs-reply-dot')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')?.textContent).toBe('1')
  })

  it('does not offer Add to Needs reply for a room whose last message is yours', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    expect(screen.queryByRole('menuitem', { name: 'Add to Needs reply' })).toBeNull()
    expect(container.querySelector('.room-list .needs-reply-dot')).toBeNull()
    expect(harness.service.SetRoomUnanswered).not.toHaveBeenCalled()
  })

  it('keeps an answered room in Unanswered and removes it from Needs reply', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Group project', direct: false, bridge: 'IG', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [group] })
    const { container } = render(<App />)
    expect(await screen.findByRole('button', { name: /Group project/ })).toBeTruthy()
    expect(container.querySelector('.room-list .needs-reply-dot')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: /Remove from Needs reply/ }))

    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenCalledWith(group.id, false))
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(expect.stringContaining('needs_reply'), expect.anything())
    await waitFor(() => expect(container.querySelector('.room-list .needs-reply-dot')).toBeNull())
    expect(await screen.findByText('Marked Group project answered')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))
    expect(within(screen.getByRole('navigation', { name: 'Rooms' })).getByRole('button', { name: /Group project/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')).toBeNull()
  })

  it('restores Needs reply when undoing an answered room', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Group project', direct: false, bridge: 'IG', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [group] })
    const { container } = render(<App />)
    expect(await screen.findByRole('button', { name: /Group project/ })).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(screen.getByRole('menuitem', { name: /Remove from Needs reply/ }))
    await waitFor(() => expect(container.querySelector('.room-list .needs-reply-dot')).toBeNull())

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenLastCalledWith(group.id, true))
    await waitFor(() => expect(container.querySelector('.room-list .needs-reply-dot')).toBeTruthy())
  })

  it('leaves Needs reply to the sync after replying in a room', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Group project', direct: false, bridge: 'IG', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [group] })
    render(<App />)
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'reply in the group')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(group.id, 'reply in the group'))
    expect(harness.service.SetRoomUnanswered).not.toHaveBeenCalled()
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(expect.stringContaining('needs_reply'), expect.anything())
  })

  it('shows room action shortcuts and runs them from the context menu', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })

    const menu = screen.getByRole('menu')
    const shortcuts = Array.from(menu.querySelectorAll('kbd'), (key) => key.textContent)
    expect(shortcuts).toEqual(expect.arrayContaining(['N', 'U', 'A', 'F']))
    expect(screen.getByRole('menuitem', { name: /Mark room unread/ }).getAttribute('aria-keyshortcuts')).toBe('U')

    fireEvent.keyDown(menu, { key: 'u' })
    await waitFor(() => expect(harness.service.MarkUnread).toHaveBeenCalledWith(room.id))
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

  it('waits for initial sync before showing a recovery key form', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, needsVerification: true, syncReady: false })
    render(<App />)

    expect(await screen.findByText('Checking device verification…')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Verify this device' })).toBeNull()

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

  it('defaults the accent to Ocean and derives the outgoing bubble from it', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const style = container.querySelector('.app-shell')?.getAttribute('style') ?? ''
    expect(style).toContain('--accent: #28718f')
    expect(style).toContain('--own-bubble: #28718f')
  })

  it('applies a custom accent color from the picker', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Appearance' }))
    fireEvent.change(screen.getByLabelText('Custom accent color'), { target: { value: '#a1b2c3' } })

    expect(container.querySelector('.app-shell')?.getAttribute('style')).toContain('--accent: #a1b2c3')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.accent_color', '#a1b2c3'))
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

  it('toggles content blur with the privacy shortcut and preserves the draft', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'private draft' } })
    composer.focus()

    fireEvent.keyDown(composer, { key: 'p', metaKey: true, shiftKey: true })
    await waitFor(() => expect(appShell.getAttribute('data-content-blur')).toBe('true'))
    expect(screen.queryByRole('button', { name: 'Show screen content' })).toBeNull()
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('privacy.incognito', true))
    expect(composer.value).toBe('private draft')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'p', metaKey: true, shiftKey: true })
    await waitFor(() => expect(appShell.getAttribute('data-content-blur')).toBe('false'))
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
    expect(screen.getByText('Toggle content blur')).toBeTruthy()
  })

  it('shows room filter shortcut hints and opens filters with modifier shortcuts', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    const unansweredButton = screen.getByRole('button', { name: 'Unanswered rooms' })
    const archiveButton = screen.getByRole('button', { name: 'Archived rooms' })
    const favoriteButton = screen.getByRole('button', { name: 'Favorite rooms' })

    expect(unansweredButton.querySelector('kbd')?.textContent).toMatch(/^(⌘|Ctrl)⇧R$/)
    expect(archiveButton.querySelector('kbd')?.textContent).toMatch(/^(⌘|Ctrl)⇧H$/)
    expect(favoriteButton.querySelector('kbd')?.textContent).toMatch(/^(⌘|Ctrl)⇧F$/)
    fireEvent.keyDown(appShell, { key: 'r', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(unansweredButton.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.keyDown(appShell, { key: 'h', metaKey: true, shiftKey: true })
    await waitFor(() => expect(archiveButton.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.keyDown(appShell, { key: 'f', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(favoriteButton.getAttribute('aria-pressed')).toBe('true'))
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

  it('shows the sender on the first incoming message of each run in group rooms', async () => {
    const groupMessages = [
      { ...message('$alice-1', 'first from alice', 100), avatar: 'mxc://example.org/alice-avatar' },
      { ...message('$alice-2', 'second from alice', 200), avatar: 'mxc://example.org/alice-avatar' },
      { ...message('$bob-1', 'hello from bob', 400_000), sender: '@bob:example.org', senderName: 'Bob' },
      { ...message('$me-1', 'sent by me', 500_000), sender: snapshot.profile.userId, senderName: snapshot.profile.displayName, own: true },
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, direct: false }] })
    harness.service.History.mockResolvedValueOnce({ messages: groupMessages, before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('first from alice')).toBeTruthy()
    const rows = [...container.querySelectorAll<HTMLElement>('.message-row')]
    expect(rows).toHaveLength(4)
    expect(rows[0].querySelector('.message-sender-name')?.textContent).toBe('Alice')
    expect(rows[0].classList.contains('is-group-incoming')).toBe(true)
    await waitFor(() => expect(rows[0].querySelector('.message-sender-avatar img')?.getAttribute('src')).toBe('/media/mxc/example.org/alice-avatar'))
    expect(rows[1].querySelector('.message-sender-name')).toBeNull()
    expect(rows[1].querySelector('.message-sender-avatar')).toBeNull()
    expect(rows[2].querySelector('.message-sender-name')?.textContent).toBe('Bob')
    expect(rows[2].querySelector('.message-sender-avatar')?.textContent).toBe('B')
    expect(rows[3].classList.contains('is-group-incoming')).toBe(false)
    expect(rows[3].querySelector('.message-sender-name')).toBeNull()
  })

  it('starts a direct chat when a group sender name is clicked', async () => {
    const user = userEvent.setup()
    const groupRoom: Room = { ...room, direct: false }
    const directRoom: Room = { ...room, id: '!zaib-dm:example.org', name: 'Zaib', direct: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [groupRoom, directRoom] })
    harness.service.History.mockResolvedValue({ messages: [{ ...message('$zaib-1', 'hike on sunday?', 100), sender: '@zaib:example.org', senderName: 'Zaib' }], before: 0, hasMore: false })
    harness.service.StartDirectChat.mockResolvedValue(directRoom.id)
    render(<App />)

    expect(await screen.findByText('hike on sunday?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start a direct chat with Zaib' }))

    await waitFor(() => expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(directRoom.id))
    expect(harness.service.StartDirectChat).toHaveBeenLastCalledWith('@zaib:example.org')
    expect(screen.getByRole('region', { name: 'Conversation' }).querySelector('.conversation-title')?.textContent).toBe('Zaib')
  })

  it('keeps sender headers out of direct message timelines', async () => {
    harness.service.History.mockResolvedValueOnce({ messages: [message('$dm-1', 'direct hello', 100), message('$dm-2', 'direct again', 400_000)], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('direct hello')).toBeTruthy()
    expect(container.querySelectorAll('.message-row')).toHaveLength(2)
    expect(container.querySelector('.message-row.is-group-incoming')).toBeNull()
    expect(container.querySelector('.message-sender-name')).toBeNull()
    expect(container.querySelector('.message-sender-avatar')).toBeNull()
  })

  it('keeps sender headers out of IG bridged timelines', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, direct: false, bridge: 'IG' }] })
    harness.service.History.mockResolvedValueOnce({ messages: [message('$ig-1', 'ig hello', 100), message('$ig-2', 'ig again', 400_000)], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('ig hello')).toBeTruthy()
    expect(container.querySelectorAll('.message-row')).toHaveLength(2)
    expect(container.querySelector('.message-row.is-group-incoming')).toBeNull()
    expect(container.querySelector('.message-sender-name')).toBeNull()
    expect(container.querySelector('.message-sender-avatar')).toBeNull()
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

describe('native application menu actions', () => {
  function dispatchMenuAction(action: string) {
    harness.eventHandlers.get('application-menu:action')?.({ data: action })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    harness.eventHandlers.clear()
    harness.service.Snapshot.mockResolvedValue(snapshot)
    harness.service.AccountRooms.mockResolvedValue([])
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    harness.service.ScheduledJobs.mockResolvedValue([])
    harness.service.SetActiveRoom.mockResolvedValue(undefined)
    harness.service.MarkRead.mockResolvedValue(undefined)
    harness.service.SetRoomUnanswered.mockResolvedValue(undefined)
    harness.service.RoomMembers.mockResolvedValue([])
    harness.service.NativeNotificationsSupported.mockResolvedValue(false)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.SetBooleanPreference.mockResolvedValue(undefined)
    harness.service.SetStringPreference.mockResolvedValue(undefined)
    harness.service.ListLocalAIChats.mockResolvedValue([])
    harness.service.ListLocalAIChatFolders.mockResolvedValue([])
    harness.service.LoadLocalAIChatMessages.mockResolvedValue([])
    harness.service.SwitchAccount.mockResolvedValue({ ...snapshot, activeAccountId: 'secondary' })
    harness.tutorService.Analyze.mockReturnValue(new Promise(() => undefined))
  })

  afterEach(() => {
    cleanup()
  })

  it('publishes the selected room and filter to the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({
      roomSelected: true,
      privateChatOpen: false,
      draftReady: false,
      filter: 'all',
    })))
  })

  it('runs room actions from the native menu on the selected room', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [secondRoom] })
    render(<App />)
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ roomSelected: true, roomUnanswered: true, roomNeedsReply: true })))

    act(() => dispatchMenuAction('room-answered'))

    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenCalledWith(secondRoom.id, false))
  })

  it('applies room filters from the native menu', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    render(<App />)
    await screen.findByText('latest message')
    const roomList = screen.getByRole('navigation', { name: 'Rooms' })
    expect(within(roomList).getByRole('button', { name: /Test room/ })).toBeTruthy()

    act(() => dispatchMenuAction('filter:needs-reply'))

    await waitFor(() => expect(within(roomList).queryByRole('button', { name: /Test room/ })).toBeNull())
    expect(within(roomList).getByRole('button', { name: /Second room/ })).toBeTruthy()
    expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'needs-reply' }))
  })

  it('opens the requested settings tab from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('settings:Keyboard'))

    const settingsDialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(settingsDialog).getByRole('tab', { name: 'Keyboard' }).getAttribute('aria-selected')).toBe('true')
  })

  it('switches accounts from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('account:secondary'))

    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith('secondary'))
  })

  it('opens the quick switcher from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('quick-switch'))

    expect(await screen.findByRole('dialog', { name: 'Quick switcher' })).toBeTruthy()
  })

  it('focuses room search from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('room-search'))

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find a room' }))
  })

  it('opens a new private chat from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('private-chat-new'))

    expect(await screen.findByRole('heading', { name: 'Local AI' })).toBeTruthy()
  })

  it('adds the open private chat to All rooms from the native menu', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    render(<App />)
    await screen.findByText('latest message')
    await user.click(screen.getByRole('button', { name: 'Local AI chats' }))
    await user.click(await screen.findByRole('button', { name: /Trip plan/ }))
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ privateChatOpen: true, privateChatInAll: false })))

    act(() => dispatchMenuAction('private-chat-all'))

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('ai.local_chat.in_all.chat-1', true))
  })

  it('analyzes the composer draft from the native menu', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    await screen.findByText('latest message')
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Ben iyiyim.' } })
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ draftReady: true })))

    act(() => dispatchMenuAction('tutor-draft'))

    await waitFor(() => expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Ben iyiyim.', 'draft', 'en', expect.any(String)))
  })

  it('sends undo to the focused text field from the native menu', async () => {
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    try {
      render(<App />)
      const composer = await screen.findByRole('textbox', { name: 'Message' })
      composer.focus()

      act(() => dispatchMenuAction('undo'))

      expect(execCommand).toHaveBeenCalledWith('undo')
    } finally {
      Reflect.deleteProperty(document, 'execCommand')
    }
  })
})
