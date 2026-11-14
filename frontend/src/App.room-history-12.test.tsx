import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, secondRoom, message, openMessageMenu, snapshot } from './appTestSetup'

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
          notifications: [{ roomId: secondRoom.id, accountId: 'acct-1', room: secondRoom.name, sender: 'Alice', senderAvatar: 'mxc://example.org/alice', body: 'A native alert' }],
        },
      })
    })

    await waitFor(() => expect(harness.service.SendNotification).toHaveBeenCalledWith({
      title: 'Alice',
      subtitle: 'Second room',
      body: 'A native alert',
      roomId: secondRoom.id,
      accountId: 'acct-1',
      senderAvatar: 'mxc://example.org/alice',
    }))
    act(() => {
      harness.eventHandlers.get('notification:open-room')?.({ data: secondRoom.id })
    })
    await waitFor(() => expect(harness.service.History).toHaveBeenCalledWith(secondRoom.id, 0))
  })

  it('delivers background account alerts with their own privacy settings without replacing the active timeline', async () => {
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.SendNotification.mockResolvedValue(true)
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'notifications.enabled': false },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    act(() => harness.eventHandlers.get('matrix:update')?.({
      data: {
        accountId: 'second',
        rooms: [{ ...room, accountId: 'second', name: 'Background room' }],
        notificationPreferences: { 'notifications.only_when_unfocused': false, 'notifications.privacy': 'Hidden content' },
        notifications: [{ roomId: room.id, accountId: 'second', sender: 'Private sender', senderAvatar: 'mxc://example.org/private-sender', body: 'Private message', category: 'direct' }],
      }
    }))
    await waitFor(() => expect(harness.service.SendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Matrix', body: 'New activity', accountId: 'second', roomId: room.id, senderAvatar: '',
    })))
    expect(screen.getByText('latest message')).toBeTruthy()
    expect(harness.service.SwitchAccount).not.toHaveBeenCalled()
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
    await waitFor(() => expect(harness.service.SendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'Bob', subtitle: 'Second room', body: 'group chatter', roomId: secondRoom.id })))
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
      expect(harness.service.SendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'Second room', subtitle: '', body: '2 new messages from Alice, Bob', roomId: secondRoom.id }))
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

    const chip = await screen.findByRole('button', { name: 'Remove 👍 reaction' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await user.click(chip)
    await waitFor(() => expect(harness.service.RemoveReaction).toHaveBeenCalledWith(room.id, '$latest', '👍'))
    expect(harness.service.React).not.toHaveBeenCalled()
  })
})
