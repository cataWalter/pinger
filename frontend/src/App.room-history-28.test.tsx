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

  it('toggles content blur with the privacy shortcut and preserves the draft', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'private draft' } })
    composer.focus()

    fireEvent.keyDown(composer, { key: 'p', metaKey: true, shiftKey: true })
    await waitFor(() => expect(appShell.getAttribute('data-content-blur')).toBe('true'))
    expect(screen.queryByRole('button', { name: 'Show screen content' })).toBeNull()
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('privacy.incognito', true))
    expect(composer.value).toBe('private draft')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'p', metaKey: true, shiftKey: true })
    await waitFor(() => expect(appShell.getAttribute('data-content-blur')).toBe('false'))
    expect(screen.queryByRole('button', { name: 'Show screen content' })).toBeNull()
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('privacy.incognito', false))
    expect(composer.value).toBe('private draft')
  })

  it('toggles hiding images and videos with Cmd+Shift+I without losing the draft', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'keep this draft' } })
    composer.focus()

    fireEvent.keyDown(composer, { key: 'i', metaKey: true, shiftKey: true })
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('appearance.hide_images_and_videos', true))
    expect(composer.value).toBe('keep this draft')

    fireEvent.keyDown(window, { key: 'i', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('appearance.hide_images_and_videos', false))
    expect(composer.value).toBe('keep this draft')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('opens keyboard help and focuses room search with unmodified shortcuts', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!

    fireEvent.keyDown(appShell, { key: '/' })
    expect(document.activeElement).toBe(await screen.findByRole('textbox', { name: 'Find a room' }))
    fireEvent.keyDown(await screen.findByRole('textbox', { name: 'Find a room' }), { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'Quick switcher' })).toBeNull()

    fireEvent.keyDown(appShell, { key: 'f', ctrlKey: true })
    const messageSearch = await screen.findByRole('textbox', { name: 'Search local message history' })
    fireEvent.keyDown(messageSearch, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search local message history' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search messages' })))

    fireEvent.keyDown(appShell, { key: 'f', ctrlKey: true })
    await screen.findByRole('textbox', { name: 'Search local message history' })
    await user.click(await screen.findByRole('button', { name: 'Close message search' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search messages' })))

    fireEvent.keyDown(appShell, { key: '?' })
    expect((await screen.findByRole('tab', { name: 'Keyboard' })).getAttribute('aria-selected')).toBe('true')
    await user.click(await screen.findByText('Advanced'))
    expect(screen.getByText('Navigate the focused timeline')).toBeTruthy()
    expect(screen.getByText('Reply to the focused message')).toBeTruthy()
    expect(screen.getByText('Toggle content blur')).toBeTruthy()
  })

  it('keeps room filter shortcuts in tooltips and opens filters with modifier shortcuts', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    const unansweredButton = await screen.findByRole('button', { name: 'Unanswered rooms' })
    const archiveButton = await screen.findByRole('button', { name: 'Archived rooms' })
    const favoriteButton = await screen.findByRole('button', { name: 'Favorite rooms' })

    expect(unansweredButton.getAttribute('title')).toContain('Shift + R')
    expect(unansweredButton.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+R Meta+Shift+R')
    expect(archiveButton.getAttribute('title')).toContain('Shift + H')
    expect(archiveButton.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+H Meta+Shift+H')
    expect(favoriteButton.getAttribute('title')).toContain('Shift + F')
    expect(favoriteButton.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+F Meta+Shift+F')
    expect(container.querySelector('.room-filters kbd')).toBeNull()
    fireEvent.keyDown(appShell, { key: 'r', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(unansweredButton.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.keyDown(appShell, { key: 'h', metaKey: true, shiftKey: true })
    await waitFor(() => expect(archiveButton.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.keyDown(appShell, { key: 'f', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(favoriteButton.getAttribute('aria-pressed')).toBe('true'))
  })

  it('disables spelling correction in search and filter inputs', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    const expectNoCorrection = (input: HTMLElement) => {
      expect(input.getAttribute('spellcheck')).toBe('false')
      expect(input.getAttribute('autocorrect')).toBe('off')
      expect(input.getAttribute('autocapitalize')).toBe('off')
    }
    expectNoCorrection(await screen.findByRole('textbox', { name: 'Find a room' }))

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'k', ctrlKey: true })
    const quickSearch = await screen.findByRole('textbox', { name: 'Search rooms' })
    expectNoCorrection(quickSearch)
    fireEvent.keyDown(quickSearch, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quick switcher' })).toBeNull())

    await user.click(await screen.findByRole('button', { name: 'Search messages' }))
    const messageSearch = await screen.findByRole('textbox', { name: 'Search local message history' })
    expectNoCorrection(messageSearch)
    await user.click(screen.getByText('Filters'))
    expectNoCorrection(await screen.findByRole('textbox', { name: 'Filter by sender' }))
    fireEvent.keyDown(messageSearch, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search local message history' })).toBeNull())

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    expectNoCorrection(await screen.findByRole('searchbox', { name: 'Search settings' }))
  })

  it('searches all chats, paginates results, and opens the matching message', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    harness.service.SearchMessages
      .mockResolvedValueOnce({
        results: [{ roomID: secondRoom.id, message: message('$new', 'needle from another chat', 400) }],
        nextBatch: 'local_offset:50',
      })
      .mockResolvedValueOnce({ results: [], nextBatch: '' })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: 'f', ctrlKey: true })
    const query = await screen.findByRole('textbox', { name: 'Search local message history' })
    await user.type(query, 'needle')
    await user.click(await screen.findByRole('button', { name: 'Search' }))

    expect(await screen.findByRole('button', { name: 'Open message in Second room' })).toBeTruthy()
    expect(harness.service.SearchMessages).toHaveBeenNthCalledWith(1, {
      query: 'needle',
      roomID: '',
      sender: '',
      minTimestamp: 0,
      maxTimestamp: 0,
      limit: 50,
      nextBatch: '',
    })

    await user.click(await screen.findByRole('button', { name: 'Load more results' }))
    await waitFor(() => expect(harness.service.SearchMessages).toHaveBeenCalledTimes(2))
    expect(harness.service.SearchMessages).toHaveBeenNthCalledWith(2, expect.objectContaining({ nextBatch: 'local_offset:50' }))

    await user.click(await screen.findByRole('button', { name: 'Open message in Second room' }))
    expect(await screen.findByText('new live message')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Second room' })).toBeTruthy()
  })
})
