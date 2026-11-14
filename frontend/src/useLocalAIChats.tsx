/* eslint-disable react-hooks/exhaustive-deps -- deps mirror the original component closure; setters and refs come from other hooks */
import { useEffect } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Message, type MessageSearchResult, type Room } from '../bindings/mychat/desktop/models.js'
import { activeLocale } from './i18n'
import { isLocalAIRoomID, type LocalAIChatKind } from './localAIChats'
import { IN_APP_NOTICE_TIMEOUT_MS, describeError, displayMessageBody, preferenceBoolean, preferenceString } from './appShared'
import type { useMessageSearch } from './useMessageSearch'

export function useLocalAIChats(app: ReturnType<typeof useMessageSearch>) {
  const { activeListRoomID, composerInputRef, filteredRooms, focusTimelineMessage, historyRoomIDRef, localAIAgents, localAIChatOpen, localAIInitialDraftVersion, messages, pendingSearchJumpRef, preferences, roomSelectionAnchorRef, roomSwitchRef, scheduledNoticeTimerRef, selectedRoom, selectedRoomID, selectedRoomIDs, selectedRoomRef, setError, setHasOlder, setHistoryPageRevision, setHistoryRevision, setLoadingHistory, setLoadingOlder, setLocalAIChatId, setLocalAIChatOpen, setLocalAIDeleteArmedID, setLocalAIInitialDraft, setLocalAINewChatAgentId, setLocalAINewChatKind, setLocalAIRenameDraft, setMessageContextMenu, setMessages, setMobilePane, setOlderCursor, setRoomContextMenu, setScheduledNotice, setSearchOpen, setSelectedRoomID, setSelectedRoomIDs, setSnapshot, setUndoRoomID, showRoomRef, snapshot, stickToBottomRef, timelineHeightBeforePrepend, triageBusyRef, undoRoomID, undoToastTimerRef } = app

  function showUndoToast(roomID: string) {
    if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current)
    setUndoRoomID(roomID)
    undoToastTimerRef.current = window.setTimeout(() => {
      setUndoRoomID((current) => current === roomID ? '' : current)
      undoToastTimerRef.current = null
    }, IN_APP_NOTICE_TIMEOUT_MS)
  }

  function showScheduledNotice(notice: string) {
    if (scheduledNoticeTimerRef.current !== null) window.clearTimeout(scheduledNoticeTimerRef.current)
    setScheduledNotice(notice)
    scheduledNoticeTimerRef.current = window.setTimeout(() => {
      setScheduledNotice('')
      scheduledNoticeTimerRef.current = null
    }, IN_APP_NOTICE_TIMEOUT_MS)
  }

  function clearScheduledNotice() {
    if (scheduledNoticeTimerRef.current !== null) window.clearTimeout(scheduledNoticeTimerRef.current)
    scheduledNoticeTimerRef.current = null
    setScheduledNotice('')
  }

  function clearUndoToast() {
    if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current)
    undoToastTimerRef.current = null
    setUndoRoomID('')
  }

  function openRoomContextMenu(roomID: string, x: number, y: number) {
    const menuWidth = 232
    const menuHeight = isLocalAIRoomID(roomID) ? 340 : selectedRoomIDs.includes(roomID) && selectedRoomIDs.length > 1 ? 232 : 200
    if (!isLocalAIRoomID(roomID) && !selectedRoomIDs.includes(roomID)) {
      setSelectedRoomIDs([roomID])
      roomSelectionAnchorRef.current = roomID
    }
    setLocalAIDeleteArmedID('')
    setMessageContextMenu(null)
    setRoomContextMenu({
      roomID,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    })
  }

  function updateRoomNeedsReply(roomID: string, needsReply: boolean) {
    setSnapshot((current) => current ? {
      ...current,
      rooms: (current.rooms ?? []).map((room) => room.id === roomID ? { ...room, needsReply } : room),
    } : current)
  }

  function openMessageContextMenu(message: Message, x: number, y: number) {
    const menuWidth = 260
    const menuHeight = Math.max(0, Math.min(620, window.innerHeight - 16))
    const targetKey = message.id || message.transactionId
    const targetRow = Array.from(document.querySelectorAll<HTMLElement>('.message-row[data-event-id]'))
      .find((candidate) => candidate.dataset.eventId === targetKey)
    const targetElement = targetRow?.querySelector<HTMLElement>('.message-body') ?? targetRow
    const bounds = targetElement?.getBoundingClientRect()
    setRoomContextMenu(null)
    setMessageContextMenu({
      message,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
      targetBounds: {
        left: Math.max(0, (bounds?.left ?? x) - 8),
        top: Math.max(0, (bounds?.top ?? y) - 8),
        right: Math.min(window.innerWidth, (bounds?.right ?? x) + 8),
        bottom: Math.min(window.innerHeight, (bounds?.bottom ?? y) + 8),
      },
    })
  }

  async function copyMessage(message: Message, includeTimestamp = preferenceBoolean(preferences, 'clipboard.copy_timestamp')) {
    const body = displayMessageBody(message)
    const timestamp = includeTimestamp
      ? `[${new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(message.timestamp))}] ${message.senderName || message.sender}: `
      : ''
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
      await navigator.clipboard.writeText(`${timestamp}${body}`)
    } catch (copyError) {
      setError(describeError(copyError))
    }
  }

  // Records the answered mark. Unanswered stays set; only Needs reply clears.
  async function clearNeedsReply(room: Room) {
    await AppService.SetRoomUnanswered(room.id, false)
    updateRoomNeedsReply(room.id, false)
  }

  function showRoom(roomID: string) {
    if (roomID) setLocalAIChatOpen(false)
    if (selectedRoomRef.current === roomID && historyRoomIDRef.current === roomID) {
      setHistoryRevision((revision) => revision + 1)
    }
    if (selectedRoomRef.current !== roomID) {
      historyRoomIDRef.current = ''
      setMessages([])
      setLoadingHistory(Boolean(roomID))
      setOlderCursor(0)
      setHasOlder(false)
      setLoadingOlder(false)
      timelineHeightBeforePrepend.current = null
    }
    roomSwitchRef.current = true
    stickToBottomRef.current = true
    setSelectedRoomID(roomID)
    setMobilePane(roomID ? 'conversation' : 'rooms')
    requestAnimationFrame(() => {
      if (roomID) composerInputRef.current?.focus()
    })
  }

  // The private chat pane replaces the Matrix conversation, so the Matrix selection is cleared.
  function openLocalAIChatView() {
    if (selectedRoomRef.current) showRoom('')
    setLocalAIChatOpen(true)
    setLocalAIRenameDraft(null)
    setMobilePane('conversation')
  }

  function startLocalAIChat(initialDraft = '', kind: LocalAIChatKind = 'chat') {
    setLocalAIChatId(null)
    setLocalAINewChatAgentId(localAIAgents.defaultAgentId)
    setLocalAINewChatKind(kind)
    localAIInitialDraftVersion.current++
    setLocalAIInitialDraft({ version: localAIInitialDraftVersion.current, content: initialDraft })
    openLocalAIChatView()
  }

  function selectLocalAIChat(chatID: string) {
    setLocalAIChatId(chatID)
    openLocalAIChatView()
  }

  function openSearchResult(result: MessageSearchResult) {
    const eventID = result.message.id
    if (!eventID) return
    setSearchOpen(false)
    if (selectedRoomID === result.roomID && messages.some((message) => message.id === eventID)) {
      requestAnimationFrame(() => focusTimelineMessage(eventID))
      return
    }
    pendingSearchJumpRef.current = { roomID: result.roomID, eventID, timelineCursor: result.message.timelineCursor }
    if (selectedRoomID === result.roomID) setHistoryPageRevision((revision) => revision + 1)
    else showRoom(result.roomID)
  }

  async function undoAnswered() {
    const roomID = undoRoomID
    if (!roomID || triageBusyRef.current) return
    triageBusyRef.current = true
    setError('')
    try {
      await AppService.SetRoomUnanswered(roomID, true)
      updateRoomNeedsReply(roomID, true)
      clearUndoToast()
      showRoom(roomID)
    } catch (triageError) {
      setError(describeError(triageError))
    } finally {
      triageBusyRef.current = false
    }
  }

  showRoomRef.current = showRoom

  useEffect(() => {
    if (!selectedRoomID || localAIChatOpen || selectedRoom) return
    showRoomRef.current('')
  }, [selectedRoomID, localAIChatOpen, selectedRoom])

  function isActiveAccountRoom(room: Room) {
    return !room.accountId || room.accountId === snapshot?.activeAccountId
  }
  const selectedRoomListIndex = filteredRooms.findIndex((room) => room.id === activeListRoomID && isActiveAccountRoom(room))

  function nextRoomByBehavior(excludedRoomIDs: Set<string>, behavior: string) {
    const candidates = filteredRooms.filter((room) => !excludedRoomIDs.has(room.id) && isActiveAccountRoom(room))
    if (behavior === 'none') return ''
    if (behavior === 'next_unread') return candidates.find((room) => room.unread > 0 || room.markedUnread)?.id ?? ''
    return candidates[0]?.id ?? ''
  }

  function nextRoomAfterArchive(archivedRoomIDs: Set<string>) {
    const behavior = preferenceString(preferences, 'archive.next_room', 'next_visible')
    return nextRoomByBehavior(archivedRoomIDs, behavior)
  }
  return { ...app, startLocalAIChat, selectLocalAIChat, openLocalAIChatView, selectedRoomListIndex, openSearchResult, nextRoomByBehavior, nextRoomAfterArchive, showUndoToast, showScheduledNotice, clearScheduledNotice, clearUndoToast, openRoomContextMenu, updateRoomNeedsReply, openMessageContextMenu, copyMessage, clearNeedsReply, undoAnswered, showRoom, isActiveAccountRoom }
}
