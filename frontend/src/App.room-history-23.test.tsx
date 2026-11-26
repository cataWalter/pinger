import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { emitMatrixUpdate, harness, room, secondRoom, message, snapshot } from './appTestSetup'

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

  it('archives unread rooms after marking them read and restores them from Archived', async () => {
    const user = userEvent.setup()
    const unreadRoom = { ...room, unread: 2, lastEventId: '$latest', unanswered: true, needsReply: true }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [unreadRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 1 })))

    fireEvent.contextMenu(container.querySelector('.room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Archive room' }))
    await waitFor(() => {
      expect(harness.service.MarkRead).toHaveBeenCalledWith(room.id, '$latest')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${room.id}`, true)
    })
    expect(container.querySelector('.room-list .room-button')).toBeNull()
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 0 })))

    await user.click(await screen.findByRole('button', { name: 'Archived rooms' }))
    expect(container.querySelector('.room-list .room-button')).toBeTruthy()
    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Restore room' }))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${room.id}`, false))
    await user.click(await screen.findByRole('button', { name: 'All' }))
    expect(container.querySelector('.room-list .room-button')).toBeTruthy()
    await waitFor(() => expect(harness.service.SetMenuState).toHaveBeenLastCalledWith(expect.objectContaining({ needsReplyCount: 1 })))
  })

  it('includes archived rooms in inbox search results', async () => {
    const user = userEvent.setup()
    const archivedRoom = { ...secondRoom, name: 'Archived project' }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [room, archivedRoom],
      preferences: { [`room.archived.primary.${archivedRoom.id}`]: true },
    })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.type(await screen.findByRole('textbox', { name: 'Find a room' }), 'Archived')

    expect(container.querySelectorAll('.room-list .room-button')).toHaveLength(1)
    expect(container.querySelector('.room-list .room-button')?.textContent).toContain('Archived project')
  })

  it('restores archived rooms to the inbox when their latest event changes', async () => {
    const user = userEvent.setup()
    const archivedRoom = { ...room, lastEventId: '$before-archive-update' }
    const archiveKey = `room.archived.primary.${archivedRoom.id}`
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { [archiveKey]: true } })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Archived rooms' }))
    expect(container.querySelector('.room-list .room-button')).toBeTruthy()
    act(() => {
      emitMatrixUpdate({
        rooms: [{ ...archivedRoom, lastEventId: '$after-archive-update', lastEventAt: archivedRoom.lastEventAt + 1 }],
        timelineChangedRoomId: [archivedRoom.id],
        initialSyncComplete: true,
        needsVerification: false,
        connectionState: 'connected',
      })
    })

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(archiveKey, false))
    await waitFor(() => expect(container.querySelector('.room-list .room-button')).toBeNull())
    await user.click(await screen.findByRole('button', { name: 'All' }))
    expect(container.querySelector('.room-list .room-button')).toBeTruthy()
  })

  it('uses the configured next-unread room after archiving the selected room', async () => {
    const user = userEvent.setup()
    const unreadDestination = { ...secondRoom, unread: 1 }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [room, unreadDestination] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'After archiving a room' }), 'next_unread')
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('archive.next_room', 'next_unread'))
    await user.keyboard('{Escape}')

    fireEvent.contextMenu(container.querySelector('.room-list .room-button')!, { clientX: 48, clientY: 48 })
    await user.click(await screen.findByRole('menuitem', { name: 'Archive room' }))
    await waitFor(() => expect(container.querySelector('.room-button.is-active')?.textContent).toContain(unreadDestination.name))
  })

  it('archives rooms older than the selected age after marking unread rooms read', async () => {
    const user = userEvent.setup()
    const staleRoom = { ...room, unread: 1, lastEventId: '$stale', lastEventAt: Date.now() - 20 * 24 * 60 * 60 * 1000 }
    const currentRoom = { ...secondRoom, lastEventAt: Date.now() }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [staleRoom, currentRoom] })
    const { container } = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const ageInput = await screen.findByRole('spinbutton', { name: 'Inactive room age' })
    await user.clear(ageInput)
    await user.type(ageInput, '7')
    await user.tab()
    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('archive.older_than_days', '7'))
    await user.click(await screen.findByRole('button', { name: 'Archive inactive rooms' }))

    await waitFor(() => {
      expect(harness.service.MarkRead).toHaveBeenCalledWith(staleRoom.id, '$stale')
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${staleRoom.id}`, true)
    })
    expect(container.querySelector('.room-list .room-button')?.textContent).toContain(currentRoom.name)
  })

  it('automatically archives inactive rooms using the selected age', async () => {
    const user = userEvent.setup()
    const staleRoom = { ...secondRoom, lastEventAt: Date.now() - 45 * 24 * 60 * 60 * 1000 }
    const currentRoom = { ...room, lastEventAt: Date.now() }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [currentRoom, staleRoom],
      preferences: { 'archive.older_than_days': '90' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const ageInput = await screen.findByRole('spinbutton', { name: 'Inactive room age' })
    await user.clear(ageInput)
    await user.type(ageInput, '30')
    await user.tab()
    await user.click(await screen.findByRole('checkbox', { name: 'Automatically archive inactive rooms' }))

    await waitFor(() => expect(harness.service.SetStringPreference).toHaveBeenCalledWith('archive.older_than_days', '30'))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('archive.automatic', true))
    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${staleRoom.id}`, true))
  })

  it('archives inactive rooms that only have a list activity timestamp', async () => {
    const user = userEvent.setup()
    const staleRoom = { ...secondRoom, lastEventAt: 0, lastSeen: Date.now() - 20 * 24 * 60 * 60 * 1000 }
    const currentRoom = { ...room, lastEventAt: Date.now() }
    harness.service.Snapshot.mockResolvedValue({
      ...snapshot,
      rooms: [currentRoom, staleRoom],
      preferences: { 'archive.older_than_days': '7' },
    })
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Archive inactive rooms' }))

    await waitFor(() => expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith(`room.archived.primary.${staleRoom.id}`, true))
    expect(harness.service.SetBooleanPreference).not.toHaveBeenCalledWith(`room.archived.primary.${currentRoom.id}`, true)
  })
})
