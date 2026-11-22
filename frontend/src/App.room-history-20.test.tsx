import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  function stubTimelineGeometry(contentHeight: number) {
    let height = contentHeight
    const resizeCallbacks: ResizeObserverCallback[] = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
      }
      observe() { }
      unobserve() { }
      disconnect() { }
    })
    geometrySpies.push(
      vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(() => height),
      vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(300),
    )
    return {
      setContentHeight(next: number) {
        height = next
      },
      notifyResize() {
        act(() => {
          for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
        })
      },
    }
  }

  // Opens a room whose newest message is an auto-previewed image. The image loads after the
  // timeline has been pinned to the bottom, which is the order that leaves the view above the newest message.
  async function renderRoomWithImageAtBottom() {
    const image = { ...message('$photo', 'Attachment', 300), mediaUri: 'mxc://example.org/photo', mediaMime: 'image/png', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [message('$older', 'older history', 100), image], before: 0, hasMore: false })
    const geometry = stubTimelineGeometry(700)
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('[data-event-id="$photo"] .media-preview')).toBeTruthy())
    const timeline = await screen.findByRole('region', { name: 'Message timeline' })
    expect(timeline.scrollTop).toBe(700)
    return { geometry, timeline }
  }

  it('renders Matrix audio with a video MIME as one compact audio bar', async () => {
    const user = userEvent.setup()
    const audioMessage = { ...message('$audio-webm', 'Voice message.mp4', 300), mediaUri: 'mxc://example.org/audio-webm', mediaMime: 'video/mp4', mediaType: 'm.audio', mediaDurationMs: 19_840 }
    harness.service.History.mockResolvedValueOnce({ messages: [audioMessage], before: 0, hasMore: false })

    const { container } = render(<App />)
    const card = await waitFor(() => {
      const audioCard = container.querySelector('[data-event-id="$audio-webm"] .audio-attachment')
      expect(audioCard).toBeTruthy()
      return audioCard
    })
    expect(card?.querySelector('.audio-clock')?.textContent).toBe('0:00 / 0:19')
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Play audio' }))
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1))

    const audio = card?.querySelector('audio') as HTMLAudioElement
    fireEvent.play(audio)
    expect(await within(card as HTMLElement).findByRole('button', { name: 'Pause audio' })).toBeTruthy()
    expect(card?.querySelector('.audio-player-bar')).toBeTruthy()
    expect(card?.querySelector('video')).toBeNull()
    expect(audio.hasAttribute('controls')).toBe(false)
    expect(audio.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$audio-webm')}`)
    expect(card?.querySelector('.audio-clock')?.textContent).toBe('0:00 / 0:19')
    playSpy.mockRestore()
  })

  it('loads an incoming Matrix video message into the native video player', async () => {
    const user = userEvent.setup()
    const videoMessage = { ...message('$video-playback', 'Video message', 300), mediaUri: 'mxc://example.org/video-playback', mediaMime: 'video/webm', mediaType: 'm.video', mediaDurationMs: 2500 }
    harness.service.History.mockResolvedValueOnce({ messages: [videoMessage], before: 0, hasMore: false })
    const { container } = render(<App />)

    const card = await waitFor(() => {
      const videoCard = container.querySelector('[data-event-id="$video-playback"] .message-attachment')
      expect(videoCard).toBeTruthy()
      return videoCard
    })
    await user.click(within(card as HTMLElement).getByRole('button', { name: /Load video/ }))

    const video = await waitFor(() => {
      const element = card?.querySelector('video')
      expect(element).toBeTruthy()
      return element
    })
    expect(video?.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$video-playback')}`)
    expect(video?.hasAttribute('controls')).toBe(true)
  })

  it.each(['button', 'ctrlKey', 'metaKey'])('transcribes audio with %s and only puts the result in the composer when accepted', async (activation) => {
    const user = userEvent.setup()
    const audioMessage = { ...message('$audio-transcription', 'Voice message.ogg', 300), mediaUri: 'mxc://example.org/audio-transcription', mediaMime: 'audio/ogg', mediaSize: 12 }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080' } })
    harness.service.History.mockResolvedValueOnce({ messages: [audioMessage], before: 0, hasMore: false })
    harness.service.AITranscribeMedia.mockResolvedValueOnce('Please meet at noon.')

    const { container } = render(<App />)
    const transcribe = await screen.findByRole('button', { name: 'Transcribe with AI' })
    if (activation === 'button') await user.click(transcribe)
    else {
      const row = container.querySelector<HTMLElement>('[data-event-id="$audio-transcription"]')!
      row.focus()
      fireEvent.keyDown(row, { key: 'V', code: 'KeyV', [activation]: true, shiftKey: true })
    }

    expect(await screen.findByText('Please meet at noon.')).toBeTruthy()
    expect(harness.service.AITranscribeMedia).toHaveBeenCalledWith(audioMessage.mediaUri, audioMessage.body, audioMessage.mediaMime, '')
    expect(harness.service.AITranscribeMedia).toHaveBeenCalledTimes(1)
    expect(harness.service.SendMessage).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: 'Use as draft' }))
    expect((await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Please meet at noon.')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(container.querySelector('[data-event-id="$audio-transcription"] .audio-transcript')).toBeTruthy()
  })

  it('keeps the newest message in view when media loads after the room opens', async () => {
    const { geometry, timeline } = await renderRoomWithImageAtBottom()

    geometry.setContentHeight(1000)
    geometry.notifyResize()

    expect(timeline.scrollTop).toBe(1000)
  })

  it('stops following new content after the reader scrolls up', async () => {
    const { geometry, timeline } = await renderRoomWithImageAtBottom()

    timeline.scrollTop = 150
    fireEvent.scroll(timeline)
    geometry.setContentHeight(1000)
    geometry.notifyResize()

    expect(timeline.scrollTop).toBe(150)
  })

  it('keeps following when the scroll event from an earlier pin arrives after media grew', async () => {
    const { geometry, timeline } = await renderRoomWithImageAtBottom()

    geometry.setContentHeight(1500)
    fireEvent.scroll(timeline)
    geometry.notifyResize()

    expect(timeline.scrollTop).toBe(1500)
  })

  it('hides message timestamps when configured', async () => {
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.show_timestamps': false } })
    const { container } = render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    expect(container.querySelector('[data-event-id="$latest"] .message-meta time')).toBeNull()
  })
})
