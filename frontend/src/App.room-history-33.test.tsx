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

  it('does not use browser permission as native notification permission', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
    try {
      const user = userEvent.setup()
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(await screen.findByRole('button', { name: 'Settings' }))
      await user.click(await screen.findByRole('tab', { name: 'Notifications' }))

      expect(await screen.findByText('Native notifications are unavailable. On macOS, launch the bundled Pinger.app; on Linux or Windows, use a desktop session with notifications enabled.')).toBeTruthy()
      expect(screen.queryByText('Blocked by the system')).toBeNull()
      expect((await screen.findByRole('button', { name: 'Unavailable' }) as HTMLButtonElement).disabled).toBe(true)
      expect(harness.service.RequestNotificationPermission).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('previews the selected notification tone at the configured volume', async () => {
    const oscillator = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    }
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
    class MockAudioContext {
      currentTime = 1
      destination = {}
      createOscillator = vi.fn(() => oscillator)
      createGain = vi.fn(() => gain)
      resume = vi.fn().mockResolvedValue(undefined)
      close = vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('AudioContext', MockAudioContext)
    try {
      const user = userEvent.setup()
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(await screen.findByRole('button', { name: 'Settings' }))
      await user.click(await screen.findByRole('tab', { name: 'Notifications' }))
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Direct message tone' }), 'Pulse')

      await waitFor(() => expect(oscillator.start).toHaveBeenCalledTimes(1))
      expect(oscillator.type).toBe('square')
      expect(harness.service.SetStringPreference).toHaveBeenCalledWith('notifications.sound_direct', 'Pulse')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('schedules a reminder for a specific Matrix message', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'schedule.default_reminder_minutes': '120' } })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Set reminder for message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set reminder' })
    const remindAt = within(dialog).getByLabelText('Remind me at') as HTMLInputElement
    const defaultRemindAt = new Date(remindAt.value).getTime()
    expect(defaultRemindAt).toBeGreaterThanOrEqual(Date.now() + 119 * 60_000)
    expect(defaultRemindAt).toBeLessThanOrEqual(Date.now() + 121 * 60_000)
    expect(within(dialog).getByRole('checkbox', { name: 'Archive room after setting reminder' }).getAttribute('checked')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Set reminder' }))

    await waitFor(() => expect(harness.service.ScheduleReminder).toHaveBeenCalledWith(room.id, '$latest', '', expect.any(Number)))
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true)
  })

  it('archives the room after successfully setting a reminder when requested', async () => {
    const user = userEvent.setup()
    const unreadRoom = { ...room, unread: 1, lastEventId: '$latest' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [unreadRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Set reminder for message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set reminder' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Archive room after setting reminder' }))
    await user.click(within(dialog).getByRole('button', { name: 'Set reminder' }))

    await waitFor(() => {
      expect(harness.service.ScheduleReminder).toHaveBeenCalledWith(room.id, '$latest', '', expect.any(Number))
      expect(harness.service.MarkRead).toHaveBeenCalledWith(room.id, '$latest')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true)
    })
    expect(container.querySelector('.room-list .room-button')).toBeNull()
  })

  it('does not archive the room when setting a reminder fails', async () => {
    const user = userEvent.setup()
    harness.service.ScheduleReminder.mockRejectedValueOnce(new Error('schedule failed'))
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    openMessageMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Set reminder for message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set reminder' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Archive room after setting reminder' }))
    await user.click(within(dialog).getByRole('button', { name: 'Set reminder' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('schedule failed')
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true)
  })

  it('cancels a pending job from the scheduled queue', async () => {
    const user = userEvent.setup()
    harness.service.ScheduledJobs.mockResolvedValue([{
      id: 'scheduled-1',
      kind: 'message',
      roomId: room.id,
      text: 'scheduled text',
      eventId: '',
      dueAt: Date.now() + 60_000,
      createdAt: Date.now(),
      status: 'pending',
      error: '',
    }])
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(menuCommand('Scheduled messages and reminders'))
    const dialog = await screen.findByRole('dialog', { name: 'Scheduled messages and reminders' })
    expect(within(dialog).getByText('scheduled text')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(harness.service.CancelScheduledJob).toHaveBeenCalledWith('scheduled-1'))
  })

  it('surfaces a due reminder and keeps it available in the queue', async () => {
    const user = userEvent.setup()
    const reminder = {
      id: 'reminder-1',
      kind: 'reminder',
      roomId: room.id,
      text: 'Stand up',
      eventId: '$latest',
      dueAt: Date.now() - 1_000,
      createdAt: Date.now() - 3_600_000,
      status: 'fired',
      error: '',
    }
    harness.service.ScheduledJobs.mockResolvedValue([reminder])
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    act(() => harness.eventHandlers.get('scheduler:reminder')?.({ data: reminder }))
    expect(await screen.findByText('Test room: Stand up')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'View reminders' }))
    const dialog = await screen.findByRole('dialog', { name: 'Scheduled messages and reminders' })

    expect(within(dialog).getByText('Stand up')).toBeTruthy()
    expect(within(dialog).getByText('Due now')).toBeTruthy()
  })
})
