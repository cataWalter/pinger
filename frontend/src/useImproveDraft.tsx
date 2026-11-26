import { useRef, useState } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import type { ImprovedDraftVariant } from '../bindings/mychat/desktop/models.js'
import { describeError } from './appShared'
import type { useComposerSnippets } from './useComposerSnippets'

export interface ImproveDraftSession {
  roomId: string
  original: string
  goal: string
  goalLoading: boolean
  reviewing: boolean
  variants: ImprovedDraftVariant[]
  openQuestions: string[]
  error: string
}

export interface ImprovedDraftRestore {
  roomId: string
  original: string
  applied: string
}

type ImproveDraftInput = Pick<ReturnType<typeof useComposerSnippets>,
  'aiEnabled' | 'busy' | 'cancelAIRequest' | 'composeTextRef' | 'composerInputRef' | 'confirmOnlineAIRequest' |
  'editTarget' | 'newAIRequestID' | 'selectedRoomID' | 'selectedRoomRef' | 'setComposeDraft'>

// useImproveDraft owns the draft review: it infers the draft goal, runs the review, and places a chosen version in the composer. Nothing is sent.
export function useImproveDraft(app: ImproveDraftInput) {
  const { aiEnabled, busy, cancelAIRequest, composeTextRef, composerInputRef, editTarget, newAIRequestID, selectedRoomID, selectedRoomRef, setComposeDraft } = app
  const [session, setSession] = useState<ImproveDraftSession | null>(null)
  const [restore, setRestore] = useState<ImprovedDraftRestore | null>(null)
  const goalRequestRef = useRef('')
  const reviewRequestRef = useRef('')

  // improveComposerDraft opens the review, infers the draft goal from the chat, and runs the review with it.
  async function improveComposerDraft() {
    const roomID = selectedRoomID
    const original = composeTextRef.current
    if (!roomID || !aiEnabled || busy || editTarget || !original.trim()) return
    if (!(await app.confirmOnlineAIRequest('Improve draft', 'your draft, recent messages, and the draft goal'))) return
    if (selectedRoomRef.current !== roomID) return
    cancelAIRequest(goalRequestRef.current)
    cancelAIRequest(reviewRequestRef.current)
    reviewRequestRef.current = ''
    const requestID = newAIRequestID()
    goalRequestRef.current = requestID
    setSession({ roomId: roomID, original, goal: '', goalLoading: true, reviewing: false, variants: [], openQuestions: [], error: '' })
    void inferDraftGoal(roomID, original, requestID)
  }

  async function inferDraftGoal(roomID: string, original: string, requestID: string) {
    try {
      const goal = await AppService.AIInferDraftGoal(roomID, original, requestID)
      if (goalRequestRef.current !== requestID) return
      goalRequestRef.current = ''
      if (selectedRoomRef.current !== roomID) {
        closeImproveDraft()
        return
      }
      setSession((current) => current?.roomId === roomID ? { ...current, goal, goalLoading: false } : current)
      void runReview(roomID, original, goal.trim())
    } catch (goalError) {
      if (goalRequestRef.current !== requestID) return
      goalRequestRef.current = ''
      setSession((current) => current?.roomId === roomID ? { ...current, goalLoading: false, error: describeError(goalError) } : current)
    }
  }

  function setImproveDraftGoal(goal: string) {
    setSession((current) => current ? { ...current, goal } : current)
  }

  // runReview asks the AI for improved versions of the draft under the goal. A new run replaces the previous versions.
  async function runReview(roomId: string, original: string, goal: string) {
    cancelAIRequest(reviewRequestRef.current)
    const requestID = newAIRequestID()
    reviewRequestRef.current = requestID
    setSession((current) => current?.roomId === roomId ? { ...current, reviewing: true, error: '', variants: [], openQuestions: [] } : current)
    try {
      const result = await AppService.AIImproveDraft(roomId, original, goal, requestID)
      if (reviewRequestRef.current !== requestID) return
      reviewRequestRef.current = ''
      if (selectedRoomRef.current !== roomId) {
        closeImproveDraft()
        return
      }
      setSession((current) => current?.roomId === roomId ? { ...current, reviewing: false, variants: result.variants ?? [], openQuestions: result.openQuestions ?? [] } : current)
    } catch (reviewError) {
      if (reviewRequestRef.current !== requestID) return
      reviewRequestRef.current = ''
      setSession((current) => current?.roomId === roomId ? { ...current, reviewing: false, error: describeError(reviewError) } : current)
    }
  }

  async function runImproveDraft() {
    if (!session || session.reviewing || session.goalLoading) return
    if (!(await app.confirmOnlineAIRequest('Improve draft', 'your draft, recent messages, and the draft goal'))) return
    void runReview(session.roomId, session.original, session.goal.trim())
  }

  // stopImproveReview cancels the running review. The dialog keeps the goal and any earlier versions.
  function stopImproveReview() {
    cancelAIRequest(reviewRequestRef.current)
    reviewRequestRef.current = ''
    setSession((current) => current ? { ...current, reviewing: false } : current)
  }

  // applyImprovedDraft places a chosen version in the composer and closes the review. Restore returns to the draft from before the first improvement.
  function applyImprovedDraft(text: string) {
    if (!session || selectedRoomRef.current !== session.roomId) return
    const original = restore && restore.roomId === session.roomId && restore.applied === session.original ? restore.original : session.original
    setComposeDraft(text)
    setRestore({ roomId: session.roomId, original, applied: text })
    closeImproveDraft()
    composerInputRef.current?.focus()
  }

  function closeImproveDraft() {
    cancelAIRequest(goalRequestRef.current)
    cancelAIRequest(reviewRequestRef.current)
    goalRequestRef.current = ''
    reviewRequestRef.current = ''
    setSession(null)
  }

  // restoreImprovedDraft puts the original draft back, but only while the composer still holds the applied version.
  function restoreImprovedDraft() {
    if (!restore || composeTextRef.current !== restore.applied || selectedRoomRef.current !== restore.roomId) return
    setComposeDraft(restore.original)
    setRestore(null)
    composerInputRef.current?.focus()
  }

  return { improveDraft: session, improveRestore: restore, improveComposerDraft, setImproveDraftGoal, runImproveDraft, stopImproveReview, applyImprovedDraft, closeImproveDraft, restoreImprovedDraft }
}
