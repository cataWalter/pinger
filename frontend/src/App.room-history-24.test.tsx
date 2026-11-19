import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('navigates to the next unread room after an explicit mark-read action', async () => {
    const user = userEvent.setup()
    const markedRoom = { ...secondRoom, unread: 1, lastEventId: '$second' }
    const nextUnreadRoom = { ...secondRoom, id: '!third:example.org', name: 'Third room', unread: 1, lastEventId: '$third' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, markedRoom, nextUnreadRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'General' }))
    await user.selectOptions(await screen.findByRole('combobox', { name: "After changing a room's read state" }), 'next_unread')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('inbox.after_read', 'next_unread'))
    await user.keyboard('{Escape}')

    const roomButtons = container.querySelectorAll<HTMLButtonElement>('.room-list .room-button')
    fireEvent.contextMenu(roomButtons[1], { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Mark room read' }))

    await waitFor(() => {
      expect(harness.service.MarkRead).toHaveBeenCalledWith(markedRoom.id, '$second')
      expect(container.querySelector('.room-button.is-active')?.textContent).toContain(nextUnreadRoom.name)
    })
  })

  it('marks a room unread and navigates to the next unread room', async () => {
    const user = userEvent.setup()
    const nextUnreadRoom = { ...secondRoom, id: '!third:example.org', name: 'Third room', unread: 1, lastEventId: '$third' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, nextUnreadRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'General' }))
    await user.selectOptions(await screen.findByRole('combobox', { name: "After changing a room's read state" }), 'next_unread')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('inbox.after_read', 'next_unread'))
    await user.keyboard('{Escape}')

    const roomButton = container.querySelector<HTMLButtonElement>('.room-list .room-button')!
    fireEvent.contextMenu(roomButton, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Mark room unread' }))

    await waitFor(() => {
      expect(harness.service.MarkUnread).toHaveBeenCalledWith(room.id)
      expect(container.querySelector('.room-button.is-active')?.textContent).toContain(nextUnreadRoom.name)
    })
  })

  it('switches between the room list and conversation on mobile', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    expect(appShell.getAttribute('data-mobile-pane')).toBe('rooms')

    await user.click(await screen.findByRole('button', { name: /Test room/ }))
    expect(appShell.getAttribute('data-mobile-pane')).toBe('conversation')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })))
    await user.click(await screen.findByRole('button', { name: 'Back to rooms' }))
    expect(appShell.getAttribute('data-mobile-pane')).toBe('rooms')

    fireEvent.keyDown(appShell, { key: 'k', metaKey: true })
    const quickSwitcher = await screen.findByRole('textbox', { name: 'Search rooms' })
    fireEvent.keyDown(quickSwitcher, { key: 'Enter' })
    expect(appShell.getAttribute('data-mobile-pane')).toBe('conversation')
  })

  it('shows room previews without sender names', async () => {
    const ownMessageRoom: Room = {
      ...room,
      id: '!own-message:example.org',
      name: 'Sent by me',
      preview: 'My latest message',
      lastEventSender: snapshot.profile.userId,
    }
    const incomingMessageRoom: Room = {
      ...room,
      id: '!incoming-message:example.org',
      name: 'Sent by them',
      preview: 'Their latest message',
      lastEventSender: '@alice:example.org',
    }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [ownMessageRoom, incomingMessageRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const previews = container.querySelectorAll('.room-preview')
    expect(previews[0].textContent).toBe('My latest message')
    expect(previews[1].textContent).toBe('Their latest message')
    expect(previews[0].querySelector('.room-preview-sent')).toBeTruthy()
    expect(previews[1].querySelector('.room-preview-sent')).toBeNull()
    expect(previews[0].querySelector('.room-preview-text')?.classList.contains('is-received')).toBe(false)
    expect(previews[1].querySelector('.room-preview-text')?.classList.contains('is-received')).toBe(true)
  })

  it('shows a seen icon for own latest messages that another user has read', async () => {
    const seenRoom: Room = {
      ...room,
      id: '!seen-message:example.org',
      name: 'Seen by them',
      preview: 'Seen message',
      lastEventSender: snapshot.profile.userId,
      lastEventSeenAt: 1793447100000,
    }
    const unseenRoom: Room = {
      ...room,
      id: '!unseen-message:example.org',
      name: 'Not seen yet',
      preview: 'Unseen message',
      lastEventSender: snapshot.profile.userId,
      lastEventSeenAt: 0,
    }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [seenRoom, unseenRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('Seen message')).toBeTruthy()

    const previews = container.querySelectorAll('.room-preview')
    expect(previews[0].querySelector('.room-preview-sent.is-seen[aria-label="Seen"]')).toBeTruthy()
    expect(previews[1].querySelector('.room-preview-sent.is-seen')).toBeNull()
    expect(previews[1].querySelector('.room-preview-sent[aria-label="Sent by you"]')).toBeTruthy()
  })

  it('shows the time for rooms active today and the date for rooms active on earlier days', async () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(23, 59, 0, 0)
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [
        { ...room, id: '!today:example.org', name: 'Today room', lastEventAt: today.getTime() },
        { ...room, id: '!yesterday:example.org', name: 'Yesterday room', lastEventAt: yesterday.getTime() },
      ],
    })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.room-button[title="Yesterday room"]')).toBeTruthy())

    expect(container.querySelector('.room-button[title="Today room"] .room-meta time')?.textContent).toBe(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(today))
    expect(container.querySelector('.room-button[title="Yesterday room"] .room-meta time')?.textContent).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(yesterday))
  })

  it('leaves the preview empty instead of showing the room ID', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [{ ...room, id: '!quiet:example.org', name: 'Quiet room', preview: '', topic: '' }],
    })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.room-button[title="Quiet room"]')).toBeTruthy())

    expect(container.querySelector('.room-button[title="Quiet room"] .room-preview')?.textContent).toBe('')
  })

  it('dates rooms without a message time by their last activity', async () => {
    const activity = Date.now() - 2 * 24 * 60 * 60_000
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [
        { ...room, id: '!backfilled:example.org', name: 'Backfilled room', lastEventAt: 0, lastSeen: activity },
        { ...room, id: '!silent:example.org', name: 'Silent room', lastEventAt: 0, lastSeen: 0 },
      ],
    })
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('.room-button[title="Silent room"]')).toBeTruthy())

    expect(container.querySelector('.room-button[title="Backfilled room"] .room-meta time')?.textContent).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(activity)))
    expect(container.querySelector('.room-button[title="Silent room"] .room-meta time')).toBeNull()
  })

  it('sorts chats by activity date while keeping favorites pinned', async () => {
    const dayAt = (daysAgo: number) => {
      const date = new Date()
      date.setHours(12, 0, 0, 0)
      date.setDate(date.getDate() - daysAgo)
      return date.getTime()
    }
    const oldest = { ...room, id: '!oldest:example.org', name: 'Oldest', lastEventAt: dayAt(3) }
    const middle = { ...room, id: '!middle:example.org', name: 'Middle', lastEventAt: 0, lastSeen: dayAt(2) }
    const newest = { ...room, id: '!newest:example.org', name: 'Newest', lastEventAt: dayAt(1) }
    const favorite = { ...room, id: '!favorite:example.org', name: 'Favorite', favorite: true, lastEventAt: dayAt(4) }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [oldest, middle, newest, favorite] })

    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const names = Array.from(container.querySelectorAll('.room-list .room-name-text'), (element) => element.textContent)
    expect(names).toEqual(['Favorite', 'Newest', 'Middle', 'Oldest'])
  })
})
