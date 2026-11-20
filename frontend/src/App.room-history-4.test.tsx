import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('opens the read-only Language Tutor analysis from a message context menu', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Analyze message with Language Tutor' }))

    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('latest message', 'message', 'tr', 'en', expect.any(String))
    const dialog = await screen.findByRole('dialog', { name: 'Analyze message' })
    expect(await within(dialog).findByText('Ciao, come stai?')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Replace draft with Turkish' })).toBeNull()
  })

  it('cancels tutor analysis on notification navigation and ignores its late response', async () => {
    const user = userEvent.setup()
    let completeAnalysis!: (analysis: { text_to_insert: string }) => void
    harness.tutorService.Analyze.mockReturnValueOnce(new Promise<{ text_to_insert: string }>((resolve) => { completeAnalysis = resolve }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom], preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    await screen.findByText('latest message')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'the original draft' } })
    await user.click(menuCommand('Analyze draft with Language Tutor'))
    await screen.findByRole('dialog', { name: 'Tutor this draft' })
    const calls = harness.tutorService.Analyze.mock.calls
    const requestID = calls[calls.length - 1][4]
    act(() => harness.eventHandlers.get('notification:open-room')?.({ data: { accountId: 'primary', roomId: secondRoom.id } }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tutor this draft' })).toBeNull())
    expect(harness.service.AICancel).toHaveBeenCalledWith(requestID)
    fireEvent.change(composer, { target: { value: 'the second room draft' } })
    await act(async () => completeAnalysis({ text_to_insert: 'obsolete analysis' }))
    expect(screen.queryByRole('dialog', { name: 'Tutor this draft' })).toBeNull()
    expect(composer.value).toBe('the second room draft')
  })

  it('labels the Language Tutor dialog with the selected languages', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: {
        'ai.endpoint': 'http://localhost:11434',
        'ai.tutor_language': 'es',
        'ai.default_language': 'en',
        [`room.learning_language.${room.id}`]: 'fr',
        [`room.tutor_language.${room.id}`]: 'de',
      },
    })
    harness.tutorService.Analyze.mockResolvedValueOnce({
      detected_language: 'en',
      corrected_text: 'Bonjour, comment ça va ?',
      translation: 'Hallo, wie geht es dir?',
      grammar_notes: ['Use the contraction “ça va” in this expression.'],
      vocabulary: [{ term: 'bonjour', meaning: 'hello', example: 'Bonjour, Aline.' }],
      text_to_insert: 'Bonjour, comment ça va ?',
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Hello, how are you?' } })
    await user.click(menuCommand('Analyze draft with Language Tutor'))

    expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Hello, how are you?', 'draft', 'fr', 'de', expect.any(String))
    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    expect(await within(dialog).findByText('CORRECTED · FRENCH')).toBeTruthy()
    expect(dialog.querySelector('p[lang="fr"]')?.textContent).toBe('Bonjour, comment ça va ?')
    expect(within(dialog).getByText('TRANSLATION · GERMAN')).toBeTruthy()
    expect(within(dialog).getByText('Hallo, wie geht es dir?')).toBeTruthy()
    expect(within(dialog).queryByText('Use the contraction “ça va” in this expression.')).toBeNull()
    expect(within(dialog).queryByText('bonjour')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Replace draft with French' })).toBeTruthy()
  })

  it.each(['menu', 'ctrlKey', 'metaKey'])('translates messages received after your last message with %s and skips own and redacted messages', async (activation) => {
    const user = userEvent.setup()
    const timeline = [
      message('$before-own', 'Eski mesaj', 100),
      { ...message('$own-latest', 'My latest message', 200), own: true, sender: snapshot.profile.userId },
      message('$received-first', 'Günaydın', 300),
      { ...message('$received-redacted', 'Silinmiş mesaj', 350), redacted: true },
      message('$received-second', 'Nasılsın?', 400),
    ]
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      preferences: { 'ai.endpoint': 'http://localhost:8080', [`room.tutor_language.${room.id}`]: 'fr' },
    })
    harness.service.History.mockResolvedValue({ messages: timeline, before: 80, hasMore: true })
    harness.tutorService.Analyze.mockImplementation(async (body: string) => ({ translation: body === 'Günaydın' ? 'Bonjour' : 'Comment ça va ?' }))

    const { container } = render(<App />)
    expect(await screen.findByText('Günaydın')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    if (activation === 'menu') await user.click(menuCommand('Translate messages received since your last message to French'))
    else fireEvent.keyDown(composer, { key: 'Y', code: 'KeyY', [activation]: true, shiftKey: true })

    await screen.findByText('Bonjour')
    await screen.findByText('Comment ça va ?')
    expect(harness.tutorService.Analyze.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ['Günaydın', 'message', 'tr', 'fr'],
      ['Nasılsın?', 'message', 'tr', 'fr'],
    ])
    expect(container.querySelector('[data-event-id="$received-first"] .message-translation')?.textContent).toContain('Bonjour')
    expect(container.querySelector('[data-event-id="$received-second"] .message-translation')?.textContent).toContain('Comment ça va ?')
    expect(container.querySelector('[data-event-id="$before-own"] .message-translation')).toBeNull()
    expect(container.querySelector('[data-event-id="$own-latest"] .message-translation')).toBeNull()
    expect(container.querySelector('[data-event-id="$received-redacted"] .message-translation')).toBeNull()
    expect(harness.service.History.mock.calls.filter(([, before]) => before !== 0)).toEqual([])
    expect(harness.service.AIComplete).not.toHaveBeenCalled()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    if (activation !== 'menu') {
      fireEvent.keyDown(composer, { key: 'X', code: 'KeyX', [activation]: true, shiftKey: true })
      await waitFor(() => expect(container.querySelector('.message-translation')).toBeNull())
      expect(harness.tutorService.Analyze).toHaveBeenCalledTimes(2)
    }
  })

  it('shows translation progress as a percentage of completed messages without character counts', async () => {
    const user = userEvent.setup()
    const timeline = [
      { ...message('$own-latest', 'my message', 100), own: true, sender: snapshot.profile.userId },
      message('$received-first', 'first incoming', 200),
      message('$received-second', 'second incoming', 300),
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: timeline, before: 0, hasMore: false })
    let finishFirst!: (analysis: { translation: string }) => void
    let finishSecond!: (analysis: { translation: string }) => void
    harness.tutorService.Analyze
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
    render(<App />)
    await screen.findByText('second incoming')
    await user.click(menuCommand('Translate messages received since your last message to English'))

    expect(await screen.findByText('Translating 0%…')).toBeTruthy()
    expect(screen.queryByText(/characters received/)).toBeNull()
    await act(async () => finishFirst({ translation: 'First translation' }))
    expect(await screen.findByText('Translating 50%…')).toBeTruthy()
    expect(screen.getByText('First translation')).toBeTruthy()
    expect(screen.queryByText(/characters received/)).toBeNull()
    await act(async () => finishSecond({ translation: 'Second translation' }))
    expect(await screen.findByText('Second translation')).toBeTruthy()
    expect(screen.queryByText(/^Translating \d+%/)).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('translates every incoming message after your last message without a fixed cap', async () => {
    const user = userEvent.setup()
    const timeline = [
      { ...message('$own-latest', 'my message', 100), own: true, sender: snapshot.profile.userId },
      ...Array.from({ length: 12 }, (_, index) => message(`$received-${index + 1}`, `received message ${index + 1}`, 200 + index)),
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: timeline, before: 80, hasMore: true })
    harness.tutorService.Analyze.mockImplementation(async (body: string) => ({ translation: `Translated ${body}` }))

    const { container } = render(<App />)
    expect(await screen.findByText('received message 12')).toBeTruthy()
    await user.click(menuCommand('Translate messages received since your last message to English'))

    await waitFor(() => expect(container.querySelector('[data-event-id="$received-12"] .message-translation')?.textContent).toContain('Translated received message 12'))
    expect(harness.tutorService.Analyze).toHaveBeenCalledTimes(12)
    expect(container.querySelector('[data-event-id="$own-latest"] .message-translation')).toBeNull()
  })
})
