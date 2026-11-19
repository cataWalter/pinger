import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Invite, type Room } from '../bindings/mychat/desktop/models.js'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, message, snapshot } from './appTestSetup'

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

  const teamInvite: Invite = { roomId: '!team:example.org', name: 'Team', topic: '', avatar: 'mxc://example.org/spam', inviter: '@alice:example.org', inviterName: 'Alice', direct: false, invitedAt: 1 }

  const teamRoom: Room = { ...room, id: '!team:example.org', name: 'Team', direct: false }

  it('does not use an unflagged own message avatar as the direct-room avatar', async () => {
    const incomingMessage = {
      ...message('$alice-1', 'from Alice', 100),
      sender: '@alice:example.org',
      avatar: 'mxc://example.org/alice-avatar',
    }
    const ownMessage = {
      ...message('$own-1', 'sent by me', 200),
      sender: snapshot.profile.userId,
      avatar: 'mxc://example.org/me-avatar',
    }
    harness.service.History.mockResolvedValueOnce({ messages: [incomingMessage, ownMessage], before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('from Alice')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('.conversation-room-avatar img')?.getAttribute('src')).toBe('/media/mxc/example.org/alice-avatar'))
  })

  it('shows the sender on the first incoming message of each run in group rooms', async () => {
    const groupMessages = [
      { ...message('$alice-1', 'first from alice', 100), avatar: 'mxc://example.org/alice-avatar' },
      { ...message('$alice-2', 'second from alice', 200), avatar: 'mxc://example.org/alice-avatar' },
      { ...message('$bob-1', 'hello from bob', 400_000), sender: '@bob:example.org', senderName: 'Bob' },
      { ...message('$me-1', 'sent by me', 500_000), sender: snapshot.profile.userId, senderName: snapshot.profile.displayName, own: true },
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, direct: false }] })
    harness.service.History.mockResolvedValueOnce({ messages: groupMessages, before: 0, hasMore: false })
    const { container } = render(<App />)

    expect(await screen.findByText('first from alice')).toBeTruthy()
    const rows = [...container.querySelectorAll<HTMLElement>('.message-row')]
    expect(rows).toHaveLength(4)
    expect(rows[0].querySelector('.message-sender-name')?.textContent).toBe('Alice')
    expect(rows[0].classList.contains('is-group-incoming')).toBe(true)
    await waitFor(() => expect(rows[0].querySelector('.message-sender-avatar img')?.getAttribute('src')).toBe('/media/mxc/example.org/alice-avatar'))
    expect(rows[1].querySelector('.message-sender-name')).toBeNull()
    expect(rows[1].querySelector('.message-sender-avatar')).toBeNull()
    expect(rows[2].querySelector('.message-sender-name')?.textContent).toBe('Bob')
    expect(rows[2].querySelector('.message-sender-avatar')?.textContent).toBe('B')
    expect(rows[3].classList.contains('is-group-incoming')).toBe(false)
    expect(rows[3].querySelector('.message-sender-name')).toBeNull()
  })

  it('starts a direct chat when a group sender name is clicked', async () => {
    const user = userEvent.setup()
    const groupRoom: Room = { ...room, direct: false }
    const directRoom: Room = { ...room, id: '!zaib-dm:example.org', name: 'Zaib', direct: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [groupRoom, directRoom] })
    harness.service.History.mockResolvedValue({ messages: [{ ...message('$zaib-1', 'hike on sunday?', 100), sender: '@zaib:example.org', senderName: 'Zaib' }], before: 0, hasMore: false })
    harness.service.StartDirectChat.mockResolvedValue(directRoom.id)
    render(<App />)

    expect(await screen.findByText('hike on sunday?')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Start a direct chat with Zaib' }))

    await waitFor(() => expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(directRoom.id))
    expect(harness.service.StartDirectChat).toHaveBeenLastCalledWith('@zaib:example.org')
    expect(screen.getByRole('region', { name: 'Conversation' }).querySelector('.conversation-title')?.textContent).toBe('Zaib')
  })

  it('accepts an invitation and opens the room', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, invites: [teamInvite] })
    harness.service.AcceptInvite.mockResolvedValue(teamRoom.id)
    const { container } = render(<App />)

    const invites = await screen.findByRole('region', { name: 'Invitations' })
    expect(within(invites).getByText('Team')).toBeTruthy()
    expect(within(invites).getByText('Invited by: Alice')).toBeTruthy()
    expect(container.querySelector('.invite-row img')).toBeNull()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, teamRoom], invites: [] })
    await user.click(within(invites).getByRole('button', { name: 'Accept invitation to Team' }))

    await waitFor(() => expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(teamRoom.id))
    expect(harness.service.AcceptInvite).toHaveBeenCalledWith(teamRoom.id)
    expect(screen.queryByRole('region', { name: 'Invitations' })).toBeNull()
  })

  it('declines an invitation and shows invitations from sync updates', async () => {
    const user = userEvent.setup()
    harness.service.DeclineInvite.mockResolvedValue(undefined)
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Invitations' })).toBeNull()

    act(() => harness.eventHandlers.get('matrix:update')?.({ data: { accountId: 'primary', rooms: [room], invites: [teamInvite], timelineChangedRoomId: [], initialSyncComplete: true, needsVerification: false, connectionState: 'connected', error: '' } }))
    const invites = await screen.findByRole('region', { name: 'Invitations' })
    await user.click(within(invites).getByRole('button', { name: 'Decline invitation to Team' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Invitations' })).toBeNull())
    expect(harness.service.DeclineInvite).toHaveBeenCalledWith(teamRoom.id)
  })

  it('shows incoming session verification from sync updates', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    act(() => harness.eventHandlers.get('matrix:update')?.({ data: {
      accountId: 'primary',
      rooms: [room],
      invites: [],
      timelineChangedRoomId: [],
      initialSyncComplete: true,
      needsVerification: false,
      verification: {
        transactionId: 'txn-incoming',
        userId: '@alice:example.org',
        deviceId: 'ALICEPHONE',
        incoming: true,
        phase: 'requested',
        emojis: [],
        decimals: [],
        reason: '',
      },
      connectionState: 'connected',
      error: '',
    } }))

    expect(await screen.findByRole('dialog', { name: 'Verify another session' })).toBeTruthy()
    expect(screen.getByText('@alice:example.org wants to verify this session.')).toBeTruthy()
  })

  it('starts session verification from the Devices section of Account settings', async () => {
    const user = userEvent.setup()
    harness.service.Devices.mockResolvedValue([])
    harness.service.StartSessionVerification.mockResolvedValue(undefined)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Account' }))
    await user.click(await screen.findByText('Advanced'))

    await user.click(await screen.findByRole('button', { name: 'Verify another session' }))

    await waitFor(() => expect(harness.service.StartSessionVerification).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
  })
})
