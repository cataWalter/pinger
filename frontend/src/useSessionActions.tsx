import { type FormEvent, type KeyboardEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Room } from '../bindings/mychat/desktop/models.js'
import { describeError, preferenceBoolean, preferenceString, isUnansweredRoom, isNeedsReplyRoom, isUnreadRoom } from './appShared'
import type { useRoomActions } from './useRoomActions'

export function useSessionActions(app: ReturnType<typeof useRoomActions>) {
  const { answeredShortcut, archivedPreferenceKey, clearNeedsReply, clearRoomSelection, filteredRooms, homeserver, markRoomAnswered, nextRoomAfterArchive, nextRoomByBehavior, openRoomContextMenu, password, preferences, recoveryKey, roomListRef, roomsRef, selectedRoomID, setBusy, setError, setPassword, setPreference, setRecoveryKey, setRoomContextMenu, setSelectedRoomID, setSnapshot, showRoom, singleKeyShortcuts, snapshot, updateRoomNeedsReply, username } = app

  async function applyBulkRoomAction(action: 'answered' | 'needs-reply' | 'read' | 'unread' | 'archive' | 'restore' | 'favorite' | 'unfavorite' | 'mute' | 'unmute', targetRooms: Room[]) {
    const targetRoomIDs = new Set(targetRooms.map((room) => room.id))
    setRoomContextMenu(null)
    clearRoomSelection()

    if (action === 'favorite' || action === 'unfavorite') {
      for (const room of targetRooms) await setPreference(`room.favorite.${room.id}`, action === 'favorite')
      return
    }

    if (action === 'mute' || action === 'unmute') {
      for (const room of targetRooms) await setPreference(`room.muted.${room.id}`, action === 'mute')
      return
    }

    if (action === 'answered') {
      let changed = false
      for (const room of targetRooms) {
        if (!isNeedsReplyRoom(room)) continue
        try {
          await clearNeedsReply(room)
          changed = true
        } catch (actionError) {
          setError(describeError(actionError))
        }
      }
      if (changed && targetRoomIDs.has(selectedRoomID)) {
        const selectedIndex = filteredRooms.findIndex((room) => room.id === selectedRoomID)
        const candidates = selectedIndex >= 0
          ? [...filteredRooms.slice(selectedIndex + 1), ...filteredRooms.slice(0, selectedIndex)]
          : filteredRooms
        const nextRoom = candidates.find((room) => !targetRoomIDs.has(room.id))
        if (nextRoom) showRoom(nextRoom.id)
      }
      return
    }

    if (action === 'needs-reply') {
      for (const room of targetRooms) {
        if (!isUnansweredRoom(room) || isNeedsReplyRoom(room)) continue
        try {
          await AppService.SetRoomUnanswered(room.id, true)
          updateRoomNeedsReply(room.id, true)
        } catch (actionError) {
          setError(describeError(actionError))
        }
      }
      return
    }

    if (action === 'read' || action === 'unread') {
      for (const room of targetRooms) {
        if (action === 'read') {
          if ((room.unread === 0 && !room.markedUnread) || !room.lastEventId) continue
          try {
            await AppService.MarkRead(room.id, room.lastEventId)
            setSnapshot((current) => current ? {
              ...current,
              rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
            } : current)
          } catch (actionError) {
            setError(describeError(actionError))
          }
        } else {
          if (room.unread > 0 || room.markedUnread) continue
          try {
            await AppService.MarkUnread(room.id)
            setSnapshot((current) => current ? {
              ...current,
              rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, markedUnread: true } : candidate),
            } : current)
          } catch (actionError) {
            setError(describeError(actionError))
          }
        }
      }
      const behavior = preferenceString(preferences, 'inbox.after_read', 'stay')
      if (behavior !== 'stay') showRoom(nextRoomByBehavior(targetRoomIDs, behavior))
      return
    }

    const archivedRoomIDs = new Set<string>()
    for (const room of targetRooms) {
      const archived = action === 'archive'
      const key = archivedPreferenceKey(room.id, room.accountId)
      if (archived && (room.unread > 0 || room.markedUnread) && room.lastEventId) {
        try {
          await AppService.MarkRead(room.id, room.lastEventId)
          setSnapshot((current) => current ? {
            ...current,
            rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
          } : current)
        } catch (actionError) {
          setError(describeError(actionError))
          continue
        }
      }
      if (await setPreference(key, archived) && archived) archivedRoomIDs.add(room.id)
    }
    if (action === 'archive' && archivedRoomIDs.has(selectedRoomID)) showRoom(nextRoomAfterArchive(archivedRoomIDs))
  }

  function handleMarkAnsweredKeyDown(event: KeyboardEvent<HTMLElement>, roomID: string) {
    if (!singleKeyShortcuts || event.altKey || event.metaKey || event.ctrlKey || event.key.toUpperCase() !== answeredShortcut) return
    const room = roomsRef.current.find((candidate) => candidate.id === roomID)
    if (!room || !isNeedsReplyRoom(room)) return
    event.preventDefault()
    event.stopPropagation()
    void markRoomAnswered(roomID)
  }

  function handleRoomActionShortcut(event: KeyboardEvent<HTMLElement>, targetRooms: Room[]) {
    const key = event.key.toLowerCase()
    if (!singleKeyShortcuts || event.repeat || event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
    if (!['n', 'u', 'a', 'f', 'm'].includes(key) || targetRooms.length === 0) return false

    let action: 'needs-reply' | 'read' | 'unread' | 'archive' | 'restore' | 'favorite' | 'unfavorite' | 'mute' | 'unmute'
    let actionRooms = targetRooms
    if (key === 'n') {
      action = 'needs-reply'
      actionRooms = targetRooms.filter((room) => isUnansweredRoom(room) && !isNeedsReplyRoom(room))
      if (actionRooms.length === 0) return false
    } else if (key === 'u') {
      action = targetRooms.some(isUnreadRoom) ? 'read' : 'unread'
    } else if (key === 'a') {
      action = targetRooms.some((room) => !preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId))) ? 'archive' : 'restore'
    } else if (key === 'm') {
      action = targetRooms.some((room) => !room.muted) ? 'mute' : 'unmute'
    } else {
      action = targetRooms.some((room) => !room.favorite) ? 'favorite' : 'unfavorite'
    }

    event.preventDefault()
    void applyBulkRoomAction(action, actionRooms)
    return true
  }

  function isLastMessageByCurrentUser(room: Room) {
    const userID = snapshot?.profile.userId
    return Boolean(room.lastEventSender && userID === room.lastEventSender)
  }

  function handleRoomKeyDown(event: KeyboardEvent<HTMLButtonElement>, room: Room, index: number) {
    handleMarkAnsweredKeyDown(event, room.id)
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      openRoomContextMenu(room.id, bounds.right - 216, bounds.bottom)
      return
    }
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? filteredRooms.length - 1 : index + direction
    if (direction === 0 && event.key !== 'Home' && event.key !== 'End') return
    const list = roomListRef.current
    const nextButton = list?.querySelector<HTMLButtonElement>(`.room-button[data-room-index="${nextIndex}"]`)
    if (nextButton) {
      event.preventDefault()
      nextButton.focus()
    } else if (list && nextIndex >= 0 && nextIndex < filteredRooms.length) {
      event.preventDefault()
      const rowHeight = preferenceBoolean(preferences, 'sidebar.compact_chat_list') ? 46 : 62
      list.scrollTop = nextIndex * rowHeight
      list.dispatchEvent(new Event('scroll'))
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        list.querySelector<HTMLButtonElement>(`.room-button[data-room-index="${nextIndex}"]`)?.focus()
      }))
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await AppService.Login(homeserver.trim(), username.trim(), password)
      setPassword('')
      const state = await AppService.Snapshot()
      setSnapshot(state)
      setSelectedRoomID((state.rooms ?? [])[0]?.id ?? '')
    } catch (loginError) {
      setError(describeError(loginError))
    } finally {
      setBusy(false)
    }
  }

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await AppService.Verify(recoveryKey.trim())
      setRecoveryKey('')
      setSnapshot(await AppService.Snapshot())
    } catch (verificationError) {
      setError(describeError(verificationError))
    } finally {
      setBusy(false)
    }
  }
  return { ...app, applyBulkRoomAction, handleMarkAnsweredKeyDown, handleRoomActionShortcut, isLastMessageByCurrentUser, handleRoomKeyDown, submitLogin, submitVerification }
}
