import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    await user.click(await screen.findByRole('menuitem', { name: 'Add 1 to Needs reply' }))

    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenCalledWith(thirdRoom.id, true))
    expect(harness.service.SetRoomUnanswered).not.toHaveBeenCalledWith(secondRoom.id, true)
    expect(harness.service.SetRoomUnanswered).not.toHaveBeenCalledWith(room.id, true)

    roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.click(roomButtons[0])
    roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.click(roomButtons[2], { shiftKey: true })
    roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.contextMenu(roomButtons[2], { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Add 3 to Favorites' }))

    await waitFor(() => {
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.favorite.${room.id}`, true)
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.favorite.${secondRoom.id}`, true)
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.favorite.${thirdRoom.id}`, true)
    })
    expect(container.querySelectorAll('.room-button.is-multiselected')).toHaveLength(0)
  })
})
