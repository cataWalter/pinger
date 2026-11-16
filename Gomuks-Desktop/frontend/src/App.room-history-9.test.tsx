import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AccountSummary, type Message } from '../bindings/mychat/desktop/models.js'
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

  it('keeps loaded older messages when the selected room receives a live update', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Load older messages' }))
    expect(await screen.findByText('older history')).toBeTruthy()

    act(() => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [room],
          timelineChangedRoomId: [room.id],
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'connected',
        },
      })
    })

    expect(await screen.findByText('new live message')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('older history')).toBeTruthy())
    expect(harness.service.History).toHaveBeenCalledTimes(3)

    await user.click(await screen.findByRole('button', { name: 'Load older messages' }))
    expect(await screen.findByText('oldest history')).toBeTruthy()
    expect(screen.getByText('older history')).toBeTruthy()
    expect(harness.service.History).toHaveBeenLastCalledWith(room.id, 20)
  })

  it('switches the active Matrix account and loads its rooms', async () => {
    const user = userEvent.setup()
    harness.service.ScheduledJobs.mockResolvedValueOnce([{
      id: 'primary-scheduled',
      kind: 'message',
      roomId: room.id,
      text: 'primary job',
      eventId: '',
      dueAt: Date.now() + 60_000,
      createdAt: Date.now(),
      status: 'pending',
      error: '',
    }]).mockResolvedValueOnce([])
    const secondProfile = {
      userId: '@two:example.net',
      displayName: 'Two',
      homeserver: 'https://example.net',
      deviceId: 'DEVICE_TWO',
      avatarUri: '',
      verified: true,
    }
    const secondAccount: AccountSummary = { id: 'second', profile: secondProfile }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      accounts: [{ id: 'primary', profile: snapshot.profile }, secondAccount],
    })
    harness.service.SwitchAccount.mockResolvedValue({
      ...snapshot,
      activeAccountId: secondAccount.id,
      profile: secondProfile,
      rooms: [secondRoom],
    })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('.action-menu-count')).toBeTruthy())
    await user.click(await screen.findByRole('button', { name: 'Manage Matrix accounts' }))
    await user.click(await screen.findByRole('button', { name: /@two:example\.net/ }))

    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith(secondAccount.id))
    await waitFor(() => expect(container.querySelector('.action-menu-count')).toBeNull())
    expect(await screen.findByText('@two:example.net')).toBeTruthy()
    await waitFor(() => expect(harness.service.History).toHaveBeenCalledWith(secondRoom.id, 0))
  })

  it('preserves separate drafts when switching accounts in the same room', async () => {
    const user = userEvent.setup()
    const secondProfile = { ...snapshot.profile, userId: '@two:example.net', displayName: 'Two' }
    const accounts = [{ id: 'primary', profile: snapshot.profile }, { id: 'second', profile: secondProfile }]
    const primaryState = { ...snapshot, activeAccountId: 'primary', accounts, rooms: [room] }
    harness.service.Snapshot.mockResolvedValue(primaryState)
    let currentAccountID = 'primary'
    harness.service.History.mockImplementation(async () => ({
      messages: [message('$latest', `History for ${currentAccountID}`, 300)], before: 0, hasMore: false,
    }))
    harness.service.SwitchAccount.mockImplementation(async (accountID: string) => {
      currentAccountID = accountID
      return {
        ...primaryState,
        activeAccountId: accountID,
        profile: accountID === 'second' ? secondProfile : snapshot.profile,
      }
    })
    const { container } = render(<App />)
    expect(await screen.findByText('History for primary')).toBeTruthy()
    const composer = await screen.findByRole('textbox', { name: 'Message' })
    await user.type(composer, 'Primary draft')
    fireEvent.change(container.querySelector('.composer input[type="file"]')!, { target: { files: [new File(['private'], 'primary-only.txt', { type: 'text/plain' })] } })
    expect(await screen.findByText('primary-only.txt')).toBeTruthy()
    const switchTo = async (digit: string, accountID: string) => {
      harness.service.History.mockClear()
      fireEvent.keyDown(container.querySelector('.app-shell')!, { key: digit, code: `Digit${digit}`, ctrlKey: true, altKey: true })
      await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenLastCalledWith(accountID))
      await waitFor(() => expect(harness.service.History).toHaveBeenCalledWith(room.id, 0))
      expect(await screen.findByText(`History for ${accountID}`)).toBeTruthy()
    }
    await switchTo('2', 'second')
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(''))
    expect(screen.queryByText('primary-only.txt')).toBeNull()
    await user.type(composer, 'Second draft')
    await switchTo('1', 'primary')
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe('Primary draft'))
    expect(screen.getByText('primary-only.txt')).toBeTruthy()
    await switchTo('2', 'second')
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe('Second draft'))
    expect(screen.queryByText('primary-only.txt')).toBeNull()
  })

  it('ignores history from the previous account after switching into the same room', async () => {
    let completeHistory!: (page: { messages: Message[]; before: number; hasMore: boolean }) => void
    harness.service.History
      .mockImplementationOnce(() => new Promise((resolve) => { completeHistory = resolve }))
      .mockResolvedValue({ messages: [message('$second', 'Second account history', 400)], before: 0, hasMore: false })
    harness.service.SwitchAccount.mockResolvedValue({ ...snapshot, activeAccountId: 'second', rooms: [room] })
    render(<App />)
    await waitFor(() => expect(harness.service.History).toHaveBeenCalledWith(room.id, 0))
    act(() => harness.eventHandlers.get('notification:open-room')?.({ data: { accountId: 'second', roomId: room.id } }))
    expect(await screen.findByText('Second account history')).toBeTruthy()
    await act(async () => completeHistory({ messages: [message('$primary', 'Private primary history', 300)], before: 0, hasMore: false }))
    expect(screen.queryByText('Private primary history')).toBeNull()
    expect(screen.getByText('Second account history')).toBeTruthy()
  })

  it('stages files dropped from the file manager in the composer', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    act(() => harness.eventHandlers.get('matrix:files-dropped')?.({ data: { files: [{ name: 'dropped-notes.txt', type: 'text/plain', data: btoa('hello') }] } }))
    const attachments = await screen.findByRole('list', { name: 'Attachments to send' })
    expect(within(attachments).getByText('dropped-notes.txt')).toBeTruthy()
  })

  it('discards staged account attachments on logout', async () => {
    const user = userEvent.setup()
    harness.service.Logout.mockResolvedValue(undefined)
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    fireEvent.change(container.querySelector('.composer input[type="file"]')!, { target: { files: [new File(['private'], 'logout-only.txt', { type: 'text/plain' })] } })
    expect(screen.getByText('logout-only.txt')).toBeTruthy()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, activeAccountId: 'second' })
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(settings).getByRole('tab', { name: 'Account' }))
    await user.click(within(settings).getByRole('button', { name: 'Log out' }))
    harness.service.History.mockClear()
    await user.click(within(await screen.findByRole('group', { name: 'Confirm logout' })).getByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(harness.service.History).toHaveBeenCalledWith(room.id, 0))
    harness.service.SwitchAccount.mockResolvedValue(snapshot)
    harness.service.History.mockResolvedValue({ messages: [message('$returned', 'Returned to logged-out account', 500)], before: 0, hasMore: false })
    act(() => harness.eventHandlers.get('notification:open-room')?.({ data: { accountId: 'primary', roomId: room.id } }))
    expect(await screen.findByText('Returned to logged-out account')).toBeTruthy()
    expect(screen.queryByText('logout-only.txt')).toBeNull()
  })
})
