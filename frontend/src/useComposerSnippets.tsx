import { AppService } from '../bindings/mychat/desktop'
import { type GroupRoomRequest, type Invite, type Member } from '../bindings/mychat/desktop/models.js'
import { formatComposerText, insertEmoji, type ComposerFormat } from './composerText'
import { saveSnippets, type Snippet } from './snippets'
import { useSnippetExpander } from './useSnippetExpander'
import { describeError } from './appShared'
import { deleteVolatileAIDraft, getVolatileAIDraft, updateVolatileAIDraft } from './volatileAIDrafts'
import type { useMessageAIActions } from './useMessageAIActions'

export function useComposerSnippets(app: ReturnType<typeof useMessageAIActions>) {
  const { activeAccountID, aiPanel, closeLanguageTutor, composeText, composeTextRef, composerEmojiSelectionRef, composerInputRef, editTarget, emojiMatch, emojiOptions, focusTimelineMessage, handleMessageDoubleClick, handleTimelineAudioEnded, inviteBusyRoomID, languageTutorState, mentionEnd, mentionOptions, mentionStart, openMessageContextMenu, openThreadPanel, removeReaction, roomDrafts, selectedRoomID, selectedRoomRef, sendReaction, setAIPanel, setComposeText, setEditTarget, setEmojiMatch, setEmojiPickerOpen, setError, setInviteBusyRoomID, setMentionBindings, setMentionQuery, setMentionStart, setNewRoomMode, setReplyTarget, setSnapshot, setSnippets, setSuggestedReplies, setVolatileAIDrafts, showRoom, snippets, startDirectChat, timelineMessageActionsRef, updateEmojiQuery, updateMentionQuery, volatileAIDrafts } = app

  function setComposeDraft(text: string) {
    composeTextRef.current = text
    setComposeText(text)
    if (!editTarget && selectedRoomID) {
      if (getVolatileAIDraft(volatileAIDrafts, activeAccountID, selectedRoomID)) {
        setVolatileAIDrafts((current) => updateVolatileAIDraft(current, activeAccountID, selectedRoomID, text))
      } else if (text) roomDrafts.set(selectedRoomID, text)
      else roomDrafts.delete(selectedRoomID)
    }
  }

  function discardVolatileAIDraft(roomID = selectedRoomID) {
    const draft = getVolatileAIDraft(volatileAIDrafts, activeAccountID, roomID)
    if (!draft) return
    setVolatileAIDrafts((current) => deleteVolatileAIDraft(current, activeAccountID, roomID))
    if (selectedRoomRef.current === roomID) {
      composeTextRef.current = draft.baseText
      setComposeText(draft.baseText)
      setMentionBindings([])
      setMentionStart(-1)
    }
  }
  timelineMessageActionsRef.current = {
    onDoubleClick: handleMessageDoubleClick,
    onOpenContextMenu: openMessageContextMenu,
    onFocusMessage: focusTimelineMessage,
    onAudioEnded: handleTimelineAudioEnded,
    onUseTranscript: (text) => {
      setComposeDraft(text)
      composerInputRef.current?.focus()
    },
    onSendReaction: sendReaction,
    onRemoveReaction: removeReaction,
    onStartDirectChat: startDirectChat,
    onOpenThread: openThreadPanel,
  }
  const snippetExpander = useSnippetExpander({
    value: composeText,
    snippets,
    roomID: selectedRoomID,
    inputRef: composerInputRef,
    setValue: setComposeDraft,
    onExpanded: () => {
      setEmojiMatch(null)
      setMentionStart(-1)
    },
    onUndo: (value, caret) => {
      updateMentionQuery(value, caret)
      updateEmojiQuery(value, caret)
    },
  })
  const snippetOptions = snippetExpander.suggestions
  const snippetMatch = snippetExpander.match
  const snippetMenuVisible = snippetExpander.visible
    && !(mentionStart >= 0 && mentionOptions.length > 0)
    && emojiOptions.length === 0

  function applyMention(member: Member) {
    if (mentionStart < 0) return
    const token = `@${member.displayName || member.id}`
    const suffix = composeText.slice(mentionEnd)
    const separator = suffix.startsWith(' ') ? '' : ' '
    const nextText = composeText.slice(0, mentionStart) + token + separator + suffix
    setComposeDraft(nextText)
    setMentionBindings((current) => [
      ...current.filter((binding) => binding.token !== token && nextText.includes(binding.token)),
      { token, userID: member.id },
    ])
    setMentionStart(-1)
    setMentionQuery('')
    requestAnimationFrame(() => {
      const input = composerInputRef.current
      if (!input) return
      const caret = mentionStart + token.length + separator.length
      input.focus()
      input.setSelectionRange(caret, caret)
    })
  }

  function useLanguageTutorDraft() {
    const text = languageTutorState?.analysis?.text_to_insert.trim()
    if (languageTutorState?.mode !== 'draft' || !text || editTarget) return
    if (languageTutorState.accountID !== activeAccountID || languageTutorState.roomID !== selectedRoomRef.current) {
      closeLanguageTutor()
      return
    }
    setComposeDraft(text)
    closeLanguageTutor()
    requestAnimationFrame(() => composerInputRef.current?.focus())
  }

  // useSuggestedReply fills the composer with the chosen option. It does not send the message or change the reply target.
  function useSuggestedReply(text: string) {
    setSuggestedReplies(null)
    setComposeDraft(text)
    requestAnimationFrame(() => composerInputRef.current?.focus())
  }

  function acceptAIResult() {
    if (!aiPanel?.result || aiPanel.busy || editTarget || aiPanel.acceptAction.kind === 'none') return
    if (aiPanel.acceptAction.kind === 'reply') {
      setEditTarget(null)
      setReplyTarget(aiPanel.acceptAction.target)
    }
    setComposeDraft(aiPanel.result)
    setAIPanel(null)
    composerInputRef.current?.focus()
  }

  function updateSnippets(next: Snippet[]) {
    setSnippets(next)
    saveSnippets(next)
  }

  function applyEmojiSuggestion(emoji: string) {
    if (!emojiMatch) return
    const { text, caret } = insertEmoji(composeText, emojiMatch.start, emojiMatch.end, emoji)
    setComposeDraft(text)
    setEmojiMatch(null)
    requestAnimationFrame(() => {
      const input = composerInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(caret, caret)
    })
  }

  function toggleComposerEmojiPicker() {
    const input = composerInputRef.current
    const valueLength = composeTextRef.current.length
    const start = Math.max(0, Math.min(input?.selectionStart ?? valueLength, valueLength))
    const end = Math.max(start, Math.min(input?.selectionEnd ?? start, valueLength))
    composerEmojiSelectionRef.current = { start, end }
    setEmojiPickerOpen((open) => !open)
  }

  function insertPickedEmoji(emoji: string) {
    const currentText = composeTextRef.current
    const start = Math.min(composerEmojiSelectionRef.current.start, currentText.length)
    const end = Math.max(start, Math.min(composerEmojiSelectionRef.current.end, currentText.length))
    const nextText = currentText.slice(0, start) + emoji + currentText.slice(end)
    const caret = start + emoji.length
    setComposeDraft(nextText)
    setEmojiPickerOpen(false)
    setEmojiMatch(null)
    requestAnimationFrame(() => {
      const input = composerInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(caret, caret)
    })
  }

  function applyFormatting(format: ComposerFormat) {
    const input = composerInputRef.current
    const start = input?.selectionStart ?? composeText.length
    const end = input?.selectionEnd ?? composeText.length
    const result = formatComposerText(composeText, start, end, format)
    setComposeDraft(result.text)
    requestAnimationFrame(() => {
      const target = composerInputRef.current
      if (!target) return
      target.focus()
      target.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  async function acceptInvite(invite: Invite) {
    if (inviteBusyRoomID) return
    setInviteBusyRoomID(invite.roomId)
    try {
      const roomID = await AppService.AcceptInvite(invite.roomId)
      setSnapshot(await AppService.Snapshot())
      showRoom(roomID)
    } catch (inviteError) {
      setError(describeError(inviteError))
    } finally {
      setInviteBusyRoomID('')
    }
  }

  async function declineInvite(invite: Invite) {
    if (inviteBusyRoomID) return
    setInviteBusyRoomID(invite.roomId)
    try {
      await AppService.DeclineInvite(invite.roomId)
      setSnapshot((current) => current ? { ...current, invites: (current.invites ?? []).filter((candidate) => candidate.roomId !== invite.roomId) } : current)
    } catch (inviteError) {
      setError(describeError(inviteError))
    } finally {
      setInviteBusyRoomID('')
    }
  }

  async function openNewRoom(roomID: string) {
    setSnapshot(await AppService.Snapshot())
    setNewRoomMode(null)
    showRoom(roomID)
  }

  async function joinRoomByAddress(target: string) {
    await openNewRoom(await AppService.JoinRoom(target))
  }

  async function createGroupRoom(request: GroupRoomRequest) {
    await openNewRoom(await AppService.CreateGroupRoom(request))
  }
  return { ...app, snippetExpander, snippetOptions, snippetMatch, snippetMenuVisible, applyMention, useLanguageTutorDraft, useSuggestedReply, acceptAIResult, setComposeDraft, discardVolatileAIDraft, updateSnippets, applyEmojiSuggestion, toggleComposerEmojiPicker, insertPickedEmoji, applyFormatting, acceptInvite, declineInvite, openNewRoom, joinRoomByAddress, createGroupRoom }
}
