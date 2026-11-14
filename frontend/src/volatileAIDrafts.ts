import { type Dispatch, type SetStateAction, useState } from 'react'

export interface VolatileAIDraft {
  baseText: string
  text: string
}

export type VolatileAIDraftStore = Map<string, Map<string, VolatileAIDraft>>

export interface VolatileAIDraftState {
  volatileAIDrafts: VolatileAIDraftStore
  setVolatileAIDrafts: Dispatch<SetStateAction<VolatileAIDraftStore>>
}

export function useVolatileAIDraftState<T extends object>(app: T) {
  const [volatileAIDrafts, setVolatileAIDrafts] = useState<VolatileAIDraftStore>(() => new Map())
  return { ...app, volatileAIDrafts, setVolatileAIDrafts }
}

export function getVolatileAIDraft(store: VolatileAIDraftStore, accountID: string, roomID: string) {
  return store.get(accountID)?.get(roomID)
}

export function setVolatileAIDraft(store: VolatileAIDraftStore, accountID: string, roomID: string, draft: VolatileAIDraft): VolatileAIDraftStore {
  const next = new Map(store)
  const accountDrafts = new Map(store.get(accountID) ?? [])
  accountDrafts.set(roomID, draft)
  next.set(accountID, accountDrafts)
  return next
}

export function updateVolatileAIDraft(store: VolatileAIDraftStore, accountID: string, roomID: string, text: string): VolatileAIDraftStore {
  const draft = getVolatileAIDraft(store, accountID, roomID)
  return draft ? setVolatileAIDraft(store, accountID, roomID, { ...draft, text }) : store
}

export function deleteVolatileAIDraft(store: VolatileAIDraftStore, accountID: string, roomID: string): VolatileAIDraftStore {
  const accountDrafts = store.get(accountID)
  if (!accountDrafts?.has(roomID)) return store
  const next = new Map(store)
  const nextAccountDrafts = new Map(accountDrafts)
  nextAccountDrafts.delete(roomID)
  if (nextAccountDrafts.size === 0) next.delete(accountID)
  else next.set(accountID, nextAccountDrafts)
  return next
}

export function appendAIDraft(baseText: string, reply: string) {
  const base = baseText.trimEnd()
  return base ? `${base}\n\n${reply}` : reply
}