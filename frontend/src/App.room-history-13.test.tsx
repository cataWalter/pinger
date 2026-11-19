import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Room } from '../bindings/mychat/desktop/models.js'
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

  it('adds a reaction when a chip you have not set is clicked', async () => {
    const user = userEvent.setup()
    harness.service.React.mockClear()
    harness.service.RemoveReaction.mockClear()
    harness.service.History.mockResolvedValue({
      messages: [{ ...message('$latest', 'latest message', 300), reactions: { '👍': 1 }, reacted: {} }],
      before: 0,
      hasMore: false,
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Add 👍 reaction' }))
    await waitFor(() => expect(harness.service.React).toHaveBeenCalledWith(room.id, '$latest', '👍'))
    expect(harness.service.RemoveReaction).not.toHaveBeenCalled()
  })

  it('ignores repeated reaction clicks while the first request is pending', async () => {
    const user = userEvent.setup()
    let completeReaction: () => void = () => { }
    harness.service.React.mockClear()
    harness.service.React.mockReturnValueOnce(new Promise<void>((resolve) => { completeReaction = resolve }))
    harness.service.History.mockResolvedValue({
      messages: [{ ...message('$latest', 'latest message', 300), reactions: { '👍': 1 }, reacted: {} }],
      before: 0,
      hasMore: false,
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const chip = await screen.findByRole('button', { name: 'Add 👍 reaction' })
    await user.click(chip)
    await user.click(chip)
    expect(harness.service.React).toHaveBeenCalledTimes(1)
    await act(async () => completeReaction())
    await user.click(chip)
    await waitFor(() => expect(harness.service.React).toHaveBeenCalledTimes(2))
  })

  it('clears a reaction error after the retry succeeds', async () => {
    const user = userEvent.setup()
    harness.service.React.mockClear()
    harness.service.React.mockRejectedValueOnce(new Error('reaction rejected by server')).mockResolvedValue(undefined)
    harness.service.History.mockResolvedValue({
      messages: [{ ...message('$latest', 'latest message', 300), reactions: { '👍': 1 }, reacted: {} }],
      before: 0,
      hasMore: false,
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Add 👍 reaction' }))
    expect((await screen.findByRole('alert')).textContent).toContain('reaction rejected by server')
    await user.click(await screen.findByRole('button', { name: 'Add 👍 reaction' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(harness.service.React).toHaveBeenCalledTimes(2)
  })

  it('starts a reply on double-click when configured', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'messages.double_click': 'Reply' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const row = container.querySelector<HTMLElement>('[data-event-id="$latest"]')
    if (!row) throw new Error('Missing timeline row for $latest')
    fireEvent.doubleClick(row)
    expect(await screen.findByText('Replying to Alice')).toBeTruthy()
  })

  it('shows the bridge network label only when the setting is on', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [{ ...room, bridge: 'WhatsApp' }],
      preferences: { 'sidebar.network_icons': true },
    })
    render(<App />)
    expect(await screen.findByText('WhatsApp')).toBeTruthy()
  })

  it('loads older messages automatically when the timeline is scrolled to the top', async () => {
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const timeline = await screen.findByRole('region', { name: 'Message timeline' })

    fireEvent.scroll(timeline)

    expect(await screen.findByText('older history')).toBeTruthy()
    expect(harness.service.History).toHaveBeenLastCalledWith(room.id, 50)
  })

  it('returns to the latest messages when reopening the active room', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const timeline = await screen.findByRole('region', { name: 'Message timeline' })
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 400 })
    timeline.scrollTop = 12

    await user.click(await screen.findByRole('button', { name: /Test room/ }))

    await waitFor(() => expect(timeline.scrollTop).toBe(400))
    expect(await screen.findByText('new live message')).toBeTruthy()
    expect(harness.service.History).toHaveBeenLastCalledWith(room.id, 0)
    expect(container.querySelector('.room-button.is-active')).toBeTruthy()
  })

  it('keeps group chats out of Unanswered and Needs reply except Instagram', async () => {
    const user = userEvent.setup()
    const group: Room = { ...room, id: '!group:example.org', name: 'Study group', direct: false, unanswered: true, needsReply: true }
    const instagramGroup: Room = { ...room, id: '!instagram-group:example.org', name: 'Instagram group', direct: false, bridge: 'IG', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, group, instagramGroup] })
    render(<App />)

    await screen.findByText('latest message')
    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
    expect(screen.getByRole('button', { name: 'Needs reply' }).querySelector('.filter-count')?.textContent).toBe('1')
    expect(within(roomList).getByRole('button', { name: /Study group/ }).querySelector('.needs-reply-dot')).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Instagram group/ }).querySelector('.needs-reply-dot')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Unanswered rooms' }))
    expect(screen.getByRole('button', { name: 'Unanswered rooms' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(roomList).queryByRole('button', { name: /Study group/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Instagram group/ })).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Unanswered rooms' }))
    expect(screen.getByRole('button', { name: 'Unanswered rooms' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(roomList).getByRole('button', { name: /Study group/ })).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Needs reply' }))
    expect(within(roomList).queryByRole('button', { name: /Study group/ })).toBeNull()
    expect(within(roomList).getByRole('button', { name: /Instagram group/ })).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Needs reply' }))
    expect(screen.getByRole('button', { name: 'Needs reply' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(roomList).getByRole('button', { name: /Study group/ })).toBeTruthy()
  })
})
