import { type KeyboardEvent } from 'react'
import { Reply, ScrollText, Languages, X, GraduationCap, ImagePlus, MessageSquarePlus, WandSparkles } from 'lucide-react'
import { buildContinuePrompt } from './aiPrompts'
import { AppService } from '../bindings/mychat/desktop'
import { AI_ACTION_SHORTCUTS } from './aiSettings'
import { primaryShiftShortcutKey, type ActionMenuEntry } from './appShared'
import { describeError, isTextEntryTarget, timelineMessageID } from './appShared'
import type { useComposerSnippets } from './useComposerSnippets'
import type { useImproveDraft } from './useImproveDraft'

export function useRoomChatExport(app: ReturnType<typeof useComposerSnippets> & ReturnType<typeof useImproveDraft>) {
  const { aiEnabled, aiInstructions, analyzeWithLanguageTutor, busy, chatExport, chatTranslation, clearChatTranslation, composeDraftStore, composeTextRef, composerInputRef, editTarget, generateImageToRoom, generatedImageReview, hasAIConversationContext, hasOlder, imageButtonTooltip, imageEngineReady, imageRunHere, imageSendRun, improveComposerDraft, leavingRoom, loadingOlder, localAIChatOpen, messageContextMenuItems, messages, promptMessages, roomChatGoal, roomDrafts, rooms, runAIRequest, selectedRoom, selectedRoomID, selectedRoomRef, setAIPanel, setChatExport, setComposeDraft, setLeaveConfirmOpen, setLeaveRoomError, setLeavingRoom, setMessageContextMenu, setRoomInfoOpen, setSelectedRoomID, setSnapshot, suggestRepliesForRoom, summarizeRoom, summaryStatus, translateRecentLabel, translateRecentMessages, uiOverlayStore } = app

  async function inviteToSelectedRoom(userIDs: string[]) {
    if (!selectedRoomID) return
    await AppService.InviteToRoom(selectedRoomID, userIDs)
  }

  async function leaveSelectedRoom() {
    if (!selectedRoomID || leavingRoom) return
    const roomID = selectedRoomID
    const remainingRooms = rooms.filter((room) => room.id !== roomID)
    setLeaveRoomError('')
    setLeavingRoom(true)
    try {
      await AppService.LeaveRoom(roomID)
      roomDrafts.delete(roomID)
      setSnapshot((current) => current ? { ...current, rooms: (current.rooms ?? []).filter((room) => room.id !== roomID) } : current)
      setSelectedRoomID((current) => current === roomID ? remainingRooms[0]?.id ?? '' : current)
      setRoomInfoOpen(false)
      setLeaveConfirmOpen(false)
    } catch (leaveError) {
      setLeaveRoomError(describeError(leaveError))
    } finally {
      setLeavingRoom(false)
    }
  }

  async function exportSelectedRoomChat() {
    if (!selectedRoom || chatExport?.phase === 'running') return
    const roomID = selectedRoom.id
    let folder: string
    try {
      folder = await AppService.ChooseDownloadFolder()
    } catch (folderError) {
      setChatExport({ roomID, phase: 'failed', stage: '', result: null, error: describeError(folderError) })
      return
    }
    if (!folder) return
    setChatExport({ roomID, phase: 'running', stage: '', result: null, error: '' })
    try {
      const result = await AppService.ExportRoomChat(roomID, folder)
      setChatExport((current) => current?.roomID === roomID ? { ...current, phase: 'done', result } : current)
    } catch (exportError) {
      setChatExport((current) => current?.roomID === roomID ? { ...current, phase: 'failed', error: describeError(exportError) } : current)
    }
  }

  async function cancelChatExport() {
    try {
      await AppService.CancelChatExport()
    } catch (cancelError) {
      setChatExport((current) => current ? { ...current, error: describeError(cancelError) } : current)
    }
  }

  async function revealChatExport(path: string) {
    try {
      await AppService.RevealFile(path)
    } catch (revealError) {
      setChatExport((current) => current ? { ...current, error: describeError(revealError) } : current)
    }
  }

  function dismissChatExport() {
    setChatExport((current) => current?.phase === 'running' ? { ...current, error: '' } : null)
  }

  // Drafts the next message from the room. An empty composer receives it; otherwise it stays in the AI panel.
  async function continueRoomConversation() {
    const roomID = selectedRoomID
    if (!roomID || busy || !aiEnabled || editTarget || composeTextRef.current.trim() !== '') return
    const context = promptMessages(messages.map((message) => (message.own ? { ...message, senderName: 'You' } : message)))
    const request = buildContinuePrompt(context, aiInstructions('continue_conversation'), roomChatGoal)
    const scope = roomChatGoal ? 'recent chat history, the saved chat goal, and your instructions' : 'recent chat history and your instructions'
    const text = (await runAIRequest('Continue conversation', request, 'continue_conversation', scope, { kind: 'draft' })).trim()
    if (!text || selectedRoomRef.current !== roomID || composeTextRef.current.trim() !== '') return
    setComposeDraft(text)
    setAIPanel(null)
    composerInputRef.current?.focus()
  }

  function composerAIItems(draftText = composeDraftStore.getText()): ActionMenuEntry[] {
    return [
      { label: 'Analyze draft with Language Tutor', caption: 'Tutor', primaryShiftKey: AI_ACTION_SHORTCUTS.analyzeDraft.key, icon: <GraduationCap size={15} />, onSelect: () => void analyzeWithLanguageTutor(draftText, 'draft'), disabled: !selectedRoom || !draftText.trim() || busy || !aiEnabled || Boolean(editTarget) },
      { label: 'Suggest replies', caption: 'Replies', primaryShiftKey: AI_ACTION_SHORTCUTS.suggestReplies.key, icon: <Reply size={15} />, onSelect: () => void suggestRepliesForRoom(selectedRoomID), disabled: !selectedRoom || busy || !aiEnabled || Boolean(editTarget) },
      { label: 'Improve draft with AI', caption: 'Improve', primaryShiftKey: AI_ACTION_SHORTCUTS.improveDraft.key, icon: <WandSparkles size={15} />, onSelect: () => void improveComposerDraft(), disabled: !selectedRoom || !draftText.trim() || busy || !aiEnabled || Boolean(editTarget) },
      { label: 'Continue conversation', caption: 'Continue', primaryShiftKey: AI_ACTION_SHORTCUTS.continueConversation.key, icon: <MessageSquarePlus size={15} />, onSelect: () => void continueRoomConversation(), disabled: !selectedRoom || busy || !aiEnabled || Boolean(editTarget) || !hasAIConversationContext || draftText.trim() !== '' },
      { label: 'Generate image from draft', caption: 'Image', primaryShiftKey: AI_ACTION_SHORTCUTS.generateImage.key, icon: <ImagePlus size={15} />, onSelect: () => void generateImageToRoom(), title: imageButtonTooltip, disabled: Boolean(imageRunHere) || !selectedRoom || !imageEngineReady || !draftText.trim() || busy || Boolean(editTarget) || imageSendRun !== null || generatedImageReview !== null },
      { label: 'Summarize with AI', caption: 'Summarize', primaryShiftKey: AI_ACTION_SHORTCUTS.summarize.key, icon: <ScrollText size={15} />, onSelect: () => void summarizeRoom(), disabled: !selectedRoom || busy || loadingOlder || Boolean(summaryStatus) || !aiEnabled || (!hasAIConversationContext && !hasOlder) },
      { label: translateRecentLabel, caption: 'Translate', primaryShiftKey: AI_ACTION_SHORTCUTS.translate.key, icon: <Languages size={15} />, onSelect: () => void translateRecentMessages(), disabled: !selectedRoom || busy || loadingOlder || !aiEnabled || (!hasAIConversationContext && !hasOlder) },
      ...(chatTranslation?.roomID === selectedRoomID ? [{ label: 'Clear message translations', caption: 'Clear', primaryShiftKey: AI_ACTION_SHORTCUTS.clearTranslations.key, icon: <X size={15} />, onSelect: clearChatTranslation }] : []),
    ]
  }

  function handleAIShortcut(event: KeyboardEvent<HTMLElement>) {
    const { messageContextMenu, roomContextMenu } = uiOverlayStore.getSnapshot()
    if (localAIChatOpen || roomContextMenu || (isTextEntryTarget(event.target) && event.target !== composerInputRef.current)) return false
    const shortcutKey = primaryShiftShortcutKey(event.nativeEvent)
    if (!shortcutKey) return false
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-event-id]') : null
    if (shortcutKey === AI_ACTION_SHORTCUTS.transcribeAudio.key) {
      const button = row?.querySelector<HTMLButtonElement>('.audio-transcribe-button')
      if (!button) return false
      event.preventDefault()
      event.stopPropagation()
      button.click()
      return true
    }
    const message = messageContextMenu?.message ?? messages.find((item) => timelineMessageID(item) === row?.dataset.eventId)
    const messageCommand = message ? messageContextMenuItems(message).find((item) => item.primaryShiftKey === shortcutKey) : undefined
    if (messageCommand) {
      event.preventDefault()
      event.stopPropagation()
      if (!messageCommand.disabled) {
        setMessageContextMenu(null)
        messageCommand.run()
      }
      return true
    }
    const command = composerAIItems().find((item) => item.primaryShiftKey === shortcutKey)
    if (!command) return false
    event.preventDefault()
    event.stopPropagation()
    if (!command.disabled) command.onSelect()
    return true
  }
  return { ...app, inviteToSelectedRoom, leaveSelectedRoom, exportSelectedRoomChat, cancelChatExport, revealChatExport, dismissChatExport, composerAIItems, handleAIShortcut }
}
