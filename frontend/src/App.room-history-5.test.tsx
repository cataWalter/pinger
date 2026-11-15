import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, message, openMessageMenu, menuCommand, suggestedReplyFixture, snapshot } from './appTestSetup'

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

  it('loads older history only until your last message and translates what follows it', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => before === 0
      ? { messages: [message('$received-late', 'late received', 300)], before: 80, hasMore: true }
      : {
        messages: [
          message('$outside', 'outside received', 50),
          { ...message('$own-older', 'my older message', 200), own: true, sender: snapshot.profile.userId },
          message('$received-older', 'older received', 250),
        ],
        before: 40,
        hasMore: true,
      })
    harness.tutorService.Analyze.mockImplementation(async (body: string) => ({ translation: `EN ${body}` }))

    const { container } = render(<App />)
    expect(await screen.findByText('late received')).toBeTruthy()
    await user.click(menuCommand('Translate messages received since your last message to English'))

    await screen.findByText('EN late received')
    expect(harness.service.History.mock.calls.filter(([, before]) => before !== 0)).toEqual([[room.id, 80]])
    expect(harness.tutorService.Analyze.mock.calls.map((call) => call[0])).toEqual(['older received', 'late received'])
    expect(container.querySelector('[data-event-id="$received-older"] .message-translation')?.textContent).toContain('EN older received')
    expect(container.querySelector('[data-event-id="$outside"] .message-translation')).toBeNull()
    expect(container.querySelector('[data-event-id="$own-older"] .message-translation')).toBeNull()
  })

  it('explains when no incoming messages follow your last message', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [{ ...message('$own-latest', 'My latest message', 300), own: true, sender: snapshot.profile.userId }], before: 0, hasMore: false })

    render(<App />)
    expect(await screen.findByText('My latest message')).toBeTruthy()
    await user.click(menuCommand('Translate messages received since your last message to English'))

    expect(await screen.findByText(/There are no incoming text messages since your last message/)).toBeTruthy()
    expect(harness.tutorService.Analyze).not.toHaveBeenCalled()
  })

  it('notes an unchanged draft and copies a tutor result', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434', 'ai.tutor_language': 'es', 'ai.default_language': 'en' },
    })
    harness.tutorService.Analyze.mockResolvedValueOnce({
      detected_language: 'es',
      corrected_text: 'Hola, ¿cómo estás?',
      translation: 'Hello, how are you?',
      text_to_insert: 'Hola, ¿cómo estás?',
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Hola, ¿cómo estás?' } })
    await user.click(menuCommand('Analyze draft with Language Tutor'))

    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    expect(await within(dialog).findByText('No changes needed. The text is already correct.')).toBeTruthy()
    expect(within(dialog).queryByText('Explained in English')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Copy corrected · spanish' }))
    expect(writeText).toHaveBeenCalledWith('Hola, ¿cómo estás?')
  })

  it('shows the Language Tutor analysis for each translated message', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$received-turkish', 'Nasılsın?', 300)], before: 0, hasMore: false })
    harness.tutorService.Analyze.mockResolvedValueOnce({
      detected_language: 'tr',
      corrected_text: 'Nasılsın?',
      translation: 'How are you?',
      text_to_insert: '',
    })

    const { container } = render(<App />)
    expect(await screen.findByText('Nasılsın?')).toBeTruthy()
    await user.click(menuCommand('Translate messages received since your last message to English'))

    await waitFor(() => expect(container.querySelector('[data-event-id="$received-turkish"] .message-translation')?.textContent).toContain('How are you?'))
    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Nasılsın?', 'message', 'tr', 'en', expect.any(String))
    const translation = container.querySelector<HTMLElement>('[data-event-id="$received-turkish"] .message-translation')
    expect(translation).toBeTruthy()
    expect(within(translation as HTMLElement).getByText('How are you?')).toBeTruthy()
    expect(within(translation as HTMLElement).queryByText('WORD-BY-WORD')).toBeNull()
    expect((translation as HTMLElement).querySelector('.language-tutor-phrase')).toBeNull()
    expect(within(translation as HTMLElement).queryByText('GRAMMAR RULE')).toBeNull()
  })

  it.each(['menu', 'ctrlKey', 'metaKey'])('drafts a reply from nearby context with %s and keeps the selected message as the reply target', async (activation) => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('A suggested reply')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    if (activation === 'menu') {
      openMessageMenu(container)
      await user.click(await screen.findByRole('menuitem', { name: 'Draft reply with local AI' }))
    } else {
      const row = screen.getByText('selected message').closest<HTMLElement>('[data-event-id]')!
      row.focus()
      fireEvent.keyDown(row, { key: 'D', code: 'KeyD', [activation]: true, shiftKey: true })
    }

    const request = await waitFor(() => {
      expect(harness.service.AIComplete).toHaveBeenCalledTimes(1)
      return harness.service.AIComplete.mock.calls[0][0]
    })
    expect(request[1].content).toContain('earlier context')
    expect(request[1].content).toContain('selected message')
    const dialog = await screen.findByRole('dialog', { name: 'Draft reply' })
    await user.click(within(dialog).getByRole('button', { name: 'Use as reply draft' }))

    expect(screen.getByText('Replying to Alice')).toBeTruthy()
    expect((await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('A suggested reply')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
  })

  it('does not request automatic AI text suggestions while typing', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

    fireEvent.change(composer, { target: { value: 'hello', selectionStart: 5, selectionEnd: 5 } })
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
    expect(harness.service.AIComplete).not.toHaveBeenCalled()
    expect(document.querySelector('.composer-ghost')).toBeNull()
    expect(composer.value).toBe('hello')
  })

  it('suggests ten replies and fills the draft with the chosen one without sending', async () => {
    const user = userEvent.setup()
    harness.service.AISuggestReplies.mockResolvedValue({ language: 'tr', suggestions: suggestedReplyFixture })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

    await user.click(menuCommand('Suggest replies'))
    const picker = await screen.findByRole('group', { name: 'Suggested replies' })
    expect(harness.service.AISuggestReplies).toHaveBeenCalledWith(expect.any(String), expect.any(String))
    expect(within(picker).getByText('Sounds good!', { selector: '.suggested-reply-text' }).getAttribute('lang')).toBe('tr')
    expect(within(picker).getByText('Sounds good!', { selector: '.suggested-reply-translation' }).getAttribute('lang')).toBe('en')
    await user.click(within(picker).getByRole('button', { name: /Maybe later\?/ }))

    expect(composer.value).toBe('Maybe later?')
    expect(screen.queryByRole('group', { name: 'Suggested replies' })).toBeNull()
    expect(screen.queryByText(/Replying to/)).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
  })
})
