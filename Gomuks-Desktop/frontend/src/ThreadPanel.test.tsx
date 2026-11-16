import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../bindings/mychat/desktop/models.js'
import { ThreadPanel } from './ThreadPanel'
import { mainTimelineMessages, summarizeThreads } from './threads'

const service = vi.hoisted(() => ({
  ThreadMessages: vi.fn(),
  SendThreadReply: vi.fn(),
}))

vi.mock('../bindings/mychat/desktop', () => ({ AppService: service }))

function message(id: string, body: string, timestamp: number, threadRootId = ''): Message {
  return {
    id, transactionId: '', sender: '@alice:example.org', senderName: 'Alice', avatar: '', body, formattedBody: '',
    replyToEventId: '', replyToSender: '', replyToPreview: '', threadRootId, timestamp, seenAt: 0, timelineCursor: timestamp,
    sending: false, sendError: '', own: false, reactions: {}, reacted: {}, mediaUri: '', mediaType: '', mediaMime: '',
    mediaSize: 0, mediaWidth: 0, mediaHeight: 0, mediaDurationMs: 0, encrypted: false, decryptionError: '', edited: false,
    editHistory: [], redacted: false,
  }
}

const root = message('$root', 'Plan for Friday?', 1)
const firstReply = message('$first', 'Pizza works', 2, '$root')
const secondReply = { ...message('$second', 'Count me in', 3, '$root'), sender: '@bob:example.org', senderName: 'Bob' }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('thread helpers', () => {
  it('summarizes replies per root with the latest reply', () => {
    const summaries = summarizeThreads([root, firstReply, secondReply])
    expect(summaries.get('$root')).toEqual({ count: 2, latest: secondReply })
    expect(summaries.size).toBe(1)
  })

  it('moves replies under a loaded root and keeps orphan replies visible', () => {
    const orphan = message('$orphan', 'Late answer', 4, '$old-root')
    expect(mainTimelineMessages([root, firstReply, orphan])).toEqual([root, orphan])
    const plain = [root, orphan]
    expect(mainTimelineMessages(plain)).toBe(plain)
  })
})

describe('ThreadPanel', () => {
  function renderPanel(onClose = vi.fn()) {
    render(<ThreadPanel roomID="!room:example.org" rootID="$root" rootMessage={root} revision={0} currentUserID="@me:example.org" preferences={{}} onClose={onClose} />)
    return onClose
  }

  it('shows the root and replies, and focuses the composer', async () => {
    service.ThreadMessages.mockResolvedValueOnce([root, firstReply, secondReply])
    renderPanel()

    expect(await screen.findByRole('heading', { name: '2 replies' })).toBeTruthy()
    expect(await screen.findByText('Count me in')).toBeTruthy()
    expect(screen.getByText('Plan for Friday?')).toBeTruthy()
    expect(service.ThreadMessages).toHaveBeenCalledWith('!room:example.org', '$root')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Reply in thread' }))
  })

  it('sends with Enter, keeps Shift+Enter as a new line and reloads the thread', async () => {
    const user = userEvent.setup()
    service.ThreadMessages.mockResolvedValueOnce([root]).mockResolvedValueOnce([root, { ...firstReply, own: true }])
    service.SendThreadReply.mockResolvedValueOnce(undefined)
    renderPanel()
    expect(await screen.findByText('No replies yet')).toBeTruthy()

    const composer = screen.getByRole('textbox', { name: 'Reply in thread' })
    await user.type(composer, 'Pizza{Shift>}{Enter}{/Shift}works')
    expect(service.SendThreadReply).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')

    expect(service.SendThreadReply).toHaveBeenCalledWith('!room:example.org', 'Pizza\nworks', '$root')
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(''))
    expect(await screen.findByRole('heading', { name: '1 reply' })).toBeTruthy()
    expect(service.ThreadMessages).toHaveBeenCalledTimes(2)
  })

  it('keeps the draft and explains a failed send', async () => {
    const user = userEvent.setup()
    service.ThreadMessages.mockResolvedValueOnce([root])
    service.SendThreadReply.mockRejectedValueOnce(new Error('offline'))
    renderPanel()

    const composer = screen.getByRole('textbox', { name: 'Reply in thread' })
    await user.type(composer, 'Hello{Enter}')

    expect((await screen.findByRole('alert')).textContent).toContain('Could not send reply: offline')
    expect((composer as HTMLTextAreaElement).value).toBe('Hello')
  })

  it('shows load errors and closes', async () => {
    const user = userEvent.setup()
    service.ThreadMessages.mockRejectedValueOnce(new Error('database locked'))
    const onClose = renderPanel()

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load thread: database locked')
    await user.click(screen.getByRole('button', { name: 'Close thread' }))
    expect(onClose).toHaveBeenCalled()
  })
})
