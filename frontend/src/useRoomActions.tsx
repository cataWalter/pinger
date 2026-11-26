import { useEffect, useRef } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Message } from '../bindings/mychat/desktop/models.js'
import { describeError, preferenceBoolean, preferenceString, isNeedsReplyRoom, roomActivityAt } from './appShared'
import type { useLocalAIChats } from './useLocalAIChats'

export function useRoomActions(app: ReturnType<typeof useLocalAIChats>) {
  const { archivedPreferenceKey, automaticArchiveEnabled, automaticArchiveInFlightRef, clearNeedsReply, clearRoomSelection, filteredRooms, markRoomAnsweredRef, nextRoomAfterArchive, nextRoomByBehavior, preferences, rooms, roomsByID, roomsRef, selectedRoomID, selectedRoomRef, setError, setForwardError, setForwardTargetRoomID, setForwardingMessage, setMessageContextMenu, setPreference, setRoomContextMenu, setSnapshot, showRoom, showUndoToast, triageBusyRef } = app

  async function markRoomRead(roomID: string) {
    const room = roomsByID.get(roomID)
    if (!room || (room.unread === 0 && !room.markedUnread) || !room.lastEventId) return
    try {
      await AppService.MarkRead(room.id, room.lastEventId)
      setSnapshot((current) => current ? {
        ...current,
        rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
      } : current)
      setRoomContextMenu(null)
      clearRoomSelection()
      const behavior = preferenceString(preferences, 'inbox.after_read', 'stay')
      if (behavior !== 'stay') showRoom(nextRoomByBehavior(new Set([roomID]), behavior))
    } catch (readError) {
      setError(describeError(readError))
    }
  }

  async function markRoomUnread(roomID: string) {
    const room = roomsByID.get(roomID)
    if (!room || room.unread > 0 || room.markedUnread) return
    try {
      await AppService.MarkUnread(room.id)
      setSnapshot((current) => current ? {
        ...current,
        rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, markedUnread: true } : candidate),
      } : current)
      setRoomContextMenu(null)
      clearRoomSelection()
      const behavior = preferenceString(preferences, 'inbox.after_read', 'stay')
      if (behavior !== 'stay') showRoom(nextRoomByBehavior(new Set([roomID]), behavior))
    } catch (readError) {
      setError(describeError(readError))
    }
  }

  async function setRoomArchived(roomID: string, archived: boolean) {
    const room = roomsByID.get(roomID)
    if (!room) return
    if (archived && (room.unread > 0 || room.markedUnread) && room.lastEventId) {
      try {
        await AppService.MarkRead(room.id, room.lastEventId)
        setSnapshot((current) => current ? {
          ...current,
          rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
        } : current)
      } catch (readError) {
        setError(describeError(readError))
        return
      }
    }
    const saved = await setPreference(archivedPreferenceKey(roomID), archived)
    setRoomContextMenu(null)
    clearRoomSelection()
    if (saved && archived && selectedRoomID === roomID) {
      showRoom(nextRoomAfterArchive(new Set([roomID])))
    }
  }

  async function archiveInactiveRooms() {
    const ageDays = Number(preferenceString(preferences, 'archive.older_than_days', '90'))
    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000
    const inactiveRooms = rooms.filter((room) => {
      const activityAt = roomActivityAt(room)
      return activityAt > 0 && activityAt < cutoff && !preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId))
    })
    const archivedRoomIDs = new Set<string>()
    for (const room of inactiveRooms) {
      if ((room.unread > 0 || room.markedUnread) && room.lastEventId) {
        try {
          await AppService.MarkRead(room.id, room.lastEventId)
          setSnapshot((current) => current ? {
            ...current,
            rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
          } : current)
        } catch (readError) {
          setError(describeError(readError))
          continue
        }
      }
      if (await setPreference(archivedPreferenceKey(room.id, room.accountId), true)) archivedRoomIDs.add(room.id)
    }
    if (archivedRoomIDs.has(selectedRoomID)) showRoom(nextRoomAfterArchive(archivedRoomIDs))
  }

  const archiveInactiveRoomsRef = useRef(archiveInactiveRooms)
  archiveInactiveRoomsRef.current = archiveInactiveRooms

  useEffect(() => {
    if (!automaticArchiveEnabled) return
    const runArchive = () => {
      if (automaticArchiveInFlightRef.current) return
      automaticArchiveInFlightRef.current = true
      void archiveInactiveRoomsRef.current().finally(() => {
        automaticArchiveInFlightRef.current = false
      })
    }
    runArchive()
    const timer = window.setInterval(runArchive, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [automaticArchiveEnabled, preferences, rooms, selectedRoomID, automaticArchiveInFlightRef])

  function openMessageForward(message: Message) {
    const destination = rooms.find((candidate) => candidate.id !== selectedRoomID)
    if (!destination) return
    setMessageContextMenu(null)
    setForwardTargetRoomID(destination.id)
    setForwardError('')
    setForwardingMessage(message)
  }

  async function markRoomAnswered(roomID: string) {
    setRoomContextMenu(null)
    clearRoomSelection()
    const targetRoom = roomsRef.current.find((room) => room.id === roomID)
    if (triageBusyRef.current || !targetRoom || !isNeedsReplyRoom(targetRoom)) return
    triageBusyRef.current = true
    setError('')
    const wasSelected = selectedRoomRef.current === roomID
    const visibleIndex = filteredRooms.findIndex((room) => room.id === roomID)
    const nextRoom = visibleIndex >= 0 && filteredRooms.length > 1
      ? filteredRooms[(visibleIndex + 1) % filteredRooms.length]
      : roomsRef.current.find((room) => room.id !== roomID)
    try {
      await clearNeedsReply(targetRoom)
      showUndoToast(roomID)
      if (wasSelected && nextRoom) showRoom(nextRoom.id)
    } catch (triageError) {
      setError(describeError(triageError))
    } finally {
      triageBusyRef.current = false
    }
  }
  markRoomAnsweredRef.current = markRoomAnswered
  return { ...app, markRoomRead, markRoomUnread, setRoomArchived, archiveInactiveRooms, archiveInactiveRoomsRef, openMessageForward, markRoomAnswered }
}
