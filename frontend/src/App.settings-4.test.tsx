import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { SNIPPETS_STORAGE_KEY } from './snippets'
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

describe('settings storage, integrations, help, and about', () => {
  let confirmSpy: { mockRestore: () => void; } | undefined

  let snippetDownloadClickSpy: { mockRestore: () => void; } | undefined

  afterEach(() => {
    confirmSpy?.mockRestore()
    confirmSpy = undefined
    snippetDownloadClickSpy?.mockRestore()
    snippetDownloadClickSpy = undefined
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.removeItem(SNIPPETS_STORAGE_KEY)
  })

  beforeEach(() => {
    harness.eventHandlers.clear()
    harness.service.Snapshot.mockResolvedValue(snapshot)
    harness.service.History.mockResolvedValue({ messages: [], before: 0, hasMore: false })
    harness.service.ScheduledJobs.mockResolvedValue([])
    harness.service.SetActiveRoom.mockResolvedValue(undefined)
    harness.service.SetRoomUnanswered.mockResolvedValue(undefined)
    harness.service.Devices.mockResolvedValue([])
    harness.service.RevokeDevice.mockResolvedValue(undefined)
    harness.service.SaveMedia.mockResolvedValue('')
    harness.service.RevealFile.mockResolvedValue(undefined)
    harness.service.SetTyping.mockResolvedValue(undefined)
    harness.service.MarkRead.mockResolvedValue(undefined)
    harness.service.RoomMembers.mockResolvedValue([])
    harness.service.NativeNotificationsSupported.mockResolvedValue(false)
    harness.service.NotificationPermission.mockResolvedValue('default')
    harness.service.OpenNotificationSettings.mockResolvedValue(undefined)
    harness.service.SetBooleanPreference.mockResolvedValue(undefined)
    harness.service.SetStringPreference.mockResolvedValue(undefined)
    harness.service.SetStringPreferences.mockResolvedValue(undefined)
    harness.service.StorageUsage.mockResolvedValue({ databaseBytes: 2048, walBytes: 0 })
    harness.service.MediaCacheUsage.mockResolvedValue({ bytes: 4096, files: 3 })
    harness.service.RoomStorageUsage.mockResolvedValue([])
    harness.service.ClearCachedMedia.mockResolvedValue({ files: 0, bytes: 0 })
    harness.service.AppVersion.mockResolvedValue('1.0.0')
    harness.service.AppBuildInfo.mockResolvedValue({ commit: 'abcdef0123456789', buildDate: '2026-10-22T12:00:00Z' })
    harness.service.CheckForUpdates.mockResolvedValue({ currentVersion: '1.0.0', latestVersion: '', releaseUrl: 'https://github.com/cataWalter/pinger/releases', publishedAt: '', releaseNotes: '', updateAvailable: false, message: 'Pinger is up to date.' })
    harness.service.AICancel.mockResolvedValue(false)
    harness.service.GenerateRoomImage.mockResolvedValue('iVBORw0KGgo=')
    harness.service.SendRoomImage.mockResolvedValue(undefined)
    harness.service.AIFeatureDefaults.mockResolvedValue([])
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
  })

  it.each(['menu', 'ctrlKey', 'metaKey'])('generates an image from the draft with %s, shows progress, and sends it only after approval', async (activation) => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.image.binary_path': '/opt/sd-server', 'ai.image.model_path': '/models/realistic.safetensors' } })
    harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
    let resolveImage: (encoded: string) => void = () => { }
    harness.service.GenerateRoomImage.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveImage = resolve }))
    render(<App />)
    await screen.findByText('Can you review this?')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'a red fox')
    if (activation === 'menu') await user.click(menuCommand('Generate image from draft'))
    else fireEvent.keyDown(composer, { key: 'J', code: 'KeyJ', [activation]: true, shiftKey: true })

    await waitFor(() => expect(harness.service.GenerateRoomImage).toHaveBeenCalledTimes(1))
    const [prompt, requestID] = harness.service.GenerateRoomImage.mock.calls[0] as [string, string]
    expect(prompt).toBe('a red fox')
    expect(requestID).toEqual(expect.any(String))
    act(() => harness.eventHandlers.get('local-ai:image-progress')?.({ data: { requestId: requestID, stage: 'generating', step: 3, totalSteps: 8 } }))
    expect(await screen.findByText('Generating image · step 3 of 8')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Stop image generation' })).toBeTruthy()

    await act(async () => resolveImage('iVBORw0KGgo='))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send generated image to this room?' })
    expect(within(dialog).getByRole('img', { name: 'Generated image preview' }).getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(harness.service.SendRoomImage).not.toHaveBeenCalled()
    expect(composer.value).toBe('a red fox')

    await user.click(within(dialog).getByRole('button', { name: 'Approve and send' }))
    await waitFor(() => expect(harness.service.SendRoomImage).toHaveBeenCalledWith(room.id, 'iVBORw0KGgo='))
    await waitFor(() => expect(composer.value).toBe(''))
    expect(menuCommand('Generate image from draft')).toBeTruthy()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })

  it('discards a generated image without sending it and keeps the draft', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.image.binary_path': '/opt/sd-server', 'ai.image.model_path': '/models/realistic.safetensors' } })
    harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
    render(<App />)
    await screen.findByText('Can you review this?')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'a red fox')
    await user.click(menuCommand('Generate image from draft'))

    const dialog = await screen.findByRole('alertdialog', { name: 'Send generated image to this room?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Send generated image to this room?' })).toBeNull())
    expect(harness.service.SendRoomImage).not.toHaveBeenCalled()
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(composer.value).toBe('a red fox')
    expect((menuCommand('Generate image from draft') as HTMLButtonElement).disabled).toBe(false)
  })

  it('stops image generation from the composer and keeps the draft', async () => {
    const user = userEvent.setup()
    harness.service.Snapshot.mockResolvedValue({ ...snapshot, preferences: { 'ai.image.binary_path': '/opt/sd-server', 'ai.image.model_path': '/models/realistic.safetensors' } })
    harness.service.History.mockResolvedValue({ messages: [message('$incoming', 'Can you review this?', 300)], before: 0, hasMore: false })
    let rejectImage: (error: Error) => void = () => { }
    harness.service.GenerateRoomImage.mockImplementationOnce(() => new Promise<string>((_, reject) => { rejectImage = reject }))
    harness.service.AICancel.mockImplementationOnce(async () => {
      rejectImage(new Error('image generation stopped'))
      return true
    })
    render(<App />)
    await screen.findByText('Can you review this?')
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'a red fox')
    await user.click(menuCommand('Generate image from draft'))

    await waitFor(() => expect(harness.service.GenerateRoomImage).toHaveBeenCalledTimes(1))
    const requestID = harness.service.GenerateRoomImage.mock.calls[0][1]
    await user.click(await screen.findByRole('button', { name: 'Stop image generation' }))

    expect(harness.service.AICancel).toHaveBeenCalledWith(requestID)
    await waitFor(() => expect(menuCommand('Generate image from draft')).toBeTruthy())
    expect(composer.value).toBe('a red fox')
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
    expect(harness.service.SendRoomImage).not.toHaveBeenCalled()
  })

  it('records a video message and uploads it with the video-message flag', async () => {
    const user = userEvent.setup()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    class FakeMediaRecorder {
      static isTypeSupported = (type: string) => type === 'video/webm'
      state: 'inactive' | 'recording' = 'inactive'
      mimeType: string
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      constructor(_stream: MediaStream, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? 'video/webm'
      }
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['video bytes'], { type: 'video/webm' }) })
        this.onstop?.()
      }
    }
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(menuCommand('Record video message'))
      await user.click(await screen.findByRole('button', { name: 'Stop and send video message' }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve and send' }))

      await waitFor(() => expect(uploadFetch).toHaveBeenCalledWith(expect.stringContaining('videoMessage=true'), expect.objectContaining({ method: 'POST' })))
      expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything(), audio: true }))
      const uploadURL = String(uploadFetch.mock.calls.find(([input]) => String(input).includes('/media/ipc/attachment/'))?.[0])
      expect(uploadURL).toContain('voiceNote=false')
      const uploadQuery = new URL(uploadURL, 'http://localhost').searchParams
      expect(uploadQuery.get('videoMessage')).toBe('true')
      expect(Number(uploadQuery.get('durationMs'))).toBeGreaterThan(0)
      expect(Number(uploadQuery.get('durationMs'))).toBeLessThanOrEqual(3 * 60 * 1000)
      const uploadRequest = uploadFetch.mock.calls.find(([input]) => String(input).includes('/media/ipc/attachment/'))?.[1]
      expect((uploadRequest?.headers as Record<string, string>)['Content-Type']).toBe('video/webm')
      expect(track.stop).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
