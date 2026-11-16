import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AppService } from '../../bindings/mychat/desktop'
import type { Message } from '../../bindings/mychat/desktop/models.js'
import { describeError, mergeTimelineMessages, type TimelineListHandle } from '../appShared'

type SearchJump = { roomID: string; eventID: string; timelineCursor: number }
type MutableRef<T> = { current: T }

type RoomHistoryOptions = {
  selectedRoomID: string
  activeAccountID: string
  selectedRoomRef: MutableRef<string>
  workspaceGenerationRef: MutableRef<number>
  messages: Message[]
  setMessages: Dispatch<SetStateAction<Message[]>>
  setError: Dispatch<SetStateAction<string>>
  pendingSearchJumpRef: MutableRef<SearchJump | null>
  timelineRef: MutableRef<HTMLDivElement | null>
  timelineListRef: MutableRef<TimelineListHandle | null>
  timelineHeightBeforePrepend: MutableRef<number | null>
  roomSwitchRef: MutableRef<boolean>
  stickToBottomRef: MutableRef<boolean>
}

export function useRoomHistory({
  selectedRoomID,
  activeAccountID,
  selectedRoomRef,
  workspaceGenerationRef,
  messages,
  setMessages,
  setError,
  pendingSearchJumpRef,
  timelineRef,
  timelineListRef,
  timelineHeightBeforePrepend,
  roomSwitchRef,
  stickToBottomRef,
}: RoomHistoryOptions) {
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [historyPageRevision, setHistoryPageRevision] = useState(0)
  const [olderCursor, setOlderCursor] = useState(0)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const historyRoomIDRef = useRef('')
  const pendingHistoryRefreshRoomIDRef = useRef('')
  const lastObservedHistoryRevisionRef = useRef(0)
  const hasOlderRef = useRef(false)
  hasOlderRef.current = hasOlder
  // Scroll events can arrive before loadingOlder re-renders, so this closes the duplicate-fetch window.
  const loadingOlderRef = useRef(false)

  useEffect(() => {
    if (!selectedRoomID) {
      historyRoomIDRef.current = ''
      setMessages([])
      setOlderCursor(0)
      setHasOlder(false)
      return
    }

    let active = true
    const generation = workspaceGenerationRef.current
    const searchJump = pendingSearchJumpRef.current?.roomID === selectedRoomID ? pendingSearchJumpRef.current : null
    if (pendingSearchJumpRef.current && !searchJump) pendingSearchJumpRef.current = null
    historyRoomIDRef.current = ''
    setLoadingHistory(true)
    setOlderCursor(0)
    setHasOlder(false)
    setLoadingOlder(false)
    timelineHeightBeforePrepend.current = null
    roomSwitchRef.current = true
    stickToBottomRef.current = true
    void (async () => {
      try {
        let page = await AppService.History(selectedRoomID, 0)
        if (!active || workspaceGenerationRef.current !== generation) return
        let loadedMessages = page.messages ?? []
        let nextBefore = page.before
        let hasMore = page.hasMore
        let jumpPages = 0
        while (
          searchJump && searchJump.timelineCursor > 0 &&
          !loadedMessages.some((message) => message.id === searchJump.eventID) &&
          hasMore && nextBefore > searchJump.timelineCursor && jumpPages < 500
        ) {
          page = await AppService.History(selectedRoomID, nextBefore)
          if (!active || workspaceGenerationRef.current !== generation) return
          const olderMessages = page.messages ?? []
          if (olderMessages.length === 0 || page.before === nextBefore) {
            hasMore = false
            break
          }
          const loadedKeys = new Set(loadedMessages.map((message) => message.id || message.transactionId))
          loadedMessages = [...olderMessages.filter((message) => !loadedKeys.has(message.id || message.transactionId)), ...loadedMessages]
          nextBefore = page.before
          hasMore = page.hasMore
          jumpPages++
        }
        historyRoomIDRef.current = selectedRoomID
        setMessages(loadedMessages)
        setOlderCursor(nextBefore)
        setHasOlder(hasMore)
        if (searchJump && !loadedMessages.some((message) => message.id === searchJump.eventID)) {
          pendingSearchJumpRef.current = null
          setError('Could not load that message from local history.')
        }
        if (pendingHistoryRefreshRoomIDRef.current === selectedRoomID) {
          pendingHistoryRefreshRoomIDRef.current = ''
          setHistoryRevision((revision) => revision + 1)
        }
      } catch (historyError) {
        if (active && workspaceGenerationRef.current === generation) setError(describeError(historyError))
      } finally {
        if (active && workspaceGenerationRef.current === generation) setLoadingHistory(false)
      }
    })()

    return () => { active = false }
  }, [activeAccountID, historyPageRevision, pendingSearchJumpRef, roomSwitchRef, selectedRoomID, setError, setMessages, stickToBottomRef, timelineHeightBeforePrepend, workspaceGenerationRef])

  useEffect(() => {
    const revisionChanged = historyRevision !== lastObservedHistoryRevisionRef.current
    lastObservedHistoryRevisionRef.current = historyRevision
    if (!selectedRoomID || historyRevision === 0) return
    const roomID = selectedRoomID
    if (historyRoomIDRef.current !== roomID) {
      if (revisionChanged) pendingHistoryRefreshRoomIDRef.current = roomID
      return
    }

    let active = true
    const generation = workspaceGenerationRef.current
    AppService.History(roomID, 0)
      .then((page) => {
        if (!active || selectedRoomRef.current !== roomID || workspaceGenerationRef.current !== generation) return
        setMessages((current) => mergeTimelineMessages(current, page.messages ?? []))
        if (!hasOlderRef.current) setOlderCursor(page.before)
        if (page.hasMore) setHasOlder(true)
      })
      .catch((historyError: unknown) => {
        if (active) setError(describeError(historyError))
      })

    return () => { active = false }
  }, [activeAccountID, historyRevision, selectedRoomID, selectedRoomRef, setError, setMessages, workspaceGenerationRef])

  async function loadOlderMessages() {
    if (!selectedRoomID || !hasOlder || loadingOlder || loadingOlderRef.current) return
    const roomID = selectedRoomID
    const generation = workspaceGenerationRef.current
    timelineHeightBeforePrepend.current = timelineRef.current?.scrollHeight ?? null
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const page = await AppService.History(roomID, olderCursor)
      if (selectedRoomRef.current !== roomID || workspaceGenerationRef.current !== generation) return
      setMessages((current) => {
        const currentKeys = new Set(current.map((message) => message.id || message.transactionId))
        const olderMessages = (page.messages ?? []).filter((message) => !currentKeys.has(message.id || message.transactionId))
        if (olderMessages.length === 0) timelineHeightBeforePrepend.current = null
        return [...olderMessages, ...current]
      })
      setOlderCursor(page.before)
      setHasOlder(page.hasMore && page.before !== olderCursor)
    } catch (historyError) {
      if (workspaceGenerationRef.current !== generation) return
      setError(describeError(historyError))
      timelineHeightBeforePrepend.current = null
    } finally {
      if (workspaceGenerationRef.current === generation) {
        setLoadingOlder(false)
        if (timelineListRef.current?.virtualized) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (workspaceGenerationRef.current === generation) loadingOlderRef.current = false
          }))
        } else {
          loadingOlderRef.current = false
        }
      }
    }
  }

  const loadOlderMessagesRef = useRef(loadOlderMessages)
  loadOlderMessagesRef.current = loadOlderMessages

  // Fill a viewport that cannot scroll yet; pagination stops when the cursor stops advancing.
  useEffect(() => {
    const timeline = timelineRef.current
    if (!selectedRoomID || loadingHistory || loadingOlder || !hasOlder) return
    if (!timeline || timeline.clientHeight <= 0 || timeline.scrollHeight > timeline.clientHeight) return
    void loadOlderMessagesRef.current()
  }, [hasOlder, loadingHistory, loadingOlder, messages, selectedRoomID, timelineRef])

  return {
    loadingHistory,
    setLoadingHistory,
    historyRevision,
    setHistoryRevision,
    setHistoryPageRevision,
    historyRoomIDRef,
    pendingHistoryRefreshRoomIDRef,
    olderCursor,
    setOlderCursor,
    hasOlder,
    setHasOlder,
    hasOlderRef,
    loadingOlder,
    setLoadingOlder,
    loadingOlderRef,
    loadOlderMessages,
  }
}