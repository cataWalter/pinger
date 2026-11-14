import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('creates, edits, and deletes local text snippets from settings', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Keyboard' }))
    await user.click(await screen.findByRole('button', { name: 'Manage text snippets' }))
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
    await user.click(await screen.findByRole('tab', { name: 'Keyboard' }))
    await user.click(await screen.findByRole('button', { name: 'Manage text snippets' }))
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
    await user.click(await screen.findByRole('tab', { name: 'Keyboard' }))
    await user.click(await screen.findByRole('button', { name: 'Manage text snippets' }))
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
    await user.click(await screen.findByRole('tab', { name: 'Keyboard' }))
    await user.click(await screen.findByRole('button', { name: 'Manage text snippets' }))
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
