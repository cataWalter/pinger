import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  function stubIntersectionObserver() {
    const observers: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = []
    vi.stubGlobal('IntersectionObserver', class {
      callback: IntersectionObserverCallback
      targets: Element[] = []
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
        observers.push(this)
      }
      observe(target: Element) { this.targets.push(target) }
      unobserve() { }
      disconnect() { }
      takeRecords() { return [] }
    })
    return (target: Element, isIntersecting: boolean) => act(() => {
      const observer = [...observers].reverse().find((candidate) => candidate.targets.includes(target))
      expect(observer, 'an IntersectionObserver watches the target').toBeDefined()
      observer?.callback([{ target, isIntersecting } as unknown as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
    })
  }

  const unreadHistory = { messages: [message('$read', 'already read', 100), message('$first-new', 'first new', 200), message('$second-new', 'second new', 300)], before: 0, hasMore: false }

  it('restores an unsent draft after the app restarts', async () => {
    const user = userEvent.setup()
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    const first = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Unsent after restart')
    first.unmount()

    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Unsent after restart'))
  })

  it('does not save drafts when keeping drafts is turned off', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'composer.keep_drafts': false } })
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    const first = render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Not for disk')
    first.unmount()
    expect(window.localStorage.getItem(ROOM_DRAFTS_STORAGE_KEY)).toBeNull()

    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    expect((await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('')
  })

  it('removes saved drafts on logout', async () => {
    const user = userEvent.setup()
    harness.service.Logout.mockResolvedValue(undefined)
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Private before logout')
    await waitFor(() => expect(window.localStorage.getItem(ROOM_DRAFTS_STORAGE_KEY) ?? '').toContain('Private before logout'))
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(settings).getByRole('tab', { name: 'Account' }))
    await user.click(within(settings).getByRole('button', { name: 'Log out' }))
    await user.click(within(await screen.findByRole('group', { name: 'Confirm logout' })).getByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(harness.service.Logout).toHaveBeenCalled())
    await waitFor(() => expect(window.localStorage.getItem(ROOM_DRAFTS_STORAGE_KEY) ?? '').not.toContain('Private before logout'))
  })

  it('marks where unread messages start and jumps there from the pill', async () => {
    const user = userEvent.setup()
    const reportVisibility = stubIntersectionObserver()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unread: 2 }] })
    harness.service.History.mockResolvedValue(unreadHistory)
    render(<App />)

    const divider = await screen.findByRole('separator', { name: 'New messages' })
    expect(divider.nextElementSibling?.getAttribute('data-event-id')).toBe('$first-new')
    await waitFor(() => expect(harness.service.MarkRead).toHaveBeenCalled())
    expect(await screen.findByRole('separator', { name: 'New messages' })).toBe(divider)

    reportVisibility(divider, false)
    await user.click(await screen.findByRole('button', { name: '2 new messages' }))
    expect(document.activeElement?.getAttribute('data-event-id')).toBe('$first-new')
    expect(screen.queryByRole('button', { name: '2 new messages' })).toBeNull()
  })

  it('hides the unread pill for good once the divider has been seen', async () => {
    const reportVisibility = stubIntersectionObserver()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [{ ...room, unread: 2 }] })
    harness.service.History.mockResolvedValue(unreadHistory)
    render(<App />)

    const divider = await screen.findByRole('separator', { name: 'New messages' })
    reportVisibility(divider, true)
    expect(screen.queryByRole('button', { name: '2 new messages' })).toBeNull()
    expect(await screen.findByRole('separator', { name: 'New messages' })).toBeTruthy()
  })

  it('shows no unread divider for a room without unread messages', async () => {
    harness.service.History.mockResolvedValue(unreadHistory)
    render(<App />)
    expect(await screen.findByText('second new')).toBeTruthy()
    expect(screen.queryByRole('separator', { name: 'New messages' })).toBeNull()
  })
})
