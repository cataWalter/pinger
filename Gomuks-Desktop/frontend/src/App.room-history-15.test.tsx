import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Room } from '../bindings/mychat/desktop/models.js'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, message, snapshot } from './appTestSetup'

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

  it('lists direct and Instagram rooms whose last message is not from you in the Unanswered filter', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Group project', direct: false, unanswered: true }
    const bridgedDM: Room = { ...room, id: '!whatsapp:example.org', name: 'WhatsApp contact', bridge: 'WA', unanswered: true }
    const nilay: Room = { ...room, id: '!nilay:example.org', name: 'Nilay', topic: 'WhatsApp private chat', unanswered: true }
    const answeredGroup: Room = { ...room, id: '!answered:example.org', name: 'Answered group', direct: false, unanswered: false }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, group, bridgedDM, nilay, answeredGroup] })
    render(<App />)
    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })

    await user.click(await screen.findByRole('button', { name: 'Unanswered rooms' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Unanswered rooms' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(roomList).queryByRole('button', { name: /Group project/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /WhatsApp contact/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Nilay/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Answered group/ })).toBeNull()
    expect(within(roomList).queryByRole('button', { name: /Test room/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')).toBeNull()

    await user.click(await screen.findByRole('button', { name: 'All' }))
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Unanswered rooms' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(roomList).getByRole('button', { name: /Nilay/ })).toBeTruthy()
  })

  it('adds a private chat to All rooms from its context menu', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    render(<App />)
    await screen.findByText('latest message')
    await user.click(await screen.findByRole('button', { name: 'Local AI chats' }))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Add to All rooms' }))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('ai.local_chat.in_all.chat-1', true))
    await user.click(await screen.findByRole('button', { name: 'All' }))

    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
  })

  it('adds an open private chat to All rooms with Ctrl or Command+Shift+G', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    const { container } = render(<App />)
    await screen.findByText('latest message')
    await user.click(await screen.findByRole('button', { name: 'Local AI chats' }))
    await user.click(await screen.findByRole('button', { name: /Trip plan/ }))

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'g', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('ai.local_chat.in_all.chat-1', true))
    await user.click(await screen.findByRole('button', { name: 'All' }))

    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
  })

  it('renames a private chat from its menu; Enter saves and Escape cancels', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    harness.service.RenameLocalAIChat.mockResolvedValue(undefined)
    render(<App />)
    await screen.findByText('latest message')
    await user.click(await screen.findByRole('button', { name: 'Local AI chats' }))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Rename chat' }))
    expect((await screen.findByRole('textbox', { name: 'Chat title' }) as HTMLInputElement).value).toBe('Trip plan')
    await user.clear(await screen.findByRole('textbox', { name: 'Chat title' }))
    await user.type(await screen.findByRole('textbox', { name: 'Chat title' }), 'Discarded{Escape}')
    expect(await screen.findByRole('heading', { name: 'Trip plan' })).toBeTruthy()
    expect(harness.service.RenameLocalAIChat).not.toHaveBeenCalled()

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Rename chat' }))
    await user.clear(await screen.findByRole('textbox', { name: 'Chat title' }))
    await user.type(await screen.findByRole('textbox', { name: 'Chat title' }), 'Renamed trip{Enter}')

    await waitFor(() => expect(harness.service.RenameLocalAIChat).toHaveBeenCalledWith('chat-1', 'Renamed trip'))
    expect(screen.queryByRole('textbox', { name: 'Chat title' })).toBeNull()
  })

  it('does not save the placeholder name when renaming an untitled chat', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: '', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    render(<App />)
    await screen.findByText('latest message')
    await user.click(await screen.findByRole('button', { name: 'Local AI chats' }))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Untitled chat/ }), { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Rename chat' }))
    expect((await screen.findByRole('textbox', { name: 'Chat title' }) as HTMLInputElement).value).toBe('')
    await user.type(await screen.findByRole('textbox', { name: 'Chat title' }), '{Enter}')

    expect(screen.queryByRole('textbox', { name: 'Chat title' })).toBeNull()
    expect(harness.service.RenameLocalAIChat).not.toHaveBeenCalled()
  })

  it('favorites and deletes a private chat from its menu', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    harness.service.DeleteLocalAIChat.mockResolvedValue(undefined)
    render(<App />)
    await screen.findByText('latest message')
    await user.click(await screen.findByRole('button', { name: 'Local AI chats' }))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Add to Favorites' }))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('ai.local_chat.favorite.chat-1', true))

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Delete chat' }))
    expect(harness.service.DeleteLocalAIChat).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('menuitem', { name: 'Confirm delete' }))

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
    await user.click(await screen.findByRole('button', { name: 'Local AI chats' }))

    await user.click(await screen.findByRole('button', { name: 'New folder' }))
    await user.type(await screen.findByRole('textbox', { name: 'New folder name' }), 'Work{Enter}')

    await waitFor(() => expect(harness.service.CreateLocalAIChatFolder).toHaveBeenCalledWith('Work'))
    expect(await screen.findByText('No chats in this folder')).toBeTruthy()
    expect((await screen.findByRole('button', { name: 'Work' })).getAttribute('aria-pressed')).toBe('true')

    await user.click(await screen.findByRole('button', { name: 'All AI chats' }))
    fireEvent.contextMenu(await screen.findByRole('button', { name: /Trip plan/ }), { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitemradio', { name: 'Work' }))

    await waitFor(() => expect(harness.service.SetLocalAIChatFolder).toHaveBeenCalledWith('chat-1', 'folder-1'))
    await user.click(await screen.findByRole('button', { name: 'Work' }))
    expect(await screen.findByRole('button', { name: /Trip plan/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Essay notes/ })).toBeNull()
  })
})
