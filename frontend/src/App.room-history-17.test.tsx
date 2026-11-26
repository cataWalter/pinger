import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('sends read receipts when content blur is enabled by a legacy preference', async () => {
    const blurredRoom = { ...room, direct: false, unread: 2, lastEventId: '$blur-latest' }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [blurredRoom],
      preferences: { 'privacy.incognito': true },
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(document.querySelector('.app-shell')?.getAttribute('data-content-blur')).toBe('true')
    const blurIndicator = await screen.findByRole('status', { name: 'Content blur is on' })
    expect(blurIndicator).toBeTruthy()
    expect(blurIndicator.textContent).toBe('')
    expect(document.querySelector('.conversation-room-avatar')).toBeTruthy()
    await waitFor(() => expect(harness.service.MarkRead).toHaveBeenCalledWith(blurredRoom.id, '$blur-latest'))
    await waitFor(() => expect(document.querySelector('.room-button.is-active .unread-count')).toBeNull())
  })

  it('sends a read receipt when opening an unread room with content blur enabled', async () => {
    const user = userEvent.setup()
    const unreadRoom = { ...secondRoom, name: 'Unread chat', unread: 3, mentions: 1, lastEventId: '$unread' }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, unreadRoom],
      preferences: { 'privacy.incognito': true },
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const unreadButton = await screen.findByRole('button', { name: /Unread chat/ })
    expect(unreadButton.querySelector('.unread-count')?.textContent).toBe('3')

    await user.click(unreadButton)
    await waitFor(() => expect(harness.service.MarkRead).toHaveBeenCalledWith(unreadRoom.id, '$unread'))
    await waitFor(() => expect(unreadButton.querySelector('.unread-count')).toBeNull())
  })

  it('marks a group read through its latest synced event when local history is behind', async () => {
    const group = { ...room, direct: false, unread: 2, lastEventId: '$sync-latest' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [group] })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await waitFor(() => expect(harness.service.MarkRead).toHaveBeenCalledWith(group.id, '$sync-latest'))
    await waitFor(() => expect(document.querySelector('.room-button.is-active .unread-count')).toBeNull())
  })

  it('ignores the retired compact message layout preference', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.compact': true } })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(container.querySelector('.app-shell')?.hasAttribute('data-compact')).toBe(false)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    expect(screen.queryByRole('checkbox', { name: 'Compact message layout' })).toBeNull()
  })

  it('disables spelling and autocorrect in the message composer by default', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: {} })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    expect(composer.getAttribute('spellcheck')).toBe('false')
    expect(composer.getAttribute('autocorrect')).toBe('off')
    expect(composer.getAttribute('autocapitalize')).toBe('off')
  })

  it('moves focus from the empty composer to the message list when configured', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'composer.arrow_up_focus_timeline': true } })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    const timeline = await screen.findByRole('region', { name: 'Message timeline' })
    composer.focus()
    fireEvent.keyDown(composer, { key: 'ArrowUp' })

    expect(document.activeElement).toBe(timeline)
  })

  it('hides deleted messages when the appearance preference is enabled', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.hide_deleted_messages': true } })
    harness.service.History.mockResolvedValueOnce({
      messages: [
        { ...message('$removed', 'removed body', 200), redacted: true },
        message('$latest', 'latest message', 300),
      ],
      before: 50,
      hasMore: true,
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.queryByText('Message removed')).toBeNull()
  })
})
