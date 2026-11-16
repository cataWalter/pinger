import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, message, openMessageMenu, menuCommand, room, secondRoom, suggestedReplyFixture, snapshot } from './appTestSetup'

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
    harness.service.AIGenerateReplyDraft.mockReset()
    harness.service.AIGenerateReplyDraft.mockResolvedValue('')
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

  it('generates one unsent RAM-only reply for each Needs reply room in the active account', async () => {
    const user = userEvent.setup()
    const firstNeedsReplyRoom = { ...room, unanswered: true, needsReply: true }
    const otherAccountRoom = { ...secondRoom, id: '!other:example.org', accountId: 'secondary', name: 'Other account' }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [firstNeedsReplyRoom, secondRoom, otherAccountRoom],
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    harness.service.AIGenerateReplyDraft.mockImplementation(async (roomID: string) => `AI reply for ${roomID}`)
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'My note' } })
    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))
    await user.click(screen.getByRole('button', { name: 'Generate AI reply drafts' }))

    await waitFor(() => expect(harness.service.AIGenerateReplyDraft).toHaveBeenCalledTimes(2))
    expect(harness.service.AIGenerateReplyDraft.mock.calls.map(([roomID]) => roomID).sort()).toEqual([room.id, secondRoom.id].sort())
    expect(composer.value).toBe(`My note\n\nAI reply for ${room.id}`)
    expect(screen.getAllByTitle('AI reply draft').map((el) => el.textContent).join('\n')).toContain(`AI reply for ${room.id}`)
    expect(window.localStorage.getItem(ROOM_DRAFTS_STORAGE_KEY) ?? '').not.toContain('AI reply for')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()

    fireEvent.change(composer, { target: { value: 'My note\n\nEdited AI reply' } })
    expect(window.localStorage.getItem(ROOM_DRAFTS_STORAGE_KEY) ?? '').not.toContain('Edited AI reply')

    await user.click(screen.getByRole('button', { name: /Second room/ }))
    await waitFor(() => expect(composer.value).toBe(`AI reply for ${secondRoom.id}`))
    expect(window.localStorage.getItem(ROOM_DRAFTS_STORAGE_KEY) ?? '').not.toContain('AI reply for')
  })

  it('cancels a running reply batch without applying a late result', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [{ ...room, unanswered: true, needsReply: true }],
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    let resolveDraft: (reply: string) => void = () => { }
    harness.service.AIGenerateReplyDraft.mockReturnValue(new Promise<string>((resolve) => { resolveDraft = resolve }))
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))
    await user.click(screen.getByRole('button', { name: 'Generate AI reply drafts' }))
    await waitFor(() => expect(harness.service.AIGenerateReplyDraft).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Cancel AI reply draft generation' }))
    expect(harness.service.AICancel).toHaveBeenCalledWith(harness.service.AIGenerateReplyDraft.mock.calls[0][1])
    resolveDraft('Late AI reply')

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    expect(composer.value).toBe('')
    expect(screen.queryByText('AI reply draft')).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('shows the AI reply draft control only with the Unanswered or Needs reply filter', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [{ ...room, unanswered: true, needsReply: true }],
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Generate AI reply drafts' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))
    expect(screen.getByRole('button', { name: 'Generate AI reply drafts' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Needs reply' }))
    expect(screen.getByRole('button', { name: 'Generate AI reply drafts' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Needs reply' }))
    expect(screen.queryByRole('button', { name: 'Generate AI reply drafts' })).toBeNull()
  })

  it('keeps a generated reply after a failed send and clears it after a successful send', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [{ ...room, unanswered: true, needsReply: true }, { ...secondRoom, unanswered: false, needsReply: false }],
      preferences: { 'ai.endpoint': 'http://localhost:8080' },
    })
    harness.service.AIGenerateReplyDraft.mockResolvedValue('AI reply')
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.click(screen.getByRole('button', { name: 'Unanswered rooms' }))
    await user.click(screen.getByRole('button', { name: 'Generate AI reply drafts' }))
    await waitFor(() => expect(composer.value).toBe('AI reply'))

    harness.service.SendMessage.mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledTimes(1))
    expect(composer.value).toBe('AI reply')

    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(composer.value).toBe(''))
  })

  it('asks before replacing an existing draft with a suggested reply', async () => {
    const user = userEvent.setup()
    harness.service.AISuggestReplies.mockResolvedValue({ suggestions: suggestedReplyFixture })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'my own words' } })

    await user.click(menuCommand('Suggest replies'))
    const picker = await screen.findByRole('group', { name: 'Suggested replies' })
    await user.click(within(picker).getByRole('button', { name: /Sounds good!/ }))
    expect(composer.value).toBe('my own words')

    await user.click(within(picker).getByRole('button', { name: 'Keep draft' }))
    expect(await screen.findByRole('group', { name: 'Suggested replies' })).toBeTruthy()
    expect(composer.value).toBe('my own words')

    await user.click(within(picker).getByRole('button', { name: /Sounds good!/ }))
    await user.click(within(picker).getByRole('button', { name: 'Replace draft' }))
    expect(composer.value).toBe('Sounds good!')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('opens suggested replies from the message menu', async () => {
    const user = userEvent.setup()
    harness.service.AISuggestReplies.mockResolvedValue({ suggestions: suggestedReplyFixture })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Suggest five replies with local AI' }))

    const picker = await screen.findByRole('group', { name: 'Suggested replies' })
    expect(within(picker).getByRole('button', { name: /Maybe later\?/ })).toBeTruthy()
    expect(harness.service.AISuggestReplies).toHaveBeenCalledTimes(1)
  })

  it('shows a tone label and number key hint for each suggested reply', async () => {
    const user = userEvent.setup()
    harness.service.AISuggestReplies.mockResolvedValue({ suggestions: suggestedReplyFixture })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(menuCommand('Suggest replies'))
    const picker = await screen.findByRole('group', { name: 'Suggested replies' })
    expect(within(picker).getByText('Direct')).toBeTruthy()
    expect(within(picker).getByText('Playful')).toBeTruthy()
    expect(within(picker).getByText('Formal')).toBeTruthy()
    expect(within(picker).getByText('Empathetic')).toBeTruthy()
    expect(within(picker).getByText('3')).toBeTruthy()
    expect(within(picker).getByText('5')).toBeTruthy()
    expect(within(picker).getAllByRole('button').filter((button) => button.classList.contains('suggested-reply-option'))).toHaveLength(5)
  })

  it('chooses the fifth suggested reply with the 5 key', async () => {
    const user = userEvent.setup()
    harness.service.AISuggestReplies.mockResolvedValue({ suggestions: suggestedReplyFixture })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

    await user.click(menuCommand('Suggest replies'))
    await screen.findByRole('group', { name: 'Suggested replies' })
    await user.keyboard('5')

    expect(composer.value).toBe('That sounds tough. Want to talk?')
    expect(screen.queryByRole('group', { name: 'Suggested replies' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('chooses a suggested reply with its number key without sending', async () => {
    const user = userEvent.setup()
    harness.service.AISuggestReplies.mockResolvedValue({ suggestions: suggestedReplyFixture })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

    await user.click(menuCommand('Suggest replies'))
    await screen.findByRole('group', { name: 'Suggested replies' })
    await user.keyboard('2')

    expect(composer.value).toBe('Maybe later?')
    expect(screen.queryByRole('group', { name: 'Suggested replies' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendReply).not.toHaveBeenCalled()
  })

  it('does not choose a suggested reply when a digit is typed in the composer', async () => {
    const user = userEvent.setup()
    harness.service.AISuggestReplies.mockResolvedValue({ suggestions: suggestedReplyFixture })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

    await user.click(menuCommand('Suggest replies'))
    const picker = await screen.findByRole('group', { name: 'Suggested replies' })
    await user.click(composer)
    await user.keyboard('1')

    expect(composer.value).toBe('1')
    expect(within(picker).queryByRole('button', { name: 'Keep draft' })).toBeNull()
    expect(harness.service.AISuggestReplies).toHaveBeenCalledTimes(1)
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('regenerates replies while keeping the previous options dimmed until the new ones arrive', async () => {
    const user = userEvent.setup()
    let resolveRegenerate: (value: { suggestions: { tone: string; text: string }[] }) => void = () => { }
    harness.service.AISuggestReplies
      .mockResolvedValueOnce({ suggestions: suggestedReplyFixture })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRegenerate = resolve }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(menuCommand('Suggest replies'))
    const picker = await screen.findByRole('group', { name: 'Suggested replies' })
    await user.click(within(picker).getByRole('button', { name: 'Regenerate suggested replies' }))

    expect(harness.service.AISuggestReplies).toHaveBeenCalledTimes(2)
    const staleOption = within(picker).getByRole('button', { name: /Maybe later\?/ }) as HTMLButtonElement
    expect(staleOption.disabled).toBe(true)
    expect(within(picker).getByRole('status').textContent).toContain('Reading the latest messages')

    resolveRegenerate({ suggestions: [{ tone: 'Warm', text: 'New warm reply' }, { tone: 'Brief', text: 'New brief reply' }, { tone: 'Direct', text: 'New direct reply' }] })
    expect(await within(picker).findByRole('button', { name: /New brief reply/ })).toBeTruthy()
    expect(within(picker).queryByRole('button', { name: /Maybe later\?/ })).toBeNull()
  })

  it.each(['menu', 'ctrlKey', 'metaKey'])('explains only the selected message with %s and keeps the result read-only', async (activation) => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('This is an explanation.')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'unrelated earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    if (activation === 'menu') {
      openMessageMenu(container)
      await user.click(await screen.findByRole('menuitem', { name: 'Explain message with local AI' }))
    } else if (activation === 'metaKey') {
      openMessageMenu(container)
      fireEvent.keyDown(await screen.findByRole('menu', { name: 'Message actions' }), { key: 'E', code: 'KeyE', metaKey: true, shiftKey: true })
    } else {
      const row = screen.getByText('selected message').closest<HTMLElement>('[data-event-id]')!
      row.focus()
      fireEvent.keyDown(row, { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true })
    }
    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    expect(harness.service.AIComplete.mock.calls[0][0]).toHaveLength(2)
    expect(harness.service.AIComplete.mock.calls[0][0][1].content).toContain('selected message')
    expect(harness.service.AIComplete.mock.calls[0][0][1].content).not.toContain('unrelated earlier context')

    const dialog = await screen.findByRole('dialog', { name: 'Explain message' })
    await within(dialog).findByText('This is an explanation.')
    expect(within(dialog).queryByRole('button', { name: 'Use as draft' })).toBeNull()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })
})
