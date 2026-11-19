import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { SNIPPETS_STORAGE_KEY } from './snippets'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { harness, message, snapshot } from './appTestSetup'

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

  it('records a voice note and uploads WAV audio with duration metadata', async () => {
    const user = userEvent.setup()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const audioBuffer = {
      duration: 0.25,
      length: 2,
      numberOfChannels: 1,
      sampleRate: 8000,
      getChannelData: () => Float32Array.of(0.25, -0.25),
    } as unknown as AudioBuffer
    class FakeAudioContext {
      decodeAudioData = vi.fn(async () => audioBuffer)
      close = vi.fn(async () => undefined)
    }
    class FakeMediaRecorder {
      state: 'inactive' | 'recording' = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      constructor() { }
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['audio bytes'], { type: this.mimeType }) })
        this.onstop?.()
      }
    }
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(await screen.findByRole('button', { name: 'Record voice note' }))
      await user.click(await screen.findByRole('button', { name: 'Stop and send voice note' }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve and send' }))

      await waitFor(() => expect(uploadFetch).toHaveBeenCalledWith(expect.stringContaining('voiceNote=true'), expect.objectContaining({ method: 'POST' })))
      const [uploadURL, request] = uploadFetch.mock.calls.find(([input]) => String(input).includes('/media/ipc/attachment/')) ?? []
      expect(String(uploadURL)).toContain('durationMs=250')
      expect((request?.headers as Record<string, string>)['Content-Type']).toBe('audio/wav')
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
      expect(track.stop).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stages a pasted clipboard image and uploads it only when sent', async () => {
    const user = userEvent.setup()
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const screenshot = new File([Uint8Array.of(137, 80, 78, 71)], '', { type: 'image/png' })
    URL.createObjectURL = vi.fn(() => 'blob:pasted-image')
    URL.revokeObjectURL = vi.fn()
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      const composer = await screen.findByRole('textbox', { name: 'Message' })
      fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }], files: [] } })

      const attachments = await screen.findByRole('list', { name: 'Attachments to send' })
      expect(within(attachments).getByRole('img', { name: 'Image attachment preview' }).getAttribute('src')).toBe('blob:pasted-image')
      expect(within(attachments).queryByText(/^pasted-image-.*\.png$/)).toBeNull()
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)

      await user.click(await screen.findByRole('button', { name: 'Send message' }))

      await waitFor(() => expect(uploadFetch).toHaveBeenCalledWith(expect.stringContaining('/media/ipc/attachment/'), expect.objectContaining({ method: 'POST' })))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      const [uploadURL, request] = uploadFetch.mock.calls.find(([input]) => String(input).includes('/media/ipc/attachment/')) ?? []
      expect(new URL(String(uploadURL), 'http://localhost').searchParams.get('filename')).toMatch(/^pasted-image-.*\.png$/)
      expect((request?.body as Uint8Array).byteLength).toBe(4)
      await waitFor(() => expect(screen.queryByText(/^pasted-image-/)).toBeNull())
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

})
