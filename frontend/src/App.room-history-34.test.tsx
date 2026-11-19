import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, secondRoom, message, openMessageMenu, menuCommand, snapshot } from './appTestSetup'

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

  it('schedules a reply with its original Matrix event target', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Reply to Alice' }))
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Answer later')
    await user.click(menuCommand('Schedule reply'))
    const dialog = await screen.findByRole('dialog', { name: 'Schedule reply' })
    expect(within(dialog).getByText('Replying to Alice')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Schedule reply' }))

    await waitFor(() => expect(harness.service.ScheduleReply).toHaveBeenCalledWith(room.id, 'Answer later', '$latest', expect.any(Number)))
    expect(harness.service.ScheduleMessage).not.toHaveBeenCalled()
  })

  it('keeps message actions out of sight until the message is right-clicked', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    expect(container.querySelector('.message-actions')).toBeNull()

    openMessageMenu(container)
    const menu = await screen.findByRole('menu', { name: 'Message actions' })
    const target = container.querySelector('[data-event-id="$latest"]')
    expect(container.querySelector('.message-context-scrim')).not.toBeNull()
    expect(container.querySelectorAll('.message-context-scrim-panel')).toHaveLength(4)
    expect(target?.classList.contains('is-context-target')).toBe(true)
    expect(within(menu).getByRole('menuitem', { name: 'Reply to Alice' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Set reminder for message' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Add reaction' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Copy message' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Bookmark message' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Mark room as unread' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Copy message with timestamp' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Forward message' })).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull())
    expect(container.querySelector('.message-context-scrim')).toBeNull()
    expect(target?.classList.contains('is-context-target')).toBe(false)
  })

  it('opens message actions when right-clicking selected bubble text', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const body = container.querySelector<HTMLElement>('[data-event-id="$latest"] .message-body')
    if (!body) throw new Error('Message body did not render')
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(body)
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.contextMenu(body, { clientX: 48, clientY: 48 })

    expect(await screen.findByRole('menu', { name: 'Message actions' })).toBeTruthy()
  })

  it('marks a Matrix reply even when its original message preview is unavailable', async () => {
    const reply = { ...message('$reply', 'Reply text', 300), replyToEventId: '$missing-parent' }
    harness.service.History.mockResolvedValueOnce({ messages: [reply], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('Reply text')).toBeTruthy()
    const preview = container.querySelector('[data-event-id="$reply"] .reply-preview')
    expect(preview?.textContent).toContain('Original message unavailable')
  })

  it('persists a bookmark toggle for a message', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Bookmark message' }))

    const key = `message.bookmark.${encodeURIComponent(room.id)}.${encodeURIComponent('$latest')}`
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(key, true))
    openMessageMenu(container)
    expect(await screen.findByRole('menuitem', { name: 'Remove message bookmark' })).toBeTruthy()
  })

  it('marks the current room unread from the message menu', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Mark room as unread' }))

    await waitFor(() => expect(harness.service.MarkUnread).toHaveBeenCalledWith(room.id))
  })

  it('copies a message with a timestamp from the context menu', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Copy message with timestamp' }))

    const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(300))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`[${timestamp}] Alice: latest message`))
  })

  it('forwards a text message to another room', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Forward message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Forward message' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Forward destination' }), secondRoom.id)
    await user.click(within(dialog).getByRole('button', { name: 'Forward' }))

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(secondRoom.id, 'Forwarded from Alice:\n\nlatest message'))
  })

  it('disables text forwarding for media messages', async () => {
    harness.service.History.mockResolvedValue({
      messages: [{ ...message('$latest', 'image caption', 300), mediaUri: 'mxc://example.org/image', mediaType: 'm.image', mediaMime: 'image/png' }],
      before: '',
      hasMore: false,
    })
    const { container } = render(<App />)
    expect(await screen.findByText('image caption')).toBeTruthy()

    openMessageMenu(container)

    expect((await screen.findByRole('menuitem', { name: 'Forward message' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('copies a message with its timestamp when configured', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'clipboard.copy_timestamp': true } })
    const writeText = vi.fn().mockResolvedValue(undefined)
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    openMessageMenu(document.body)
    await user.click(await screen.findByRole('menuitem', { name: 'Copy message' }))

    const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(300))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`[${timestamp}] Alice: latest message`))
  })
})
