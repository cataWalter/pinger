import { useEffect } from 'react'
import { useRef, useState } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Room, type Snapshot } from '../bindings/mychat/desktop/models.js'
import { isLocalAIRoomID, localAIChatIDFromRoomID } from './localAIChats'
import { clearParkedChatTranslations } from './chatTranslationStash'
import { describeError, isNeedsReplyRoom, preferenceBoolean } from './appShared'
import { roomActivityAt } from './rooms'
import { appendAIDraft, dropArchivedVolatileAIDrafts, getVolatileAIDraft, setVolatileAIDraft } from './volatileAIDrafts'
import type { useAIRequests } from './useAIRequests'

// AI_DRAFT_REQUEST_TIMEOUT_MS is slightly above the backend's 10 minute completion limit.
const AI_DRAFT_REQUEST_TIMEOUT_MS = 11 * 60 * 1000

export function useAccountWorkspace(app: ReturnType<typeof useAIRequests>) {
  const { archivedPreferenceKey, composeTextRef, preferences, roomDrafts, roomRefinements, roomScope, rooms, setVolatileAIDrafts, volatileAIDrafts } = app
  const { activeAIRequestRef, activeAccountID, aiEnabled, busy, cancelAIRequest, chatTranslationAIRequestRef, chatTranslationRequestRef, clearRoomSelection, closeLanguageTutor, editTarget, filteredRooms, handleRoomKeyDown, historyRoomIDRef, imageSendRun, languageTutorRequestRef, lastReadEventByRoom, loadingOlderRef, newAIRequestID, openRoomContextMenu, pendingHistoryRefreshRoomIDRef, pendingSearchJumpRef, refreshScheduledJobs, roomButtonActionsRef, roomSelectionAnchorRef, selectLocalAIChat, selectedRoomID, selectedRoomRef, setAIPanel, setChatTranslation, setComposeText, setEditTarget, setForwardingMessage, setGeneratedImageReview, setImageSendRun, setLanguageTutorState, setLeaveConfirmOpen, setLoadingOlder, setLocalAIChatOpen, setMediaApproval, setMentionBindings, setMessageContextMenu, setMessages, setMobilePane, setRedactTarget, setReplyTarget, setRoomContextMenu, setRoomInfoOpen, setRoomMembers, setScheduledDraft, setScheduledJobs, setScheduledJobsOpen, setScheduledTimes, setSearchNextBatch, setSearchOpen, setSearchResults, setSelectedRoomID, setSelectedRoomIDs, setSnapshot, setSuggestedReplies, setSummaryStatus, setTypingUsers, setUndoRoomID, showRoom, suggestedRepliesRequestRef, summaryLoadingRef, undoToastTimerRef, workspaceGenerationRef } = app
  const [aiReplyDraftBatch, setAIReplyDraftBatch] = useState({
    status: 'idle' as 'idle' | 'running' | 'complete' | 'cancelled',
    completed: 0,
    total: 0,
    failures: [] as string[],
    notice: '',
  })
  const replyDraftBatchRef = useRef<{ accountID: string; requestIDs: Set<string>; cancelled: boolean } | null>(null)

  // A notice describes the chats in the view that produced it, so it clears when the filter changes.
  useEffect(() => {
    setAIReplyDraftBatch((current) => current.notice && current.status !== 'running' ? { ...current, notice: '' } : current)
  }, [roomScope, roomRefinements.unanswered, roomRefinements.needsReply])

  // suggestRepliesForRoom asks Local AI for ten reply options, each in a different style, based on the latest messages in roomID.
  async function suggestRepliesForRoom(roomID: string) {
    if (!roomID || !aiEnabled || editTarget) return
    if (!(await app.confirmOnlineAIRequest('Suggest replies', 'recent messages, the saved chat goal, and reply instructions'))) return
    if (selectedRoomRef.current !== roomID) return
    cancelAIRequest(suggestedRepliesRequestRef.current)
    const requestID = newAIRequestID()
    suggestedRepliesRequestRef.current = requestID
    setSuggestedReplies((previous) => ({ roomId: roomID, requestId: requestID, status: 'loading', language: previous?.roomId === roomID ? previous.language : '', inferredGoal: previous?.roomId === roomID ? previous.inferredGoal : '', suggestions: previous?.roomId === roomID ? previous.suggestions : [], error: '' }))
    try {
      const result = await AppService.AISuggestReplies(roomID, requestID)
      if (suggestedRepliesRequestRef.current !== requestID) return
      setSuggestedReplies({ roomId: roomID, requestId: requestID, status: 'ready', language: result.language ?? '', inferredGoal: result.inferredGoal ?? '', suggestions: result.suggestions ?? [], error: '' })
    } catch (suggestError) {
      if (suggestedRepliesRequestRef.current !== requestID) return
      setSuggestedReplies({ roomId: roomID, requestId: requestID, status: 'error', language: '', inferredGoal: '', suggestions: [], error: describeError(suggestError) })
    } finally {
      if (suggestedRepliesRequestRef.current === requestID) suggestedRepliesRequestRef.current = ''
    }
  }

  // cancelSuggestedReplies stops a pending request and closes the picker.
  function cancelSuggestedReplies() {
    const requestID = suggestedRepliesRequestRef.current
    suggestedRepliesRequestRef.current = ''
    setSuggestedReplies(null)
    cancelAIRequest(requestID)
  }

  function cancelAIDraftBatch() {
    const run = replyDraftBatchRef.current
    if (!run) return
    run.cancelled = true
    for (const requestID of run.requestIDs) cancelAIRequest(requestID)
    run.requestIDs.clear()
    replyDraftBatchRef.current = null
    setAIReplyDraftBatch((current) => current.status === 'running' ? { ...current, status: 'cancelled' } : current)
  }

  // withDraftTimeout stops a draft request that never settles, so one hung call cannot keep the batch running.
  // The limit is slightly above the backend's longest completion timeout.
  function withDraftTimeout<T>(request: Promise<T>, requestID: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        cancelAIRequest(requestID)
        reject(new Error('The reply draft took too long'))
      }, AI_DRAFT_REQUEST_TIMEOUT_MS)
    })
    return Promise.race([request, timeout]).finally(() => clearTimeout(timer))
  }

  // isArchivedRoom reports whether the room is archived. Archived rooms never get AI drafts.
  function isArchivedRoom(accountID: string, roomID: string) {
    return preferenceBoolean(preferences, archivedPreferenceKey(roomID, accountID))
  }

  async function generateNeedsReplyDrafts() {
    if (!aiEnabled || busy || editTarget || replyDraftBatchRef.current) return
    const candidates = rooms.filter((room) => isNeedsReplyRoom(room)
      && !isArchivedRoom(room.accountId, room.id)
      && !getVolatileAIDraft(volatileAIDrafts, activeAccountID, room.id))
      .sort((left, right) => roomActivityAt(left) - roomActivityAt(right))
    if (candidates.length === 0) {
      // With no candidates, either every chat that needs a reply already has a draft or none needs one.
      const alreadyDrafted = rooms.some((room) => isNeedsReplyRoom(room) && !isArchivedRoom(room.accountId, room.id))
      setAIReplyDraftBatch({ status: 'complete', completed: 0, total: 0, failures: [], notice: alreadyDrafted ? 'All chats have drafts' : 'No chats need a reply' })
      return
    }

    if (!(await app.confirmOnlineAIRequest('Draft replies', `recent messages and reply instructions from ${candidates.length} ${candidates.length === 1 ? 'chat' : 'chats'}`))) return
    const run = { accountID: activeAccountID, requestIDs: new Set<string>(), cancelled: false }
    replyDraftBatchRef.current = run
    setAIReplyDraftBatch({ status: 'running', completed: 0, total: candidates.length, failures: [], notice: '' })
    let nextIndex = 0
    let completed = 0
    const failures: string[] = []

    const worker = async () => {
      while (!run.cancelled) {
        const room = candidates[nextIndex++]
        if (!room) return
        const requestID = newAIRequestID()
        run.requestIDs.add(requestID)
        try {
          const reply = await withDraftTimeout(AppService.AIGenerateReplyDraft(room.id, requestID), requestID)
          if (run.cancelled || replyDraftBatchRef.current !== run) return
          if (isArchivedRoom(room.accountId, room.id)) continue
          const baseText = roomDrafts.get(room.id) ?? (selectedRoomRef.current === room.id ? composeTextRef.current : '')
          const draft = { baseText, text: appendAIDraft(baseText, reply) }
          setVolatileAIDrafts((current) => setVolatileAIDraft(current, activeAccountID, room.id, draft))
          if (selectedRoomRef.current === room.id) {
            composeTextRef.current = draft.text
            setComposeText(draft.text)
          }
        } catch (generationError) {
          if (run.cancelled) return
          failures.push(`${room.name || room.id}: ${describeError(generationError)}`)
        } finally {
          run.requestIDs.delete(requestID)
          if (!run.cancelled && replyDraftBatchRef.current === run) {
            completed++
            setAIReplyDraftBatch({ status: 'running', completed, total: candidates.length, failures: [...failures], notice: '' })
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, () => worker()))
    if (replyDraftBatchRef.current === run) {
      replyDraftBatchRef.current = null
      setAIReplyDraftBatch({ status: 'complete', completed, total: candidates.length, failures, notice: failures.length > 0 ? `${failures.length} of ${candidates.length} drafts failed` : '' })
    }
  }

  useEffect(() => {
    if (replyDraftBatchRef.current && replyDraftBatchRef.current.accountID !== activeAccountID) cancelAIDraftBatch()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelAIDraftBatch is recreated each render; the effect follows only the account
  }, [activeAccountID])

  useEffect(() => {
    if (app.snapshot && !app.snapshot.loggedIn) setVolatileAIDrafts(new Map())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only loggedIn is read; re-running on every snapshot change is not wanted
  }, [app.snapshot?.loggedIn, setVolatileAIDrafts])

  // Discard unsent AI drafts for rooms that are archived, including rooms archived while a draft was waiting.
  useEffect(() => {
    setVolatileAIDrafts((current) => dropArchivedVolatileAIDrafts(current, isArchivedRoom))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isArchivedRoom is recreated each render; the prune follows preferences and rooms
  }, [preferences, rooms, setVolatileAIDrafts])

  // Close the picker when the open room changes so its options never apply to another room.
  useEffect(() => {
    const requestID = suggestedRepliesRequestRef.current
    suggestedRepliesRequestRef.current = ''
    setSuggestedReplies(null)
    cancelAIRequest(requestID)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelAIRequest only calls AppService; it is recreated each render
  }, [selectedRoomID, activeAccountID, setSuggestedReplies, suggestedRepliesRequestRef])

  useEffect(() => {
    const requestID = languageTutorRequestRef.current
    languageTutorRequestRef.current = ''
    setLanguageTutorState(null)
    cancelAIRequest(requestID)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelAIRequest only calls AppService; it is recreated each render
  }, [selectedRoomID, activeAccountID, languageTutorRequestRef, setLanguageTutorState])

  function closeAIResult() {
    cancelAIRequest(activeAIRequestRef.current)
    activeAIRequestRef.current = ''
    setAIPanel(null)
  }

  function resetAccountWorkspace(state: Snapshot) {
    workspaceGenerationRef.current++
    app.resolveOnlineAIConfirmation(false)
    cancelSuggestedReplies()
    closeLanguageTutor()
    closeAIResult()
    cancelAIRequest(imageSendRun?.requestID ?? '')
    cancelAIRequest(chatTranslationAIRequestRef.current)
    chatTranslationAIRequestRef.current = ''
    chatTranslationRequestRef.current++
    setChatTranslation(null)
    clearParkedChatTranslations()
    setImageSendRun(null)
    setGeneratedImageReview(null)
    setMediaApproval(null)
    setScheduledDraft(null)
    setScheduledJobsOpen(false)
    setUndoRoomID('')
    if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current)
    setRoomContextMenu(null)
    setMessageContextMenu(null)
    setForwardingMessage(null)
    setRedactTarget(null)
    setRoomInfoOpen(false)
    setLeaveConfirmOpen(false)
    setRoomMembers([])
    setTypingUsers([])
    setSelectedRoomIDs([])
    pendingSearchJumpRef.current = null
    loadingOlderRef.current = false
    setLoadingOlder(false)
    summaryLoadingRef.current = false
    setSummaryStatus('')
    setSnapshot(state)
    setSelectedRoomID((state.rooms ?? [])[0]?.id ?? '')
    setMobilePane('rooms')
    setMessages([])
    setComposeText('')
    setMentionBindings([])
    setReplyTarget(null)
    setEditTarget(null)
    setSearchOpen(false)
    setSearchResults([])
    setSearchNextBatch('')
    setScheduledJobs([])
    setScheduledTimes({})
    lastReadEventByRoom.current.clear()
    historyRoomIDRef.current = ''
    pendingHistoryRefreshRoomIDRef.current = ''
    void refreshScheduledJobs()
  }

  function openInboxRoom(room: Room) {
    const chatID = localAIChatIDFromRoomID(room.id)
    if (chatID !== null) {
      selectLocalAIChat(chatID)
      return
    }
    setLocalAIChatOpen(false)
    showRoom(room.id)
  }

  roomButtonActionsRef.current = {
    onSelect: (room, index, event) => {
      if (event.shiftKey && !isLocalAIRoomID(room.id)) {
        event.preventDefault()
        const anchorIndex = filteredRooms.findIndex((candidate) => candidate.id === roomSelectionAnchorRef.current)
        if (anchorIndex < 0) {
          roomSelectionAnchorRef.current = room.id
          setSelectedRoomIDs([room.id])
          return
        }
        const start = Math.min(anchorIndex, index)
        const end = Math.max(anchorIndex, index)
        setSelectedRoomIDs(filteredRooms.slice(start, end + 1).filter((candidate) => !isLocalAIRoomID(candidate.id)).map((candidate) => candidate.id))
        return
      }
      clearRoomSelection()
      roomSelectionAnchorRef.current = room.id
      openInboxRoom(room)
    },
    onKeyDown: (room, index, event) => handleRoomKeyDown(event, room, index),
    onContextMenu: (room, event) => {
      event.preventDefault()
      openRoomContextMenu(room.id, event.clientX, event.clientY)
    },
  }

  function selectRoomByOffset(direction: number, unansweredOnly = false) {
    const availableRooms = filteredRooms.filter((room) => !unansweredOnly || isNeedsReplyRoom(room))
    if (availableRooms.length === 0) return
    const currentIndex = availableRooms.findIndex((room) => room.id === selectedRoomRef.current)
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : availableRooms.length - 1
      : (currentIndex + direction + availableRooms.length) % availableRooms.length
    openInboxRoom(availableRooms[nextIndex])
  }

  return { ...app, openInboxRoom, selectRoomByOffset, resetAccountWorkspace, aiReplyDraftBatch, generateNeedsReplyDrafts, cancelAIDraftBatch, suggestRepliesForRoom, cancelSuggestedReplies, closeAIResult }
}
