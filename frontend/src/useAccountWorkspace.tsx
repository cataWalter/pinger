/* eslint-disable react-hooks/exhaustive-deps -- deps mirror the original component closure; setters and refs come from other hooks */
import { useEffect, type FormEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Room, type Snapshot } from '../bindings/mychat/desktop/models.js'
import { useAccountSwitching } from './hooks/useAccountSwitching'
import { isLocalAIRoomID, localAIChatIDFromRoomID } from './localAIChats'
import { describeError, isNeedsReplyRoom } from './appShared'
import type { useAIRequests } from './useAIRequests'

export function useAccountWorkspace(app: ReturnType<typeof useAIRequests>) {
  const { accountHomeserver, accountPassword, accountUsername, activeAIRequestRef, activeAccountID, aiEnabled, busy, cancelAIRequest, chatTranslationAIRequestRef, chatTranslationRequestRef, clearRoomSelection, closeLanguageTutor, editTarget, filteredRooms, forwardBusy, handleRoomKeyDown, historyRoomIDRef, imageSendRun, isActiveAccountRoom, languageTutorRequestRef, lastReadEventByRoom, leavingRoom, loadingOlderRef, newAIRequestID, openRoomContextMenu, pendingHistoryRefreshRoomIDRef, pendingSearchJumpRef, refreshScheduledJobs, roomButtonActionsRef, roomSelectionAnchorRef, scheduledBusyID, scheduledSaving, selectLocalAIChat, selectedRoomID, selectedRoomRef, setAIPanel, setAccountError, setAccountManagerOpen, setAccountPassword, setAccountUsername, setAddingAccount, setBusy, setChatTranslation, setComposeText, setEditTarget, setForwardingMessage, setGeneratedImageReview, setImageSendRun, setLanguageTutorState, setLeaveConfirmOpen, setLoadingOlder, setLocalAIChatOpen, setMediaApproval, setMentionBindings, setMessageContextMenu, setMessages, setMobilePane, setRedactTarget, setReplyTarget, setRoomContextMenu, setRoomInfoOpen, setRoomMembers, setScheduledDraft, setScheduledJobs, setScheduledJobsOpen, setScheduledTimes, setSearchNextBatch, setSearchOpen, setSearchResults, setSelectedRoomID, setSelectedRoomIDs, setSnapshot, setSuggestedReplies, setSummaryStatus, setTypingUsers, setUndoRoomID, showRoom, suggestedRepliesRequestRef, summaryLoadingRef, undoToastTimerRef, voiceCaptureStatus, workspaceGenerationRef } = app

  // suggestRepliesForRoom asks Local AI for three reply options based on the latest messages in roomID.
  async function suggestRepliesForRoom(roomID: string) {
    if (!roomID || !aiEnabled || editTarget) return
    cancelAIRequest(suggestedRepliesRequestRef.current)
    const requestID = newAIRequestID()
    suggestedRepliesRequestRef.current = requestID
    setSuggestedReplies((previous) => ({ roomId: roomID, requestId: requestID, status: 'loading', suggestions: previous?.roomId === roomID ? previous.suggestions : [], error: '' }))
    try {
      const result = await AppService.AISuggestReplies(roomID, requestID)
      if (suggestedRepliesRequestRef.current !== requestID) return
      setSuggestedReplies({ roomId: roomID, requestId: requestID, status: 'ready', suggestions: result.suggestions ?? [], error: '' })
    } catch (suggestError) {
      if (suggestedRepliesRequestRef.current !== requestID) return
      setSuggestedReplies({ roomId: roomID, requestId: requestID, status: 'error', suggestions: [], error: describeError(suggestError) })
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

  // Close the picker when the open room changes so its options never apply to another room.
  useEffect(() => {
    const requestID = suggestedRepliesRequestRef.current
    suggestedRepliesRequestRef.current = ''
    setSuggestedReplies(null)
    cancelAIRequest(requestID)
  }, [selectedRoomID, activeAccountID])

  useEffect(() => {
    const requestID = languageTutorRequestRef.current
    languageTutorRequestRef.current = ''
    setLanguageTutorState(null)
    cancelAIRequest(requestID)
  }, [selectedRoomID, activeAccountID])

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
  return { ...app, openInboxRoom, selectRoomByOffset, resetAccountWorkspace, switchAccount, submitAddAccount, openNotificationRoom, suggestRepliesForRoom, cancelSuggestedReplies, closeAIResult }
}
