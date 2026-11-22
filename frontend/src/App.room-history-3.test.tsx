import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, secondRoom, message, openMessageMenu, menuCommand, suggestedReplyFixture, snapshot } from './appTestSetup'

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

  it('does not show a room ID beneath a room name when there is no topic', async () => {
    const roomWithoutTopic = { ...room, id: '!group:example.org', name: 'Actual room name', direct: false }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [roomWithoutTopic] })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Actual room name' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Conversation' }).querySelector('.conversation-title')?.textContent).toBe('Actual room name')
  })

  it('shows only the contact name in a direct-message header', async () => {
    const directRoom = { ...room, name: 'Lory', direct: true, topic: '' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [directRoom] })

    render(<App />)

    const title = await screen.findByRole('heading', { name: 'Lory' })
    expect(title.parentElement?.textContent).toBe('Lory')
  })

  it('offers the Language Tutor in the message menu instead of a separate translation', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)

    expect(await screen.findByRole('menuitem', { name: 'Analyze message with Language Tutor' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Translate message with AI' })).toBeNull()
  })

  it('analyzes an outgoing draft and replaces the composer with the Turkish correction', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await user.click(menuCommand('Analyze draft with Language Tutor'))

    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Ciao, come stai?', 'draft', 'tr', 'en', expect.any(String))
    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    expect(dialog.querySelector('.ai-result-disclaimer')).toBeNull()
    expect(within(dialog).getByText('Merhaba, nasılsın?')).toBeTruthy()
    expect((within(dialog).getByRole('textbox', { name: 'Your text' }) as HTMLTextAreaElement).value).toBe('Ciao, come stai?')
    await user.click(within(dialog).getByRole('button', { name: 'Replace draft with Turkish' }))

    expect(composer.value).toBe('Merhaba, nasılsın?')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('keeps the edited draft in the composer with Keep my draft', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await user.click(menuCommand('Analyze draft with Language Tutor'))

    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    await within(dialog).findByText('Merhaba, nasılsın?')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Your text' }), { target: { value: 'Ciao, come stai oggi?' } })
    await user.click(within(dialog).getByRole('button', { name: 'Keep my draft' }))

    expect(composer.value).toBe('Ciao, come stai oggi?')
    expect(screen.queryByRole('dialog', { name: 'Tutor this draft' })).toBeNull()
  })

  it.each(['ctrlKey', 'metaKey'])('keeps the edited Language Tutor draft with %s+1', async (modifier) => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await userEvent.click(menuCommand('Analyze draft with Language Tutor'))

    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    await within(dialog).findByText('Merhaba, nasılsın?')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Your text' }), { target: { value: 'Ciao, come stai oggi?' } })
    fireEvent.keyDown(dialog, { key: '1', [modifier]: true })

    expect(composer.value).toBe('Ciao, come stai oggi?')
    expect(screen.queryByRole('dialog', { name: 'Tutor this draft' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it.each(['ctrlKey', 'metaKey'])('replaces the draft with the Language Tutor correction with %s+2', async (modifier) => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await userEvent.click(menuCommand('Analyze draft with Language Tutor'))

    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    await within(dialog).findByText('Merhaba, nasılsın?')
    fireEvent.keyDown(dialog, { key: '2', [modifier]: true })

    expect(composer.value).toBe('Merhaba, nasılsın?')
    expect(screen.queryByRole('dialog', { name: 'Tutor this draft' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('ignores Ctrl+2 while the Language Tutor correction is still pending', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    harness.tutorService.Analyze.mockReturnValueOnce(new Promise(() => { }))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await userEvent.click(menuCommand('Analyze draft with Language Tutor'))

    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    fireEvent.keyDown(dialog, { key: '2', ctrlKey: true })

    expect(composer.value).toBe('Ciao, come stai?')
    expect(screen.getByRole('dialog', { name: 'Tutor this draft' })).toBeTruthy()
  })

  it.each(['ctrlKey', 'metaKey'])('checks an edited Language Tutor draft with %s+Enter without replacing the composer', async (modifier) => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await userEvent.click(menuCommand('Analyze draft with Language Tutor'))

    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    const editor = within(dialog).getByRole('textbox', { name: 'Your text' }) as HTMLTextAreaElement
    await waitFor(() => expect(document.activeElement).toBe(editor))
    fireEvent.change(editor, { target: { value: 'Ciao, come stai oggi?' } })
    expect(within(dialog).getByText('Changed since the last check. Press Check to update.')).toBeTruthy()
    expect(harness.tutorService.Analyze).toHaveBeenCalledTimes(1)

    harness.tutorService.Analyze.mockResolvedValueOnce({ detected_language: 'it', corrected_text: 'Merhaba, bugün nasılsın?' })
    fireEvent.keyDown(dialog, { key: 'Enter', [modifier]: true })

    expect(await within(dialog).findByText('Merhaba, bugün nasılsın?')).toBeTruthy()
    expect(harness.tutorService.Analyze).toHaveBeenLastCalledWith('Ciao, come stai oggi?', 'draft', 'tr', 'en', expect.any(String))
    expect(within(dialog).queryByText('Changed since the last check. Press Check to update.')).toBeNull()
    expect(composer.value).toBe('Ciao, come stai?')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('shows the corrected text while the check is still streaming', async () => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    let resolveAnalysis: (analysis: unknown) => void = () => { }
    harness.tutorService.Analyze.mockReturnValueOnce(new Promise((resolve) => { resolveAnalysis = resolve }))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Ciao, come stai?' } })
    await userEvent.click(menuCommand('Analyze draft with Language Tutor'))

    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    const calls = harness.tutorService.Analyze.mock.calls
    const requestID = calls[calls.length - 1][4]
    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: '{"detected_language":"it","corrected_text":"Merhaba, nas' } }))
    expect(await within(dialog).findByText('Merhaba, nas')).toBeTruthy()
    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: 'ılsın?"}' } }))
    expect(await within(dialog).findByText('Merhaba, nasılsın?')).toBeTruthy()

    act(() => resolveAnalysis({ detected_language: 'it', corrected_text: 'Merhaba, nasılsın?' }))
    expect(await within(dialog).findByRole('button', { name: 'Copy corrected · turkish' })).toBeTruthy()
  })

  it('shows the English meaning of the correction and still inserts only the correction', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    let resolveAnalysis: (analysis: unknown) => void = () => { }
    harness.tutorService.Analyze.mockReturnValueOnce(new Promise((resolve) => { resolveAnalysis = resolve }))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await user.click(menuCommand('Analyze draft with Language Tutor'))

    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    const calls = harness.tutorService.Analyze.mock.calls
    const requestID = calls[calls.length - 1][4]
    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: '{"detected_language":"it","corrected_text":"Merhaba, nasılsın?","translation":"Hello, how ar' } }))
    expect(await within(dialog).findByText('Hello, how ar')).toBeTruthy()

    act(() => resolveAnalysis({ detected_language: 'it', corrected_text: 'Merhaba, nasılsın?', translation: 'Hello, how are you?' }))
    expect(await within(dialog).findByText('Hello, how are you?')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Copy translation · english' })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Replace draft with Turkish' }))

    expect(composer.value).toBe('Merhaba, nasılsın?')
  })

  it.each(['ctrlKey', 'metaKey'])('analyzes the composer draft with %s+Shift+T', async (modifier) => {
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:11434' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    fireEvent.change(composer, { target: { value: 'Ben iyiyim.' } })
    fireEvent.keyDown(composer, { key: 'T', code: 'KeyT', [modifier]: true, shiftKey: true })

    await waitFor(() => expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Ben iyiyim.', 'draft', 'tr', 'en', expect.any(String)))
    expect(await screen.findByRole('dialog', { name: 'Tutor this draft' })).toBeTruthy()
  })

  it.each(['ctrlKey', 'metaKey'])('suggests replies from the composer with %s+Shift+B without sending', async (modifier) => {
    harness.service.AISuggestReplies.mockResolvedValue({ suggestions: suggestedReplyFixture })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    await screen.findByText('latest message')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'My draft' } })
    fireEvent.keyDown(composer, { key: 'B', code: 'KeyB', [modifier]: true, shiftKey: true })

    await waitFor(() => expect(harness.service.AISuggestReplies).toHaveBeenCalledTimes(1))
    expect(composer.value).toBe('My draft')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it.each(['ctrlKey', 'metaKey'])('drafts the next message into an empty composer with %s+Shift+C', async (modifier) => {
    harness.service.AIComplete.mockResolvedValue('Sounds good, see you then.')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    const body = await screen.findByText('latest message')
    const row = body.closest<HTMLElement>('[data-event-id]')!
    row.focus()
    fireEvent.keyDown(row, { key: 'C', code: 'KeyC', [modifier]: true, shiftKey: true })

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.value).toBe('Sounds good, see you then.'))
    expect(harness.service.AIComplete).toHaveBeenCalledTimes(1)
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('shows the continue draft panel with its waiting state and refine prompt', async () => {
    let finishReply: (reply: string) => void = () => {}
    harness.service.AIComplete.mockReturnValue(new Promise<string>((resolve) => { finishReply = resolve }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    const body = await screen.findByText('latest message')
    const row = body.closest<HTMLElement>('[data-event-id]')!
    row.focus()
    fireEvent.keyDown(row, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })

    const dialog = await screen.findByRole('dialog', { name: 'Continue conversation' })
    expect(within(dialog).getByRole('status').textContent).toContain('Drafting the next message')
    expect(dialog.querySelector('.ai-result-skeleton')).not.toBeNull()

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'typed meanwhile' } })
    finishReply('Sounds good, see you then.')

    expect(await within(dialog).findByText('Draft for your next message')).toBeTruthy()
    expect(within(dialog).getByText('Sounds good, see you then.')).toBeTruthy()
    expect(within(dialog).getByPlaceholderText('Refine this draft, for example: make it shorter')).toBeTruthy()
    expect(dialog.querySelector('.ai-result-skeleton')).toBeNull()
    expect(composer.value).toBe('typed meanwhile')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('does not continue over an existing composer draft', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    await screen.findByText('latest message')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'My draft' } })
    fireEvent.keyDown(composer, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })
    expect(harness.service.AIComplete).not.toHaveBeenCalled()
    expect(composer.value).toBe('My draft')
  })

  it('does not run unavailable AI shortcuts', async () => {
    render(<App />)
    await screen.findByText('latest message')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'My draft' } })
    for (const key of ['T', 'B', 'J', 'O', 'Y', 'L']) {
      fireEvent.keyDown(composer, { key, code: `Key${key}`, ctrlKey: true, shiftKey: true })
    }
    expect(harness.tutorService.Analyze).not.toHaveBeenCalled()
    expect(harness.service.AISuggestReplies).not.toHaveBeenCalled()
    expect(harness.service.AIInferDraftGoal).not.toHaveBeenCalled()
    expect(harness.service.GenerateRoomImage).not.toHaveBeenCalled()
    expect(harness.service.AIComplete).not.toHaveBeenCalled()
    expect(composer.value).toBe('My draft')
  })

  it('improves the draft with Ctrl+Shift+L, fills the chosen version, and restores the original', async () => {
    const user = userEvent.setup()
    harness.service.AIInferDraftGoal.mockResolvedValue('Confirm lunch on Friday')
    harness.service.AIImproveDraft.mockResolvedValue({
      variants: [
        { text: 'Ciao! Pranzo domani?', rationale: 'Shorter and friendlier.' },
        { text: 'Ciao, ci vediamo a pranzo domani?', rationale: 'Names the meal explicitly.' },
      ],
      openQuestions: ['Which restaurant?'],
    })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'ciao pranzo domani?' } })
    fireEvent.keyDown(composer, { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true })

    const dialog = await screen.findByRole('dialog', { name: 'Improve draft' })
    expect(harness.service.AIInferDraftGoal).toHaveBeenCalledWith(room.id, 'ciao pranzo domani?', expect.any(String))
    const goal = await within(dialog).findByRole('textbox', { name: 'Draft goal' }) as HTMLTextAreaElement
    await waitFor(() => expect(goal.value).toBe('Confirm lunch on Friday'))
    expect(goal.disabled).toBe(false)

    expect(harness.service.AIImproveDraft).toHaveBeenCalledWith(room.id, 'ciao pranzo domani?', 'Confirm lunch on Friday', expect.any(String))
    expect(await within(dialog).findByText('Ciao! Pranzo domani?')).toBeTruthy()
    expect(within(dialog).getByText('Names the meal explicitly.')).toBeTruthy()
    expect(within(dialog).getByText('Which restaurant?')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Improve again' })).toBeTruthy()

    await user.click(within(dialog).getAllByRole('button', { name: 'Use this version' })[1])

    expect(composer.value).toBe('Ciao, ci vediamo a pranzo domani?')
    expect(screen.queryByRole('dialog', { name: 'Improve draft' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Restore original draft' }))
    expect(composer.value).toBe('ciao pranzo domani?')
    expect(screen.queryByRole('button', { name: 'Restore original draft' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('shows a goal inference error and still improves the draft with an empty goal', async () => {
    const user = userEvent.setup()
    harness.service.AIInferDraftGoal.mockRejectedValue(new Error('model offline'))
    harness.service.AIImproveDraft.mockResolvedValue({ variants: [{ text: 'Ciao!', rationale: 'Shorter.' }], openQuestions: null })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'ciao' } })
    fireEvent.keyDown(composer, { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true })

    const dialog = await screen.findByRole('dialog', { name: 'Improve draft' })
    expect((await within(dialog).findByRole('alert')).textContent).toContain('model offline')
    expect((within(dialog).getByRole('textbox', { name: 'Draft goal' }) as HTMLTextAreaElement).disabled).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Improve draft' }))
    expect(harness.service.AIImproveDraft).toHaveBeenCalledWith(room.id, 'ciao', '', expect.any(String))
    expect(await within(dialog).findByText('Ciao!')).toBeTruthy()
    expect(composer.value).toBe('ciao')
  })

  it('does not open Improve draft over an empty composer', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    await screen.findByText('latest message')
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    fireEvent.keyDown(composer, { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true })

    expect(harness.service.AIInferDraftGoal).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Improve draft' })).toBeNull()
  })

  it('ignores AI shortcuts during key repeat, IME composition, and other modifier combinations', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    await screen.findByText('latest message')
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    fireEvent.change(composer, { target: { value: 'My draft' } })
    for (const modifiers of [{ repeat: true }, { isComposing: true }, { altKey: true }, { shiftKey: false }]) {
      fireEvent.keyDown(composer, { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, ...modifiers })
    }
    expect(harness.tutorService.Analyze).not.toHaveBeenCalled()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('blocks keyboard and native room navigation while tutoring a draft', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom], preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    await screen.findByText('latest message')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ciao, come stai?' } })
    await user.click(menuCommand('Analyze draft with Language Tutor'))
    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    const close = within(dialog).getByRole('button', { name: 'Close Language Tutor' })
    fireEvent.keyDown(close, { key: '3', ctrlKey: true })
    act(() => harness.eventHandlers.get('application-menu:action')?.({ data: 'room-next' }))
    expect(harness.service.SetActiveRoom).not.toHaveBeenCalledWith(secondRoom.id)
    await within(dialog).findByText('Merhaba, nasılsın?')
    await user.click(within(dialog).getByRole('button', { name: 'Replace draft with Turkish' }))
    expect(composer.value).toBe('Merhaba, nasılsın?')
  })
})
