import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { SNIPPETS_STORAGE_KEY } from './snippets'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, snapshot } from './appTestSetup'

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

  it('changes the interface language from the General settings tab', async () => {
    const user = await openSettingsTab('General')
    const language = await screen.findByRole('combobox', { name: 'Language' })

    await user.selectOptions(language, 'it')

    expect(await screen.findByRole('heading', { name: 'Generale' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeTruthy()
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('general.language', 'it')

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Lingua' }), 'system')
    expect(await screen.findByRole('heading', { name: 'General' })).toBeTruthy()
  })

  it('revokes a device after password confirmation', async () => {
    const device = {
      id: 'OLDDEVICE',
      displayName: 'Old laptop',
      lastSeenIp: '',
      lastSeenAt: 0,
      current: false,
    }
    harness.service.Devices.mockResolvedValue([device])
    const user = await openSettingsTab('Account')
    await user.click(await screen.findByText('Advanced'))
    expect(await screen.findByText('Old laptop')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Revoke' }))
    await user.type(await screen.findByLabelText('Account password'), 'matrix-password')
    await user.click(await screen.findByRole('button', { name: 'Revoke device' }))

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
    expect(within(settingsDialog).getByRole('tab', { name: 'Help' }).getAttribute('aria-selected')).toBe('true')
    expect(within(settingsDialog).getByRole('button', { name: 'Check for updates' })).toBeTruthy()

    await act(async () => {
      harness.eventHandlers.get('application-menu:settings')?.({ data: undefined })
    })
    expect(within(settingsDialog).getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
  })

  it('offers Beeper onboarding and a homeserver preset without replacing login credentials', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, loggedIn: false })
    harness.service.OpenExternalURL.mockResolvedValue(undefined)
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
    const homeserver = await screen.findByLabelText('Homeserver') as HTMLInputElement
    const username = await screen.findByLabelText('Username') as HTMLInputElement
    const password = await screen.findByLabelText('Password') as HTMLInputElement
    fireEvent.change(homeserver, { target: { value: 'https://other.example.org/' } })
    fireEvent.change(username, { target: { value: '@test_user:beeper.com' } })
    fireEvent.change(password, { target: { value: 'test matrix password' } })
    await user.click(await screen.findByRole('button', { name: 'Use Beeper Homeserver' }))
    expect(homeserver.value).toBe('https://matrix.beeper.com/')
    expect(username.value).toBe('@test_user:beeper.com')
    expect(password.value).toBe('test matrix password')
    const summary = screen.getByText('Using Beeper with Pinger?')
    const guide = summary.closest('details')!
    expect(guide.open).toBe(false)
    await user.click(summary)
    expect(guide.open).toBe(true)
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3)
    expect(within(guide).getByText('Register on Beeper')).toBeTruthy()
    expect(within(guide).getByText('Set a Matrix password')).toBeTruthy()
    expect(within(guide).getByText('Sign in here')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Download official Beeper app' }))
    expect(harness.service.OpenExternalURL).toHaveBeenCalledWith('https://www.beeper.com/download')
    expect(homeserver.value).toBe('https://matrix.beeper.com/')
    expect(username.value).toBe('@test_user:beeper.com')
    expect(password.value).toBe('test matrix password')
  })

  it('allows retrying the Beeper download action after the native browser fails', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, loggedIn: false })
    harness.service.OpenExternalURL.mockRejectedValueOnce(new Error('Could not open the browser')).mockResolvedValue(undefined)
    render(<App />)
    await user.click(await screen.findByText('Using Beeper with Pinger?'))
    const download = await screen.findByRole('button', { name: 'Download official Beeper app' })
    await user.click(download)
    expect((await screen.findByRole('alert')).textContent).toContain('Could not open the browser')
    await user.click(download)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(harness.service.OpenExternalURL).toHaveBeenCalledTimes(2)
    expect(harness.service.OpenExternalURL).toHaveBeenLastCalledWith('https://www.beeper.com/download')
  })

  it('shows chat networks detected from bridged rooms instead of placeholder statuses', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, { ...room, id: '!wa1:example.org', name: 'Alice', bridge: 'WA' }, { ...room, id: '!wa2:example.org', name: 'Bob', bridge: 'WA' }],
    })
    const user = await openSettingsTab('Account')
    await user.click(await screen.findByText('Advanced'))
    const status = await screen.findByLabelText('Detected chat networks')
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
    await user.type(await screen.findByRole('textbox', { name: 'Agent name' }), 'Tutor')
    await user.type(await screen.findByRole('textbox', { name: 'Agent instructions' }), 'Answer in short sentences.')
    await user.click(await screen.findByRole('button', { name: 'Save agent' }))

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.local_agents', expect.stringContaining('"name":"Tutor"')))
  })

  it('saves the language to learn from AI settings', async () => {
    const user = await openSettingsTab('AI')

    await user.selectOptions(await screen.findByLabelText('Default learning language'), 'de')

    await waitFor(() => expect(harness.service.SetStringPreferences).toHaveBeenCalledWith({ 'ai.tutor_language': 'de' }))
    expect(await screen.findByText('Language to learn saved.')).toBeTruthy()
  })
})
