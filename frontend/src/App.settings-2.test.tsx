import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { SNIPPETS_STORAGE_KEY } from './snippets'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, snapshot } from './appTestSetup'

vi.mock('@wailsio/runtime', async () => {
  const { clipboardSetText, harness } = await import('./appTestSetup')
  return {
    Clipboard: { SetText: clipboardSetText },
    Events: {
      On: vi.fn((name: string, handler: (event: { data: unknown }) => void) => {
        harness.eventHandlers.set(name, handler)
        return () => harness.eventHandlers.delete(name)
      }),
    },
  }
})

vi.mock('emoji-picker-react', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (emojiData: { emoji: string }) => void }) => (
    <button type="button" aria-label="grinning face" onClick={() => onEmojiClick({ emoji: '😀' })}>😀</button>
  ),
}))

vi.mock('../bindings/mychat/desktop', async () => {
  const { harness } = await import('./appTestSetup')
  return {
    AppService: harness.service,
    LanguageTutorService: harness.tutorService,
  }
})

vi.mock('./MarkdownMessage', async () => {
  const { harness } = await import('./appTestSetup')
  return {
    default: ({ body, className = 'message-body' }: { body: string; className?: string }) => {
      harness.markdownRenderCount++
      return <div className={className}>{body}</div>
    },
  }
})

// Runs after each suite's cleanup, which saves pending drafts while unmounting.
afterEach(() => {
  window.localStorage.removeItem(ROOM_DRAFTS_STORAGE_KEY)
})

