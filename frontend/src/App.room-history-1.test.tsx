import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { emitMatrixUpdate, harness, room, message, openMessageMenu, menuCommand, snapshot } from './appTestSetup'

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

  it('reports the overscanned room range and prefetches when scrolling reaches the loaded tail', async () => {
    const rooms = Array.from({ length: 20 }, (_, index) => ({
      ...room,
      id: `!room-${index}:example.org`,
      name: `Room ${index}`,
    }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms, slidingSyncListCounts: { main: 40 } })
    render(<App />)

    // 600px viewport / 52px row pitch + 8 overscan reaches all 20 loaded rooms, so the prefetch
    // to the 40-room list count fires on the first render. After scrolling to 1000px the first
    // index is floor(1000 / 52) - 8 = 11.
    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
    await waitFor(() => expect(harness.service.UpdateVisibleRange).toHaveBeenCalledWith('main', 0, 40))

    act(() => {
      Object.defineProperty(roomList, 'scrollTop', { configurable: true, value: 1000 })
      fireEvent.scroll(roomList)
    })
    await waitFor(() => expect(harness.service.UpdateVisibleRange).toHaveBeenLastCalledWith('main', 11, 40))
  })

  it('keeps AI actions disabled until an AI endpoint is set', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect((menuCommand('Summarize with AI') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Analyze chat topics' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Analyze conversation' })).toBeNull()
  })

  it('keeps only the Local AI summary action among the room analysis buttons', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(menuCommand('Summarize with AI')).toBeTruthy()
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
    expect(screen.getByRole('button', { name: 'Attach file' }).title).toBe('Attach a file')
    expect(screen.getByRole('button', { name: 'Room actions' }).parentElement?.getAttribute('data-tooltip')).toBe('Room actions')
    const utilities = await screen.findByRole('group', { name: 'Conversation utilities' })
    expect(within(utilities).getByRole('button', { name: 'Search messages' })).toBeTruthy()
    const roomDetails = await screen.findByRole('group', { name: 'Room details' })
    expect(within(roomDetails).getByRole('button', { name: 'Room actions' })).toBeTruthy()
    expect(within(roomDetails).getByRole('button', { name: 'Room details' }).parentElement?.getAttribute('data-tooltip')).toBe('Room details')
    expect((await screen.findByRole('button', { name: 'Add 👍 reaction' }) as HTMLButtonElement).title).toBe('Add 👍 reaction')
    openMessageMenu(container)
    expect((await screen.findByRole('menuitem', { name: 'Copy message' }) as HTMLButtonElement).title).toBe('Copy message')
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
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    await user.click(composer)
    const initialRenderCount = harness.markdownRenderCount

    await user.type(composer, 'typing')

    expect(harness.markdownRenderCount).toBe(initialRenderCount)
  })

  it('skips message rerenders and history reloads for unchanged Matrix room snapshots', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const emitUnchangedUpdate = async () => {
      await act(async () => {
        emitMatrixUpdate({
          rooms: [room],
          changedRoomId: [],
          timelineChangedRoomId: [],
          typingUsers: { [room.id]: [] },
          notifications: [],
          error: '',
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        })
        await Promise.resolve()
      })
    }

    await emitUnchangedUpdate()
    const message = screen.getByText('latest message')
    const renderCount = harness.markdownRenderCount
    const historyCalls = harness.service.History.mock.calls.length
    await emitUnchangedUpdate()
    await emitUnchangedUpdate()

    expect(harness.markdownRenderCount).toBe(renderCount)
    expect(harness.service.History).toHaveBeenCalledTimes(historyCalls)
    expect(screen.getByText('latest message')).toBe(message)
  })

  it('merges incremental new_messages and read_receipts without reloading full History', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const historyCalls = harness.service.History.mock.calls.length

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [{
            roomId: room.id,
            message: { ...message('$incremental', 'incremental delta message', 400), own: true },
          }],
          read_receipts: [],
          typing_updates: [],
          room_deltas: [{
            update: {
              rooms: [{ ...room, lastEventId: '$incremental', lastEventAt: 400, lastSeen: 400, preview: 'incremental delta message' }],
              changedRoomId: [room.id],
              timelineChangedRoomId: [room.id],
              typingUsers: {},
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

    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    expect(await within(timeline).findByText('incremental delta message')).toBeTruthy()
    expect(harness.service.History).toHaveBeenCalledTimes(historyCalls)

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [],
          read_receipts: [{
            roomId: room.id,
            eventId: '$incremental',
            timestamp: 500,
          }],
          typing_updates: [],
          room_deltas: [{
            update: {
              rooms: [{ ...room, lastEventId: '$incremental', lastEventAt: 400, lastSeen: 400, lastEventSeenAt: 500 }],
              changedRoomId: [room.id],
              timelineChangedRoomId: [room.id],
              typingUsers: {},
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

    expect(await screen.findByText(/Seen at/)).toBeTruthy()
    expect(harness.service.History).toHaveBeenCalledTimes(historyCalls)
  })

  it('applies edited_messages in place without reloading full History', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const historyCalls = harness.service.History.mock.calls.length
    const timeline = screen.getByRole('region', { name: 'Message timeline' })

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [{ roomId: room.id, message: message('$edit-target', 'before edit', 410) }],
          edited_messages: null,
          read_receipts: [],
          typing_updates: [],
          room_deltas: [],
        },
      })
      await Promise.resolve()
    })
    expect(await within(timeline).findByText('before edit')).toBeTruthy()

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [],
          edited_messages: [{
            roomId: room.id,
            message: { ...message('$edit-target', 'after edit', 410), edited: true, editHistory: ['before edit'] },
          }],
          read_receipts: [],
          typing_updates: [],
          room_deltas: [],
        },
      })
      await Promise.resolve()
    })

    expect(await within(timeline).findByText('after edit')).toBeTruthy()
    expect(harness.service.History).toHaveBeenCalledTimes(historyCalls)
  })

  it('applies reaction_deltas and redacted_event_ids in place without reloading full History', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const historyCalls = harness.service.History.mock.calls.length
    const timeline = screen.getByRole('region', { name: 'Message timeline' })

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [{ roomId: room.id, message: message('$delta-target', 'target message', 420) }],
          edited_messages: null,
          redacted_event_ids: null,
          reaction_deltas: null,
          read_receipts: [],
          typing_updates: [],
          room_deltas: [],
        },
      })
      await Promise.resolve()
    })
    expect(await within(timeline).findByText('target message')).toBeTruthy()

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [],
          reaction_deltas: [{
            roomId: room.id,
            eventId: '$delta-target',
            reactions: { '🎉': 3 },
            reacted: { '🎉': true },
          }],
          read_receipts: [],
          typing_updates: [],
          room_deltas: [],
        },
      })
      await Promise.resolve()
    })
    expect(await within(timeline).findByText('🎉 3')).toBeTruthy()
    expect(harness.service.History).toHaveBeenCalledTimes(historyCalls)

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [],
          redacted_event_ids: [{ roomId: room.id, eventId: '$delta-target', redactedBy: '$mod' }],
          read_receipts: [],
          typing_updates: [],
          room_deltas: [],
        },
      })
      await Promise.resolve()
    })
    expect(await within(timeline).findByText('Message removed')).toBeTruthy()
    expect(harness.service.History).toHaveBeenCalledTimes(historyCalls)
  })
})
