import { useRef, type FormEvent } from 'react'
import { ArrowUpRight, BellRing, Clock3, CircleDot, Copy, MessagesSquare, Pencil, Reply, RotateCcw, Languages, Smile, Sparkles, Star, Trash2, ListChecks } from 'lucide-react'
import { AppService, LanguageTutorService } from '../bindings/mychat/desktop'
import { type Message, type TutorAnalysis } from '../bindings/mychat/desktop/models.js'
import { activeLocale } from './i18n'
import { MAX_AGENT_COLLECTION_LENGTH, MAX_AGENT_INSTRUCTIONS_LENGTH, MAX_AGENT_NAME_LENGTH, MAX_CHAT_AGENTS, buildExplainPrompt, buildReplyPrompt, serializeChatAgents, type ChatAgentCollection, type ChatAgentProfile } from './aiPrompts'
import { AI_ACTION_SHORTCUTS, languageName, resolveChatLearningLanguage, resolveChatTutorLanguage, resolveLanguageRoles } from './aiSettings'
import { type MessageMenuItem, describeError, displayMessageBody, preferenceBoolean, mergeTimelineMessages, timelineMessageID, incomingSinceOwnMessage } from './appShared'
import { deleteVolatileAIDraft, getVolatileAIDraft } from './volatileAIDrafts'
import type { useMenuActions } from './useMenuActions'

