import { useSyncExternalStore } from 'react'
import type { Message } from '../bindings/mychat/desktop/models.js'

export type RoomContextMenuState = { roomID: string; x: number; y: number } | null

export type MessageContextMenuState = {
  message: Message
  x: number
  y: number
  targetBounds: { left: number; top: number; right: number; bottom: number }
} | null

export type UIOverlaySnapshot = {
  roomContextMenu: RoomContextMenuState
  messageContextMenu: MessageContextMenuState
  searchOpen: boolean
  quickSwitcherOpen: boolean
}

export interface UIOverlayStore {
  getSnapshot: () => UIOverlaySnapshot
  setRoomContextMenu: (next: RoomContextMenuState) => void
  setMessageContextMenu: (next: MessageContextMenuState) => void
  setSearchOpen: (next: boolean | ((current: boolean) => boolean)) => void
  setQuickSwitcherOpen: (next: boolean | ((current: boolean) => boolean)) => void
  subscribe: (listener: () => void) => () => void
}

export function createUIOverlayStore(): UIOverlayStore {
  let state: UIOverlaySnapshot = {
    roomContextMenu: null,
    messageContextMenu: null,
    searchOpen: false,
    quickSwitcherOpen: false,
  }
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    setRoomContextMenu: (next) => {
      if (Object.is(state.roomContextMenu, next)) return
      state = { ...state, roomContextMenu: next }
      emit()
    },
    setMessageContextMenu: (next) => {
      if (Object.is(state.messageContextMenu, next)) return
      state = { ...state, messageContextMenu: next }
      emit()
    },
    setSearchOpen: (next) => {
      const value = typeof next === 'function' ? next(state.searchOpen) : next
      if (Object.is(state.searchOpen, value)) return
      state = { ...state, searchOpen: value }
      emit()
    },
    setQuickSwitcherOpen: (next) => {
      const value = typeof next === 'function' ? next(state.quickSwitcherOpen) : next
      if (Object.is(state.quickSwitcherOpen, value)) return
      state = { ...state, quickSwitcherOpen: value }
      emit()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useRoomContextMenu(store: UIOverlayStore): RoomContextMenuState {
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().roomContextMenu)
}

export function useMessageContextMenu(store: UIOverlayStore): MessageContextMenuState {
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().messageContextMenu)
}

export function useSearchOpen(store: UIOverlayStore): boolean {
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().searchOpen)
}

export function useQuickSwitcherOpen(store: UIOverlayStore): boolean {
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().quickSwitcherOpen)
}