describe('settings storage, integrations, help, and about', () => {
  let snippetDownloadClickSpy: { mockRestore: () => void; } | undefined

  afterEach(() => {
    snippetDownloadClickSpy?.mockRestore()
    snippetDownloadClickSpy = undefined
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.removeItem(SNIPPETS_STORAGE_KEY)
  })

  beforeEach(() => {
    harness.eventHandlers.clear()
    harness.service.Snapshot.mockResolvedValue(snapshot)
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
    harness.service.SetStringPreferences.mockResolvedValue(undefined)
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
      corrected_text: 'Merhaba, nasılsın?',
      translation: 'Ciao, come stai?',
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

  it('blocks choosing the default language as the language to learn', async () => {
    const user = await openSettingsTab('AI')
    const learning = await screen.findByLabelText('Default learning language') as HTMLSelectElement

    await user.selectOptions(learning, 'en')

    expect(await screen.findByText('Choose two different languages.')).toBeTruthy()
    expect(learning.value).toBe('tr')
    expect(harness.service.SetStringPreference.mock.calls.filter(([key]) => key === 'ai.tutor_language')).toEqual([])
  })

  it('saves the default language and adds it to the known languages', async () => {
    const user = await openSettingsTab('AI')

    await user.selectOptions(await screen.findByLabelText('Default for translations and explanations'), 'fr')

    await waitFor(() => expect(harness.service.SetStringPreferences).toHaveBeenCalledWith({ 'ai.default_language': 'fr', 'ai.known_languages': '["en","fr"]' }))
    expect(await screen.findByText('Default language saved.')).toBeTruthy()
  })

  it('saves the languages you know and keeps the default language checked', async () => {
    const user = await openSettingsTab('AI')
    const known = within(await screen.findByRole('group', { name: 'Languages you know' }))

    expect((known.getByRole('checkbox', { name: 'English' }) as HTMLInputElement).disabled).toBe(true)
    await user.click(known.getByRole('checkbox', { name: 'Spanish' }))

    await waitFor(() => expect(harness.service.SetStringPreferences).toHaveBeenCalledWith({ 'ai.known_languages': '["en","es"]' }))
    expect(await screen.findByText('Known languages saved.')).toBeTruthy()
  })

  it('restores the language choices when the batch save fails', async () => {
    harness.service.SetStringPreferences.mockRejectedValueOnce(new Error('disk full'))
    const user = await openSettingsTab('AI')
    const learning = await screen.findByLabelText('Default learning language') as HTMLSelectElement

    await user.selectOptions(learning, 'de')

    expect(await screen.findByText('Not saved.')).toBeTruthy()
    expect(learning.value).toBe('tr')
  })

  it('lists per-chat storage and clears matching cached media after confirmation', async () => {
    harness.service.RoomStorageUsage
      .mockResolvedValueOnce([{ roomId: '!room:example.org', name: 'Test room', messages: 12, textBytes: 1024, mediaBytes: 4096, mediaFiles: 3 }])
      .mockResolvedValue([{ roomId: '!room:example.org', name: 'Test room', messages: 12, textBytes: 1024, mediaBytes: 0, mediaFiles: 0 }])
    harness.service.ClearCachedMedia.mockResolvedValue({ files: 3, bytes: 4096 })
    const user = await openSettingsTab('Storage')
    await user.click(await screen.findByText('Advanced'))

    const table = await screen.findByRole('table', { name: 'Storage used by each chat' })
    expect(within(table).getByText('Test room')).toBeTruthy()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Cleanup age' }), '30')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Cleanup media type' }), 'image')
    await user.click(within(table).getByRole('button', { name: 'Clear media in Test room' }))
    const confirmDialog = await screen.findByRole('alertdialog', { name: 'Remove cached media?' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Remove media' }))

    await waitFor(() => expect(harness.service.ClearCachedMedia).toHaveBeenCalledWith({ roomId: '!room:example.org', olderThanDays: 30, mediaType: 'image' }))
    expect(await screen.findByText(/Removed 3 cached files/)).toBeTruthy()
  })

  it('does not clear media when the cleanup confirmation is declined', async () => {
    harness.service.RoomStorageUsage.mockResolvedValue([{ roomId: '!room:example.org', name: 'Test room', messages: 1, textBytes: 10, mediaBytes: 20, mediaFiles: 1 }])
    const user = await openSettingsTab('Storage')
    await user.click(await screen.findByText('Advanced'))

    await user.click(await screen.findByRole('button', { name: 'Clear matching media' }))
    const confirmDialog = await screen.findByRole('alertdialog', { name: 'Remove cached media?' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog', { name: 'Remove cached media?' })).toBeNull()
    expect(harness.service.ClearCachedMedia).not.toHaveBeenCalled()
  })

  it('exports the newest messages for every chat after validating the limit', async () => {
    harness.service.ChooseDownloadFolder.mockResolvedValue('/tmp/exports')
    harness.service.ExportRecentMessagesForAllChats.mockResolvedValue({ path: '/tmp/exports/All chats last 50 messages.txt', chats: 2, messages: 80, failed: 1, cancelled: false })
    const user = await openSettingsTab('Storage')
    await user.click(await screen.findByText('Advanced'))

    const limit = await screen.findByRole('spinbutton', { name: 'Messages per chat' })
    await user.clear(limit)
    await user.type(limit, '0')
    await user.click(await screen.findByRole('button', { name: 'Export all chats' }))
    expect(await screen.findByText('Enter a whole number from 1 to 1,000.')).toBeTruthy()
    expect(harness.service.ChooseDownloadFolder).not.toHaveBeenCalled()

    await user.clear(limit)
    await user.type(limit, '50')
    await user.click(await screen.findByRole('button', { name: 'Export all chats' }))

    await waitFor(() => expect(harness.service.ExportRecentMessagesForAllChats).toHaveBeenCalledWith('/tmp/exports', 50, { privateChats: true, groupChats: true, myMessages: true, theirMessages: true, deletedMessages: false }))
    expect(await screen.findByText('Export finished.')).toBeTruthy()
    expect(screen.getByText('Failed chats')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Show file' })).toBeTruthy()
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
    const user = await openSettingsTab('Help')

    expect(await screen.findByText('1.0.0')).toBeTruthy()
    expect(await screen.findByText('abcdef0')).toBeTruthy()
    expect(screen.getByText('2026-10-22T12:00:00Z')).toBeTruthy()
    expect(harness.service.CheckForUpdates).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Check for updates' }))

    expect(await screen.findByText('Version v1.1.0 is available.')).toBeTruthy()
    expect(screen.getByText('Adds storage cleanup.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View release' }).getAttribute('href')).toBe('https://github.com/cataWalter/pinger/releases/tag/v1.1.0')
  })

  it('reports update check failures without changing the About page', async () => {
    harness.service.CheckForUpdates.mockRejectedValueOnce(new Error('Network unavailable'))
    const user = await openSettingsTab('Help')

    await user.click(await screen.findByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('Network unavailable')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'View release' })).toBeNull()
  })

  it('shows unknown build metadata when the metadata service fails', async () => {
    harness.service.AppBuildInfo.mockRejectedValueOnce(new Error('Metadata unavailable'))
    await openSettingsTab('Help')
    const aboutSection = screen.getByText('Application').parentElement
    await waitFor(() => expect(within(aboutSection!).getAllByText('unknown')).toHaveLength(2))
  })

  it('links the help center to the keyboard and storage settings', async () => {
    const user = await openSettingsTab('Help')
    expect(screen.getByText(/For Beeper, create your account and connect new networks in the official Beeper app first/)).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Open storage' }))
    expect((await screen.findByRole('tab', { name: 'Storage' })).getAttribute('aria-selected')).toBe('true')
  })

  it('turns single-key shortcuts off from the keyboard settings', async () => {
    const user = await openSettingsTab('Keyboard')

    await user.click(await screen.findByLabelText(/Enable single-key shortcuts/))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('shortcuts.single_keys', false))
    expect(await screen.findByText(/Single-key shortcuts are off/)).toBeTruthy()
  })

  it('filters keyboard shortcuts by action and key combination', async () => {
    const user = await openSettingsTab('Keyboard')
    await user.click(await screen.findByText('Advanced'))
    const search = await screen.findByRole('searchbox', { name: 'Search keyboard shortcuts' })

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
    await user.click(await screen.findByText('Advanced'))

    await user.type(await screen.findByRole('searchbox', { name: 'Search keyboard shortcuts' }), 'zzzzz')
    expect(await screen.findByText(/No shortcuts match/)).toBeTruthy()
    expect(screen.queryByText('Quick switch rooms')).toBeNull()
  })
})
