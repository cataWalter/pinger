import { useEffect, useMemo } from 'react'
import { Events } from '@wailsio/runtime'
import { mainTimelineMessages, summarizeThreads } from './threads'
import { AppService } from '../bindings/mychat/desktop'
import { applyLanguage } from './i18n'
import { useRoomDrafts } from './roomDrafts'
import { useRoomHistory } from './hooks/useRoomHistory'
import { EMPTY_CHAT_AGENTS, parseChatAgents, type ChatAgentCollection } from './aiPrompts'
import { languageName, resolveChatLearningLanguage, resolveChatTutorLanguage, resolveLanguageRoles } from './aiSettings'
import { matrixMXCMediaURL } from './ChatMediaRenderer'
import { localAIErrorMessage } from './localAIChats'
import { type AIStreamChunk, EMPTY_ROOMS, formatTypingStatus, newestOtherAvatar, preferenceBoolean, preferenceString, preferenceNumber, parseTimeSuggestionMinutes } from './appShared'
import type { useAuthFormState } from './useAuthFormState'

export function useTimelineHistory(app: ReturnType<typeof useAuthFormState>) {
  const { activeAccountID, aiStreamHandlersRef, composeDraftStore, composeTextRef, currentDisplayNameRef, currentUserIDRef, imageSendRun, localAIChatId, localAIChatList, localAINewChatAgentId, messages, messagesRef, nativeNotificationsRef, openThread, pendingSearchJumpRef, preferencesRef, roomMembers, roomSwitchRef, roomsRef, selectedRoomID, selectedRoomRef, setError, setLocalAIChatId, setLocalAIFolderDeleteArmedID, setLocalAIFolderDraft, setLocalAIFolderFilter, setLocalAINewChatKind, setLocalAIRenameDraft, setMessages, snapshot, stickToBottomRef, timelineHeightBeforePrepend, timelineListRef, timelineRef, typingUsers, unreadMarker, workspaceGenerationRef } = app
  const {
    loadingHistory,
    setLoadingHistory,
    historyRevision,
    setHistoryRevision,
    setHistoryPageRevision,
    historyRoomIDRef,
    pendingHistoryRefreshRoomIDRef,
    olderCursor,
    setOlderCursor,
    hasOlder,
    setHasOlder,
    hasOlderRef,
    loadingOlder,
    setLoadingOlder,
    loadingOlderRef,
    loadOlderMessages,
  } = useRoomHistory({
    selectedRoomID,
    activeAccountID,
    selectedRoomRef,
    workspaceGenerationRef,
    messages,
    setMessages,
    setError,
    pendingSearchJumpRef,
    timelineRef,
    timelineListRef,
    timelineHeightBeforePrepend,
    roomSwitchRef,
    stickToBottomRef,
  })

  useEffect(() => {
    let active = true
    void AppService.NativeNotificationsSupported()
      .then((supported) => {
        if (active) nativeNotificationsRef.current = supported
      })
      .catch(() => { })
    return () => { active = false }
  }, [nativeNotificationsRef])

  const preferences = useMemo(() => snapshot?.preferences ?? {}, [snapshot?.preferences])
  const languagePreference = preferenceString(preferences, 'general.language', 'system')
  useEffect(() => {
    void applyLanguage(languagePreference)
  }, [languagePreference])
  const roomDrafts = useRoomDrafts(activeAccountID, preferenceBoolean(preferences, 'composer.keep_drafts', true))
  const chatTutorLanguage = resolveChatTutorLanguage(preferences, selectedRoomID)
  const chatLearningLanguage = resolveChatLearningLanguage(preferences, selectedRoomID)
  const languageRoles = resolveLanguageRoles(preferences)
  const translateRecentLabel = `Translate messages received since your last message to ${languageName(chatTutorLanguage, languageRoles.languages)}`
  const rooms = snapshot?.rooms ?? EMPTY_ROOMS
  const roomsByID = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms])
  const selectedRoom = roomsByID.get(selectedRoomID)
  const currentUserID = snapshot?.profile.userId ?? ''
  const selectedRoomAvatar = useMemo(() => selectedRoom?.avatar || (
    historyRoomIDRef.current === selectedRoomID
      ? newestOtherAvatar(messages, currentUserID)
      : ''
  ), [currentUserID, historyRoomIDRef, messages, selectedRoom?.avatar, selectedRoomID])
  const selectedRoomAvatarSource = useMemo(() => matrixMXCMediaURL(selectedRoomAvatar), [selectedRoomAvatar])
  const typingStatus = formatTypingStatus(typingUsers, roomMembers, messages, selectedRoom?.direct ? selectedRoom.name : '')
  const imageEngineReady = preferenceString(preferences, 'ai.image.binary_path', '') !== '' && preferenceString(preferences, 'ai.image.model_path', '') !== ''
  const imageRunHere = imageSendRun !== null && imageSendRun.roomID === selectedRoomID ? imageSendRun : null
  const imageRunStatus = imageRunHere?.stage === 'generating' ? `Generating image · step ${imageRunHere.step} of ${imageRunHere.totalSteps}` : 'Starting image engine…'
  const imageButtonTooltip = imageRunHere ? 'Stop image generation' : imageEngineReady ? 'Generate an image from the draft to review before sending' : 'Generate an image from the draft · set up the image engine in Settings > AI first'
  const roomAgentsPreferenceKey = selectedRoom ? `room.ai_agents.${selectedRoom.id}` : ''
  const roomAgents = useMemo<ChatAgentCollection>(() => parseChatAgents(preferenceString(preferences, roomAgentsPreferenceKey, JSON.stringify(EMPTY_CHAT_AGENTS))), [preferences, roomAgentsPreferenceKey])
  const roomChatGoalKey = selectedRoom ? `room.chat_goal.${selectedRoom.id}` : ''
  const roomChatGoal = preferenceString(preferences, roomChatGoalKey, '')
  const localAIAgents = useMemo<ChatAgentCollection>(() => parseChatAgents(preferenceString(preferences, 'ai.local_agents', JSON.stringify(EMPTY_CHAT_AGENTS))), [preferences])
  const localAIActiveChat = localAIChatList.chats.find((chat) => chat.id === localAIChatId) ?? null
  const localAIAgentCandidate = localAIActiveChat ? localAIActiveChat.agentId : localAINewChatAgentId
  const localAIAgentId = localAIAgents.agents.some((agent) => agent.id === localAIAgentCandidate) ? localAIAgentCandidate : ''

  async function renameLocalAIChat(chatID: string, title: string) {
    await AppService.RenameLocalAIChat(chatID, title)
    localAIChatList.reload()
  }

  async function saveLocalAIRename(draft: string) {
    setLocalAIRenameDraft(null)
    const title = draft.trim()
    if (!localAIChatId || !title || title === localAIActiveChat?.title) return
    try {
      await renameLocalAIChat(localAIChatId, title)
    } catch (renameError) {
      setError(localAIErrorMessage(renameError, 'The chat could not be renamed.'))
    }
  }

  async function deleteLocalAIChat(chatID: string) {
    await AppService.DeleteLocalAIChat(chatID)
    if (chatID === localAIChatId) {
      setLocalAIChatId(null)
      setLocalAINewChatKind('chat')
    }
    localAIChatList.reload()
  }

  // An empty folderID creates a folder, and the new folder becomes the active filter.
  async function saveLocalAIFolderDraft(folderID: string, draftName: string) {
    setLocalAIFolderDraft(null)
    const name = draftName.trim()
    if (!name || (folderID && name === localAIChatList.folders.find((folder) => folder.id === folderID)?.name)) return
    try {
      if (folderID) {
        await AppService.RenameLocalAIChatFolder(folderID, name)
      } else {
        const folder = await AppService.CreateLocalAIChatFolder(name)
        setLocalAIFolderFilter(folder.id)
      }
      localAIChatList.reload()
    } catch (folderError) {
      setError(localAIErrorMessage(folderError, 'The folder could not be saved.'))
    }
  }

  // Chats in a deleted folder stay saved and become unfiled.
  async function deleteLocalAIFolder(folderID: string) {
    setLocalAIFolderDeleteArmedID('')
    try {
      await AppService.DeleteLocalAIChatFolder(folderID)
      setLocalAIFolderFilter((current) => current === folderID ? null : current)
      localAIChatList.reload()
    } catch (folderError) {
      setError(localAIErrorMessage(folderError, 'The folder could not be deleted.'))
    }
  }

  async function moveLocalAIChatToFolder(chatID: string, folderID: string) {
    try {
      await AppService.SetLocalAIChatFolder(chatID, folderID)
      localAIChatList.reload()
    } catch (moveError) {
      setError(localAIErrorMessage(moveError, 'The chat could not be moved.'))
    }
  }

  async function reorderLocalAIFolders(folderIDs: string[]) {
    if (folderIDs.length < 2) return
    try {
      await AppService.ReorderLocalAIChatFolders(folderIDs)
      localAIChatList.reload()
    } catch (reorderError) {
      setError(localAIErrorMessage(reorderError, 'The folders could not be reordered.'))
    }
  }

  const appZoom = preferenceNumber(preferences, 'appearance.zoom', 100, 75, 125)
  const scheduleTimeSuggestions = parseTimeSuggestionMinutes(preferenceString(preferences, 'schedule.suggestions_minutes', '5,15,60'))
  const answeredShortcut = preferenceString(preferences, 'shortcuts.mark_answered', 'E').trim().toUpperCase() || 'E'
  const singleKeyShortcuts = preferenceBoolean(preferences, 'shortcuts.single_keys', true)
  const hideDeletedMessages = preferenceBoolean(preferences, 'appearance.hide_deleted_messages')
  const automaticArchiveEnabled = preferenceBoolean(preferences, 'archive.automatic')
  const timelineMessages = useMemo(() => mainTimelineMessages(messages), [messages])
  const threadSummaries = useMemo(() => summarizeThreads(messages), [messages])
  const visibleMessages = useMemo(() => hideDeletedMessages ? timelineMessages.filter((message) => !message.redacted) : timelineMessages, [timelineMessages, hideDeletedMessages])
  const activeThread = openThread?.roomID === selectedRoomID ? openThread : null
  const activeUnreadMarker = unreadMarker?.scope === `${activeAccountID}:${selectedRoomID}` ? unreadMarker : null
  const unreadMarkerID = activeUnreadMarker?.messageID ?? ''
  const unreadMarkerSeen = activeUnreadMarker?.seen ?? false
  preferencesRef.current = preferences
  roomsRef.current = rooms
  messagesRef.current = messages
  composeTextRef.current = composeDraftStore.getText()
  currentUserIDRef.current = snapshot?.profile.userId ?? ''
  currentDisplayNameRef.current = snapshot?.profile.displayName ?? ''

  useEffect(() => Events.On('ai:stream', (event: { data: unknown }) => {
    const chunk = event.data as AIStreamChunk | undefined
    if (!chunk?.requestId) return
    aiStreamHandlersRef.current.get(chunk.requestId)?.(chunk)
  }), [aiStreamHandlersRef])
  return { ...app, loadingHistory, setLoadingHistory, historyRevision, setHistoryRevision, setHistoryPageRevision, historyRoomIDRef, pendingHistoryRefreshRoomIDRef, olderCursor, setOlderCursor, hasOlder, setHasOlder, hasOlderRef, loadingOlder, setLoadingOlder, loadingOlderRef, loadOlderMessages, preferences, languagePreference, roomDrafts, chatTutorLanguage, chatLearningLanguage, languageRoles, translateRecentLabel, rooms, roomsByID, selectedRoom, selectedRoomAvatar, selectedRoomAvatarSource, typingStatus, imageEngineReady, imageRunHere, imageRunStatus, imageButtonTooltip, roomAgentsPreferenceKey, roomAgents, roomChatGoalKey, roomChatGoal, localAIAgents, localAIActiveChat, localAIAgentCandidate, localAIAgentId, saveLocalAIRename, renameLocalAIChat, deleteLocalAIChat, saveLocalAIFolderDraft, deleteLocalAIFolder, moveLocalAIChatToFolder, reorderLocalAIFolders, appZoom, scheduleTimeSuggestions, answeredShortcut, singleKeyShortcuts, hideDeletedMessages, automaticArchiveEnabled, timelineMessages, threadSummaries, visibleMessages, activeThread, activeUnreadMarker, unreadMarkerID, unreadMarkerSeen }
}
