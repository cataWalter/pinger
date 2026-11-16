import { describe, expect, it } from 'vitest'
import { clearStoredRoomDrafts, loadRoomDrafts, MAX_STORED_DRAFT_LENGTH, MAX_STORED_DRAFTS, ROOM_DRAFTS_STORAGE_KEY, saveRoomDrafts, type RoomDraftStore } from './roomDrafts'

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(ROOM_DRAFTS_STORAGE_KEY, initial)
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

function storeOf(entries: Array<[string, string, string, number]>): RoomDraftStore {
  const store: RoomDraftStore = new Map()
  for (const [account, room, text, updatedAt] of entries) {
    if (!store.has(account)) store.set(account, new Map())
    store.get(account)!.set(room, { text, updatedAt })
  }
  return store
}

describe('room drafts storage', () => {
  it('round-trips drafts per account and room', () => {
    const storage = memoryStorage()
    const store = storeOf([['primary', '!a:x', 'Hello', 2], ['primary', '!b:x', 'Bye', 3], ['second', '!a:x', 'Other account', 1]])
    expect(saveRoomDrafts(store, storage)).toBe(true)
    const loaded = loadRoomDrafts(storage)
    expect(loaded.get('primary')?.get('!a:x')?.text).toBe('Hello')
    expect(loaded.get('primary')?.get('!b:x')?.text).toBe('Bye')
    expect(loaded.get('second')?.get('!a:x')?.text).toBe('Other account')
  })

  it('keeps only the newest drafts and skips ones that are too long', () => {
    const storage = memoryStorage()
    const entries: Array<[string, string, string, number]> = Array.from({ length: MAX_STORED_DRAFTS + 5 }, (_, index) => ['primary', `!room${index}:x`, `Draft ${index}`, index])
    entries.push(['primary', '!long:x', 'x'.repeat(MAX_STORED_DRAFT_LENGTH + 1), 10_000])
    saveRoomDrafts(storeOf(entries), storage)
    const loaded = loadRoomDrafts(storage).get('primary')!
    expect(loaded.size).toBe(MAX_STORED_DRAFTS)
    expect(loaded.has('!long:x')).toBe(false)
    expect(loaded.has('!room0:x')).toBe(false)
    expect(loaded.get(`!room${MAX_STORED_DRAFTS + 4}:x`)?.text).toBe(`Draft ${MAX_STORED_DRAFTS + 4}`)
  })

  it('removes the stored value when no drafts remain', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, drafts: [{ account: 'primary', room: '!a:x', text: 'Old', updatedAt: 1 }] }))
    saveRoomDrafts(new Map(), storage)
    expect(storage.values.has(ROOM_DRAFTS_STORAGE_KEY)).toBe(false)
  })

  it.each([
    ['invalid JSON', '{'],
    ['an unknown version', JSON.stringify({ version: 2, drafts: [{ account: 'primary', room: '!a:x', text: 'Hi', updatedAt: 1 }] })],
    ['a non-array draft list', JSON.stringify({ version: 1, drafts: {} })],
  ])('loads nothing from %s', (_, source) => {
    expect(loadRoomDrafts(memoryStorage(source)).size).toBe(0)
  })

  it('drops malformed entries and keeps valid ones', () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      drafts: [
        { account: 'primary', room: '!ok:x', text: 'Kept', updatedAt: 5 },
        { account: 'primary', room: '', text: 'No room', updatedAt: 5 },
        { account: 'primary', room: '!empty:x', text: '', updatedAt: 5 },
        { account: 'primary', room: '!time:x', text: 'Bad time', updatedAt: 'soon' },
        { account: 7, room: '!acct:x', text: 'Bad account', updatedAt: 5 },
        'not a draft',
      ],
    }))
    const loaded = loadRoomDrafts(storage)
    expect([...loaded.get('primary')!.keys()]).toEqual(['!ok:x'])
    expect(loaded.size).toBe(1)
  })

  it('tolerates unavailable storage', () => {
    const failing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(loadRoomDrafts(failing).size).toBe(0)
    expect(saveRoomDrafts(storeOf([['primary', '!a:x', 'Hi', 1]]), failing)).toBe(false)
    expect(() => clearStoredRoomDrafts(failing)).not.toThrow()
    expect(loadRoomDrafts(null).size).toBe(0)
    expect(saveRoomDrafts(new Map(), null)).toBe(false)
  })
})
