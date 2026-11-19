import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, message, openMessageMenu, snapshot } from './appTestSetup'

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

afterEach(() => {
  window.localStorage.removeItem(ROOM_DRAFTS_STORAGE_KEY)
})

describe('message editing', () => {
  beforeEach(() => {
    harness.eventHandlers.clear()
    harness.service.Snapshot.mockResolvedValue(snapshot)
    harness.service.RoomMembers.mockResolvedValue([])
    harness.service.ScheduledJobs.mockResolvedValue([])
    harness.service.SetActiveRoom.mockResolvedValue(undefined)
    harness.service.SetRoomUnanswered.mockResolvedValue(undefined)
    harness.service.SetTyping.mockResolvedValue(undefined)
    harness.service.MarkRead.mockResolvedValue(undefined)
    harness.service.SetBooleanPreference.mockResolvedValue(undefined)
    harness.service.SetStringPreference.mockResolvedValue(undefined)
    harness.service.EditMessage.mockResolvedValue(undefined)
    harness.service.NativeNotificationsSupported.mockResolvedValue(false)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.SendNotification.mockResolvedValue(false)
    harness.service.ListLocalAIChats.mockResolvedValue([])
    harness.service.ListLocalAIChatFolders.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('edits an own message from the context menu and sends the edit', async () => {
    const own = { ...message('$mine', 'original text', 300), sender: snapshot.profile.userId, senderName: 'Me', own: true }
    harness.service.History.mockResolvedValue({ messages: [own], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('original text')).toBeTruthy()

    openMessageMenu(container, '$mine')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit message' }))

    const input = container.querySelector<HTMLTextAreaElement>('form.composer textarea')!
    await waitFor(() => expect(input.value).toBe('original text'))
    fireEvent.change(input, { target: { value: 'edited text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))

    await waitFor(() => expect(harness.service.EditMessage).toHaveBeenCalledWith('!room:example.org', 'edited text', '$mine'))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendMessageWithMentions).not.toHaveBeenCalled()
  })

  it('saves an edit when Enter is pressed in the composer', async () => {
    const own = { ...message('$mine', 'original text', 300), sender: snapshot.profile.userId, senderName: 'Me', own: true }
    harness.service.History.mockResolvedValue({ messages: [own], before: 0, hasMore: false })
    const { container } = render(<App />)
    expect(await screen.findByText('original text')).toBeTruthy()

    openMessageMenu(container, '$mine')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit message' }))

    const input = container.querySelector<HTMLTextAreaElement>('form.composer textarea')!
    await waitFor(() => expect(input.value).toBe('original text'))
    fireEvent.change(input, { target: { value: 'edited by enter' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(harness.service.EditMessage).toHaveBeenCalledWith('!room:example.org', 'edited by enter', '$mine'))
  })

  it('shows the edited body after the timeline reloads', async () => {
    const own = { ...message('$mine', 'original text', 300), sender: snapshot.profile.userId, senderName: 'Me', own: true }
    const edited = { ...own, body: 'edited text' }
    let sent = false
    harness.service.History.mockImplementation(async () => ({
      messages: [sent ? edited : own],
      before: 0,
      hasMore: false,
    }))
    harness.service.EditMessage.mockImplementation(async () => { sent = true })
    const { container } = render(<App />)
    expect(await screen.findByText('original text')).toBeTruthy()

    openMessageMenu(container, '$mine')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit message' }))
    const input = container.querySelector<HTMLTextAreaElement>('form.composer textarea')!
    await waitFor(() => expect(input.value).toBe('original text'))
    fireEvent.change(input, { target: { value: 'edited text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))

    expect(await screen.findByText('edited text')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('original text')).toBeNull())
  })
})
