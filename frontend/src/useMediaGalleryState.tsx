import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { useMediaGallery } from './hooks/useMediaGallery'
import { useMatrixBatch } from './useMatrixBatch'
import { type MatrixUpdate, describeError, isTextEntryTarget, preferenceBoolean } from './appShared'
import { getVolatileAIDraft } from './volatileAIDrafts'
import type { useTimelineScroll } from './useTimelineScroll'

export function useMediaGalleryState(app: ReturnType<typeof useTimelineScroll>) {
  const { activeAccountID, composeText, composerEmojiControlRef, composerInputRef, emojiPickerOpen, focusTimelineMessage, historyRoomIDRef, loadingHistory, messages, moveTimelineFocus, pendingSearchJumpRef, pinTimelineToBottom, pinnedScrollTopRef, preferences, quickSwitcherInputRef, quickSwitcherOpen, quickSwitcherQuery, roomDrafts, roomSwitchRef, roomsRef, selectedRoomID, selectedRoomRef, setAgentEditor, setAgentSettingsError, setComposeText, setEditTarget, setEmojiPickerOpen, setError, setHistoryRevision, setLeaveConfirmOpen, setMentionBindings, setMentionStart, setMessageSearch, setQuickSwitcherIndex, setReplyTarget, setRoomInfoOpen, setRoomMembers, setRoomMembersError, setRoomMembersLoading, setSearchOpen, setSearchResults, setSearchStatus, setTypingUsers, setUnreadMarker, singleKeyShortcuts, stickToBottomRef, timelineHeightBeforePrepend, timelineListRef, timelineRef, timelineResizeObserverRef, unreadMarkerID, volatileAIDrafts } = app

  function handleTimelineKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || isTextEntryTarget(event.target)) return
    const target = event.target instanceof HTMLElement ? event.target : null
    const row = target?.closest<HTMLElement>('[data-event-id]')
    if (!row && target !== event.currentTarget) return

    if (!singleKeyShortcuts && event.key.length === 1) return

    if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') {
      if (event.key.startsWith('Arrow') && target !== row && target !== event.currentTarget) return
      event.preventDefault()
      moveTimelineFocus(1)
    } else if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
      if (event.key.startsWith('Arrow') && target !== row && target !== event.currentTarget) return
      event.preventDefault()
      moveTimelineFocus(-1)
    } else if (event.key === 'Home' && (target === row || target === event.currentTarget)) {
      event.preventDefault()
      moveTimelineFocus(1, 'first')
    } else if (event.key === 'End' && (target === row || target === event.currentTarget)) {
      event.preventDefault()
      moveTimelineFocus(-1, 'last')
    } else if (event.key.toLowerCase() === 'r' && row) {
      const message = messages.find((item) => item.id === row.dataset.eventId || item.transactionId === row.dataset.eventId)
      if (!message?.id || message.id.startsWith('~')) return
      event.preventDefault()
      setEditTarget(null)
      setReplyTarget(message)
      requestAnimationFrame(() => composerInputRef.current?.focus())
    }
  }

  useLayoutEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) return
    const previousHeight = timelineHeightBeforePrepend.current
    if (previousHeight !== null) {
      if (!timelineListRef.current?.virtualized) timeline.scrollTop += timeline.scrollHeight - previousHeight
      timelineHeightBeforePrepend.current = null
      return
    }
    if (roomSwitchRef.current || stickToBottomRef.current) {
      pinTimelineToBottom(timeline)
      if (!roomSwitchRef.current || historyRoomIDRef.current === selectedRoomID) roomSwitchRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinTimelineToBottom is recreated each render; the pin should follow room and message changes only
  }, [historyRoomIDRef, messages, selectedRoomID, unreadMarkerID, roomSwitchRef, stickToBottomRef, timelineHeightBeforePrepend, timelineListRef, timelineRef])

  // Media, fonts, and composer or banner changes resize the timeline without changing `messages`.
  // Re-pin to the newest message after each resize while the reader is following the conversation.
  useLayoutEffect(() => {
    const timeline = timelineRef.current
    if (!timeline || typeof ResizeObserver === 'undefined') return
    if (!timelineResizeObserverRef.current) {
      timelineResizeObserverRef.current = new ResizeObserver(() => {
        const current = timelineRef.current
        if (current && stickToBottomRef.current) pinTimelineToBottom(current)
      })
    }
    const observer = timelineResizeObserverRef.current
    observer.disconnect()
    observer.observe(timeline)
    for (const child of Array.from(timeline.children)) observer.observe(child)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinTimelineToBottom is recreated each render; the observer follows room and messages only
  }, [messages, selectedRoomID, stickToBottomRef, timelineRef, timelineResizeObserverRef])

  useEffect(() => {
    return () => {
      timelineResizeObserverRef.current?.disconnect()
      timelineResizeObserverRef.current = null
    }
  }, [timelineResizeObserverRef])

  useEffect(() => {
    setSearchOpen(false)
    setMessageSearch('')
    setSearchResults([])
    setSearchStatus('')
    setRoomInfoOpen(false)
    setAgentEditor(null)
    setAgentSettingsError('')
    setLeaveConfirmOpen(false)
    setMentionBindings([])
    setMentionStart(-1)
    setEmojiPickerOpen(false)
    setTypingUsers([])
    setComposeText(getVolatileAIDraft(volatileAIDrafts, activeAccountID, selectedRoomID)?.text ?? roomDrafts.get(selectedRoomID) ?? '')
    const openedRoom = roomsRef.current.find((room) => room.id === selectedRoomID)
    setUnreadMarker(openedRoom && openedRoom.unread > 0
      ? { scope: `${activeAccountID}:${selectedRoomID}`, count: openedRoom.unread, messageID: '', seen: false, offscreen: false }
      : null)
    stickToBottomRef.current = true
    pinnedScrollTopRef.current = null
    setReplyTarget(null)
    setEditTarget(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- volatileAIDrafts must not reset the composer on each draft update; the effect follows the room and account
  }, [selectedRoomID, activeAccountID, roomDrafts, pinnedScrollTopRef, roomsRef, stickToBottomRef, setAgentEditor, setAgentSettingsError, setComposeText, setEditTarget, setEmojiPickerOpen, setLeaveConfirmOpen, setMentionBindings, setMentionStart, setMessageSearch, setReplyTarget, setRoomInfoOpen, setSearchOpen, setSearchResults, setSearchStatus, setTypingUsers, setUnreadMarker])

  useEffect(() => {
    if (!emojiPickerOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && composerEmojiControlRef.current?.contains(event.target)) return
      setEmojiPickerOpen(false)
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setEmojiPickerOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [emojiPickerOpen, composerEmojiControlRef, setEmojiPickerOpen])

  useEffect(() => {
    if (!quickSwitcherOpen) return
    const frame = window.requestAnimationFrame(() => quickSwitcherInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [quickSwitcherOpen, quickSwitcherInputRef])

  useEffect(() => {
    setQuickSwitcherIndex(0)
  }, [quickSwitcherQuery, setQuickSwitcherIndex])

  useEffect(() => {
    if (!selectedRoomID) {
      setRoomMembers([])
      setRoomMembersLoading(false)
      setRoomMembersError('')
      return
    }
    let active = true
    setRoomMembers([])
    setRoomMembersLoading(true)
    setRoomMembersError('')
    AppService.RoomMembers(selectedRoomID)
      .then((members) => { if (active) setRoomMembers(members ?? []) })
      .catch((membersError: unknown) => { if (active) setRoomMembersError(describeError(membersError)) })
      .finally(() => { if (active) setRoomMembersLoading(false) })
    return () => { active = false }
  }, [selectedRoomID, activeAccountID, setRoomMembers, setRoomMembersError, setRoomMembersLoading])

  useEffect(() => {
    if (!selectedRoomID || !preferenceBoolean(preferences, 'privacy.send_typing', true)) return
    const timeout = window.setTimeout(() => {
      const timeoutMilliseconds = composeText.trim() ? 5000 : 0
      void AppService.SetTyping(selectedRoomID, timeoutMilliseconds).catch((typingError: unknown) => setError(describeError(typingError)))
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [composeText, selectedRoomID, preferences, setError])

  const matrixUpdateHandlerRef = useRef<((update: MatrixUpdate) => void) | null>(null)

  useMatrixBatch<MatrixUpdate>((batch) => {
    for (const delta of batch.room_deltas ?? []) {
      matrixUpdateHandlerRef.current?.(delta.update)
    }
    const selectedRoomID = selectedRoomRef.current
    if (selectedRoomID && (
      (batch.new_messages ?? []).some((item) => item.roomId === selectedRoomID)
      || (batch.read_receipts ?? []).some((receipt) => receipt.roomId === selectedRoomID)
    )) {
      setHistoryRevision((revision) => revision + 1)
    }
    for (const typing of batch.typing_updates ?? []) {
      if (typing.roomId === selectedRoomID) setTypingUsers(typing.userIds)
    }
  })

  const {
    open: mediaGalleryOpen,
    filter: mediaGalleryFilter,
    setFilter: setMediaGalleryFilter,
    items: mediaGalleryItems,
    loading: mediaGalleryLoading,
    scanned: mediaGalleryScanned,
    error: mediaGalleryError,
    close: closeMediaGallery,
    openGallery: openMediaGallery,
  } = useMediaGallery({ selectedRoomID, activeAccountID, loadingHistory, historyRoomIDRef, messages, selectedRoomRef })

  useEffect(() => {
    const searchJump = pendingSearchJumpRef.current
    if (!searchJump || searchJump.roomID !== selectedRoomID || loadingHistory || historyRoomIDRef.current !== selectedRoomID) return
    if (!messages.some((message) => message.id === searchJump.eventID)) return
    pendingSearchJumpRef.current = null
    requestAnimationFrame(() => focusTimelineMessage(searchJump.eventID))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusTimelineMessage is recreated each render; the search jump follows room and messages only
  }, [historyRoomIDRef, loadingHistory, messages, selectedRoomID, pendingSearchJumpRef])
  return { ...app, handleTimelineKeyDown, matrixUpdateHandlerRef, mediaGalleryOpen, mediaGalleryFilter, setMediaGalleryFilter, mediaGalleryItems, mediaGalleryLoading, mediaGalleryScanned, mediaGalleryError, closeMediaGallery, openMediaGallery }
}
