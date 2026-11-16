import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import * as appShared from './appShared'
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

  it('applies room updates from a consolidated Matrix batch', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await act(async () => {
      harness.eventHandlers.get('matrix:batch_update')?.({
        data: {
          new_messages: [],
          read_receipts: [],
          typing_updates: [],
          room_deltas: [{
            update: {
              rooms: [{ ...room, name: 'Batched room' }],
              slidingSyncListCounts: snapshot.slidingSyncListCounts,
              timelineChangedRoomId: [],
              typingUsers: { [room.id]: [] },
              notifications: [],
              error: '',
              initialSyncComplete: true,
              needsVerification: false,
              connectionState: 'connected',
            },
          }],
        },
      })
      await Promise.resolve()
    })

    expect(await screen.findAllByText('Batched room')).toHaveLength(2)
  })

  it('plays one incoming chat sound for received messages when enabled', async () => {
    const soundSpy = vi.spyOn(appShared, 'playNotificationSound')
    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'sounds.effects': 'Incoming and sent messages' } })

    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()

      const emitUpdate = async (newIncomingMessage: boolean) => {
        await act(async () => {
          harness.eventHandlers.get('matrix:update')?.({
            data: {
              rooms: [room],
              notificationPreferences: { 'sounds.effects': 'Incoming and sent messages' },
              timelineChangedRoomId: [],
              notifications: [],
              newIncomingMessage,
              initialSyncComplete: true,
              needsVerification: false,
              connectionState: 'connected',
              error: '',
            },
          })
          await Promise.resolve()
        })
      }

      await emitUpdate(false)
      expect(soundSpy).not.toHaveBeenCalled()
      await emitUpdate(true)

      expect(soundSpy).toHaveBeenCalledOnce()
      expect(soundSpy).toHaveBeenCalledWith(50, 'Chime')

      focusSpy.mockReturnValue(false)
      await emitUpdate(true)
      expect(soundSpy).toHaveBeenCalledOnce()
    } finally {
      soundSpy.mockRestore()
      focusSpy.mockRestore()
    }
  })

  it('does not show background sync errors as a banner', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()

    await act(async () => {
      harness.eventHandlers.get('matrix:update')?.({
        data: {
          rooms: [room],
          changedRoomId: [],
          timelineChangedRoomId: [],
          typingUsers: { [room.id]: [] },
          notifications: [],
          error: 'request error: http2: server sent GOAWAY and closed the connection',
          initialSyncComplete: true,
          needsVerification: false,
          connectionState: 'offline',
        },
      })
      await Promise.resolve()
    })

    expect(screen.queryByText(/GOAWAY/)).toBeNull()
  })

  it('shows an offline notice when the browser loses its network connection', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const offlineNotice = 'No internet connection. Pinger will reconnect automatically.'

    try {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
      await act(async () => {
        window.dispatchEvent(new Event('offline'))
      })
      expect(screen.getByText(offlineNotice)).toBeTruthy()

      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
      await act(async () => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => expect(screen.queryByText(offlineNotice)).toBeNull())
    } finally {
      delete (window.navigator as { onLine?: boolean }).onLine
    }
  })

  it('shows a server notice only after sync stays offline and clears it when sync recovers', async () => {
    render(<App />)
    expect(await screen.findByText('latest message')).toBeTruthy()
    const serverNotice = "Can't reach the Matrix server. Retrying…"
    const emitConnectionState = async (connectionState: string) => {
      await act(async () => {
        harness.eventHandlers.get('matrix:update')?.({
          data: {
            rooms: [room],
            changedRoomId: [],
            timelineChangedRoomId: [],
            typingUsers: { [room.id]: [] },
            notifications: [],
            error: '',
            initialSyncComplete: true,
            needsVerification: false,
            connectionState,
          },
        })
        await Promise.resolve()
      })
    }

    vi.useFakeTimers()
    try {
      await emitConnectionState('offline')
      act(() => vi.advanceTimersByTime(4_999))
      expect(screen.queryByText(serverNotice)).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByText(serverNotice)).toBeTruthy()

      await emitConnectionState('connected')
      act(() => vi.advanceTimersByTime(120))
      expect(screen.queryByText(serverNotice)).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })
})
