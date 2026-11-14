import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('sorts rooms from today by time and older rooms by date', async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const timestampAt = (daysAgo: number, hour: number) => {
      const date = new Date(today)
      date.setDate(date.getDate() - daysAgo)
      date.setHours(hour, 0, 0, 0)
      return date.getTime()
    }
    const todayEarlier = { ...room, id: '!today-earlier:example.org', name: 'Today earlier', lastEventAt: timestampAt(0, 10) }
    const yesterday = { ...room, id: '!yesterday:example.org', name: 'Yesterday', lastEventAt: timestampAt(1, 18) }
    const todayLater = { ...room, id: '!today-later:example.org', name: 'Today later', lastEventAt: timestampAt(0, 15) }
    const twoDaysAgo = { ...room, id: '!two-days-ago:example.org', name: 'Two days ago', lastEventAt: timestampAt(2, 20) }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [todayEarlier, yesterday, todayLater, twoDaysAgo] })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const names = Array.from(container.querySelectorAll('.room-list .room-name-text'), (element) => element.textContent)
    expect(names).toEqual(['Today later', 'Today earlier', 'Yesterday', 'Two days ago'])
  })

  it('uses the latest event timestamp when it differs from the room sorting timestamp', async () => {
    const activityAt = (daysAgo: number) => {
      const date = new Date()
      date.setHours(12, 0, 0, 0)
      date.setDate(date.getDate() - daysAgo)
      return date.getTime()
    }
    const mostRecent = {
      ...room,
      id: '!most-recent:example.org',
      name: 'Most recent activity',
      lastSeen: activityAt(0),
      lastEventAt: activityAt(1),
    }
    const older = {
      ...room,
      id: '!older:example.org',
      name: 'Older activity',
      lastSeen: activityAt(1),
      lastEventAt: activityAt(3),
    }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [older, mostRecent] })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.room-list .room-button'))
    expect(buttons.map((button) => button.querySelector('.room-name-text')?.textContent)).toEqual(['Most recent activity', 'Older activity'])
    expect(buttons.map((button) => button.querySelector('.room-meta time')?.textContent)).toEqual([
      new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(mostRecent.lastEventAt)),
      new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(older.lastEventAt)),
    ])
  })

  it('mounts only a window of rooms when the inbox contains many chats', async () => {
    const rooms = Array.from({ length: 1_000 }, (_, index) => ({
      ...room,
      id: `!room-${index}:example.org`,
      name: `Room ${index}`,
    }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(container.querySelectorAll('.room-list .room-button').length).toBeLessThan(40)
    expect(container.querySelector('.room-section-label')?.textContent).toContain('1000')
  })

  it('moves keyboard focus into off-screen rooms in a large inbox', async () => {
    const rooms = Array.from({ length: 1_000 }, (_, index) => ({
      ...room,
      id: `!room-${index}:example.org`,
      name: `Room ${index}`,
    }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const buttons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    const lastVisibleButton = buttons[buttons.length - 1]
    const nextIndex = Number(lastVisibleButton.dataset.roomIndex) + 1

    fireEvent.keyDown(lastVisibleButton, { key: 'ArrowDown' })

    await waitFor(() => expect(container.querySelector(`.room-button[data-room-index="${nextIndex}"]`)).toBeTruthy())
    expect(container.querySelectorAll('.room-list .room-button').length).toBeLessThan(40)
  })

  it('dismisses the answered notification after 10 seconds', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true, needsReply: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    const answerAction = await screen.findByRole('menuitem', { name: /Remove from Needs reply/ })

    vi.useFakeTimers()
    try {
      await act(async () => {
        fireEvent.click(answerAction)
        await Promise.resolve()
      })
      expect(screen.getByText('Marked Test room answered')).toBeTruthy()
      expect(container.querySelector('.conversation .chat-notice-stack .triage-toast')).not.toBeNull()

      act(() => vi.advanceTimersByTime(9_999))
      expect(screen.getByText('Marked Test room answered')).toBeTruthy()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.queryByText('Marked Test room answered')).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it('dismisses an answered notification immediately from the chat area', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true, needsReply: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: /Remove from Needs reply/ }))

    expect(await screen.findByText('Marked Test room answered')).toBeTruthy()
    expect(container.querySelector('.conversation .chat-notice-stack .triage-toast')).not.toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Marked Test room answered')).toBeNull()
  })

  it('adds an answered Matrix room back to Needs reply from its context menu', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unanswered: true }] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Add to Needs reply' }))

    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenCalledWith(room.id, true))
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(expect.stringContaining('needs_reply'), expect.anything())
    expect(container.querySelector('.room-list .needs-reply-dot')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')?.textContent).toBe('1')
  })

  it('does not offer Add to Needs reply for a room whose last message is yours', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    expect(screen.queryByRole('menuitem', { name: 'Add to Needs reply' })).toBeNull()
    expect(container.querySelector('.room-list .needs-reply-dot')).toBeNull()
    expect(harness.service.SetRoomUnanswered).not.toHaveBeenCalled()
  })
})
