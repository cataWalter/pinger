import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, message, menuCommand, snapshot } from './appTestSetup'

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

  it('inserts a picked emoji at the current selection without sending', async () => {
    const user = userEvent.setup()
    render(<App />)

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'ab')
    composer.setSelectionRange(1, 1)
    await user.click(await screen.findByRole('button', { name: 'Emoji picker' }))

    const picker = await screen.findByRole('dialog', { name: 'Choose an emoji' })
    await user.click(await within(picker).findByRole('button', { name: /grinning face/i }))

    await waitFor(() => expect(composer.value).toBe('a😀b'))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('saves a custom emoji replacement and uses it while typing', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Keyboard' }))

    await user.click(await screen.findByRole('button', { name: 'Add mapping' }))
    await user.type(await screen.findByRole('textbox', { name: 'Symbol for replacement 1' }), ':)')
    await user.type(await screen.findByRole('textbox', { name: 'Emoji for replacement 1' }), '😎')
    await user.click(await screen.findByRole('button', { name: 'Save mappings' }))
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('emoji.emoticon_replacements', '[[":)","😎"]]'))

    await user.click(await screen.findByRole('button', { name: 'Close settings' }))
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, ':)')
    expect(composer.value).toBe('😎')
  })

  it('uses the configured time suggestions in the schedule dialog', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'schedule.suggestions_minutes': '10,30,180' } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'send this later')
    await user.click(menuCommand('Schedule message'))
    const sendAt = await screen.findByLabelText('Send at') as HTMLInputElement
    const previousDueAt = new Date(sendAt.value).getTime()
    await user.click(await screen.findByRole('button', { name: '30 min' }))

    const updatedDueAt = new Date(sendAt.value).getTime()
    expect(updatedDueAt - previousDueAt).toBeGreaterThanOrEqual(24 * 60_000)
    expect(updatedDueAt - previousDueAt).toBeLessThan(26 * 60_000)
  })

  it('persists the system-default voice-note microphone selection', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Voice-note microphone' }), '')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('audio.input_device', ''))
  })

  it('lists available microphones and persists the selected input', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'audioinput', deviceId: 'mic-one', label: 'Desk microphone' },
          { kind: 'audiooutput', deviceId: 'speaker-one', label: 'Speakers' },
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const microphone = await screen.findByRole('combobox', { name: 'Voice-note microphone' })
    expect(within(microphone).getByRole('option', { name: 'Desk microphone' })).toBeTruthy()
    await user.selectOptions(microphone, 'mic-one')

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('audio.input_device', 'mic-one'))
  })

  it('saves a validated editable schedule suggestion list', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const suggestions = await screen.findByRole('textbox', { name: 'Schedule time suggestions' })
    await user.clear(suggestions)
    await user.type(suggestions, '10, 30, 180')
    await user.tab()

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('schedule.suggestions_minutes', '10,30,180'))
  })

  it('saves configurable default delays for reminders and scheduled sends', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'General' }))

    const sendDelay = await screen.findByRole('spinbutton', { name: 'Default Send Later delay in minutes' })
    await user.clear(sendDelay)
    await user.type(sendDelay, '25')
    fireEvent.blur(sendDelay)
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('schedule.default_send_minutes', '25'))

    const reminderDelay = await screen.findByRole('spinbutton', { name: 'Default Remind Later delay in minutes' })
    await user.clear(reminderDelay)
    await user.type(reminderDelay, '120')
    fireEvent.blur(reminderDelay)
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('schedule.default_reminder_minutes', '120'))
  })

  it('enables focused notifications through a positively worded setting', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'notifications.only_when_unfocused': true } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Notifications' }))

    const notifyWhileFocused = await screen.findByRole('checkbox', { name: 'Notify while Pinger is focused' }) as HTMLInputElement
    expect(notifyWhileFocused.checked).toBe(false)
    await user.click(notifyWhileFocused)

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('notifications.only_when_unfocused', false))
  })

  it('requests native system authorization when notifications are enabled', async () => {
    const user = userEvent.setup()
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.RequestNotificationPermission.mockResolvedValue('granted')
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'notifications.enabled': false } })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Notifications' }))

    await user.click(await screen.findByRole('checkbox', { name: 'Enable notifications' }))

    await waitFor(() => expect(harness.service.RequestNotificationPermission).toHaveBeenCalledTimes(1))
    expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('notifications.enabled', true)
  })

  it('opens macOS notification settings after native authorization is denied', async () => {
    const user = userEvent.setup()
    harness.service.NativeNotificationsSupported.mockResolvedValue(true)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.RequestNotificationPermission.mockResolvedValue('denied')
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Notifications' }))

    await user.click(await screen.findByRole('button', { name: 'Enable' }))

    await waitFor(() => expect(harness.service.RequestNotificationPermission).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(harness.service.OpenNotificationSettings).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: 'Open Settings' })).toBeTruthy()
  })
})
