import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, message, menuCommand, snapshot } from './appTestSetup'

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

  it('does not start an export when the folder picker is dismissed', async () => {
    const user = userEvent.setup()
    harness.service.ChooseDownloadFolder.mockResolvedValue('')
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(menuCommand('Export chat'))

    await waitFor(() => expect(harness.service.ChooseDownloadFolder).toHaveBeenCalledTimes(1))
    expect(harness.service.ExportRoomChat).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Cancel export' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['menu', 'ctrlKey', 'metaKey'])('opens a Local AI summary chat with %s and an editable full-conversation prompt', async (activation) => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => before === 0
      ? { messages: [message('$latest', 'latest message', 300)], before: 50, hasMore: true }
      : { messages: [message('$older', 'older history', 100)], before: 0, hasMore: false })
    harness.service.CreateLocalAIChat.mockResolvedValue({ id: 'summary-chat', title: '', agentId: '', updatedAt: 1 })
    harness.service.AppendLocalAIChatMessage.mockImplementation(async (_chatID: string, saved: object) => ({ ...saved, seq: 1, createdAt: 1 }))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    if (activation === 'menu') await user.click(menuCommand('Summarize with Local AI'))
    else fireEvent.keyDown(await screen.findByRole('textbox', { name: 'Message' }), { key: 'O', code: 'KeyO', [activation]: true, shiftKey: true })
    expect(await screen.findByRole('heading', { name: 'Local AI' })).toBeTruthy()
    const draft = await screen.findByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(draft.value).toContain('Alice: older history'))
    expect(draft.value).toContain('Summarize')
    expect(draft.value).toContain('Alice: latest message')
    expect(draft.value.indexOf('Alice: older history')).toBeLessThan(draft.value.indexOf('Alice: latest message'))
    expect(harness.service.History).toHaveBeenCalledWith(room.id, 50)
    expect(harness.service.CreateLocalAIChat).not.toHaveBeenCalled()
    expect(harness.service.LocalAIChat).not.toHaveBeenCalled()

    const editedDraft = `${draft.value}\nAlso note the dates mentioned.`
    fireEvent.change(draft, { target: { value: editedDraft } })
    expect(draft.value).toBe(editedDraft)
    await user.click(await screen.findByRole('button', { name: 'Send to local AI' }))
    await waitFor(() => expect(harness.service.LocalAIChat).toHaveBeenCalled())
    expect(harness.service.CreateLocalAIChat).toHaveBeenCalledWith('', 'summary')
    expect(harness.service.AppendLocalAIChatMessage).toHaveBeenCalledWith('summary-chat', expect.objectContaining({ role: 'user', content: editedDraft }))
    expect(harness.service.LocalAIChat).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ role: 'user', content: editedDraft })],
    }))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.AIComplete).not.toHaveBeenCalled()
  })

  it('saves the AI endpoint and reports whether the model is ready', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.TestAIEndpoint.mockRejectedValueOnce(new Error('AI model is still loading'))
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'AI' }))

    await user.click(await screen.findByRole('button', { name: 'Test endpoint' }))
    expect(await screen.findByText('AI model is still loading')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Test endpoint' }))
    expect(await screen.findByText('Model is loaded and ready.')).toBeTruthy()

    const endpoint = await screen.findByLabelText('Endpoint')
    await user.clear(endpoint)
    await user.type(endpoint, 'http://localhost:9090')
    expect((await screen.findByRole('button', { name: 'Test endpoint' }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(await screen.findByLabelText('Transcription model (optional)'), 'whisper-test')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Model thinking level' }), 'high')

    const aiForm = endpoint.closest('form') as HTMLElement
    await user.click(within(aiForm).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.endpoint', 'http://localhost:9090'))
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.thinking_level', 'high')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.transcription_model', 'whisper-test')
  })

  it('saves image generation settings under the ai.image preference keys', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'AI' }))
    await user.click(await screen.findByText('Advanced'))

    const imageForm = await screen.findByRole('form', { name: 'Image generation settings' })
    await user.type(within(imageForm).getByRole('textbox', { name: 'Image engine binary' }), '/usr/local/bin/sd-server')
    await user.type(within(imageForm).getByRole('textbox', { name: 'Image model checkpoint' }), '/models/sd.safetensors')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image engine idle timeout' }), '10')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image size' }), '768x512')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image steps' }), '8')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image guidance scale' }), '1')
    await user.selectOptions(within(imageForm).getByRole('combobox', { name: 'Image sampler' }), 'lcm')
    await user.type(within(imageForm).getByRole('textbox', { name: 'Default negative prompt' }), 'blurry')
    await user.click(within(imageForm).getByRole('button', { name: 'Save image settings' }))

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.binary_path', '/usr/local/bin/sd-server'))
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.model_path', '/models/sd.safetensors')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.idle_minutes', '10')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.size', '768x512')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.steps', '8')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.cfg_scale', '1')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.sampler', 'lcm')
    expect(harness.service.SetStringPreference).toHaveBeenCalledWith('ai.image.negative_prompt', 'blurry')
    expect(await within(imageForm).findByText('Image settings saved.')).toBeTruthy()
  })
})
