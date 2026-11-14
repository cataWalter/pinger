import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Message } from '../bindings/mychat/desktop/models.js'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import { firstUnreadMessageID, timelineFirstItemIndex } from './appShared'

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

describe('timeline first-item anchoring', () => {
  it.each([
    { before: ['a', 'b'], after: ['a', 'b', 'c'], expected: 1000 },
    { before: ['c', 'd'], after: ['a', 'b', 'c', 'd'], expected: 998 },
    { before: ['a', 'b', 'c'], after: ['c'], expected: 1002 },
    { before: [], after: ['a'], expected: 1000 },
    { before: ['a'], after: [], expected: 1000 },
  ])('preserves the anchor for $before -> $after', ({ before, after, expected }) => {
    const rows = (ids: string[]) => ids.map((id) => ({ id, transactionId: '' })) as Message[]
    expect(timelineFirstItemIndex(rows(before), rows(after), 1000)).toBe(expected)
  })

  it('preserves optimistic message identity when the server assigns an event ID', () => {
    const before = [{ id: '~pending', transactionId: 'txn' }] as Message[]
    const after = [{ id: '$confirmed', transactionId: 'txn' }] as Message[]
    expect(timelineFirstItemIndex(before, after, 1000)).toBe(1000)
  })
})

describe('first unread message', () => {
  const rows = (...entries: Array<[string, string]>) => entries.map(([id, sender]) => ({ id, sender, own: false })) as Message[]

  it('counts back over messages from others only', () => {
    const timeline = rows(['$a', '@alice:x'], ['$b', '@alice:x'], ['$mine', '@me:x'], ['$c', '@bob:x'])
    expect(firstUnreadMessageID(timeline, 2, '@me:x')).toBe('$b')
    expect(firstUnreadMessageID(timeline, 1, '@me:x')).toBe('$c')
  })

  it('falls back to the oldest loaded message when more are unread than loaded', () => {
    expect(firstUnreadMessageID(rows(['$a', '@alice:x'], ['$b', '@alice:x']), 9, '@me:x')).toBe('$a')
  })

  it('returns nothing without unread messages from others', () => {
    expect(firstUnreadMessageID(rows(['$a', '@alice:x']), 0, '@me:x')).toBe('')
    expect(firstUnreadMessageID(rows(['$mine', '@me:x']), 3, '@me:x')).toBe('')
  })
})
