import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, message, menuCommand, snapshot } from './appTestSetup'

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
    harness.service.SaveMedia.mockReset()
    harness.service.SaveMedia.mockResolvedValue('')
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
      corrected_text: 'Merhaba, nasılsın?',
      translation: 'Ciao, come stai?',
      text_to_insert: 'Merhaba, nasılsın?',
    })
    harness.service.TestAIEndpoint.mockResolvedValue(undefined)
    harness.service.ChooseDownloadFolder.mockResolvedValue('')
    harness.service.ExportRoomChat.mockResolvedValue({ path: '', messages: 0 })
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
    await user.click(await screen.findByRole('button', { name: 'AI chats' }))

    await user.click(await screen.findByRole('button', { name: 'Work' }))
    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Essay notes/ })).toBeNull()

    await user.click(await screen.findByRole('button', { name: 'Rename folder' }))
    await user.clear(await screen.findByRole('textbox', { name: 'Folder name' }))
    await user.type(await screen.findByRole('textbox', { name: 'Folder name' }), 'Projects{Enter}')
    await waitFor(() => expect(harness.service.RenameLocalAIChatFolder).toHaveBeenCalledWith('folder-1', 'Projects'))
    expect(await screen.findByRole('button', { name: 'Projects' })).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Delete folder' }))
    expect(harness.service.DeleteLocalAIChatFolder).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Confirm delete folder' }))

    await waitFor(() => expect(harness.service.DeleteLocalAIChatFolder).toHaveBeenCalledWith('folder-1'))
    expect(await screen.findByRole('button', { name: /Essay notes/ })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All AI chats' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('cancels a new folder with Escape without creating it', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')
    await user.click(await screen.findByRole('button', { name: 'AI chats' }))

    await user.click(await screen.findByRole('button', { name: 'New folder' }))
    await user.type(await screen.findByRole('textbox', { name: 'New folder name' }), 'Discarded{Escape}')

    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull()
    expect(harness.service.CreateLocalAIChatFolder).not.toHaveBeenCalled()
  })

  it('labels each room filter and keeps icons on the category chips', async () => {
    render(<App />)
    await screen.findByText('latest message')

    const filters = await screen.findByRole('group', { name: 'Filter rooms' })
    expect(within(filters).getByText('All')).toBeTruthy()
    expect(within(filters).getByText('Archive')).toBeTruthy()
    expect(within(filters).getByText('Needs reply')).toBeTruthy()
    expect(within(filters).getByText('Favorites')).toBeTruthy()
    expect(within(filters).getByText('Unanswered')).toBeTruthy()
    expect(within(filters).getByText('AI chats')).toBeTruthy()
    const categories = within(filters).getByRole('group', { name: 'Room categories' })
    expect(categories.querySelectorAll('button svg')).toHaveLength(3)
  })

  it('adds a chat to Favorites from the room menu', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Add to Favorites' }))

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.favorite.${room.id}`, true))
    expect(menuCommand('Remove from Favorites')).toBeTruthy()
  })

  it('mutes room notifications from the room menu and with the M key', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Mute notifications' }))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.muted.${room.id}`, true))

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    const menu = await screen.findByRole('menu')
    expect(screen.getByRole('menuitem', { name: 'Unmute notifications' }).getAttribute('aria-keyshortcuts')).toBe('M')
    fireEvent.keyDown(menu, { key: 'm' })
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledTimes(2))
    expect(harness.service.SetBooleanPreference).toHaveBeenLastCalledWith(`room.muted.${room.id}`, false)
  })

  it('explains when filters hide every room without closing the conversation', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')

    await user.click(await screen.findByRole('button', { name: 'Needs reply' }))

    expect(screen.getByText('No rooms match these filters')).toBeTruthy()
    expect(screen.getByText('latest message')).toBeTruthy()
    expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(room.id)
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

    const settingsButton = await screen.findByRole('button', { name: 'Settings' })
    await user.click(settingsButton)
    const closeSettings = await screen.findByRole('button', { name: 'Close settings' })
    const settingsDialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(document.activeElement).toBe(closeSettings)
    await user.tab({ shift: true })
    expect(settingsDialog.contains(document.activeElement)).toBe(true)
    await user.tab()
    expect(document.activeElement).toBe(closeSettings)

    await user.click(await screen.findByRole('tab', { name: 'General' }))
    expect(await screen.findByRole('checkbox', { name: 'Launch Pinger at login' })).toBeTruthy()
    expect(await screen.findByRole('checkbox', { name: 'Minimize to tray when closing the window' })).toBeTruthy()

    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    fireEvent.keyDown(settingsDialog, { key: 'k', metaKey: true })
    expect(screen.queryByRole('dialog', { name: 'Quick switcher' })).toBeNull()
    await user.keyboard('{ArrowRight}')
    const notificationsTab = await screen.findByRole('tab', { name: 'Notifications' })
    expect(notificationsTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('settings-tab-notifications')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
    expect(document.activeElement).toBe(settingsButton)
  })
})
