import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, message, openMessageMenu, menuCommand, snapshot } from './appTestSetup'

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

  it('streams an AI answer into the panel before the request resolves', async () => {
    const user = userEvent.setup()
    let finishRequest: (reply: string) => void = () => { }
    harness.service.AIComplete.mockImplementationOnce(() => new Promise<string>((resolve) => { finishRequest = resolve }))
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'unrelated earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Explain message with AI' }))
    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    const requestID = harness.service.AIComplete.mock.calls[0][1]
    expect(requestID).toEqual(expect.any(String))
    const dialog = await screen.findByRole('dialog', { name: 'Explain message' })

    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: 'This is ' } }))
    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: 'streamed.' } }))
    await within(dialog).findByText('This is streamed.')
    expect(within(dialog).getByRole('button', { name: 'Stop' })).toBeTruthy()

    act(() => finishRequest('This is streamed.'))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Regenerate' })).toBeTruthy())
    expect(within(dialog).queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(within(dialog).getByText('This is streamed.')).toBeTruthy()
  })

  it('stops a streaming answer, keeps the partial text, and offers Regenerate', async () => {
    const user = userEvent.setup()
    let rejectRequest: (error: Error) => void = () => { }
    harness.service.AIComplete.mockImplementationOnce(() => new Promise<string>((_, reject) => { rejectRequest = reject }))
    harness.service.AICancel.mockImplementationOnce(async () => {
      rejectRequest(new Error('request cancelled'))
      return true
    })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'unrelated earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Explain message with AI' }))
    await waitFor(() => expect(harness.service.AIComplete).toHaveBeenCalledTimes(1))
    const requestID = harness.service.AIComplete.mock.calls[0][1]
    const dialog = await screen.findByRole('dialog', { name: 'Explain message' })

    act(() => harness.eventHandlers.get('ai:stream')?.({ data: { requestId: requestID, text: 'Partial answer' } }))
    await within(dialog).findByText('Partial answer')
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }))

    expect(harness.service.AICancel).toHaveBeenCalledWith(requestID)
    await within(dialog).findByText('Generation stopped. The text above may be incomplete.')
    expect(within(dialog).getByText('Partial answer')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Regenerate' })).toBeTruthy()
  })

  it('sends a follow-up with the earlier answer as context', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValueOnce('This is an explanation.').mockResolvedValueOnce('It explains the message briefly.')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValue({ messages: [message('$previous', 'unrelated earlier context', 200), message('$latest', 'selected message', 300)], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('selected message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Explain message with AI' }))
    const dialog = await screen.findByRole('dialog', { name: 'Explain message' })
    await within(dialog).findByText('This is an explanation.')

    await user.type(within(dialog).getByRole('textbox', { name: 'Follow-up question' }), 'Make it shorter')
    await user.click(within(dialog).getByRole('button', { name: 'Send follow-up' }))

    await within(dialog).findByText('It explains the message briefly.')
    expect(harness.service.AIComplete).toHaveBeenCalledTimes(2)
    const followUpRequest = harness.service.AIComplete.mock.calls[1][0]
    expect(followUpRequest).toHaveLength(4)
    expect(followUpRequest[2]).toEqual({ role: 'assistant', content: 'This is an explanation.' })
    expect(followUpRequest[3]).toEqual({ role: 'user', content: 'Make it shorter' })
  })

  it('saves independent per-room learning and translation languages from the header', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Chat languages' }))
    await user.selectOptions(await screen.findByLabelText('Language to learn'), 'fr')
    await user.selectOptions(await screen.findByLabelText('Translations and explanations'), 'de')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith(`room.learning_language.${room.id}`, 'fr'))
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith(`room.tutor_language.${room.id}`, 'de'))
  })

  it('saves per-room agent profiles and default chat agent', async () => {
    const user = userEvent.setup()
    harness.service.AIComplete.mockResolvedValue('A language-learning suggestion')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Room details' }))
    const roomDialog = await screen.findByRole('dialog', { name: 'Test room' })
    await user.click(within(roomDialog).getByRole('button', { name: 'Add agent' }))
    await user.type(within(roomDialog).getByLabelText('Name'), 'Language coach')
    await user.type(within(roomDialog).getByLabelText('Instructions'), 'Explain idioms and suggest a natural alternative.')
    await user.click(within(roomDialog).getByRole('button', { name: 'Save agent' }))

    const key = `room.ai_agents.${room.id}`
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith(key, expect.any(String)))
    const savedCollection = JSON.parse(harness.service.SetStringPreference.mock.calls[harness.service.SetStringPreference.mock.calls.length - 1]?.[1] as string)
    expect(savedCollection.agents[0]).toMatchObject({ name: 'Language coach', instructions: 'Explain idioms and suggest a natural alternative.' })
    await user.selectOptions(within(roomDialog).getByRole('combobox', { name: 'Default chat agent' }), savedCollection.agents[0].id)
    await waitFor(() => expect(JSON.parse(harness.service.SetStringPreference.mock.calls[harness.service.SetStringPreference.mock.calls.length - 1]?.[1] as string).defaultAgentId).toBe(savedCollection.agents[0].id))
    await user.click(within(roomDialog).getByRole('button', { name: 'Close room details' }))
  })

  it('exports the room chat to a chosen folder with progress and reveals the result', async () => {
    const user = userEvent.setup()
    const exportPath = '/tmp/exports/Test room chat 2026-01-01 1200.txt'
    let finishExport: (result: { path: string; messages: number }) => void = () => { }
    harness.service.ChooseDownloadFolder.mockResolvedValue('/tmp/exports')
    harness.service.ExportRoomChat.mockReturnValue(new Promise((resolve) => { finishExport = resolve }))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(menuCommand('Export chat'))
    await waitFor(() => expect(harness.service.ExportRoomChat).toHaveBeenCalledWith(room.id, '/tmp/exports'))
    await waitFor(() => expect(harness.eventHandlers.has('chat-export:progress')).toBe(true))

    act(() => {
      harness.eventHandlers.get('chat-export:progress')?.({ data: { roomId: room.id, stage: 'history', messages: 3 } })
    })
    expect(await screen.findByText('Reading room history')).toBeTruthy()

    await act(async () => finishExport({ path: exportPath, messages: 3 }))
    expect(await screen.findByText('Exported 3 messages.')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Show in file manager' }))
    expect(harness.service.RevealFile).toHaveBeenCalledWith(exportPath)
  })

  it('cancels a running room chat export and reports the failure', async () => {
    const user = userEvent.setup()
    let abortExport: (reason: Error) => void = () => { }
    harness.service.ChooseDownloadFolder.mockResolvedValue('/tmp/exports')
    harness.service.ExportRoomChat.mockReturnValue(new Promise((_resolve, reject) => { abortExport = reject }))
    harness.service.CancelChatExport.mockImplementation(async () => {
      abortExport(new Error('chat export was cancelled'))
      return true
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(menuCommand('Export chat'))
    await user.click(await screen.findByRole('button', { name: 'Cancel export' }))

    expect(harness.service.CancelChatExport).toHaveBeenCalledTimes(1)
    expect((await screen.findByRole('alert')).textContent).toContain('chat export was cancelled')
    expect(menuCommand('Export chat').hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Cancel export' })).toBeNull()
  })
})
