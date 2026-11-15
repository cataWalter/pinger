import { useEffect, type FormEvent } from 'react'
import { useRef, useState } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Room, type Snapshot } from '../bindings/mychat/desktop/models.js'
import { useAccountSwitching } from './hooks/useAccountSwitching'
import { isLocalAIRoomID, localAIChatIDFromRoomID } from './localAIChats'
import { describeError, isNeedsReplyRoom, preferenceBoolean } from './appShared'
import { roomActivityAt } from './rooms'
import { appendAIDraft, dropArchivedVolatileAIDrafts, getVolatileAIDraft, setVolatileAIDraft } from './volatileAIDrafts'
import type { useAIRequests } from './useAIRequests'

// AI_DRAFT_REQUEST_TIMEOUT_MS is slightly above the backend's 10 minute completion limit.
const AI_DRAFT_REQUEST_TIMEOUT_MS = 11 * 60 * 1000

export function useAccountWorkspace(app: ReturnType<typeof useAIRequests>) {
  const { archivedPreferenceKey, composeTextRef, preferences, roomDrafts, rooms, setVolatileAIDrafts, volatileAIDrafts } = app
  const { accountHomeserver, accountPassword, accountUsername, activeAIRequestRef, activeAccountID, aiEnabled, busy, cancelAIRequest, chatTranslationAIRequestRef, chatTranslationRequestRef, clearRoomSelection, closeLanguageTutor, editTarget, filteredRooms, forwardBusy, handleRoomKeyDown, historyRoomIDRef, imageSendRun, isActiveAccountRoom, languageTutorRequestRef, lastReadEventByRoom, leavingRoom, loadingOlderRef, newAIRequestID, openRoomContextMenu, pendingHistoryRefreshRoomIDRef, pendingSearchJumpRef, refreshScheduledJobs, roomButtonActionsRef, roomSelectionAnchorRef, scheduledBusyID, scheduledSaving, selectLocalAIChat, selectedRoomID, selectedRoomRef, setAIPanel, setAccountError, setAccountManagerOpen, setAccountPassword, setAccountUsername, setAddingAccount, setBusy, setChatTranslation, setComposeText, setEditTarget, setForwardingMessage, setGeneratedImageReview, setImageSendRun, setLanguageTutorState, setLeaveConfirmOpen, setLoadingOlder, setLocalAIChatOpen, setMediaApproval, setMentionBindings, setMessageContextMenu, setMessages, setMobilePane, setRedactTarget, setReplyTarget, setRoomContextMenu, setRoomInfoOpen, setRoomMembers, setScheduledDraft, setScheduledJobs, setScheduledJobsOpen, setScheduledTimes, setSearchNextBatch, setSearchOpen, setSearchResults, setSelectedRoomID, setSelectedRoomIDs, setSnapshot, setSuggestedReplies, setSummaryStatus, setTypingUsers, setUndoRoomID, showRoom, suggestedRepliesRequestRef, summaryLoadingRef, undoToastTimerRef, voiceCaptureStatus, workspaceGenerationRef } = app
  const [aiReplyDraftBatch, setAIReplyDraftBatch] = useState({
    status: 'idle' as 'idle' | 'running' | 'complete' | 'cancelled',
    completed: 0,
    total: 0,
    failures: [] as string[],
  })
  const replyDraftBatchRef = useRef<{ accountID: string; requestIDs: Set<string>; cancelled: boolean } | null>(null)

  // suggestRepliesForRoom asks Local AI for ten reply options, each in a different style, based on the latest messages in roomID.
  async function suggestRepliesForRoom(roomID: string) {
    if (!roomID || !aiEnabled || editTarget) return
    cancelAIRequest(suggestedRepliesRequestRef.current)
    const requestID = newAIRequestID()
    suggestedRepliesRequestRef.current = requestID
    setSuggestedReplies((previous) => ({ roomId: roomID, requestId: requestID, status: 'loading', language: previous?.roomId === roomID ? previous.language : '', suggestions: previous?.roomId === roomID ? previous.suggestions : [], error: '' }))
    try {
      const result = await AppService.AISuggestReplies(roomID, requestID)
      if (suggestedRepliesRequestRef.current !== requestID) return
      setSuggestedReplies({ roomId: roomID, requestId: requestID, status: 'ready', language: result.language ?? '', suggestions: result.suggestions ?? [], error: '' })
    } catch (suggestError) {
      if (suggestedRepliesRequestRef.current !== requestID) return
      setSuggestedReplies({ roomId: roomID, requestId: requestID, status: 'error', language: '', suggestions: [], error: describeError(suggestError) })
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
    const candidates = rooms.filter((room) => isActiveAccountRoom(room)
      && isNeedsReplyRoom(room)
      && !isArchivedRoom(room.accountId, room.id)
      && !getVolatileAIDraft(volatileAIDrafts, activeAccountID, room.id))
      .sort((left, right) => roomActivityAt(left) - roomActivityAt(right))
    if (candidates.length === 0) {
      setAIReplyDraftBatch({ status: 'complete', completed: 0, total: 0, failures: [] })
      return
    }

    const run = { accountID: activeAccountID, requestIDs: new Set<string>(), cancelled: false }
    replyDraftBatchRef.current = run
    setAIReplyDraftBatch({ status: 'running', completed: 0, total: candidates.length, failures: [] })
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
            setAIReplyDraftBatch({ status: 'running', completed, total: candidates.length, failures: [...failures] })
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, () => worker()))
    if (replyDraftBatchRef.current === run) {
      replyDraftBatchRef.current = null
      setAIReplyDraftBatch({ status: 'complete', completed, total: candidates.length, failures })
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
    cancelSuggestedReplies()
    closeLanguageTutor()
    closeAIResult()
    cancelAIRequest(imageSendRun?.requestID ?? '')
    cancelAIRequest(chatTranslationAIRequestRef.current)
    chatTranslationAIRequestRef.current = ''
    chatTranslationRequestRef.current++
    setChatTranslation(null)
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

  const switchAccount = useAccountSwitching({
    activeAccountID,
    blocked: busy || Boolean(voiceCaptureStatus) || scheduledSaving || Boolean(scheduledBusyID) || forwardBusy || leavingRoom,
    resetAccountWorkspace,
    showRoom,
    setBusy,
    setAccountError,
    setAccountManagerOpen,
  })

  // Rooms from other accounts switch to their account before opening.
  function openInboxRoom(room: Room) {
    const chatID = localAIChatIDFromRoomID(room.id)
    if (chatID !== null) {
      selectLocalAIChat(chatID)
      return
    }
    setLocalAIChatOpen(false)
    if (isActiveAccountRoom(room)) showRoom(room.id)
    else void switchAccount(room.accountId, room.id)
  }

  roomButtonActionsRef.current = {
    onSelect: (room, index, event) => {
      if (event.shiftKey && isActiveAccountRoom(room) && !isLocalAIRoomID(room.id)) {
        event.preventDefault()
        const anchorIndex = filteredRooms.findIndex((candidate) => candidate.id === roomSelectionAnchorRef.current)
        if (anchorIndex < 0) {
          roomSelectionAnchorRef.current = room.id
          setSelectedRoomIDs([room.id])
          return
        }
        const start = Math.min(anchorIndex, index)
        const end = Math.max(anchorIndex, index)
        setSelectedRoomIDs(filteredRooms.slice(start, end + 1).filter((candidate) => isActiveAccountRoom(candidate) && !isLocalAIRoomID(candidate.id)).map((candidate) => candidate.id))
        return
      }
      clearRoomSelection()
      roomSelectionAnchorRef.current = room.id
      openInboxRoom(room)
    },
    onKeyDown: (room, index, event) => handleRoomKeyDown(event, room, index),
    onContextMenu: (room, event) => {
      event.preventDefault()
      if (isActiveAccountRoom(room)) openRoomContextMenu(room.id, event.clientX, event.clientY)
    },
  }

  function selectRoomByOffset(direction: number, unansweredOnly = false) {
    const availableRooms = filteredRooms.filter((room) => !unansweredOnly || isNeedsReplyRoom(room))
    if (availableRooms.length === 0) return
    const currentIndex = availableRooms.findIndex((room) => room.id === selectedRoomRef.current && isActiveAccountRoom(room))
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : availableRooms.length - 1
      : (currentIndex + direction + availableRooms.length) % availableRooms.length
    openInboxRoom(availableRooms[nextIndex])
  }

  async function submitAddAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setAccountError('')
    try {
      const state = await AppService.AddAccount(accountHomeserver.trim(), accountUsername.trim(), accountPassword)
      resetAccountWorkspace(state)
      setAccountPassword('')
      setAccountUsername('')
      setAddingAccount(false)
      setAccountManagerOpen(false)
    } catch (addError) {
      setAccountError(describeError(addError))
    } finally {
      setBusy(false)
    }
  }

  function openNotificationRoom(accountID: string, roomID: string) {
    if (accountID && accountID !== activeAccountID) void switchAccount(accountID, roomID)
    else showRoom(roomID)
  }
  return { ...app, openInboxRoom, selectRoomByOffset, resetAccountWorkspace, switchAccount, submitAddAccount, openNotificationRoom, aiReplyDraftBatch, generateNeedsReplyDrafts, cancelAIDraftBatch, suggestRepliesForRoom, cancelSuggestedReplies, closeAIResult }
}
