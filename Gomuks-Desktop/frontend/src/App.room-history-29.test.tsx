import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, secondRoom, message, menuCommand, snapshot } from './appTestSetup'

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

  it('opens global search with no selected room', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [] })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Pinger' })).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Search messages' }))
    await user.type(await screen.findByRole('textbox', { name: 'Search local message history' }), 'invoice')
    await user.click(await screen.findByRole('button', { name: 'Search' }))

    await waitFor(() => expect(harness.service.SearchMessages).toHaveBeenCalledWith(expect.objectContaining({
      query: 'invoice',
      roomID: '',
      limit: 50,
    })))
  })

  it('passes room, sender, and date filters to local message search', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'f', ctrlKey: true })
    await user.type(await screen.findByRole('textbox', { name: 'Search local message history' }), 'report')
    await user.click(screen.getByText('Filters'))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Filter by room' }), secondRoom.id)
    await user.type(await screen.findByRole('textbox', { name: 'Filter by sender' }), '@alice:example.org')
    fireEvent.change(await screen.findByLabelText('Search from date'), { target: { value: '2026-10-01' } })
    fireEvent.change(await screen.findByLabelText('Search to date'), { target: { value: '2026-10-17' } })
    await user.click(await screen.findByRole('button', { name: 'Search' }))

    await waitFor(() => expect(harness.service.SearchMessages).toHaveBeenCalledWith({
      query: 'report',
      roomID: secondRoom.id,
      sender: '@alice:example.org',
      minTimestamp: new Date('2026-10-01T00:00:00').getTime(),
      maxTimestamp: new Date('2026-10-17T23:59:59.999').getTime(),
      limit: 50,
      nextBatch: '',
    }))
  })

  it('navigates the timeline and replies from a focused message', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const timeline = await screen.findByRole('region', { name: 'Message timeline' })
    fireEvent.keyDown(timeline, { key: 'ArrowDown' })

    const messageRow = container.querySelector<HTMLElement>('.message-row')!
    expect(document.activeElement).toBe(messageRow)
    fireEvent.keyDown(messageRow, { key: 'r' })

    expect(await screen.findByText('Replying to Alice')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })))
  })

  it('shows all previous versions in the edited-message tooltip', async () => {
    harness.service.History.mockResolvedValueOnce({
      messages: [{ ...message('$edited', 'current version', Date.now()), edited: true, editHistory: ['original version', 'first edit'] }],
      before: 0,
      hasMore: false,
    })
    render(<App />)

    expect(await screen.findByText('current version')).toBeTruthy()
    expect(screen.getByText('edited (2 prior)').getAttribute('title')).toBe('original version\nfirst edit')
  })

  it('schedules a composer draft for a future time', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'schedule.default_send_minutes': '30' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'send this later')
    await user.click(menuCommand('Schedule message'))
    const dialog = await screen.findByRole('dialog', { name: 'Schedule message' })
    const sendAt = within(dialog).getByLabelText('Send at') as HTMLInputElement
    const defaultSendAt = new Date(sendAt.value).getTime()
    expect(defaultSendAt).toBeGreaterThanOrEqual(Date.now() + 29 * 60_000)
    expect(defaultSendAt).toBeLessThanOrEqual(Date.now() + 31 * 60_000)
    await user.click(within(dialog).getByRole('button', { name: 'Schedule message' }))

    await waitFor(() => expect(harness.service.ScheduleMessage).toHaveBeenCalledWith(room.id, 'send this later', expect.any(Number)))
    expect(harness.service.ScheduleMessage.mock.calls[0][2]).toBeGreaterThan(Date.now())
  })

  it('keeps a pending schedule modal open and preserves a newer draft on completion', async () => {
    const user = userEvent.setup()
    let completeSchedule!: () => void
    harness.service.ScheduleMessage.mockReturnValueOnce(new Promise<void>((resolve) => { completeSchedule = resolve }))
    render(<App />)
    await screen.findByText('latest message')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'send this later' } })
    await user.click(menuCommand('Schedule message'))
    const dialog = await screen.findByRole('dialog', { name: 'Schedule message' })
    await user.click(within(dialog).getByRole('button', { name: 'Schedule message' }))
    const close = within(dialog).getByRole('button', { name: 'Close schedule dialog' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    expect((within(dialog).getByLabelText('Send at') as HTMLInputElement).disabled).toBe(true)
    expect(within(dialog).getByRole('group', { name: 'Time suggestions' }).querySelectorAll('button:not(:disabled)')).toHaveLength(0)
    fireEvent.click(close)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(dialog.parentElement!)
    expect(await screen.findByRole('dialog', { name: 'Schedule message' })).toBe(dialog)
    fireEvent.change(composer, { target: { value: 'a newer draft' } })
    await act(async () => completeSchedule())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Schedule message' })).toBeNull())
    expect(composer.value).toBe('a newer draft')
    expect(harness.service.ScheduleMessage).toHaveBeenCalledTimes(1)
  })

  it('puts the tail on the final message in an outgoing group', async () => {
    const ownMessages = [100, 200, 300].map((timestamp, index) => ({
      ...message(`$own-${index}`, `sent ${index + 1}`, timestamp),
      sender: snapshot.profile.userId,
      senderName: snapshot.profile.displayName,
      own: true,
    }))
    harness.service.History.mockResolvedValueOnce({ messages: ownMessages, before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('sent 1')).toBeTruthy()
    const rows = [...container.querySelectorAll<HTMLElement>('.message-row')]
    expect(rows).toHaveLength(3)
    expect(rows[0].classList.contains('is-first')).toBe(true)
    expect(rows[0].classList.contains('is-tail')).toBe(false)
    expect(rows[1].classList.contains('is-grouped')).toBe(true)
    expect(rows[2].classList.contains('is-last')).toBe(true)
    expect(rows[2].classList.contains('is-tail')).toBe(true)
  })

  it('hides the avatar and encryption lock on incoming and outgoing messages', async () => {
    const incomingMessage = {
      ...message('$incoming', 'hello from alice', 100),
      avatar: 'mxc://example.org/alice-avatar',
      encrypted: true,
    }
    const outgoingMessage = {
      ...message('$outgoing', 'sent by me', 200),
      sender: snapshot.profile.userId,
      senderName: snapshot.profile.displayName,
      own: true,
      avatar: 'mxc://example.org/me-avatar',
      encrypted: true,
    }
    harness.service.History.mockResolvedValueOnce({ messages: [incomingMessage, outgoingMessage], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('hello from alice')).toBeTruthy()
    expect(screen.getByText('sent by me')).toBeTruthy()
    expect(container.querySelectorAll('.message-row')).toHaveLength(2)
    expect(container.querySelector('.message-row .message-avatar')).toBeNull()
    expect(container.querySelector('.message-row img')).toBeNull()
    expect(screen.queryByTitle('Encrypted message')).toBeNull()
  })
})
