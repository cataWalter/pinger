import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Room } from '../bindings/mychat/desktop/models.js'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import * as appShared from './appShared'
import { harness, room, message, openMessageMenu, snapshot } from './appTestSetup'

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

  const teamRoom: Room = { ...room, id: '!team:example.org', name: 'Team', direct: false }

  it('creates an encrypted group and invites people', async () => {
    const user = userEvent.setup()
    harness.service.CreateGroupRoom.mockResolvedValue(teamRoom.id)
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Join or create a room' }))
    await user.click(await screen.findByRole('tab', { name: 'Create' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a group' })
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, teamRoom] })
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Team')
    await user.type(within(dialog).getByRole('textbox', { name: 'Invite people (optional)' }), '@alice:example.org, @bob:example.org')
    expect((within(dialog).getByRole('checkbox', { name: 'End-to-end encryption' }) as HTMLInputElement).checked).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'Create group' }))

    await waitFor(() => expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(teamRoom.id))
    expect(harness.service.CreateGroupRoom).toHaveBeenCalledWith({ name: 'Team', topic: '', invitees: ['@alice:example.org', '@bob:example.org'], encrypted: true })
  })

  it('invites people from the room details', async () => {
    const user = userEvent.setup()
    harness.service.InviteToRoom.mockResolvedValue(undefined)
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    fireEvent.click(await screen.findByRole('button', { name: 'Room details' }))
    const dialog = await screen.findByRole('dialog', { name: 'Test room' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Invite people' }), '@carol:example.org')
    await user.click(within(dialog).getByRole('button', { name: 'Invite' }))

    expect(await within(dialog).findByText('Invited @carol:example.org')).toBeTruthy()
    expect(harness.service.InviteToRoom).toHaveBeenCalledWith(room.id, ['@carol:example.org'])
    expect((within(dialog).getByRole('textbox', { name: 'Invite people' }) as HTMLInputElement).value).toBe('')
  })

  it('shows a link preview card and keeps encrypted links private by default', async () => {
    const user = userEvent.setup()
    harness.service.OpenExternalURL.mockResolvedValue(undefined)
    harness.service.URLPreview.mockResolvedValueOnce({ url: 'https://example.com/post', title: 'Example post', description: 'A short summary.', siteName: 'Example', image: '', imageWidth: 0, imageHeight: 0 })
    harness.service.History.mockResolvedValueOnce({ messages: [
      message('$link-1', 'Read https://example.com/post.', 100),
      { ...message('$link-2', 'Secret https://private.example.org/doc', 200), encrypted: true },
    ], before: 0, hasMore: false })
    render(<App />)

    const card = await screen.findByRole('link', { name: 'Link preview: Example post' })
    expect(card.textContent).toContain('A short summary.')
    expect(harness.service.URLPreview).toHaveBeenCalledWith('https://example.com/post')
    expect(harness.service.URLPreview).not.toHaveBeenCalledWith('https://private.example.org/doc')

    await user.click(card)
    expect(harness.service.OpenExternalURL).toHaveBeenCalledWith('https://example.com/post')
  })

  it('groups thread replies under their root and opens the thread', async () => {
    const user = userEvent.setup()
    const threadRoot = message('$thread-root', 'thread starter', 100)
    const replies = [
      { ...message('$thread-1', 'first threaded answer', 200), threadRootId: '$thread-root' },
      { ...message('$thread-2', 'second threaded answer', 300), threadRootId: '$thread-root', senderName: 'Bob' },
    ]
    harness.service.History.mockResolvedValueOnce({ messages: [threadRoot, ...replies, message('$after-thread', 'main timeline continues', 400)], before: 0, hasMore: false })
    harness.service.ThreadMessages.mockResolvedValue([threadRoot, ...replies])
    const { container } = render(<App />)

    expect(await screen.findByText('main timeline continues')).toBeTruthy()
    expect(screen.queryByText('first threaded answer')).toBeNull()
    const summary = await screen.findByRole('button', { name: 'Open thread, 2 replies' })
    expect(summary.textContent).toContain('Bob: second threaded answer')

    await user.click(summary)
    const panel = await screen.findByRole('dialog', { name: '2 replies' })
    expect(await within(panel).findByText('first threaded answer')).toBeTruthy()
    expect(harness.service.ThreadMessages).toHaveBeenCalledWith(room.id, '$thread-root')
    await user.click(within(panel).getByRole('button', { name: 'Close thread' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '2 replies' })).toBeNull())

    openMessageMenu(container, '$after-thread')
    await user.click(await screen.findByRole('menuitem', { name: 'Reply in thread' }))
    expect(harness.service.ThreadMessages).toHaveBeenLastCalledWith(room.id, '$after-thread')
  })

  it('keeps sender headers out of direct message timelines', async () => {
    harness.service.History.mockResolvedValueOnce({ messages: [message('$dm-1', 'direct hello', 100), message('$dm-2', 'direct again', 400_000)], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('direct hello')).toBeTruthy()
    expect(container.querySelectorAll('.message-row')).toHaveLength(2)
    expect(container.querySelector('.message-row.is-group-incoming')).toBeNull()
    expect(container.querySelector('.message-sender-name')).toBeNull()
    expect(container.querySelector('.message-sender-avatar')).toBeNull()
  })

  it('keeps sender headers out of IG bridged timelines', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, direct: false, bridge: 'IG' }] })
    harness.service.History.mockResolvedValueOnce({ messages: [message('$ig-1', 'ig hello', 100), message('$ig-2', 'ig again', 400_000)], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('ig hello')).toBeTruthy()
    expect(container.querySelectorAll('.message-row')).toHaveLength(2)
    expect(container.querySelector('.message-row.is-group-incoming')).toBeNull()
    expect(container.querySelector('.message-sender-name')).toBeNull()
    expect(container.querySelector('.message-sender-avatar')).toBeNull()
  })

  it('refreshes the room preview after sending a message', async () => {
    const updatedRoom = { ...room, preview: 'sent from the composer', lastEventSender: snapshot.profile.userId, lastEventAt: 400 }
    harness.service.Snapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, rooms: [updatedRoom] })
    const user = userEvent.setup()
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'sent from the composer')
    await user.click(await screen.findByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, 'sent from the composer'))
    await waitFor(() => expect(container.querySelector('.room-preview')?.textContent).toBe('sent from the composer'))
  })

  it('plays an outgoing chat sound when sounds are enabled for all messages', async () => {
    const soundSpy = vi.spyOn(appShared, 'playNotificationSound')
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'sounds.effects': 'Incoming and sent messages' } })

    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()

      await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'hello')
      await user.click(await screen.findByRole('button', { name: 'Send message' }))

      await waitFor(() => expect(harness.service.SendMessage).toHaveBeenCalledWith(room.id, 'hello'))
      expect(soundSpy).toHaveBeenCalledWith(50, 'Soft')
    } finally {
      soundSpy.mockRestore()
    }
  })

  it('replaces emoticons as you type when enabled in Keyboard settings', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, direct: false }], preferences: { 'emoji.replace_emoticons': true } })
    render(<App />)

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'Hi :)')

    expect(composer.value).toBe('Hi 🙂')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('replaces emoticons as you type by default', async () => {
    const user = userEvent.setup()
    render(<App />)

    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'Hi :) <3')

    expect(composer.value).toBe('Hi 🙂 ❤️')
  })
})
