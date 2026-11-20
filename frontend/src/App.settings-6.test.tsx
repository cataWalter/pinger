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

  it('discards a recorded voice note when its send approval is cancelled', async () => {
    const user = userEvent.setup()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] })
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    class FakeAudioContext {
      sampleRate = 8000
      destination = {}
      resume = vi.fn(async () => undefined)
      close = vi.fn(async () => undefined)
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
      // The processor delivers one 250 ms block once it is connected to the destination.
      createScriptProcessor = vi.fn(() => {
        const processor = {
          onaudioprocess: null as ((event: unknown) => void) | null,
          connect: () => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(2000).fill(0.25) } }),
          disconnect: vi.fn(),
        }
        return processor
      })
    }
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    })
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      await user.click(await screen.findByRole('button', { name: 'Record voice note' }))
      await user.click(await screen.findByRole('button', { name: 'Stop and send voice note' }))

      const approval = await screen.findByRole('alertdialog', { name: 'Send media to this room?' })
      expect(within(approval).getByText(/^voice-note-.*\.wav$/)).toBeTruthy()
      await user.click(within(approval).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)
      expect(track.stop).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('removes a staged pasted image without uploading it', async () => {
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

      await user.click(await screen.findByRole('button', { name: /^Remove pasted-image-.*\.png$/ }))

      await waitFor(() => expect(screen.queryByRole('list', { name: 'Attachments to send' })).toBeNull())
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pasted-image')
      expect((await screen.findByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('reports a pasted clipboard image that has no bytes instead of uploading it', async () => {
    const originalFetch = globalThis.fetch
    const uploadFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/media/ipc/attachment/')) return { ok: true, status: 204, text: async () => '' } as Response
      return originalFetch(input, init)
    })
    const emptyScreenshot = new File([], '', { type: 'image/png' })
    vi.stubGlobal('fetch', uploadFetch)
    harness.service.History.mockResolvedValue({ messages: [message('$latest', 'latest message', 300)], before: 0, hasMore: false })
    try {
      render(<App />)
      expect(await screen.findByText('latest message')).toBeTruthy()
      const composer = await screen.findByRole('textbox', { name: 'Message' })
      fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => emptyScreenshot }], files: [] } })

      expect(await screen.findByText(/The pasted image could not be read/)).toBeTruthy()
      expect(uploadFetch.mock.calls.some(([input]) => String(input).includes('/media/ipc/attachment/'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('expands a snippet at the caret and restores its shortcut with Backspace', async () => {
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    const original = 'before ;thanks, after'
    const caret = original.indexOf(',') + 1

    fireEvent.change(composer, { target: { value: original, selectionStart: caret, selectionEnd: caret } })
    await waitFor(() => expect(composer.value).toBe('before Thanks for the update! I appreciate it., after'))

    fireEvent.keyDown(composer, { key: 'Backspace' })
    await waitFor(() => expect(composer.value).toBe(original))
    expect(composer.selectionStart).toBe(original.indexOf(';thanks') + ';thanks'.length)
  })

  it('offers matching snippets and accepts the active suggestion with Tab', async () => {
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

    fireEvent.change(composer, { target: { value: ';th', selectionStart: 3, selectionEnd: 3 } })
    expect(await screen.findByRole('listbox', { name: 'Text snippet suggestions' })).toBeTruthy()
    fireEvent.keyDown(composer, { key: 'ArrowDown' })
    fireEvent.keyDown(composer, { key: 'Tab' })

    await waitFor(() => expect(composer.value).toBe('Thanks for the update! I appreciate it.'))
  })

  it('expands an exact snippet with Enter without sending the message', async () => {
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: ';thanks', selectionStart: 7, selectionEnd: 7 } })
    expect(await screen.findByRole('listbox', { name: 'Text snippet suggestions' })).toBeTruthy()

    fireEvent.keyDown(composer, { key: 'Enter' })

    await waitFor(() => expect(composer.value).toBe('Thanks for the update! I appreciate it.'))
    expect(harness.service.SendMessage).not.toHaveBeenCalled()
  })
})