export function useMessageAIActions(app: ReturnType<typeof useMenuActions>) {
  const { agentEditor, aiEnabled, aiInstructions, analyzeWithLanguageTutor, cancelAIRequest, chatTranslationAIRequestRef, chatTranslationRequestRef, copyMessage, hasAIConversationContext, hasOlder, loadingOlderRef, markRoomUnread, messages, newAIRequestID, olderCursor, openMessageForward, openReminder, openThreadPanel, preferences, preferencesRef, promptMessages, retryMessage, roomAgents, roomAgentsPreferenceKey, roomChatGoal, roomChatGoalKey, rooms, runAIRequest, selectedRoomID, selectedRoomRef, setAgentEditor, setAgentSettingsError, setChatTranslation, setComposeText, setEditTarget, setHasOlder, setLoadingOlder, setMentionBindings, setMentionStart, setMessages, setOlderCursor, setPreference, setRedactTarget, setReplyTarget, snapshot, startReaction, suggestRepliesForRoom, timelineHeightBeforePrepend, timelineRef, workspaceGenerationRef } = app
  const { activeAccountID, setVolatileAIDrafts, volatileAIDrafts } = app

  async function translateRecentMessages() {
    if (!selectedRoomID || !aiEnabled || (!hasAIConversationContext && !hasOlder)) return
    const roomID = selectedRoomID
    const generation = workspaceGenerationRef.current
    const requestID = chatTranslationRequestRef.current + 1
    chatTranslationRequestRef.current = requestID
    const currentUserID = snapshot?.profile.userId ?? ''
    const learningLanguage = resolveChatLearningLanguage(preferencesRef.current, roomID)
    const explanation = resolveChatTutorLanguage(preferencesRef.current, roomID)
    const targetLanguage = languageName(explanation, resolveLanguageRoles(preferencesRef.current).languages)
    let allMessages = [...messages]
    let cursor = olderCursor
    let moreHistory = hasOlder
    const sinceOwnMessage = () => incomingSinceOwnMessage(allMessages, currentUserID)
    setChatTranslation({
      requestID,
      roomID,
      targetLanguage,
      targetMessageIDs: [],
      analyses: {},
      busy: true,
      status: sinceOwnMessage().foundOwnMessage || !moreHistory ? 'Preparing translations…' : 'Loading older messages to find your last message…',
      error: '',
    })
    let pagingHistory = false
    let fetchedHistory = false

    try {
      if (!sinceOwnMessage().foundOwnMessage && moreHistory) {
        if (loadingOlderRef.current) throw new Error('Wait for older messages to finish loading.')
        pagingHistory = true
        loadingOlderRef.current = true
        setLoadingOlder(true)
      }
      while (!sinceOwnMessage().foundOwnMessage && moreHistory) {
        if (chatTranslationRequestRef.current !== requestID || selectedRoomRef.current !== roomID) return
        const page = await AppService.History(roomID, cursor)
        if (chatTranslationRequestRef.current !== requestID || selectedRoomRef.current !== roomID) return
        if (page.before === cursor && page.hasMore) throw new Error('Could not continue loading the rest of this chat history.')
        allMessages = mergeTimelineMessages(allMessages, page.messages ?? [])
        cursor = page.before
        moreHistory = page.hasMore
        fetchedHistory = true
      }

      if (chatTranslationRequestRef.current !== requestID || selectedRoomRef.current !== roomID) return
      if (fetchedHistory) {
        if (allMessages.length > messages.length) {
          timelineHeightBeforePrepend.current = timelineRef.current?.scrollHeight ?? null
          setMessages((current) => mergeTimelineMessages(current, allMessages))
        }
        setOlderCursor(cursor)
        setHasOlder(moreHistory && cursor !== olderCursor)
      }

      const targetMessages = sinceOwnMessage().incoming
      if (targetMessages.length === 0) throw new Error('There are no incoming text messages since your last message in this chat.')
      const targetMessageIDs = targetMessages.map(timelineMessageID)
      setChatTranslation((current) => current?.requestID === requestID
        ? { ...current, targetMessageIDs, status: 'Translating 0%…' }
        : current)

      for (const [index, message] of targetMessages.entries()) {
        if (chatTranslationRequestRef.current !== requestID || selectedRoomRef.current !== roomID) return
        const analysisRequestID = newAIRequestID()
        setChatTranslation((current) => current?.requestID === requestID
          ? { ...current, status: `Translating ${Math.round(index * 100 / targetMessages.length)}%…` }
          : current)
        chatTranslationAIRequestRef.current = analysisRequestID
        let analysis: TutorAnalysis
        try {
          analysis = await LanguageTutorService.Analyze(message.body, 'message', learningLanguage, explanation, analysisRequestID)
        } finally {
          if (chatTranslationAIRequestRef.current === analysisRequestID) chatTranslationAIRequestRef.current = ''
        }
        if (chatTranslationRequestRef.current !== requestID || selectedRoomRef.current !== roomID) return
        if (!analysis.translation.trim()) throw new Error('Language Tutor returned an empty translation.')
        const messageID = timelineMessageID(message)
        setChatTranslation((current) => current?.requestID === requestID
          ? { ...current, analyses: { ...current.analyses, [messageID]: analysis }, status: `Translated ${Math.round((index + 1) * 100 / targetMessages.length)}%…` }
          : current)
      }

      if (chatTranslationRequestRef.current === requestID) {
        setChatTranslation((current) => current?.requestID === requestID ? { ...current, busy: false, status: '' } : current)
      }
    } catch (translationError) {
      if (chatTranslationRequestRef.current === requestID) {
        setChatTranslation((current) => current?.requestID === requestID ? { ...current, busy: false, error: describeError(translationError), status: '' } : current)
      }
    } finally {
      if (pagingHistory && workspaceGenerationRef.current === generation) {
        loadingOlderRef.current = false
        setLoadingOlder(false)
      }
    }
  }

  function clearChatTranslation() {
    chatTranslationRequestRef.current++
    cancelAIRequest(chatTranslationAIRequestRef.current)
    chatTranslationAIRequestRef.current = ''
    setChatTranslation(null)
  }

  function draftAIReply(message: Message) {
    let targetIndex = messages.indexOf(message)
    if (targetIndex < 0 && message.id) targetIndex = messages.findIndex((candidate) => candidate.id === message.id)
    if (targetIndex < 0 && message.transactionId) targetIndex = messages.findIndex((candidate) => candidate.transactionId === message.transactionId)
    const context = targetIndex < 0 ? [] : messages.slice(Math.max(0, targetIndex - 8), targetIndex)
    void runAIRequest('Draft reply', buildReplyPrompt(promptMessages([message])[0], promptMessages(context), aiInstructions('draft_reply'), roomChatGoal), 'draft_reply', { kind: 'reply', target: message })
  }

  function explainMessage(message: Message) {
    void runAIRequest('Explain message', buildExplainPrompt(promptMessages([message])[0], aiInstructions('explain')), 'explain')
  }

  function editMessage(message: Message) {
    if (getVolatileAIDraft(volatileAIDrafts, activeAccountID, selectedRoomID)) {
      setVolatileAIDrafts((current) => deleteVolatileAIDraft(current, activeAccountID, selectedRoomID))
    }
    setReplyTarget(null)
    setEditTarget(message)
    setComposeText(message.body)
    setMentionBindings([])
    setMentionStart(-1)
  }

  // The same eligibility rules the old inline action bar used, expressed once
  // so the menu can't drift from what the backend allows.
  function messageContextMenuItems(message: Message): MessageMenuItem[] {
    const unsent = !message.id || message.id.startsWith('~')
    const manageable = !unsent && !message.redacted
    const hasMedia = Boolean(message.mediaUri || message.mediaType || message.mediaMime)
    const body = displayMessageBody(message).trim()
    const bookmarkKey = `message.bookmark.${encodeURIComponent(selectedRoomID)}.${encodeURIComponent(message.id)}`
    const bookmarked = preferenceBoolean(preferences, bookmarkKey)
    const room = rooms.find((candidate) => candidate.id === selectedRoomID)
    const canMarkUnread = Boolean(room && room.unread === 0 && !room.markedUnread)
    const canForward = rooms.some((candidate) => candidate.id !== selectedRoomID)
    const receivedAt = message.timestamp > 0
      ? new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(message.timestamp))
      : 'unknown time'
    const items: MessageMenuItem[] = [
      { key: 'reply', label: 'Reply', ariaLabel: `Reply to ${message.senderName || message.sender}`, icon: <Reply size={14} />, disabled: unsent, run: () => { setEditTarget(null); setReplyTarget(message) } },
      { key: 'thread', label: 'Reply in thread', ariaLabel: 'Reply in thread', icon: <MessagesSquare size={14} />, disabled: !manageable, run: () => openThreadPanel(message.threadRootId || message.id) },
      { key: 'react', label: 'React', ariaLabel: 'Add reaction', icon: <Smile size={14} />, disabled: unsent, run: () => startReaction(message) },
      { key: 'bookmark', label: bookmarked ? 'Remove bookmark' : 'Bookmark', ariaLabel: bookmarked ? 'Remove message bookmark' : 'Bookmark message', icon: <Star size={14} fill={bookmarked ? 'currentColor' : 'none'} />, disabled: !manageable, run: () => void setPreference(bookmarkKey, !bookmarked) },
      { key: 'mark-unread', label: 'Mark as unread', ariaLabel: 'Mark room as unread', icon: <CircleDot size={14} />, disabled: !canMarkUnread, run: () => void markRoomUnread(selectedRoomID) },
      { key: 'copy', label: 'Copy message', ariaLabel: 'Copy message', icon: <Copy size={14} />, disabled: !body, separatorBefore: true, run: () => void copyMessage(message) },
      { key: 'copy-timestamp', label: 'Copy with timestamp', ariaLabel: 'Copy message with timestamp', icon: <Clock3 size={14} />, disabled: !body, run: () => void copyMessage(message, true) },
      { key: 'forward', label: 'Forward...', ariaLabel: 'Forward message', icon: <ArrowUpRight size={14} />, disabled: !manageable || !body || hasMedia || !canForward, run: () => openMessageForward(message) },
      { key: 'received-at', label: `Received at ${receivedAt}`, ariaLabel: `Received at ${receivedAt}`, icon: <Clock3 size={14} />, meta: true, separatorBefore: true, run: () => { } },
      { key: 'remind', label: 'Set reminder', ariaLabel: 'Set reminder for message', icon: <BellRing size={14} />, disabled: !manageable, separatorBefore: true, run: () => openReminder(message) },
      { key: 'language-tutor', label: 'Analyze with Language Tutor', ariaLabel: 'Analyze message with Language Tutor', icon: <Languages size={14} />, disabled: !aiEnabled || !body || Boolean(message.redacted), separatorBefore: true, run: () => void analyzeWithLanguageTutor(body, 'message') },
      { key: 'ai-reply', label: 'Draft reply with AI', ariaLabel: 'Draft reply with AI', primaryShiftKey: AI_ACTION_SHORTCUTS.draftReply.key, icon: <Reply size={14} />, disabled: !aiEnabled || !manageable || !message.body, run: () => draftAIReply(message) },
      { key: 'ai-suggest-replies', label: 'Suggest replies with AI', ariaLabel: 'Suggest ten replies with AI', primaryShiftKey: AI_ACTION_SHORTCUTS.suggestReplies.key, icon: <ListChecks size={14} />, disabled: !aiEnabled || !manageable || !message.body, run: () => void suggestRepliesForRoom(selectedRoomID) },
      { key: 'ai-explain', label: 'Explain message', ariaLabel: 'Explain message with AI', primaryShiftKey: AI_ACTION_SHORTCUTS.explainMessage.key, icon: <Sparkles size={14} />, disabled: !aiEnabled || !manageable || !message.body, run: () => explainMessage(message) },
    ]
    if (message.own && manageable) {
      if (!hasMedia) {
        items.push({ key: 'edit', label: 'Edit', ariaLabel: 'Edit message', icon: <Pencil size={13} />, run: () => editMessage(message) })
      }
      items.push({ key: 'delete', label: 'Delete', ariaLabel: 'Delete message', danger: true, icon: <Trash2 size={13} />, run: () => setRedactTarget(message) })
    }
    if (message.sendError && message.sendError !== 'not sent' && message.transactionId) {
      items.push({ key: 'retry', label: 'Retry sending', ariaLabel: 'Retry sending message', icon: <RotateCcw size={13} />, run: () => void retryMessage(message) })
    }
    return items
  }

  async function persistRoomAgents(collection: ChatAgentCollection) {
    if (!roomAgentsPreferenceKey) return false
    const serialized = serializeChatAgents(collection)
    if (new TextEncoder().encode(serialized).byteLength > MAX_AGENT_COLLECTION_LENGTH) {
      setAgentSettingsError('The chat agent settings are too large to save.')
      return false
    }
    setAgentSettingsError('')
    const saved = await setPreference(roomAgentsPreferenceKey, serialized)
    if (!saved) setAgentSettingsError('Could not save chat agent settings.')
    return saved
  }

  async function saveAgentProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!agentEditor) return
    const name = agentEditor.name.trim()
    const instructions = agentEditor.instructions.trim()
    if (!name || Array.from(name).length > MAX_AGENT_NAME_LENGTH) {
      setAgentSettingsError(`Agent names must be 1–${MAX_AGENT_NAME_LENGTH} characters.`)
      return
    }
    if (!instructions || Array.from(instructions).length > MAX_AGENT_INSTRUCTIONS_LENGTH) {
      setAgentSettingsError(`Instructions must be 1–${MAX_AGENT_INSTRUCTIONS_LENGTH} characters.`)
      return
    }
    const exists = roomAgents.agents.some((agent) => agent.id === agentEditor.id)
    if (!exists && roomAgents.agents.length >= MAX_CHAT_AGENTS) {
      setAgentSettingsError(`A chat can have up to ${MAX_CHAT_AGENTS} agents.`)
      return
    }
    const profile = { ...agentEditor, name, instructions }
    const agents = exists
      ? roomAgents.agents.map((agent) => agent.id === profile.id ? profile : agent)
      : [...roomAgents.agents, profile]
    if (await persistRoomAgents({ ...roomAgents, agents })) setAgentEditor(null)
  }

  async function deleteAgentProfile(profile: ChatAgentProfile) {
    const agents = roomAgents.agents.filter((agent) => agent.id !== profile.id)
    await persistRoomAgents({ agents, defaultAgentId: roomAgents.defaultAgentId === profile.id ? '' : roomAgents.defaultAgentId })
  }

  const chatGoalRequestRef = useRef('')

  // inferChatGoal asks Local AI to describe the chat's long-term goal from its latest messages. The caller shows the result for review before saving it.
  async function inferChatGoal() {
    if (!selectedRoomID) throw new Error('Choose a chat first.')
    cancelAIRequest(chatGoalRequestRef.current)
    const requestID = newAIRequestID()
    chatGoalRequestRef.current = requestID
    try {
      return await AppService.AIInferChatGoal(selectedRoomID, requestID)
    } finally {
      if (chatGoalRequestRef.current === requestID) chatGoalRequestRef.current = ''
    }
  }

  // saveChatGoal stores the goal for the selected chat. An empty goal clears it.
  async function saveChatGoal(goal: string) {
    if (!roomChatGoalKey) return false
    return setPreference(roomChatGoalKey, goal.trim())
  }

  function createAgentProfile() {
    const id = globalThis.crypto?.randomUUID?.() ?? `agent-${Date.now()}`
    setAgentSettingsError('')
    setAgentEditor({ id, name: '', instructions: '' })
  }
  return { ...app, messageContextMenuItems, translateRecentMessages, clearChatTranslation, draftAIReply, explainMessage, persistRoomAgents, saveAgentProfile, deleteAgentProfile, createAgentProfile, inferChatGoal, saveChatGoal }
}
