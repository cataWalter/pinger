import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('keeps an answered room in Unanswered and removes it from Needs reply', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Group project', direct: false, bridge: 'IG', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [group] })
    const { container } = render(<App />)
    expect(await screen.findByRole('button', { name: /Group project/ })).toBeTruthy()
    expect(container.querySelector('.room-list .needs-reply-dot')).toBeTruthy()
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 1 })))

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: /Remove from Needs reply/ }))

    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenCalledWith(group.id, false))
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(expect.stringContaining('needs_reply'), expect.anything())
    await waitFor(() => expect(container.querySelector('.room-list .needs-reply-dot')).toBeNull())
    expect(await screen.findByText('Marked Group project answered')).toBeTruthy()
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 0 })))

    await user.click(await screen.findByRole('button', { name: 'Unanswered rooms' }))
    expect(within(await screen.findByRole('navigation', { name: 'Rooms' })).getByRole('button', { name: /Group project/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')).toBeNull()
  })

  it('restores Needs reply when undoing an answered room', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Group project', direct: false, bridge: 'IG', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [group] })
    const { container } = render(<App />)
    expect(await screen.findByRole('button', { name: /Group project/ })).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: /Remove from Needs reply/ }))
    await waitFor(() => expect(container.querySelector('.room-list .needs-reply-dot')).toBeNull())
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 0 })))

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenLastCalledWith(group.id, true))
    await waitFor(() => expect(container.querySelector('.room-list .needs-reply-dot')).toBeTruthy())
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 1 })))
  })

  it.each([false, true])('keeps the conversation open after sending in Needs reply with another room: %s', async (hasAnotherRoom) => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Group project', direct: false, bridge: 'IG', unanswered: true, needsReply: true }
    const otherRooms = hasAnotherRoom ? [secondRoom] : []
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [group, ...otherRooms] })
    render(<App />)
    await screen.findByRole('textbox', { name: 'Message' })
    await user.click(await screen.findByRole('button', { name: 'Needs reply' }))
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'reply in the group')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...group, unanswered: false, needsReply: false }, ...otherRooms] })
    await user.click(await screen.findByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(group.id, 'reply in the group'))
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Rooms' })).queryByRole('button', { name: /Group project/ })).toBeNull())
    expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(group.id)
    expect(screen.getByRole('button', { name: 'Needs reply' }).getAttribute('aria-pressed')).toBe('true')
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'one more thing')
    await user.click(await screen.findByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenLastCalledWith(group.id, 'one more thing'))
    expect(harness.service.SetRoomUnanswered).not.toHaveBeenCalled()
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(expect.stringContaining('needs_reply'), expect.anything())
  })

  it('shows room action shortcuts and runs them from the context menu', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })

    const menu = await screen.findByRole('menu')
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

  it.each(['connecting', 'syncing', 'connected', 'offline'])('submits the recovery key before initial sync completes while %s', async (connectionState) => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, needsVerification: true, syncReady: false, connectionState })
    harness.service.Verify.mockResolvedValue(undefined)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Verify this device' })).toBeTruthy()
    const recoveryInput = await screen.findByLabelText('Recovery key or passphrase') as HTMLInputElement
    fireEvent.change(recoveryInput, { target: { value: ' test recovery key ' } })
    expect(recoveryInput.value).toBe(' test recovery key ')
    expect(screen.getByRole('button', { name: 'Verify device' }).hasAttribute('disabled')).toBe(false)
    await user.click(await screen.findByRole('button', { name: 'Verify device' }))
    expect(harness.service.Verify).toHaveBeenCalledWith('test recovery key')
    await waitFor(() => expect(recoveryInput.value).toBe(''))

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
})
