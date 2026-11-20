import { type KeyboardEvent } from 'react'
import { Reply, ScrollText, Languages, X, GraduationCap, ImagePlus } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { AI_ACTION_SHORTCUTS } from './aiSettings'
import { primaryShiftShortcutKey, type ActionMenuEntry } from './appShared'
import { describeError, isTextEntryTarget, timelineMessageID } from './appShared'
import type { useComposerSnippets } from './useComposerSnippets'

export function useRoomChatExport(app: ReturnType<typeof useComposerSnippets>) {
  const { aiEnabled, analyzeWithLanguageTutor, busy, chatExport, chatTranslation, clearChatTranslation, composeText, composerInputRef, editTarget, generateImageToRoom, generatedImageReview, hasAIConversationContext, hasOlder, imageButtonTooltip, imageEngineReady, imageRunHere, imageSendRun, leavingRoom, loadingOlder, localAIChatOpen, messageContextMenu, messageContextMenuItems, messages, roomContextMenu, roomDrafts, rooms, selectedRoom, selectedRoomID, setChatExport, setLeaveConfirmOpen, setLeaveRoomError, setLeavingRoom, setMessageContextMenu, setRoomInfoOpen, setSelectedRoomID, setSnapshot, suggestRepliesForRoom, summarizeRoom, summaryStatus, translateRecentLabel, translateRecentMessages } = app

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

  function composerAIItems(): ActionMenuEntry[] {
    return [
      { label: 'Analyze draft with Language Tutor', caption: 'Tutor', primaryShiftKey: AI_ACTION_SHORTCUTS.analyzeDraft.key, icon: <GraduationCap size={15} />, onSelect: () => void analyzeWithLanguageTutor(composeText, 'draft'), disabled: !selectedRoom || !composeText.trim() || busy || !aiEnabled || Boolean(editTarget) },
      { label: 'Suggest replies', caption: 'Replies', primaryShiftKey: AI_ACTION_SHORTCUTS.suggestReplies.key, icon: <Reply size={15} />, onSelect: () => void suggestRepliesForRoom(selectedRoomID), disabled: !selectedRoom || busy || !aiEnabled || Boolean(editTarget) },
      { label: 'Generate image from draft', caption: 'Image', primaryShiftKey: AI_ACTION_SHORTCUTS.generateImage.key, icon: <ImagePlus size={15} />, onSelect: () => void generateImageToRoom(), title: imageButtonTooltip, disabled: Boolean(imageRunHere) || !selectedRoom || !imageEngineReady || !composeText.trim() || busy || Boolean(editTarget) || imageSendRun !== null || generatedImageReview !== null },
      { label: 'Summarize with AI', caption: 'Summarize', primaryShiftKey: AI_ACTION_SHORTCUTS.summarize.key, icon: <ScrollText size={15} />, onSelect: () => void summarizeRoom(), disabled: !selectedRoom || busy || loadingOlder || Boolean(summaryStatus) || !aiEnabled || (!hasAIConversationContext && !hasOlder) },
      { label: translateRecentLabel, caption: 'Translate', primaryShiftKey: AI_ACTION_SHORTCUTS.translate.key, icon: <Languages size={15} />, onSelect: () => void translateRecentMessages(), disabled: !selectedRoom || busy || loadingOlder || !aiEnabled || (!hasAIConversationContext && !hasOlder) },
      ...(chatTranslation?.roomID === selectedRoomID ? [{ label: 'Clear message translations', caption: 'Clear', primaryShiftKey: AI_ACTION_SHORTCUTS.clearTranslations.key, icon: <X size={15} />, onSelect: clearChatTranslation }] : []),
    ]
  }

  function handleAIShortcut(event: KeyboardEvent<HTMLElement>) {
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
