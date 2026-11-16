import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AccountSummary, type Room } from '../bindings/mychat/desktop/models.js'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import * as appShared from './appShared'
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

  it('filters the inbox by account and switches accounts when opening another account room', async () => {
    const user = userEvent.setup()
    const secondProfile = {
      userId: '@two:example.net',
      displayName: 'Two',
      homeserver: 'https://example.net',
      deviceId: 'DEVICE_TWO',
      avatarUri: '',
      verified: true,
    }
    const secondAccount: AccountSummary = { id: 'second', profile: secondProfile }
    const otherRoom: Room = { ...room, id: '!other:example.net', name: 'Other account room', accountId: 'second', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      accounts: [{ id: 'primary', profile: snapshot.profile }, secondAccount],
    })
    harness.service.AccountRooms.mockResolvedValue([room, otherRoom])
    harness.service.SwitchAccount.mockResolvedValue({
      ...snapshot,
      activeAccountId: secondAccount.id,
      profile: secondProfile,
      rooms: [otherRoom],
    })
    render(<App />)

    expect(await screen.findByText('Other account room')).toBeTruthy()
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 1 })))
    const accountFilter = await screen.findByRole('combobox', { name: 'Filter rooms by account' })
    await user.selectOptions(accountFilter, 'primary')
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 0 })))
    await user.selectOptions(accountFilter, 'second')
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 1 })))
    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
    expect(within(roomList).queryByText('Test room')).toBeNull()
    expect(within(roomList).getByText('Other account room')).toBeTruthy()

    await user.click(within(roomList).getByText('Other account room'))
    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith(secondAccount.id))
  })

  it('avoids sorting unchanged background account snapshots while preserving changed rooms and drafts', async () => {
    const user = userEvent.setup()
    const accounts: AccountSummary[] = ['primary', 'second', 'third'].map((id) => ({ id, profile: { ...snapshot.profile, displayName: `${id} account` } }))
    let backgroundRooms: Room[] = [
      { ...room, accountId: 'second', name: 'Second account shared room', preview: 'Original background preview', unread: 1 },
      { ...room, accountId: 'third', name: 'Third account shared room', preview: 'Third account preview', unread: 2 },
    ]
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, accounts })
    harness.service.AccountRooms.mockImplementation(async () => [room, ...backgroundRooms].map((candidate) => ({ ...candidate })))
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const sortSpy = vi.spyOn(appShared, 'compareRoomActivity')
    try {
      render(<App />)
      const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
      await within(roomList).findByText('Third account shared room')
      await screen.findByText('latest message')
      const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
      await user.type(composer, 'Keep this draft')
      const refresh = intervalSpy.mock.calls.find(([, delay]) => delay === 15000)?.[0]
      expect(typeof refresh).toBe('function')
      const refreshRooms = refresh as () => void
      const poll = async () => {
        await act(async () => {
          refreshRooms()
          await Promise.resolve()
        })
      }
      await poll()
      sortSpy.mockClear()
      const timelineMessage = screen.getByText('latest message')
      const renderCount = harness.markdownRenderCount
      const historyCalls = harness.service.History.mock.calls.length
      for (let index = 0; index < 3; index++) await poll()

      expect(sortSpy.mock.calls.length).toBe(0)
      expect(harness.markdownRenderCount).toBe(renderCount)
      expect(harness.service.History.mock.calls.length).toBe(historyCalls)
      expect(screen.getByText('latest message')).toBe(timelineMessage)
      expect(composer.value).toBe('Keep this draft')

      backgroundRooms = [{ ...backgroundRooms[0], preview: 'Updated background preview', unread: 4 }, backgroundRooms[1]]
      await poll()
      expect(sortSpy.mock.calls.length).toBeGreaterThan(0)
      expect(within(roomList).getByText('Updated background preview')).toBeTruthy()
      expect(within(roomList).getByText('Third account preview')).toBeTruthy()
      expect(within(roomList).getByText('Test room')).toBeTruthy()
      expect(harness.service.SetActiveRoom).toHaveBeenLastCalledWith(room.id)
      expect(composer.value).toBe('Keep this draft')
    } finally {
      sortSpy.mockRestore()
      intervalSpy.mockRestore()
    }
  })

  it('switches Matrix accounts with the account number shortcut', async () => {
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
    fireEvent.keyDown(container.querySelector('.app-shell')!, { key: '2', code: 'Digit2', ctrlKey: true, altKey: true })

    await waitFor(() => expect(harness.service.SwitchAccount).toHaveBeenCalledWith(secondAccount.id))
    expect(await screen.findByText('@two:example.net')).toBeTruthy()
  })

  it('adds another Matrix account from the account manager', async () => {
    const user = userEvent.setup()
    const secondProfile = {
      userId: '@two:example.net',
      displayName: 'Two',
      homeserver: 'https://example.net',
      deviceId: 'DEVICE_TWO',
      avatarUri: '',
      verified: true,
    }
    const secondAccount: AccountSummary = { id: 'second', profile: secondProfile }
    harness.service.AddAccount.mockResolvedValue({
      ...snapshot,
      activeAccountId: secondAccount.id,
      accounts: [{ id: 'primary', profile: snapshot.profile }, secondAccount],
      profile: secondProfile,
      rooms: [secondRoom],
    })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Manage Matrix accounts' }))
    await user.click(await screen.findByRole('button', { name: 'Add account' }))
    await user.clear(await screen.findByLabelText('Homeserver'))
    await user.type(await screen.findByLabelText('Homeserver'), 'https://example.net')
    await user.type(await screen.findByLabelText('Username'), '@two:example.net')
    await user.type(await screen.findByLabelText('Password'), 'secret')
    await user.click(await screen.findByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(harness.service.AddAccount).toHaveBeenCalledWith('https://example.net', '@two:example.net', 'secret'))
    expect(await screen.findByText('@two:example.net')).toBeTruthy()
  })
})
