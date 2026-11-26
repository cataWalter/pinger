import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { useMediaGallery } from './hooks/useMediaGallery'
import { useMatrixBatch } from './useMatrixBatch'
import { applyEditedMessages, applyReactionDeltas, applyRedactedEvents } from './messages'
import { type MatrixUpdate, describeError, isTextEntryTarget, mergeTimelineMessages, preferenceBoolean } from './appShared'
import { getVolatileAIDraft } from './volatileAIDrafts'
import type { useTimelineScroll } from './useTimelineScroll'

export function useMediaGalleryState(app: ReturnType<typeof useTimelineScroll>) {
  const { activeAccountID, composeDraftStore, composerEmojiControlRef, composerInputRef, emojiPickerOpen, focusTimelineMessage, historyRoomIDRef, loadingHistory, messages, moveTimelineFocus, pendingSearchJumpRef, pinTimelineToBottom, pinnedScrollTopRef, preferences, quickSwitcherInputRef, quickSwitcherQuery, roomDrafts, roomSwitchRef, roomsRef, selectedRoomID, selectedRoomRef, setAgentEditor, setAgentSettingsError, setComposeText, setEditTarget, setEmojiPickerOpen, setError, setHistoryRevision, setLeaveConfirmOpen, setMentionBindings, setMentionStart, setMessageSearch, setMessages, setQuickSwitcherIndex, setReplyTarget, setRoomInfoOpen, setRoomMembers, setRoomMembersError, setRoomMembersLoading, setSearchOpen, setSearchResults, setSearchStatus, setTypingUsers, setUnreadMarker, singleKeyShortcuts, stickToBottomRef, timelineHeightBeforePrepend, timelineListRef, timelineRef, timelineResizeObserverRef, uiOverlayStore, unreadMarkerID, volatileAIDrafts } = app
  const volatileAIDraftsRef = useRef(volatileAIDrafts)
  volatileAIDraftsRef.current = volatileAIDrafts

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
  }, [historyRoomIDRef, messages, pinTimelineToBottom, selectedRoomID, unreadMarkerID, roomSwitchRef, stickToBottomRef, timelineHeightBeforePrepend, timelineListRef, timelineRef])

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
  }, [messages, pinTimelineToBottom, selectedRoomID, stickToBottomRef, timelineRef, timelineResizeObserverRef])

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
    setComposeText(getVolatileAIDraft(volatileAIDraftsRef.current, activeAccountID, selectedRoomID)?.text ?? roomDrafts.get(selectedRoomID) ?? '')
    const openedRoom = roomsRef.current.find((room) => room.id === selectedRoomID)
    setUnreadMarker(openedRoom && openedRoom.unread > 0
      ? { scope: `${activeAccountID}:${selectedRoomID}`, count: openedRoom.unread, messageID: '', seen: false, offscreen: false }
      : null)
    stickToBottomRef.current = true
    pinnedScrollTopRef.current = null
    setReplyTarget(null)
    setEditTarget(null)
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
    let wasOpen = uiOverlayStore.getSnapshot().quickSwitcherOpen
    let frame: number | null = null
    const focusIfOpened = () => {
      const isOpen = uiOverlayStore.getSnapshot().quickSwitcherOpen
      if (isOpen && !wasOpen) {
        frame = window.requestAnimationFrame(() => quickSwitcherInputRef.current?.focus())
      }
      wasOpen = isOpen
    }
    if (wasOpen) frame = window.requestAnimationFrame(() => quickSwitcherInputRef.current?.focus())
    const unsubscribe = uiOverlayStore.subscribe(focusIfOpened)
    return () => {
      unsubscribe()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [quickSwitcherInputRef, uiOverlayStore])

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
    let timeout: number | null = null
    const scheduleTyping = () => {
      if (timeout !== null) window.clearTimeout(timeout)
      timeout = window.setTimeout(() => {
        timeout = null
        const timeoutMilliseconds = composeDraftStore.getText().trim() ? 5000 : 0
        void AppService.SetTyping(selectedRoomID, timeoutMilliseconds).catch((typingError: unknown) => setError(describeError(typingError)))
      }, 350)
    }
    scheduleTyping()
    const unsubscribe = composeDraftStore.subscribe(scheduleTyping)
    return () => {
      unsubscribe()
      if (timeout !== null) window.clearTimeout(timeout)
    }
  }, [composeDraftStore, selectedRoomID, preferences, setError])

  const matrixUpdateHandlerRef = useRef<((update: MatrixUpdate, options?: { skipHistoryFallback?: boolean; deliveredMessageIDs?: Set<string> }) => void) | null>(null)

  useMatrixBatch<MatrixUpdate>((batch) => {
    const selectedRoomID = selectedRoomRef.current
    const incomingForSelected = selectedRoomID
      ? (batch.new_messages ?? []).filter((item) => item.roomId === selectedRoomID).map((item) => item.message)
      : []
    const deliveredMessageIDs = new Set<string>()
    for (const msg of incomingForSelected) {
      if (msg.id) deliveredMessageIDs.add(msg.id)
    }

    const handledMessagesInPlace = incomingForSelected.length > 0 && historyRoomIDRef.current === selectedRoomID
    if (incomingForSelected.length > 0) {
      if (handledMessagesInPlace) {
        setMessages((current) => mergeTimelineMessages(current, incomingForSelected))
      } else {
        setHistoryRevision((revision) => revision + 1)
      }
    }

    const editedForSelected = selectedRoomID
      ? (batch.edited_messages ?? []).filter((item) => item.roomId === selectedRoomID).map((item) => item.message)
      : []
    const handledEditInPlace = editedForSelected.length > 0 && historyRoomIDRef.current === selectedRoomID
    if (editedForSelected.length > 0) {
      if (handledEditInPlace) {
        setMessages((current) => applyEditedMessages(current, editedForSelected))
      } else {
        setHistoryRevision((revision) => revision + 1)
      }
    }

    const redactedForSelected = selectedRoomID
      ? (batch.redacted_event_ids ?? []).filter((item) => item.roomId === selectedRoomID).map((item) => item.eventId)
      : []
    const handledRedactionInPlace = redactedForSelected.length > 0 && historyRoomIDRef.current === selectedRoomID
    if (redactedForSelected.length > 0) {
      if (handledRedactionInPlace) {
        setMessages((current) => applyRedactedEvents(current, redactedForSelected))
      } else {
        setHistoryRevision((revision) => revision + 1)
      }
    }

    const reactionsForSelected = selectedRoomID
      ? (batch.reaction_deltas ?? []).filter((item) => item.roomId === selectedRoomID)
      : []
    const handledReactionInPlace = reactionsForSelected.length > 0 && historyRoomIDRef.current === selectedRoomID
    if (reactionsForSelected.length > 0) {
      if (handledReactionInPlace) {
        setMessages((current) => applyReactionDeltas(current, reactionsForSelected))
      } else {
        setHistoryRevision((revision) => revision + 1)
      }
    }

    const receiptsForSelected = selectedRoomID
      ? (batch.read_receipts ?? []).filter((receipt) => receipt.roomId === selectedRoomID)
      : []
    const handledReceiptInPlace = receiptsForSelected.some((receipt) => receipt.timestamp > 0 && Boolean(receipt.eventId))
    if (receiptsForSelected.length > 0) {
      const latestReceipt = receiptsForSelected[receiptsForSelected.length - 1]
      if (latestReceipt.timestamp > 0 && latestReceipt.eventId) {
        setMessages((current) => current.map((msg) => (
          msg.own && msg.id === latestReceipt.eventId && msg.seenAt !== latestReceipt.timestamp
            ? { ...msg, seenAt: latestReceipt.timestamp }
            : msg
        )))
      } else {
        setHistoryRevision((revision) => revision + 1)
      }
    }

    for (const delta of batch.room_deltas ?? []) {
      matrixUpdateHandlerRef.current?.(delta.update, {
        skipHistoryFallback: handledMessagesInPlace || handledEditInPlace || handledRedactionInPlace || handledReactionInPlace || handledReceiptInPlace,
        deliveredMessageIDs,
      })
    }

    for (const typing of batch.typing_updates ?? []) {
      if (typing.roomId === selectedRoomID) {
        const nextUsers = typing.userIds ?? []
        setTypingUsers((current) => current.length === nextUsers.length && current.every((user, index) => user === nextUsers[index])
          ? current
          : nextUsers)
      }
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
