import { AppService } from '../bindings/mychat/desktop'
import { type Invite, type Member } from '../bindings/mychat/desktop/models.js'
import { formatComposerText, insertEmoji, type ComposerFormat } from './composerText'
import { saveSnippets, type Snippet } from './snippets'
import { useSnippetExpander } from './useSnippetExpander'
import { describeError } from './appShared'
import { getVolatileAIDraft, updateVolatileAIDraft } from './volatileAIDrafts'
import type { useMessageAIActions } from './useMessageAIActions'

export function useComposerSnippets(app: ReturnType<typeof useMessageAIActions>) {
  const { activeAccountID, aiPanel, closeLanguageTutor, composeDraftStore, composeTextRef, composerEmojiSelectionRef, composerInputRef, editTarget, emojiMatch, emojiOptions, focusTimelineMessage, handleMessageDoubleClick, handleTimelineAudioEnded, inviteBusyRoomID, languageTutorState, mentionEnd, mentionOptions, mentionStart, openMessageContextMenu, openThreadPanel, removeReaction, roomDrafts, selectedRoomID, selectedRoomRef, sendReaction, setAIPanel, setComposeText, setEditTarget, setEmojiMatch, setEmojiPickerOpen, setError, setInviteBusyRoomID, setMentionBindings, setMentionQuery, setMentionStart, setReplyTarget, setSnapshot, setSnippets, setSuggestedReplies, setVolatileAIDrafts, showRoom, snippets, startDirectChat, startReaction, timelineMessageActionsRef, updateEmojiQuery, updateMentionQuery, volatileAIDrafts } = app

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

  timelineMessageActionsRef.current = {
    onDoubleClick: handleMessageDoubleClick,
    onOpenContextMenu: openMessageContextMenu,
    onReply: (message) => {
      setEditTarget(null)
      setReplyTarget(message)
      requestAnimationFrame(() => composerInputRef.current?.focus())
    },
    onReact: startReaction,
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
    getValue: () => composeDraftStore.getText(),
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
    const currentText = composeDraftStore.getText()
    const token = `@${member.displayName || member.id}`
    const suffix = currentText.slice(mentionEnd)
    const separator = suffix.startsWith(' ') ? '' : ' '
    const nextText = currentText.slice(0, mentionStart) + token + separator + suffix
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

  function useLanguageTutorDraft(text: string) {
    const draft = text.trim()
    if (languageTutorState?.mode !== 'draft' || !draft || editTarget) return
    if (languageTutorState.accountID !== activeAccountID || languageTutorState.roomID !== selectedRoomRef.current) {
      closeLanguageTutor()
      return
    }
    setComposeDraft(draft)
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
    const currentText = composeDraftStore.getText()
    const { text, caret } = insertEmoji(currentText, emojiMatch.start, emojiMatch.end, emoji)
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
    const currentText = composeDraftStore.getText()
    const start = input?.selectionStart ?? currentText.length
    const end = input?.selectionEnd ?? currentText.length
    const result = formatComposerText(currentText, start, end, format)
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

  return { ...app, snippetExpander, snippetOptions, snippetMatch, snippetMenuVisible, applyMention, useLanguageTutorDraft, useSuggestedReply, acceptAIResult, setComposeDraft, updateSnippets, applyEmojiSuggestion, toggleComposerEmojiPicker, insertPickedEmoji, applyFormatting, acceptInvite, declineInvite }
}
