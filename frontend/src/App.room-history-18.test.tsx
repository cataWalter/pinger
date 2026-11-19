import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import ChatMediaRenderer, { matrixMXCMediaURL } from './ChatMediaRenderer'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, room, message, menuCommand, snapshot } from './appTestSetup'

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

  it('opens a gallery with media collected from older room history', async () => {
    const user = userEvent.setup()
    const photo = { ...message('$gallery-photo', 'photo.png', 300), mediaUri: 'mxc://example.org/gallery-photo', mediaMime: 'image/png' }
    const olderFile = { ...message('$gallery-file', 'report.pdf', 100), mediaUri: 'mxc://example.org/gallery-file', mediaType: 'm.file', mediaMime: 'application/pdf' }
    harness.service.History.mockImplementation(async (_roomID: string, before: number) => {
      if (before === 0) return { messages: [photo], before: 50, hasMore: true }
      if (before === 50) return { messages: [olderFile], before: 20, hasMore: false }
      return { messages: [], before, hasMore: false }
    })
    stubImageIntersectionObserver()
    render(<App />)

    await waitFor(() => expect(document.querySelector('[data-event-id="$gallery-photo"] .message-attachment')).toBeTruthy())
    await user.click(menuCommand('Media gallery'))

    const dialog = await screen.findByRole('dialog', { name: 'Media in Test room' })
    await waitFor(() => expect(within(dialog).getAllByRole('article')).toHaveLength(2))
    expect(harness.service.History.mock.calls.filter(([, before]) => before === 0).length).toBeGreaterThanOrEqual(2)
    await user.click(within(dialog).getByRole('button', { name: 'Files, 1' }))
    expect(within(dialog).getAllByRole('article')).toHaveLength(1)
    expect(dialog.querySelector('.file-card-copy strong')?.textContent).toBe('report.pdf')
  })

  it('streams image previews from the local media endpoint without a click', async () => {
    const mediaURL = 'mxc://example.org/photo'
    const imageMessage = { ...message('$photo', 'Attachment', 300), mediaUri: mediaURL, mediaMime: 'image/png', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [imageMessage], before: 0, hasMore: false })
    const intersection = stubImageIntersectionObserver()

    const { container } = render(<App />)
    const attachment = await waitFor(() => {
      const element = container.querySelector('[data-event-id="$photo"] .message-attachment')
      expect(element).toBeTruthy()
      return element
    })
    await intersection.setIntersecting(attachment!, true)

    const preview = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>('[data-event-id="$photo"] .media-preview')
      expect(image).toBeTruthy()
      return image
    })
    expect(preview?.getAttribute('src')).toBe(`/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent('$photo')}?size=preview`)
    expect(container.querySelector('[data-event-id="$photo"] .media-load')).toBeNull()

    await intersection.setIntersecting(attachment!, false)
    await waitFor(() => expect(container.querySelector('[data-event-id="$photo"] .media-preview')).toBeNull())
    expect(container.querySelector('[data-event-id="$photo"] .media-preview')).toBeNull()
  })

  it('saves an image from its toolbar through the app download path', async () => {
    const user = userEvent.setup()
    const filename = 'photo-save.png'
    const savedPath = `/Users/test/Downloads/${filename}`
    const imageMessage = { ...message('$photo-save', filename, 300), mediaUri: 'mxc://example.org/photo-save', mediaMime: 'image/png', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [imageMessage], before: 0, hasMore: false })
    harness.service.SaveMedia.mockResolvedValueOnce(savedPath)
    const intersection = stubImageIntersectionObserver()

    const { container } = render(<App />)
    const attachment = await waitFor(() => {
      const element = container.querySelector('[data-event-id="$photo-save"] .message-attachment')
      expect(element).toBeTruthy()
      return element
    })
    await intersection.setIntersecting(attachment!, true)
    const toolbar = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-event-id="$photo-save"] .media-toolbar')
      expect(element).toBeTruthy()
      return element
    })

    await user.click(within(toolbar!).getByRole('button', { name: `Download ${filename}` }))
    expect(harness.service.SaveMedia).toHaveBeenCalledWith(imageMessage.mediaUri, filename)
    await waitFor(() => expect(toolbar?.querySelector('.media-download-status')?.textContent).toBe(`Saved to ${savedPath}`))
    await user.click(within(toolbar!).getByRole('button', { name: savedPath }))
    expect(harness.service.RevealFile).toHaveBeenCalledWith(savedPath)
    expect(toolbar?.querySelector('a')).toBeNull()
  })

  it('hides a bare image filename above the preview but keeps real captions', async () => {
    const mediaURL = 'mxc://example.org/photo'
    const fileNameMessage = { ...message('$photo', 'image.jpg', 300), mediaUri: mediaURL, mediaMime: 'image/png', mediaSize: 12 }
    const captionMessage = { ...message('$captioned', 'Sunset over the bay', 400), mediaUri: mediaURL, mediaMime: 'image/png', mediaSize: 12 }
    harness.service.History.mockResolvedValueOnce({ messages: [fileNameMessage, captionMessage], before: 0, hasMore: false })
    const intersection = stubImageIntersectionObserver()

    const { container } = render(<App />)
    const attachments = await waitFor(() => {
      const elements = container.querySelectorAll('.message-attachment')
      expect(elements).toHaveLength(2)
      return elements
    })
    await Promise.all(Array.from(attachments, (attachment) => intersection.setIntersecting(attachment, true)))
    await waitFor(() => expect(container.querySelectorAll('.media-preview')).toHaveLength(2))

    const photoRow = container.querySelector<HTMLElement>('[data-event-id="$photo"]')!
    expect(within(photoRow).queryByText('image.jpg')).toBeNull()
    expect(photoRow.querySelector('.media-toolbar span')).toBeNull()
    const captionRow = container.querySelector<HTMLElement>('[data-event-id="$captioned"]')!
    expect(await within(captionRow).findByText('Sunset over the bay')).toBeTruthy()
  })

  it('renders native image, audio, and video tags from Matrix event URLs', () => {
    const { container } = render(<div>
      <ChatMediaRenderer roomID={room.id} eventID="$photo" kind="image" alt="Photo" />
      <ChatMediaRenderer roomID={room.id} eventID="$voice" kind="audio" alt="Voice note" />
      <ChatMediaRenderer roomID={room.id} eventID="$clip" kind="video" alt="Clip" />
    </div>)
    const expectedURL = (eventID: string) => `/media/matrix/${encodeURIComponent(room.id)}/${encodeURIComponent(eventID)}`

    expect(container.querySelector('img')?.getAttribute('src')).toBe(expectedURL('$photo'))
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    expect(container.querySelector('audio')?.getAttribute('src')).toBe(expectedURL('$voice'))
    expect(container.querySelector('audio')?.hasAttribute('controls')).toBe(true)
    expect(container.querySelector('video')?.getAttribute('src')).toBe(expectedURL('$clip'))
    expect(container.querySelector('video')?.hasAttribute('controls')).toBe(true)
  })

  it('maps avatar MXC URIs to the local media endpoint', () => {
    expect(matrixMXCMediaURL('mxc://example.org/avatar')).toBe('/media/mxc/example.org/avatar')
    expect(matrixMXCMediaURL('not-an-mxc-uri')).toBe('')
  })
})
