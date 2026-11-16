import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Message } from '../bindings/mychat/desktop/models.js'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { createTimelineTimeFormatter } from './appShared'
import { formatDayLabel } from './format'
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

  it.each([false, true])('reuses one timeline clock formatter with 24-hour preference %s', (use24Hour) => {
    const timestamps = Array.from({ length: 1000 }, (_, index) => Date.now() - index * 60_000)
    const expected = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: !use24Hour })
    const constructor = vi.spyOn(Intl, 'DateTimeFormat')
    try {
      const format = createTimelineTimeFormatter({ 'appearance.time_24_hour': use24Hour })
      expect(timestamps.map(format)).toEqual(timestamps.map((timestamp) => expected.format(new Date(timestamp))))
      expect(constructor).toHaveBeenCalledTimes(1)
    } finally {
      constructor.mockRestore()
    }
  })

  it('reuses relative formatters and falls back to clock time for older messages', () => {
    const now = Date.now()
    const recent = [now - 5 * 60_000, now - 120 * 60_000]
    const old = now - 48 * 60 * 60_000
    const expectedClock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(old))
    const expectedRelative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    const clockConstructor = vi.spyOn(Intl, 'DateTimeFormat')
    const relativeConstructor = vi.spyOn(Intl, 'RelativeTimeFormat')
    try {
      const format = createTimelineTimeFormatter({ 'appearance.relative_timestamps': true })
      expect(recent.map(format)).toEqual([expectedRelative.format(-5, 'minute'), expectedRelative.format(-2, 'hour')])
      expect(format(old)).toBe(expectedClock)
      expect(format(old)).toBe(expectedClock)
      expect(clockConstructor).toHaveBeenCalledTimes(1)
      expect(relativeConstructor).toHaveBeenCalledTimes(1)
    } finally {
      clockConstructor.mockRestore()
      relativeConstructor.mockRestore()
    }
  })

  it.each([false, true])('shows only time in message headers with 24-hour clock preference %s', async (use24Hour) => {
    const recent = Date.now() - 5 * 60_000
    const old = Date.now() - 2 * 24 * 60 * 60_000
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.time_24_hour': use24Hour } })
    harness.service.History.mockResolvedValue({
      messages: [message('$old', 'older message', old), message('$latest', 'latest message', recent)],
      before: 50,
      hasMore: false,
    })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const oldMeta = container.querySelector('[data-event-id="$old"] .message-meta')
    const latestMeta = container.querySelector('[data-event-id="$latest"] .message-meta')
    const formatClockTime = (timestamp: number) => new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !use24Hour,
    }).format(new Date(timestamp))
    expect(oldMeta?.querySelector('strong')).toBeNull()
    expect(oldMeta?.textContent).toBe(formatClockTime(old))
    expect(latestMeta?.querySelector('strong')).toBeNull()
    expect(latestMeta?.textContent).toBe(formatClockTime(recent))
  })

  it('clears the previous timeline while the selected chat history loads', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    let resolveSecondPage: ((page: { messages: Message[]; before: number; hasMore: boolean }) => void) | undefined
    const secondPage = new Promise<{ messages: Message[]; before: number; hasMore: boolean }>((resolve) => {
      resolveSecondPage = resolve
    })
    harness.service.History.mockImplementation(async (roomID: string) => {
      if (roomID === room.id) return { messages: [message('$first-room', 'First room message', 100)], before: 0, hasMore: false }
      return secondPage
    })
    const { container } = render(<App />)

    expect(await screen.findByText('First room message')).toBeTruthy()
    await user.click(container.querySelector('.room-button[title="Second room"]')!)
    expect(await screen.findByText('Loading messages')).toBeTruthy()
    expect(screen.queryByText('First room message')).toBeNull()
    const timeline = await screen.findByRole('region', { name: 'Message timeline' })
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 500 })

    await act(async () => {
      resolveSecondPage?.({ messages: [message('$second-latest', 'Second room latest', 200)], before: 0, hasMore: false })
      await secondPage
    })
    expect(await screen.findByText('Second room latest')).toBeTruthy()
    expect(timeline.scrollTop).toBe(500)
  })

  it('uses the same calendar date for yesterday messages in the sidebar and timeline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 0, 2, 12))
      const yesterday = new Date(2026, 0, 1, 13).getTime()
      const previousYear = new Date(2025, 11, 31, 13).getTime()
      harness.service.Snapshot.mockResolvedValue({
        ...snapshot,
        rooms: [{ ...room, preview: 'message from yesterday', lastEventAt: yesterday }],
      })
      harness.service.History.mockResolvedValue({
        messages: [message('$yesterday', 'message from yesterday', yesterday)],
        before: 0,
        hasMore: false,
      })
      const { container } = render(<App />)
      const timeline = await screen.findByRole('region', { name: 'Message timeline' })
      await within(timeline).findByText('message from yesterday')

      const expectedDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(yesterday))
      const expectedTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(yesterday))
      expect(container.querySelector('.room-button[title="Test room"] .room-meta time')?.textContent).toBe(expectedDate)
      expect(timeline.querySelector('[data-event-id="$yesterday"] .message-meta time')?.textContent).toBe(expectedTime)
      expect(timeline.querySelector('.day-divider')?.textContent).toBe('Yesterday')
      expect(formatDayLabel(previousYear)).toContain('2025')
    } finally {
      vi.useRealTimers()
    }
  })

  it('disables message entrance animations when configured', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.message_animations': false } })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(container.querySelector('.app-shell')?.getAttribute('data-message-animations')).toBe('false')
  })

  it('reloads the initial page when the history count preference changes', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'History' }))
    await user.selectOptions(await screen.findByRole('combobox'), '250')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('history.initial_messages', '250'))
    await waitFor(() => expect(harness.service.History).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('new live message')).toBeTruthy()
  })
})
