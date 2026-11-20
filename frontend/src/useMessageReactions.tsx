import { useEffect, type ClipboardEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type MenuState, type Message } from '../bindings/mychat/desktop/models.js'
import { emojiQueryAt, suggestEmoji } from './composerText'
import { isLocalAIRoomID, localAIIncludeInAllPreference } from './localAIChats'
import { describeError, preferenceBoolean, preferenceString, isUnansweredRoom, isNeedsReplyRoom, isUnreadRoom } from './appShared'
import { textAIConfigured } from './aiProvider'
import type { useComposerActions } from './useComposerActions'

export function useMessageReactions(app: ReturnType<typeof useComposerActions>) {
  const { archivedPreferenceKey, busy, composeText, editTarget, emojiMatch, localAIChatId, localAIChatOpen, needsReplyCount, pendingReactionsRef, preferences, preferencesRef, reactionErrorRef, redactTarget, roomRefinements, roomScope, selectedRoom, selectedRoomID, setBusy, setEditTarget, setEmojiActiveIndex, setEmojiMatch, setError, setHistoryRevision, setMentionActiveIndex, setMentionEnd, setMentionQuery, setMentionStart, setReactingMessageID, setRedactTarget, setReplyTarget, setRoomInfoOpen, setRoomRefinements, setRoomScope, setSnapshot, showRoom, stageAttachmentFiles, startingDirectChatRef } = app

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'))
    const image = imageItem?.getAsFile()
    if (!image) return
    event.preventDefault()
    // Clipboard files can lose their bytes once the paste event ends, so read them now.
    const bytesRead = image.arrayBuffer()
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1]?.split('+')[0] || 'png'
    const name = image.name || `pasted-image-${Date.now()}.${extension}`
    void bytesRead
      .then((buffer) => {
        if (buffer.byteLength === 0) throw new Error('The pasted image could not be read. Copy it again or attach it with the attach button.')
        stageAttachmentFiles([new File([buffer], name, { type: image.type })])
      })
      .catch((pasteError: unknown) => setError(describeError(pasteError)))
  }

  async function changeReaction(message: Message, emoji: string, remove: boolean) {
    if (!selectedRoomID || !message.id || message.id.startsWith('~')) return
    // Both directions share a key so a double click cannot send duplicate annotations.
    const key = `${selectedRoomID}\n${message.id}\n${emoji}`
    if (pendingReactionsRef.current.has(key)) return
    pendingReactionsRef.current.add(key)
    try {
      if (remove) await AppService.RemoveReaction(selectedRoomID, message.id, emoji)
      else await AppService.React(selectedRoomID, message.id, emoji)
      setHistoryRevision((revision) => revision + 1)
      const previous = reactionErrorRef.current
      if (previous) {
        reactionErrorRef.current = ''
        setError((current) => current === previous ? '' : current)
      }
    } catch (reactionError) {
      const description = describeError(reactionError)
      reactionErrorRef.current = description
      setError(description)
    } finally {
      pendingReactionsRef.current.delete(key)
    }
  }

  async function sendReaction(message: Message, emoji: string) {
    setReactingMessageID('')
    await changeReaction(message, emoji, false)
  }

  function startReaction(message: Message) {
    const preferences = preferencesRef.current
    if (preferenceBoolean(preferences, 'reactions.quick_enabled', true)) {
      setReactingMessageID(message.id || '')
      return
    }
    void sendReaction(message, preferenceString(preferences, 'reactions.default_emoji', '') || '👍')
  }

  function handleMessageDoubleClick(message: Message) {
    if (!message.id || message.id.startsWith('~') || message.redacted || message.sending) return
    switch (preferenceString(preferencesRef.current, 'messages.double_click', 'None')) {
      case 'Reply':
        setEditTarget(null)
        setReplyTarget(message)
        break
      case 'React':
        startReaction(message)
        break
    }
  }

  async function startDirectChat(message: Message) {
    if (!message.sender || startingDirectChatRef.current) return
    startingDirectChatRef.current = true
    try {
      const roomID = await AppService.StartDirectChat(message.sender)
      showRoom(roomID)
      setSnapshot(await AppService.Snapshot())
    } catch (directChatError) {
      setError(describeError(directChatError))
    } finally {
      startingDirectChatRef.current = false
    }
  }

  async function removeReaction(message: Message, emoji: string) {
    await changeReaction(message, emoji, true)
  }

  async function redactMessage() {
    if (!selectedRoomID || !redactTarget?.id) return
    setBusy(true)
    try {
      await AppService.RedactMessage(selectedRoomID, redactTarget.id)
      setRedactTarget(null)
      setHistoryRevision((revision) => revision + 1)
    } catch (redactError) {
      setError(describeError(redactError))
    } finally {
      setBusy(false)
    }
  }

  async function retryMessage(message: Message) {
    if (!message.transactionId) return
    try {
      await AppService.RetryMessage(message.transactionId)
      setHistoryRevision((revision) => revision + 1)
    } catch (retryError) {
      setError(describeError(retryError))
    }
  }

  function openRoomInfo() {
    if (selectedRoomID) setRoomInfoOpen(true)
  }

  const emojiOptions: Array<[string, string]> = emojiMatch && preferenceBoolean(preferences, 'emoji.autocomplete')
    && composeText.slice(emojiMatch.start, emojiMatch.end).toLowerCase() === `:${emojiMatch.query}`
    ? suggestEmoji(emojiMatch.query)
    : []

  function updateMentionQuery(value: string, cursor: number) {
    const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, cursor))
    if (!match) {
      setMentionStart(-1)
      setMentionQuery('')
      return
    }
    setMentionStart(cursor - match[0].length + match[1].length)
    setMentionEnd(cursor)
    setMentionQuery(match[2])
    setMentionActiveIndex(0)
  }

  function updateEmojiQuery(value: string, cursor: number) {
    setEmojiMatch(emojiQueryAt(value, cursor))
    setEmojiActiveIndex(0)
  }

  const aiEnabled = textAIConfigured(preferences)
  // Native menu state mirrors the selected room and filters; menu actions reuse the keyboard handlers.
  const menuRoom = selectedRoom && !isLocalAIRoomID(selectedRoom.id) ? selectedRoom : undefined
  const menuRoomSelected = Boolean(menuRoom)
  const menuRoomUnread = menuRoom ? isUnreadRoom(menuRoom) : false
  const menuRoomArchived = menuRoom ? preferenceBoolean(preferences, archivedPreferenceKey(menuRoom.id, menuRoom.accountId)) : false
  const menuRoomFavorite = Boolean(menuRoom?.favorite)
  const menuRoomUnanswered = menuRoom ? isUnansweredRoom(menuRoom) : false
  const menuRoomNeedsReply = menuRoom ? isNeedsReplyRoom(menuRoom) : false
  const menuPrivateChatOpen = localAIChatOpen && Boolean(localAIChatId)
  const menuPrivateChatInAll = localAIChatOpen && localAIChatId ? preferenceBoolean(preferences, localAIIncludeInAllPreference(localAIChatId)) : false
  const menuDraftReady = Boolean(selectedRoom) && composeText.trim() !== '' && !busy && aiEnabled && !editTarget
  const menuFilter = roomScope === 'archived' ? 'archived' : roomScope === 'local-ai' ? 'private' : roomRefinements.needsReply ? 'needs-reply' : roomRefinements.unanswered ? 'unanswered' : roomRefinements.favorite ? 'favorites' : 'all'
  useEffect(() => {
    const menuState: MenuState = {
      roomSelected: menuRoomSelected,
      roomUnread: menuRoomUnread,
      roomArchived: menuRoomArchived,
      roomFavorite: menuRoomFavorite,
      roomUnanswered: menuRoomUnanswered,
      roomNeedsReply: menuRoomNeedsReply,
      needsReplyCount,
      privateChatOpen: menuPrivateChatOpen,
      privateChatInAll: menuPrivateChatInAll,
      draftReady: menuDraftReady,
      filter: menuFilter,
    }
    void AppService.SetMenuState(menuState)
  }, [menuRoomSelected, menuRoomUnread, menuRoomArchived, menuRoomFavorite, menuRoomUnanswered, menuRoomNeedsReply, needsReplyCount, menuPrivateChatOpen, menuPrivateChatInAll, menuDraftReady, menuFilter])

  function applyMenuFilter(filter: string) {
    setRoomScope(filter === 'archived' ? 'archived' : filter === 'private' ? 'local-ai' : 'all')
    setRoomRefinements({
      unanswered: filter === 'unanswered',
      needsReply: filter === 'needs-reply',
      favorite: filter === 'favorites',
    })
  }

  function toggleRoomRefinement(refinement: 'unanswered' | 'needsReply') {
    setRoomRefinements((current) => ({
      unanswered: refinement === 'unanswered' ? !current.unanswered : false,
      needsReply: refinement === 'needsReply' ? !current.needsReply : false,
      favorite: false,
    }))
  }
  return { ...app, startReaction, handleMessageDoubleClick, handleComposerPaste, changeReaction, sendReaction, startDirectChat, removeReaction, redactMessage, retryMessage, openRoomInfo, emojiOptions, updateMentionQuery, updateEmojiQuery, aiEnabled, menuRoom, menuRoomSelected, menuRoomUnread, menuRoomArchived, menuRoomFavorite, menuRoomUnanswered, menuRoomNeedsReply, menuPrivateChatOpen, menuPrivateChatInAll, menuDraftReady, menuFilter, applyMenuFilter, toggleRoomRefinement }
}
