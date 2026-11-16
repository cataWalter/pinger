import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const ROOM_DRAFTS_STORAGE_KEY = 'pinger.room-drafts.v1'
export const MAX_STORED_DRAFTS = 100
export const MAX_STORED_DRAFT_LENGTH = 8_000
const DRAFT_SAVE_DELAY_MS = 400

export interface RoomDraftEntry {
  text: string
  updatedAt: number
}

// Account ID -> room ID -> unsent composer text.
export type RoomDraftStore = Map<string, Map<string, RoomDraftEntry>>

export interface RoomDrafts {
  get(roomID: string): string | undefined
  set(roomID: string, text: string): void
  delete(roomID: string): void
  clearAccount(): void
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function localStorageOrNull(): DraftStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function putDraft(store: RoomDraftStore, accountID: string, roomID: string, entry: RoomDraftEntry) {
  let rooms = store.get(accountID)
  if (!rooms) {
    rooms = new Map()
    store.set(accountID, rooms)
  }
  rooms.set(roomID, entry)
}

export function loadRoomDrafts(storage: DraftStorage | null = localStorageOrNull()): RoomDraftStore {
  const store: RoomDraftStore = new Map()
  if (!storage) return store
  let parsed: unknown
  try {
    parsed = JSON.parse(storage.getItem(ROOM_DRAFTS_STORAGE_KEY) ?? 'null')
  } catch {
    return store
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.drafts)) return store
  const drafts = parsed.drafts.flatMap((draft: unknown) => {
    if (!isRecord(draft)) return []
    const { account, room, text, updatedAt } = draft
    if (typeof account !== 'string' || typeof room !== 'string' || !room) return []
    if (typeof text !== 'string' || !text || text.length > MAX_STORED_DRAFT_LENGTH) return []
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return []
    return [{ account, room, text, updatedAt }]
  })
  drafts.sort((left, right) => right.updatedAt - left.updatedAt)
  for (const draft of drafts.slice(0, MAX_STORED_DRAFTS)) {
    putDraft(store, draft.account, draft.room, { text: draft.text, updatedAt: draft.updatedAt })
  }
  return store
}

export function saveRoomDrafts(store: RoomDraftStore, storage: DraftStorage | null = localStorageOrNull()): boolean {
  if (!storage) return false
  const drafts = [...store].flatMap(([account, rooms]) => [...rooms]
    .filter(([, entry]) => entry.text && entry.text.length <= MAX_STORED_DRAFT_LENGTH)
    .map(([room, entry]) => ({ account, room, text: entry.text, updatedAt: entry.updatedAt })))
  drafts.sort((left, right) => right.updatedAt - left.updatedAt)
  try {
    if (drafts.length === 0) storage.removeItem(ROOM_DRAFTS_STORAGE_KEY)
    else storage.setItem(ROOM_DRAFTS_STORAGE_KEY, JSON.stringify({ version: 1, drafts: drafts.slice(0, MAX_STORED_DRAFTS) }))
    return true
  } catch {
    return false
  }
}

export function clearStoredRoomDrafts(storage: DraftStorage | null = localStorageOrNull()) {
  try {
    storage?.removeItem(ROOM_DRAFTS_STORAGE_KEY)
  } catch {
    // Storage may be unavailable; there is nothing to clear then.
  }
}

// useRoomDrafts keeps drafts for every account in memory and, when persist is on,
// mirrors them to local storage shortly after each change.
export function useRoomDrafts(accountID: string, persist: boolean): RoomDrafts {
  const [store] = useState(() => loadRoomDrafts())
  const persistRef = useRef(persist)
  const saveTimerRef = useRef<number | null>(null)

  const flush = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (persistRef.current) saveRoomDrafts(store)
  }, [store])

  useEffect(() => {
    persistRef.current = persist
    if (persist) return
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    clearStoredRoomDrafts()
  }, [persist])

  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  return useMemo(() => {
    const scheduleSave = () => {
      if (!persistRef.current || saveTimerRef.current !== null) return
      saveTimerRef.current = window.setTimeout(flush, DRAFT_SAVE_DELAY_MS)
    }
    return {
      get: (roomID) => store.get(accountID)?.get(roomID)?.text,
      set: (roomID, text) => {
        putDraft(store, accountID, roomID, { text, updatedAt: Date.now() })
        scheduleSave()
      },
      delete: (roomID) => {
        if (store.get(accountID)?.delete(roomID)) scheduleSave()
      },
      clearAccount: () => {
        store.delete(accountID)
        flush()
      },
    }
  }, [accountID, flush, store])
}
