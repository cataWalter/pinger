import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, message, snapshot } from './appTestSetup'

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

  it('applies and persists the additional appearance themes', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    const themeSelect = container.querySelector<HTMLSelectElement>('.settings-content select')!
    expect(Array.from(themeSelect.options).map((option) => option.textContent)).toEqual([
      'System default',
      'Light (light)',
      'Dark (dark)',
      'VS Code (dark)',
      'OLED black (dark)',
      'Bosco (light)',
      'Rosa (light)',
      'Dracula (dark)',
      'Midnight (dark)',
      'Slate (dark)',
      'Solarized (light)',
      'Sepia (light)',
    ])

    await user.selectOptions(themeSelect, 'VS Code')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('vs-code')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'VS Code'))
    expect(screen.getByText(/VS Code is a dark theme\./)).toBeTruthy()

    await user.selectOptions(themeSelect, 'Bosco')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('bosco')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'Bosco'))

    await user.selectOptions(themeSelect, 'Rosa')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('rosa')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'Rosa'))

    await user.selectOptions(themeSelect, 'Dracula')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('dracula')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'Dracula'))
    expect(screen.getByText(/Dracula is a dark theme\./)).toBeTruthy()

    await user.selectOptions(themeSelect, 'Sepia')
    expect(container.querySelector('.app-shell')?.getAttribute('data-theme')).toBe('sepia')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.theme', 'Sepia'))
    expect(screen.getByText(/Sepia is a light theme\./)).toBeTruthy()
  })

  it('applies a theme accent independently from the outgoing message color', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    await user.click(await screen.findByRole('button', { name: 'Ocean accent color' }))

    expect(container.querySelector('.app-shell')?.getAttribute('style')).toContain('--accent: #28718f')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.accent_color', 'Ocean'))
  })

  it('defaults the accent to Ocean and derives the outgoing bubble from it', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const style = container.querySelector('.app-shell')?.getAttribute('style') ?? ''
    expect(style).toContain('--accent: #28718f')
    expect(style).toContain('--own-bubble: #28718f')
  })

  it('applies a custom accent color from the picker', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    fireEvent.change(await screen.findByLabelText('Custom accent color'), { target: { value: '#a1b2c3' } })

    expect(container.querySelector('.app-shell')?.getAttribute('style')).toContain('--accent: #a1b2c3')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.accent_color', '#a1b2c3'))
  })

  it('applies and persists a chat wallpaper', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    await user.click(await screen.findByRole('button', { name: 'Meadow wallpaper' }))

    expect(container.querySelector('.app-shell')?.getAttribute('data-wallpaper')).toBe('meadow')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.chat_wallpaper', 'Meadow'))
  })

  it('controls room previews, unread counts, and chat-list density independently', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'sidebar.transparent': true } })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    await user.click(await screen.findByLabelText('Show room previews'))
    await user.click(await screen.findByLabelText('Show unread counts'))
    await user.click(await screen.findByLabelText('Compact chat list'))

    const appShell = container.querySelector('.app-shell')
    expect(container.querySelector('.sidebar')?.classList.contains('is-transparent')).toBe(false)
    expect(screen.queryByRole('checkbox', { name: 'Transparent sidebar' })).toBeNull()
    await waitFor(() => {
      expect(appShell?.getAttribute('data-room-previews')).toBe('false')
      expect(appShell?.getAttribute('data-unread-counts')).toBe('false')
      expect(appShell?.getAttribute('data-compact-chat-list')).toBe('true')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('sidebar.show_previews', false)
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('sidebar.show_unread_counts', false)
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('sidebar.compact_chat_list', true)
    })
  })

  it('allows disabling the pointer cursor on clickable controls', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    await user.click(await screen.findByLabelText('Use pointer cursor on clickable controls'))

    await waitFor(() => {
      expect(container.querySelector('.app-shell')?.getAttribute('data-pointer-cursor')).toBe('false')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('appearance.pointer_cursor', false)
    })
  })

  it('sets app zoom from the Appearance slider', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    const slider = await screen.findByRole('slider', { name: 'App zoom' })
    fireEvent.change(slider, { target: { value: '105' } })
    fireEvent.change(slider, { target: { value: '110' } })

    expect(screen.getByText('110%')).toBeTruthy()
    expect(harness.service.SetStringPreference).not.toHaveBeenCalledWith('appearance.zoom', expect.any(String))

    fireEvent.pointerUp(slider)

    await waitFor(() => {
      expect(document.documentElement.style.fontSize).toBe('110%')
      expect(container.querySelector('.app-shell')?.getAttribute('data-zoom')).toBe('110')
      expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.zoom', '110')
    })
    expect(harness.service.SetStringPreference).not.toHaveBeenCalledWith('appearance.zoom', '105')
  })

  it('adjusts and resets app zoom with primary-modifier shortcuts', async () => {
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const appShell = container.querySelector('.app-shell')!
    fireEvent.keyDown(appShell, { key: '=', metaKey: true })
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.zoom', '105'))

    fireEvent.keyDown(appShell, { key: '0', metaKey: true })
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('appearance.zoom', '100'))
  })
})
