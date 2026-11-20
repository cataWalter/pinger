import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Message } from '../bindings/mychat/desktop/models.js'
import App from './App'
import { SNIPPETS_STORAGE_KEY } from './snippets'
import { searchSettings } from './settings'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { appendedTimelineMessageIDs, preferredScrollBehavior, TimelineMessageList, type TimelineMessageActions } from './appShared'
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

  it('searches settings across tabs and jumps to the matching setting', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    const search = await screen.findByLabelText('Search settings', {}, { timeout: 5000 })
    await user.type(search, 'unread')

    const results = await screen.findByRole('region', { name: 'Settings search results' })
    expect(within(results).getByRole('button', { name: /Show unread counts/ })).toBeTruthy()
    expect(within(results).getByRole('button', { name: /room's read state/ })).toBeTruthy()
    expect(within(results).getByRole('heading', { name: 'Appearance' })).toBeTruthy()
    expect(within(results).getByRole('heading', { name: 'General' })).toBeTruthy()

    await user.click(within(results).getByRole('button', { name: /Show unread counts/ }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true'))
    expect(await screen.findByRole('checkbox', { name: 'Show unread counts' })).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.setting-toggle.is-search-hit')).toBeTruthy())
  })

  it('reports when no setting matches the search', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    await user.type(await screen.findByLabelText('Search settings'), 'zzzzz')
    expect(await screen.findByText(/No settings match/)).toBeTruthy()
  })

  it('opens a tab from the search results and clears the search', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.type(await screen.findByLabelText('Search settings'), 'unread')

    await user.click(await screen.findByRole('tab', { name: 'Appearance' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true'))
    expect(await screen.findByRole('checkbox', { name: 'Show unread counts' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Settings search results' })).toBeNull()
  })

  it('opens a tab without matches and clears the search', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.type(await screen.findByLabelText('Search settings'), 'unread')

    await user.click(await screen.findByRole('tab', { name: 'Help' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Help' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.queryByRole('region', { name: 'Settings search results' })).toBeNull()
  })

  it('clears the settings search with the escape key without closing the dialog', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    const search = await screen.findByLabelText('Search settings')
    await user.type(search, 'theme')
    expect(await screen.findByRole('region', { name: 'Settings search results' })).toBeTruthy()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Settings search results' })).toBeNull())
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })

  it('focuses settings search with the slash key and opens the best match with enter', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Help' }))

    await user.keyboard('/')
    const search = await screen.findByLabelText('Search settings')
    await waitFor(() => expect(document.activeElement).toBe(search))

    await user.type(search, 'unread{Enter}')
    const best = searchSettings('unread')[0]
    await waitFor(() => expect(screen.getByRole('tab', { name: best.tab }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.queryByRole('region', { name: 'Settings search results' })).toBeNull()
  })

  it('moves between settings search results with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const search = await screen.findByLabelText('Search settings')
    await user.type(search, 'unread')

    const results = await screen.findByRole('region', { name: 'Settings search results' })
    const buttons = within(results).getAllByRole('button')
    const bestButton = results.querySelector<HTMLButtonElement>('.settings-search-result.is-best-match')
    expect(bestButton).toBeTruthy()
    const bestIndex = buttons.indexOf(bestButton as HTMLButtonElement)
    expect(buttons.length).toBeGreaterThan(bestIndex + 1)

    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(document.activeElement).toBe(bestButton))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(buttons[bestIndex + 1])

    for (let step = 0; step <= bestIndex + 1; step++) await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(search)
  })

  it('highlights the matched words in settings search results', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.type(await screen.findByLabelText('Search settings'), 'unread')

    const results = await screen.findByRole('region', { name: 'Settings search results' })
    expect(within(results).getByRole('button', { name: /Show unread counts/ }).querySelector('mark')?.textContent).toBe('unread')
  })

  it('formats a preserved text selection from the composer formatting tools', async () => {
    const user = userEvent.setup()
    render(<App />)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'say hello', selectionStart: 4, selectionEnd: 9 } })

    const formatting = await screen.findByRole('group', { name: 'Formatting' })
    expect(screen.queryByRole('button', { name: 'Formatting' })).toBeNull()
    await user.click(within(formatting).getByRole('button', { name: 'Bold' }))
    await waitFor(() => expect(composer.value).toBe('say **hello**'))
    await waitFor(() => expect(document.activeElement).toBe(composer))
    expect(composer.selectionStart).toBe(6)
    expect(composer.selectionEnd).toBe(11)
  })

  it('identifies only new appends, not history, receipts, or optimistic replacements', () => {
    const first = message('$first', 'first', 100)
    const last = message('$last', 'last', 200)
    const incoming = message('$incoming', 'incoming', 300)
    expect([...appendedTimelineMessageIDs([], [first, last])]).toEqual([])
    expect([...appendedTimelineMessageIDs([last], [first, last])]).toEqual([])
    expect([...appendedTimelineMessageIDs([first, last], [first, { ...last, seenAt: 500 }])]).toEqual([])
    expect([...appendedTimelineMessageIDs([first, last], [first, last, incoming])]).toEqual(['$incoming'])
    const optimistic = { ...last, id: '~local', transactionId: 'txn-1', sending: true }
    const confirmed = { ...last, id: '$confirmed', transactionId: 'txn-1' }
    expect([...appendedTimelineMessageIDs([first, optimistic], [first, confirmed])]).toEqual([])
    expect([...appendedTimelineMessageIDs([first, optimistic], [first, confirmed, incoming])]).toEqual(['$incoming'])
  })

  it('does not replay message entrances for initial history, prepends, or account changes', async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    const first = message('$first', 'first', 100)
    const next = message('$next', 'next', 200)
    const actionsRef = { current: {} as TimelineMessageActions }
    const timeline = (messages: Message[], accountID = 'primary', animations = true) => <div className="timeline"><TimelineMessageList messages={messages} accountID={accountID} selectedRoomID={room.id} currentUserID={snapshot.profile.userId} preferences={{ 'appearance.message_animations': animations }} hideDeleted={false} groupChat={false} chatTranslation={null} contextMessageID="" reactingMessageID="" autoPlayNextMessageId={null} canUseTranscriptAsDraft actionsRef={actionsRef} /></div>
    try {
      const { container, rerender } = render(timeline([first]))
      expect(container.querySelector('[data-live-message]')).toBeNull()
      rerender(timeline([first, next]))
      const row = container.querySelector<HTMLElement>('[data-event-id="$next"]')!
      expect(row.dataset.liveMessage).toBe('true')
      fireEvent.animationEnd(row)
      fireEvent(row, new Event('webkitAnimationEnd', { bubbles: true }))
      rerender(timeline([first, { ...next, seenAt: 300 }]))
      expect(container.querySelector('[data-live-message]')).toBeNull()
      rerender(timeline([message('$older', 'older', 50), first, next]))
      expect(container.querySelector('[data-live-message]')).toBeNull()
      rerender(timeline([first, next, message('$account', 'account', 400)], 'second'))
      expect(container.querySelector('[data-live-message]')).toBeNull()
      rerender(timeline([first, next, message('$account', 'account', 400), message('$disabled', 'disabled', 500)], 'second', false))
      expect(container.querySelector('[data-live-message]')).toBeNull()
    } finally {
      bounds.mockRestore()
    }
  })

  it('uses instant programmatic scrolling when the OS requests reduced motion', () => {
    const media = vi.fn(() => ({ matches: true } as MediaQueryList))
    vi.stubGlobal('matchMedia', media)
    try {
      expect(preferredScrollBehavior('smooth')).toBe('auto')
      expect(media).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
      media.mockReturnValue({ matches: false } as MediaQueryList)
      expect(preferredScrollBehavior('smooth')).toBe('smooth')
      expect(preferredScrollBehavior('auto')).toBe('auto')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps every composer tool in one row of labelled groups with no hidden menus', async () => {
    render(<App />)
    await screen.findByRole('textbox', { name: 'Message' })

    const aiTools = await screen.findByRole('group', { name: 'AI tools' })
    const messageTools = await screen.findByRole('group', { name: 'Message tools' })
    const formattingTools = within(messageTools).getByRole('group', { name: 'Formatting' })
    const contentTools = within(messageTools).getByRole('group', { name: 'Add content' })
    const deliveryTools = within(messageTools).getByRole('group', { name: 'Delivery' })
    expect(within(formattingTools).getByRole('button', { name: 'Bold' }).querySelector('.composer-tool-caption')?.textContent).toBe('Bold')
    expect(within(aiTools).getByRole('button', { name: 'Analyze draft with Language Tutor' })).toBeTruthy()
    expect(within(aiTools).getByRole('button', { name: 'Generate image from draft' })).toBeTruthy()
    expect(within(aiTools).getByRole('button', { name: 'Suggest replies' })).toBeTruthy()
    expect(within(aiTools).getByRole('button', { name: 'Summarize with AI' })).toBeTruthy()
    expect(within(aiTools).queryByRole('button', { name: 'Analyze chat topics' })).toBeNull()
    expect(within(aiTools).queryByRole('button', { name: 'Analyze conversation' })).toBeNull()
    expect(within(aiTools).queryByRole('button', { name: 'Attach file' })).toBeNull()
    expect(within(contentTools).getByRole('button', { name: 'Attach file' })).toBeTruthy()
    expect(within(contentTools).getByRole('button', { name: 'Emoji picker' })).toBeTruthy()
    expect(within(deliveryTools).getByRole('button', { name: 'Record voice note' })).toBeTruthy()
    expect(within(deliveryTools).getByRole('button', { name: 'Record video message' })).toBeTruthy()
    expect((within(deliveryTools).getByRole('button', { name: 'Schedule message' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Formatting' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delivery options' })).toBeNull()
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull()
  })
})
