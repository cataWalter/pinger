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

  function stubImageIntersectionObserver() {
    const callbacks = new Map<Element, IntersectionObserverCallback>()
    vi.stubGlobal('IntersectionObserver', class {
      private callback: IntersectionObserverCallback
      private targets = new Set<Element>()
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        this.targets.add(target)
        callbacks.set(target, this.callback)
      }
      unobserve(target: Element) {
        this.targets.delete(target)
        if (callbacks.get(target) === this.callback) callbacks.delete(target)
      }
      disconnect() {
        for (const target of this.targets) this.unobserve(target)
      }
    })
    return {
      async setIntersecting(target: Element, isIntersecting: boolean) {
        await waitFor(() => {
          if (!callbacks.has(target)) throw new Error('Element is not observed')
        })
        const callback = callbacks.get(target)
        if (!callback) throw new Error('Observed element lost its callback')
        const entry = {
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
          time: performance.now(),
        } as IntersectionObserverEntry
        act(() => callback([entry], {} as IntersectionObserver))
      },
    }
  }

  it('opens the conversation profile photo and restores focus when closed', async () => {
    const user = userEvent.setup()
    const contactRoom = { ...room, avatar: 'mxc://example.org/contact-avatar' }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, rooms: [contactRoom] })
    render(<App />)

    expect(await screen.findByText('latest message')).toBeTruthy()
    const trigger = await screen.findByRole('button', { name: 'Open profile photo for Test room' })
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Profile photo for Test room' })
    expect(within(dialog).getByRole('img', { name: 'Test room' }).getAttribute('src')).toBe('/media/mxc/example.org/contact-avatar')

    await user.click(within(dialog).getByRole('button', { name: 'Close profile photo' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Profile photo for Test room' })).toBeNull())
    expect(document.activeElement).toBe(trigger)

    await user.click(trigger)
    await screen.findByRole('dialog', { name: 'Profile photo for Test room' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Profile photo for Test room' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('hides images and videos from chat when enabled in Appearance settings', async () => {
    const user = userEvent.setup()
    const imageMessage = { ...message('$photo-hidden', 'Photo attachment', 300), mediaUri: 'mxc://example.org/photo-hidden', mediaMime: 'image/png', mediaSize: 12 }
    const videoMessage = { ...message('$video-hidden', 'Video attachment', 400), mediaUri: 'mxc://example.org/video-hidden', mediaMime: 'video/mp4', mediaSize: 24 }
    const audioMessage = { ...message('$audio-visible', 'Voice message.ogg', 500), mediaUri: 'mxc://example.org/audio-visible', mediaMime: 'audio/ogg', mediaSize: 12 }
    const audioWebMMessage = { ...message('$audio-webm-visible', 'Voice message.webm', 600), mediaUri: 'mxc://example.org/audio-webm-visible', mediaMime: 'video/webm', mediaType: 'm.audio', mediaSize: 18 }
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'appearance.hide_images_and_videos': true } })
    harness.service.History.mockResolvedValueOnce({ messages: [imageMessage, videoMessage, audioMessage, audioWebMMessage], before: 0, hasMore: false })
    stubImageIntersectionObserver()
    const { container } = render(<App />)

    expect(await screen.findByText('Photo attachment')).toBeTruthy()
    expect(container.querySelector('[data-event-id="$photo-hidden"] .message-attachment')).toBeNull()
    expect(container.querySelector('[data-event-id="$video-hidden"] .message-attachment')).toBeNull()
    expect(container.querySelector('[data-event-id="$audio-visible"] .audio-attachment')).toBeTruthy()
    expect(container.querySelector('[data-event-id="$audio-webm-visible"] .audio-attachment')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Hide images and videos' }))

    await waitFor(() => {
      expect(container.querySelector('[data-event-id="$photo-hidden"] .media-load')).toBeTruthy()
      expect(container.querySelector('[data-event-id="$video-hidden"] .media-load')).toBeTruthy()
      expect(harness.service.SetBooleanPreference).toHaveBeenCalledWith('appearance.hide_images_and_videos', false)
    })
  })

  it('renders a file attachment in its media card without a duplicate message bubble', async () => {
    const user = userEvent.setup()
    const filename = '02 - Descrovi-Iotti-Bosia.pdf'
    const savedPath = `/Users/test/Downloads/${filename}`
    const fileMessage = { ...message('$file', filename, 300), mediaUri: 'mxc://example.org/file', mediaType: 'm.file', mediaMime: 'application/pdf', mediaSize: 200_300 }
    harness.service.History.mockResolvedValueOnce({ messages: [fileMessage], before: 0, hasMore: false })
    harness.service.SaveMedia.mockResolvedValueOnce(savedPath)
    const { container } = render(<App />)

    const fileCard = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-event-id="$file"] .file-card')
      if (!element) throw new Error('File card did not render')
      return element
    })
    expect(fileCard.querySelector('.file-card-copy strong')?.textContent).toBe(filename)
    expect(container.querySelector('[data-event-id="$file"] .message-body')).toBeNull()

    await user.click(within(fileCard).getByRole('button', { name: `Download ${filename}` }))
    expect(harness.service.SaveMedia).toHaveBeenCalledWith(fileMessage.mediaUri, filename)
    await user.click(await within(fileCard).findByRole('button', { name: savedPath }))
    expect(harness.service.RevealFile).toHaveBeenCalledWith(savedPath)
  })

  it('renders an audio attachment as one player card', async () => {
    const audioMessage = { ...message('$audio', 'Voice message.ogg', 300), mediaUri: 'mxc://example.org/audio', mediaMime: 'audio/ogg', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [audioMessage], before: 0, hasMore: false })

    const { container } = render(<App />)
    const card = await waitFor(() => {
      const audioCard = container.querySelector('[data-event-id="$audio"] .audio-attachment')
      expect(audioCard).toBeTruthy()
      return audioCard
    })

    const row = container.querySelector('[data-event-id="$audio"]')
    expect(card?.querySelector('.audio-filename')?.textContent).toBe('Voice message.ogg')
    expect((within(card as HTMLElement).getByRole('button', { name: 'Transcribe with AI' }) as HTMLButtonElement).disabled).toBe(true)
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    fireEvent.click(card?.querySelector('.audio-play-button') as HTMLButtonElement)
    await waitFor(() => expect(card?.querySelector('audio')).toBeTruthy())
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1))
    playSpy.mockRestore()
    expect(card?.querySelector('audio')).toBeTruthy()
    expect(card?.querySelector('audio')?.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$audio')}`)
    expect(row?.querySelector('.message-body')).toBeNull()
    expect(row?.querySelector('.media-download')).toBeNull()
  })

  it('saves an audio attachment and reveals the saved file', async () => {
    const user = userEvent.setup()
    const filename = 'audioclip-1794686133000-5807.ogg'
    const savedPath = `/Users/test/Downloads/${filename}`
    const audioMessage = { ...message('$audio-download', filename, 300), mediaUri: 'mxc://example.org/audio-download', mediaMime: 'audio/ogg', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [audioMessage], before: 0, hasMore: false })
    harness.service.SaveMedia.mockResolvedValueOnce(savedPath)
    harness.service.RevealFile.mockClear()
    const { container } = render(<App />)

    const card = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-event-id="$audio-download"] .audio-attachment')
      if (!element) throw new Error('Audio card did not render')
      return element
    })
    await user.click(within(card).getByRole('button', { name: `Download ${filename}` }))

    expect(harness.service.SaveMedia).toHaveBeenCalledWith(audioMessage.mediaUri, filename)
    expect(await within(card).findByRole('button', { name: savedPath })).toBeTruthy()
    expect(within(card).getByRole('status').textContent).toContain(`Saved to ${savedPath}`)
    await user.click(within(card).getByRole('button', { name: savedPath }))
    expect(harness.service.RevealFile).toHaveBeenCalledWith(savedPath)
  })
})
