import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

describe('native application menu actions', () => {
  function dispatchMenuAction(action: string) {
    harness.eventHandlers.get('application-menu:action')?.({ data: action })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    harness.eventHandlers.clear()
    harness.service.Snapshot.mockResolvedValue(snapshot)
    harness.service.AccountRooms.mockResolvedValue([])
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    harness.service.ScheduledJobs.mockResolvedValue([])
    harness.service.SetActiveRoom.mockResolvedValue(undefined)
    harness.service.MarkRead.mockResolvedValue(undefined)
    harness.service.SetTyping.mockResolvedValue(undefined)
    harness.service.SetRoomUnanswered.mockResolvedValue(undefined)
    harness.service.RoomMembers.mockResolvedValue([])
    harness.service.NativeNotificationsSupported.mockResolvedValue(false)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.SetBooleanPreference.mockResolvedValue(undefined)
    harness.service.SetStringPreference.mockResolvedValue(undefined)
    harness.service.ListLocalAIChats.mockResolvedValue([])
    harness.service.ListLocalAIChatFolders.mockResolvedValue([])
    harness.service.LoadLocalAIChatMessages.mockResolvedValue([])
    harness.service.SwitchAccount.mockResolvedValue({ ...snapshot, activeAccountId: 'secondary' })
    harness.tutorService.Analyze.mockReturnValue(new Promise(() => undefined))
  })

  afterEach(() => {
    cleanup()
  })

  it('publishes the selected room and filter to the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({
      roomSelected: true,
      privateChatOpen: false,
      draftReady: false,
      filter: 'all',
    })))
  })

  it('runs room actions from the native menu on the selected room', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [secondRoom] })
    render(<App />)
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ roomSelected: true, roomUnanswered: true, roomNeedsReply: true })))

    act(() => dispatchMenuAction('room-answered'))

    await waitFor(() => expect(harness.service.SetRoomUnanswered).toHaveBeenCalledWith(secondRoom.id, false))
  })

  it('applies room filters from the native menu', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, secondRoom] })
    render(<App />)
    await screen.findByText('latest message')
    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
    expect(within(roomList).getByRole('button', { name: /Test room/ })).toBeTruthy()

    act(() => dispatchMenuAction('filter:needs-reply'))

    await waitFor(() => expect(within(roomList).queryByRole('button', { name: /Test room/ })).toBeNull())
    expect(within(roomList).getByRole('button', { name: /Second room/ })).toBeTruthy()
    expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'needs-reply' }))
  })

  it('opens the requested settings tab from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('settings:Keyboard'))

    const settingsDialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(settingsDialog).getByRole('tab', { name: 'Keyboard' }).getAttribute('aria-selected')).toBe('true')
  })

  it('switches accounts from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('account:secondary'))

    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith('secondary'))
  })

  it('opens the quick switcher from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('quick-switch'))

    expect(await screen.findByRole('dialog', { name: 'Quick switcher' })).toBeTruthy()
  })

  it('focuses room search from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('room-search'))

    expect(document.activeElement).toBe(await screen.findByRole('textbox', { name: 'Find a room' }))
  })

  it('opens a new private chat from the native menu', async () => {
    render(<App />)
    await screen.findByText('latest message')

    act(() => dispatchMenuAction('private-chat-new'))

    expect(await screen.findByRole('heading', { name: 'Local AI' })).toBeTruthy()
  })

  it('adds the open private chat to All rooms from the native menu', async () => {
    const user = userEvent.setup()
    harness.service.ListLocalAIChats.mockResolvedValue([{ id: 'chat-1', title: 'Trip plan', agentId: '', updatedAt: 1_700_000_000_000, preview: '' }])
    render(<App />)
    await screen.findByText('latest message')
    await user.click(await screen.findByRole('button', { name: 'Local AI chats' }))
    await user.click(await screen.findByRole('button', { name: /Trip plan/ }))
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ privateChatOpen: true, privateChatInAll: false })))

    act(() => dispatchMenuAction('private-chat-all'))

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('ai.local_chat.in_all.chat-1', true))
  })

  it('analyzes the composer draft from the native menu', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:11434' } })
    render(<App />)
    await screen.findByText('latest message')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'Ben iyiyim.' } })
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ draftReady: true })))

    act(() => dispatchMenuAction('tutor-draft'))

    await waitFor(() => expect(harness.tutorService.Analyze).toHaveBeenCalledWith('Ben iyiyim.', 'draft', 'tr', 'en', expect.any(String)))
  })

  it('sends undo to the focused text field from the native menu', async () => {
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    try {
      render(<App />)
      const composer = await screen.findByRole('textbox', { name: 'Message' })
      composer.focus()

      act(() => dispatchMenuAction('undo'))

      expect(execCommand).toHaveBeenCalledWith('undo')
    } finally {
      Reflect.deleteProperty(document, 'execCommand')
    }
  })
})
