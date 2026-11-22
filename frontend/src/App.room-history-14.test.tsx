import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Room } from '../bindings/mychat/desktop/models.js'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, secondRoom, message, snapshot } from './appTestSetup'

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

  it('switches exclusive room filters while preserving search', async () => {
    const user = userEvent.setup()
    const favoriteDirect = { ...secondRoom, name: 'Favorite direct', unread: 2, favorite: true }
    const favoriteGroup: Room = { ...room, id: '!group:example.org', name: 'Favorite project', direct: false, favorite: true, unread: 1, unanswered: true, needsReply: true }
    const favoriteInstagramDM: Room = { ...room, id: '!instagram:example.org', name: 'Favorite Instagram DM', bridge: 'IG', direct: false, favorite: true, unanswered: true, needsReply: true }
    const unreadDirect: Room = { ...room, id: '!unread:example.org', name: 'Unread direct', unread: 100 }
    const markedUnreadRoom: Room = { ...room, id: '!marked-unread:example.org', name: 'Marked unread', markedUnread: true }
    const archivedNeedsReply: Room = { ...room, id: '!archived-needs-reply:example.org', name: 'Archived awaiting reply', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, favoriteDirect, favoriteGroup, favoriteInstagramDM, unreadDirect, markedUnreadRoom, archivedNeedsReply], preferences: { [`room.archived.primary.${archivedNeedsReply.id}`]: true } })
    render(<App />)

    await screen.findByText('latest message')
    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
    const unansweredFilter = await screen.findByRole('button', { name: 'Unanswered rooms' })
    expect(unansweredFilter.querySelector('.filter-count')).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite project/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ }).querySelector('.needs-reply-dot')).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite project/ }).querySelector('.needs-reply-dot')).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite Instagram DM/ }).querySelector('.needs-reply-dot')).toBeTruthy()
    const unreadDirectButton = within(roomList).getByRole('button', { name: /Unread direct/ })
    expect(unreadDirectButton.querySelector('.unread-count')?.textContent).toBe('99+')
    expect(unreadDirectButton.querySelector('.unread-dot')).toBeNull()
    expect(unreadDirectButton.querySelector('.needs-reply-dot')).toBeNull()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')?.textContent).toBe('2')
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 2 })))

    await user.click(unansweredFilter)
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Favorite project/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Favorite Instagram DM/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Unread direct/ })).toBeNull()
    expect(within(roomList).queryByRole('button', { name: /Marked unread/ })).toBeNull()
    await user.click(unansweredFilter)

    await user.click(await screen.findByRole('button', { name: 'Needs reply' }))
    await user.click(await screen.findByRole('button', { name: 'Favorite rooms' }))
    await user.type(await screen.findByRole('textbox', { name: 'Find a room' }), 'Favorite')
    expect(within(roomList).getByRole('button', { name: /Favorite project/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite Instagram DM/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Unread direct/ })).toBeNull()
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 2 })))

    await user.click(await screen.findByRole('button', { name: 'Needs reply' }))
    await user.click(await screen.findByRole('button', { name: 'Favorite rooms' }))
    await user.clear(await screen.findByRole('textbox', { name: 'Find a room' }))
    expect(within(roomList).getByRole('button', { name: /Favorite direct/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite project/ })).toBeTruthy()
    expect(within(roomList).getByRole('button', { name: /Favorite Instagram DM/ })).toBeTruthy()

    const filters = await screen.findByRole('group', { name: 'Filter rooms' })
    for (const [groupName, names] of [
      ['Room categories', ['Needs reply', 'Unanswered rooms', 'Favorite rooms']],
      ['Room visibility', ['Archived rooms', 'AI chats', 'All']],
    ] as const) {
      const filterGroup = within(filters).getByRole('group', { name: groupName })
      for (const name of names) {
        const filter = within(filterGroup).getByRole('button', { name })
        for (let click = 0; click < 2; click++) {
          await user.click(filter)
          const shouldBeActive = !['Unanswered rooms', 'Needs reply'].includes(name) || click === 0
          expect(filterGroup.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(shouldBeActive ? 1 : 0)
          expect(filter.getAttribute('aria-pressed')).toBe(String(shouldBeActive))
        }
      }
    }
    expect(within(roomList).getByRole('button', { name: /Unread direct/ })).toBeTruthy()
  })

  it('lists rooms whose messages match the room search', async () => {
    const user = userEvent.setup()
    const planningRoom: Room = { ...room, id: '!planning:example.org', name: 'Planning', direct: false, preview: '' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, planningRoom] })
    harness.service.SearchMessages.mockImplementation(async (request: { query: string }) => ({
      results: request.query === '"c++"*' ? [{ roomID: planningRoom.id, message: message('$cpp', 'we ship c++ today', 200) }] : [],
      nextBatch: '',
    }))
    render(<App />)
    await screen.findByText('latest message')
    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })

    await user.type(await screen.findByRole('textbox', { name: 'Find a room' }), 'c++')

    expect(await within(roomList).findByRole('button', { name: /Planning/ })).toBeTruthy()
    expect(within(roomList).queryByRole('button', { name: /Test room/ })).toBeNull()
    expect(harness.service.SearchMessages).toHaveBeenLastCalledWith(expect.objectContaining({ query: '"c++"*', roomID: '' }))
  })

  it('opens a separate local AI chat and sends only its conversation', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('latest message')
    await user.click(await screen.findByRole('button', { name: 'AI chats' }))
    expect(screen.getByText('No private model chats yet')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'New private chat' }))

    expect(await screen.findByRole('heading', { name: 'AI chat' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Message timeline' })).toBeNull()
    let savedSeq = 0
    harness.service.CreateLocalAIChat.mockResolvedValue({ id: 'chat-1', title: '', agentId: '', updatedAt: 1 })
    harness.service.AppendLocalAIChatMessage.mockImplementation(async (_chatID: string, message: object) => ({ ...message, seq: ++savedSeq, createdAt: 1 }))
    await user.type(await screen.findByRole('textbox', { name: 'Message AI' }), 'Only local')
    await user.click(await screen.findByRole('button', { name: 'Send to AI' }))

    expect(await screen.findByText('Hello from the local model.')).toBeTruthy()
    expect(harness.service.CreateLocalAIChat).toHaveBeenCalledWith('', 'chat')
    expect(harness.service.LocalAIChat).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'Only local' }], requestId: expect.any(String), agentInstructions: '' })
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    await user.type(await screen.findByRole('textbox', { name: 'Message AI' }), 'Follow-up')
    await user.click(await screen.findByRole('button', { name: 'Send to AI' }))
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
    await user.click(await screen.findByRole('button', { name: 'AI chats' }))

    expect((await screen.findByRole('button', { name: /Trip plan/ })).querySelector('svg.lucide-message-square')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Long article/ }).querySelector('svg.lucide-file-text')).not.toBeNull()
  })

  it('opens a new private chat with Ctrl or Command+Shift+M', async () => {
    const { container } = render(<App />)
    await screen.findByText('latest message')

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'm', ctrlKey: true, shiftKey: true })

    expect(await screen.findByRole('heading', { name: 'AI chat' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Message timeline' })).toBeNull()
  })

  it('keeps private chats out of All rooms by default and opens one from the Local AI filter', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: 'Here is a draft' }])
    render(<App />)
    await screen.findByText('latest message')
    expect(screen.queryByRole('button', { name: /Trip plan/ })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'AI chats' }))

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
    await screen.findByRole('navigation', { name: 'Rooms' })
    expect(screen.queryByRole('button', { name: /Trip plan/ })).toBeNull()

    await user.click(await screen.findByRole('button', { name: 'Unanswered rooms' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Unanswered rooms' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.queryByRole('button', { name: /Trip plan/ })).toBeNull()
  })
})
