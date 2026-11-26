import { type KeyboardEvent } from 'react'
import { hasOpenDialog } from './DialogSurface'
import { localAIIncludeInAllPreference } from './localAIChats'
import { isTextEntryTarget, preferenceBoolean } from './appShared'
import type { useRoomChatExport } from './useRoomChatExport'

export function useApplicationKeys(app: ReturnType<typeof useRoomChatExport>) {
  const { appZoom, closeMessageSearch, filteredRooms, getRoomContextMenuState, handleAIShortcut, handleRoomActionShortcut, jumpToLatest, localAIChatId, localAIChatOpen, openInboxRoom, preferences, roomSearchInputRef, rooms, roomsRef, selectRoomByOffset, selectedRoomID, setPreference, setQuickSwitcherIndex, setQuickSwitcherOpen, setQuickSwitcherQuery, setRoomRefinements, setRoomScope, setSearchOpen, setSettingsOpen, setSettingsTab, startLocalAIChat, uiOverlayStore, undoAnswered, undoRoomID } = app

  function handleApplicationKeyDown(event: KeyboardEvent<HTMLElement>) {
    const { messageContextMenu, quickSwitcherOpen, roomContextMenu, searchOpen } = uiOverlayStore.getSnapshot()
    if (event.defaultPrevented || hasOpenDialog() || quickSwitcherOpen) return
    if (handleAIShortcut(event)) return
    if (messageContextMenu) return
    if (event.key === 'Escape' && searchOpen) {
      event.preventDefault()
      closeMessageSearch()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'g' && localAIChatOpen && localAIChatId) {
      event.preventDefault()
      const preferenceKey = localAIIncludeInAllPreference(localAIChatId)
      void setPreference(preferenceKey, !preferenceBoolean(preferences, preferenceKey))
      return
    }
    if (isTextEntryTarget(event.target)) return

    const shortcutRooms = roomContextMenu
      ? getRoomContextMenuState(roomContextMenu).contextMenuRooms
      : rooms.filter((room) => room.id === selectedRoomID)
    if (roomContextMenu) {
      handleRoomActionShortcut(event, shortcutRooms)
      return
    }
    if (handleRoomActionShortcut(event, shortcutRooms)) return

    const key = event.key.toLowerCase()
    const hasPrimaryModifier = event.metaKey || event.ctrlKey
    if (!hasPrimaryModifier && !event.altKey && event.key === '?') {
      event.preventDefault()
      setSettingsTab('Keyboard')
      setSettingsOpen(true)
      return
    }
    if (!hasPrimaryModifier && !event.altKey && event.key === '/') {
      event.preventDefault()
      roomSearchInputRef.current?.focus()
      return
    }
    if (hasPrimaryModifier && !event.altKey) {
      if (key === 'k') {
        event.preventDefault()
        if (roomsRef.current.length > 0) {
          setQuickSwitcherQuery('')
          setQuickSwitcherIndex(0)
          setQuickSwitcherOpen(true)
        }
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        void setPreference('appearance.zoom', String(Math.min(125, appZoom + 5)))
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        void setPreference('appearance.zoom', String(Math.max(75, appZoom - 5)))
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        void setPreference('appearance.zoom', '100')
        return
      }
      if (key === 'f' && !event.shiftKey) {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (event.key === ',' || event.code === 'Comma') {
        event.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (event.shiftKey && key === 's') {
        event.preventDefault()
        roomSearchInputRef.current?.focus()
        return
      }
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        selectRoomByOffset(event.key === 'ArrowDown' ? 1 : -1, true)
        return
      }
      if (event.shiftKey && key === 'a') {
        event.preventDefault()
        setRoomScope('all')
        setRoomRefinements({ unanswered: false, needsReply: false, favorite: false })
        return
      }
      if (event.shiftKey && key === 'h') {
        event.preventDefault()
        setRoomScope('archived')
        setRoomRefinements({ unanswered: false, needsReply: false, favorite: false })
        return
      }
      if (event.shiftKey && key === 'r') {
        event.preventDefault()
        setRoomScope('all')
        setRoomRefinements({ unanswered: true, needsReply: false, favorite: false })
        return
      }
      if (event.shiftKey && key === 'f') {
        event.preventDefault()
        setRoomScope('all')
        setRoomRefinements({ unanswered: false, needsReply: false, favorite: true })
        return
      }
      if (event.shiftKey && key === 'u') {
        event.preventDefault()
        setRoomScope('all')
        setRoomRefinements({ unanswered: false, needsReply: true, favorite: false })
        return
      }
      if (event.shiftKey && key === 'm') {
        event.preventDefault()
        startLocalAIChat()
        return
      }
      if (event.shiftKey && key === 'l') {
        event.preventDefault()
        jumpToLatest()
        return
      }
      if (/^[1-9]$/.test(event.key)) {
        const room = filteredRooms[Number(event.key) - 1]
        if (room) {
          event.preventDefault()
          openInboxRoom(room)
        }
        return
      }
      if (key === 'z' && undoRoomID) {
        event.preventDefault()
        void undoAnswered()
        return
      }
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      selectRoomByOffset(event.key === 'ArrowDown' ? 1 : -1)
    }
  }
  return { ...app, handleApplicationKeyDown }
}
