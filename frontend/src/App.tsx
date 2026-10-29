import { lazy, Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Events } from '@wailsio/runtime'
import { ArrowDown, ArrowLeft, ArrowUpRight, Archive, ArchiveRestore, Bold, ChevronDown, Bell, BellOff, BellRing, Check, Clock3, Code, CircleAlert, CircleDot, Copy, LockKeyhole, MessageCircleMore, Paperclip, Pencil, Reply, RotateCcw, ScrollText, Search, Settings, Send, ShieldCheck, Languages, Smile, Sparkles, Star, Trash2, UsersRound, X, Download, EyeOff, Folder, FolderPlus, GraduationCap, Heading1, Images, ImagePlus, Italic, Link, List, ListOrdered, Mic, Plus, Quote, Upload, Square, SquareCode, Strikethrough, Video } from 'lucide-react'
import { QuickSwitcher } from './QuickSwitcher'
import { ProfilePhotoViewer } from './ProfilePhotoViewer'
import { RoomInfoDialog } from './RoomInfoDialog'
import { SettingsProvider, useSettings } from './SettingsContext'
import EmojiPicker from 'emoji-picker-react'
import { AppService, LanguageTutorService } from '../bindings/mychat/desktop'
import { type AIMessage, type Member, type MenuState, type Message, type MessageSearchRequest, type MessageSearchResult, type Room, type ScheduledJob, type Snapshot, type TutorAnalysis } from '../bindings/mychat/desktop/models.js'
import { emojiQueryAt, formatComposerText, insertEmoji, parseCustomEmoticonReplacements, replaceEmoticons, replaceEmoticonsAtCursor, suggestEmoji, type ComposerFormat, type EmojiQuery } from './composerText'
import { DEFAULT_ACCENT_NAME, accentCssVariables, accentPaletteFor } from './accent'
import { SYSTEM_THEME_NAME, themeIdForPreference, themeModeForPreference } from './themes'
import { SETTINGS_TABS } from './settings'
import { SnippetPopover } from './SnippetPopover'
import { loadSnippets, saveSnippets, type Snippet } from './snippets'
import { useSnippetExpander } from './useSnippetExpander'
import { ConnectionStatusBanner } from './ConnectionStatusBanner'
import { useConnectionProblem } from './useConnectionProblem'
import { EMPTY_CHAT_AGENTS, MAX_AGENT_COLLECTION_LENGTH, MAX_AGENT_INSTRUCTIONS_LENGTH, MAX_AGENT_NAME_LENGTH, MAX_CHAT_AGENTS, buildExplainPrompt, buildReplyPrompt, buildSummaryChatDraft, parseChatAgents, serializeChatAgents, type ChatAgentCollection, type ChatAgentProfile, type PromptMessage, endsWithAssistantTurn } from './aiPrompts'
import { languageName, resolveAIFeatureTuning, resolveLanguageRoles, type AIFeatureID } from './aiSettings'
import { matrixMXCMediaURL } from './ChatMediaRenderer'
import { useMatrixBatch } from './useMatrixBatch'
import { DialogSurface } from './DialogSurface'
import LocalAIChat from './LocalAIChat'
import { isLocalAIRoomID, localAIChatIDFromRoomID, localAIChatToRoom, localAIErrorMessage, localAIFavoritePreference, localAIIncludeInAllPreference, localAIChatIcon, localAIRoomID, LOCAL_AI_FOLDER_NAME_CHARACTERS, LOCAL_AI_TITLE_CHARACTERS, type LocalAIChatKind, useLocalAIChatList } from './localAIChats'
import { type MatrixUpdate, type MatrixNotification, type PreferenceValues, type RoomScope, type RoomRefinements, type OutgoingMessage, type MessageMenuItem, type AIAcceptAction, type AIPanel, type AIStreamChunk, type AIStreamHandler, type LanguageTutorState, type ChatTranslationState, type ChatExportState, type ChatExportProgressEvent, type ScheduledDraft, type MediaGalleryFilter, hasGalleryMedia, mediaGalleryMessageKey, type TimelineMessageActions, type RoomButtonActions, IN_APP_NOTICE_TIMEOUT_MS, EMPTY_ROOMS, newestPersistentMessage, formatTypingStatus, newestOtherAvatar, describeError, chatExportStatusText, isTextEntryTarget, displayMessageBody, initials, Avatar, localDateTimeInputValue, preferenceBoolean, preferenceString, preferenceNumber, parseTimeSuggestionMinutes, reconcileRoomSnapshots, mergeTimelineMessages, timelineMessageID, incomingSinceOwnMessage, isDirectLikeRoom, isUnansweredRoom, isNeedsReplyRoom, isUnreadRoom, primaryModifierLabel, TimelineMessageList, roomActivityAt, compareRoomActivity, rankQuickSwitcherRooms, playNotificationSound, notificationAllowed, notificationTone, notificationText, detectOneTimeCode, type NotificationText, type CaptureKind, type RecordedUpload, type StagedAttachment, type MediaApprovalRequest, mediaKindForFile, mediaApprovalItemFromFile, maxVideoMessageMilliseconds, maxAttachmentBytes, preferredVideoMimeType, requestLocalAsset, encodeVoiceNoteWav, RoomButton, reportRoomListVisibleRange, VirtualRoomList, IconTooltip } from './appShared'

const SettingsDialog = lazy(() => import('./SettingsDialog').then((module) => ({ default: module.SettingsDialog })))
const AIResultDialogs = lazy(() => import('./AIResultDialogs').then((module) => ({ default: module.AIResultDialogs })))
const ScheduledJobsDialog = lazy(() => import('./ScheduledDialogs').then((module) => ({ default: module.ScheduledJobsDialog })))
const ScheduledDraftDialog = lazy(() => import('./ScheduledDialogs').then((module) => ({ default: module.ScheduledDraftDialog })))
const MediaApprovalDialog = lazy(() => import('./ConfirmDialogs').then((module) => ({ default: module.MediaApprovalDialog })))
const GeneratedImageDialog = lazy(() => import('./ConfirmDialogs').then((module) => ({ default: module.GeneratedImageDialog })))
const LeaveRoomDialog = lazy(() => import('./ConfirmDialogs').then((module) => ({ default: module.LeaveRoomDialog })))
const RedactDialog = lazy(() => import('./ConfirmDialogs').then((module) => ({ default: module.RedactDialog })))
const ForwardMessageDialog = lazy(() => import('./RoomDialogs').then((module) => ({ default: module.ForwardMessageDialog })))
const MediaGalleryDialog = lazy(() => import('./RoomDialogs').then((module) => ({ default: module.MediaGalleryDialog })))

function AppBody() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const connectionProblem = useConnectionProblem(snapshot?.connectionState === 'offline')
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const [selectedRoomID, setSelectedRoomID] = useState('')
  const [localAIChatOpen, setLocalAIChatOpen] = useState(false)
  const [localAIChatId, setLocalAIChatId] = useState<string | null>(null)
  const localAIInitialDraftVersion = useRef(0)
  const [localAIInitialDraft, setLocalAIInitialDraft] = useState({ version: 0, content: '' })
  const [localAINewChatAgentId, setLocalAINewChatAgentId] = useState('')
  const [localAINewChatKind, setLocalAINewChatKind] = useState<LocalAIChatKind>('chat')
  const localAIChatList = useLocalAIChatList(true)
  const [localAIRenameDraft, setLocalAIRenameDraft] = useState<string | null>(null)
  const [localAIDeleteArmedID, setLocalAIDeleteArmedID] = useState('')
  // null shows every AI chat, '' shows unfiled chats, and any other value is a folder ID.
  const [localAIFolderFilter, setLocalAIFolderFilter] = useState<string | null>(null)
  const [localAIFolderDraft, setLocalAIFolderDraft] = useState<{ folderID: string; name: string } | null>(null)
  const [localAIFolderDeleteArmedID, setLocalAIFolderDeleteArmedID] = useState('')
  const [mobilePane, setMobilePane] = useState<'rooms' | 'conversation'>('rooms')
  const [search, setSearch] = useState('')
  const [roomScope, setRoomScope] = useState<RoomScope>('all')
  const [roomRefinements, setRoomRefinements] = useState<RoomRefinements>({ unanswered: false, needsReply: false, favorite: false })
  const [inboxAccountScope, setInboxAccountScope] = useState('all')
  const [otherAccountRooms, setOtherAccountRooms] = useState<Room[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [olderCursor, setOlderCursor] = useState(0)
  const [hasOlder, setHasOlder] = useState(false)
  const hasOlderRef = useRef(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Scroll events fire far faster than state updates commit, so a scroll
  // handler calling loadOlderMessages() could start several fetches before
  // `loadingOlder` re-renders. This ref closes that window.
  const loadingOlderRef = useRef(false)
  // Loading older room history before a Local AI summary chat opens.
  const [summaryStatus, setSummaryStatus] = useState('')
  const summaryLoadingRef = useRef(false)
  const [composeText, setComposeText] = useState('')
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([])
  const [mediaApproval, setMediaApproval] = useState<MediaApprovalRequest | null>(null)
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets())
  const [mentionBindings, setMentionBindings] = useState<{ token: string; userID: string }[]>([])
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionEnd, setMentionEnd] = useState(0)
  const [mentionQuery, setMentionQuery] = useState('')
  const [emojiMatch, setEmojiMatch] = useState<EmojiQuery | null>(null)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [emojiActiveIndex, setEmojiActiveIndex] = useState(0)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [replyTarget, setReplyTarget] = useState<Message | null>(null)
  const [editTarget, setEditTarget] = useState<Message | null>(null)
  const [reactingMessageID, setReactingMessageID] = useState('')
  const [redactTarget, setRedactTarget] = useState<Message | null>(null)
  const [roomInfoOpen, setRoomInfoOpen] = useState(false)
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<{ source: string; label: string } | null>(null)
  const [mediaGalleryOpen, setMediaGalleryOpen] = useState(false)
  const [mediaGalleryFilter, setMediaGalleryFilter] = useState<MediaGalleryFilter>('all')
  const [mediaGalleryItems, setMediaGalleryItems] = useState<Message[]>([])
  const [mediaGalleryLoading, setMediaGalleryLoading] = useState(false)
  const [mediaGalleryScanned, setMediaGalleryScanned] = useState(0)
  const [mediaGalleryError, setMediaGalleryError] = useState('')
  const mediaGalleryRequestRef = useRef(0)
  const [agentEditor, setAgentEditor] = useState<ChatAgentProfile | null>(null)
  const [agentSettingsError, setAgentSettingsError] = useState('')
  const [roomMembers, setRoomMembers] = useState<Member[]>([])
  const [roomMembersLoading, setRoomMembersLoading] = useState(false)
  const [roomMembersError, setRoomMembersError] = useState('')
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [leaveRoomError, setLeaveRoomError] = useState('')
  const [leavingRoom, setLeavingRoom] = useState(false)
  const [chatExport, setChatExport] = useState<ChatExportState | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [messageSearch, setMessageSearch] = useState('')
  const [searchRoomID, setSearchRoomID] = useState('')
  const [searchSender, setSearchSender] = useState('')
  const [searchFrom, setSearchFrom] = useState('')
  const [searchTo, setSearchTo] = useState('')
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([])
  const [searchNextBatch, setSearchNextBatch] = useState('')
  const [searchStatus, setSearchStatus] = useState('')
  const [searching, setSearching] = useState(false)
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([])
  const [scheduledJobsOpen, setScheduledJobsOpen] = useState(false)
  const [scheduledDraft, setScheduledDraft] = useState<ScheduledDraft | null>(null)
  const [scheduledDueAt, setScheduledDueAt] = useState('')
  const [scheduledTimes, setScheduledTimes] = useState<Record<string, string>>({})
  const [scheduledLoading, setScheduledLoading] = useState(false)
  const [scheduledSaving, setScheduledSaving] = useState(false)
  const [scheduledBusyID, setScheduledBusyID] = useState('')
  const [scheduledJobsError, setScheduledJobsError] = useState('')
  const [scheduledDialogError, setScheduledDialogError] = useState('')
  const [scheduledNotice, setScheduledNotice] = useState('')
  const { settingsOpen, setSettingsOpen, settingsTab, setSettingsTab } = useSettings()
  const [accountManagerOpen, setAccountManagerOpen] = useState(false)
  const [addingAccount, setAddingAccount] = useState(false)
  const [accountHomeserver, setAccountHomeserver] = useState('https://matrix.org')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountError, setAccountError] = useState('')
  const [undoRoomID, setUndoRoomID] = useState('')
  const undoToastTimerRef = useRef<number | null>(null)
  const scheduledNoticeTimerRef = useRef<number | null>(null)
  const [roomContextMenu, setRoomContextMenu] = useState<{ roomID: string; x: number; y: number } | null>(null)
  const [selectedRoomIDs, setSelectedRoomIDs] = useState<string[]>([])
  // Replaces the always-visible per-message action bar: the actions only
  // surface as a floating menu when the user right-clicks a message.
  const [messageContextMenu, setMessageContextMenu] = useState<{ message: Message; x: number; y: number; targetBounds: { left: number; top: number; right: number; bottom: number } } | null>(null)
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null)
  const [forwardTargetRoomID, setForwardTargetRoomID] = useState('')
  const [forwardBusy, setForwardBusy] = useState(false)
  const [forwardError, setForwardError] = useState('')
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [quickSwitcherQuery, setQuickSwitcherQuery] = useState('')
  const [quickSwitcherIndex, setQuickSwitcherIndex] = useState(0)
  const [homeserver, setHomeserver] = useState('https://matrix.org')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoPlayNextMessageId, setAutoPlayNextMessageId] = useState<string | null>(null)
  const [voiceCaptureStatus, setVoiceCaptureStatus] = useState<'recording' | 'processing' | null>(null)
  const [captureKind, setCaptureKind] = useState<CaptureKind>('voice')
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string>(preferenceString(snapshot?.preferences ?? {}, 'audio.input_device', ''))
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [historyPageRevision, setHistoryPageRevision] = useState(0)
  const lastObservedHistoryRevisionRef = useRef(0)
  const [error, setError] = useState('')
  const selectedRoomRef = useRef('')
  const roomListRef = useRef<HTMLElement | null>(null)
  const historyRoomIDRef = useRef('')
  const pendingHistoryRefreshRoomIDRef = useRef('')
  const editTargetRef = useRef<Message | null>(null)
  const markRoomAnsweredRef = useRef<(roomID: string) => Promise<void>>(async () => { })
  const preferencesRef = useRef<PreferenceValues>({})
  const setPreferenceRef = useRef<(key: string, value: boolean | string) => Promise<boolean>>(async () => false)
  const automaticArchiveInFlightRef = useRef(false)
  const roomsRef = useRef<Room[]>([])
  const roomSelectionAnchorRef = useRef('')
  const messagesRef = useRef<Message[]>([])
  const composeTextRef = useRef('')
  const composerEmojiControlRef = useRef<HTMLDivElement>(null)
  const composerEmojiSelectionRef = useRef({ start: 0, end: 0 })
  const selectedRoomIDRef = useRef(selectedRoomID)
  selectedRoomIDRef.current = selectedRoomID
  const nativeNotificationsRef = useRef(false)
  const lastReadEventByRoom = useRef(new Map<string, string>())
  const currentUserIDRef = useRef('')
  const currentDisplayNameRef = useRef('')
  const draftsRef = useRef(new Map<string, string>())
  const triageBusyRef = useRef(false)
  const dragDepthRef = useRef(0)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineHeightBeforePrepend = useRef<number | null>(null)
  const stickToBottomRef = useRef(true)
  const roomSwitchRef = useRef(false)
  // scrollTop after the last pin to the newest message. A scroll event at this position comes from
  // that pin, or from content growing below it, so it must not count as the reader scrolling away.
  const pinnedScrollTopRef = useRef<number | null>(null)
  const timelineResizeObserverRef = useRef<ResizeObserver | null>(null)
  const startingDirectChatRef = useRef(false)
  const timelineMessageActionsRef = useRef<TimelineMessageActions>({
    onDoubleClick: () => { },
    onOpenContextMenu: () => { },
    onFocusMessage: () => { },
    onAudioEnded: () => { },
    onUseTranscript: () => { },
    onSendReaction: () => { },
    onRemoveReaction: () => { },
    onStartDirectChat: () => { },
  })
  const roomButtonActionsRef = useRef<RoomButtonActions>({
    onSelect: () => { },
    onKeyDown: () => { },
    onContextMenu: () => { },
  })
  const notificationBatchesRef = useRef(new Map<string, { notifications: MatrixNotification[]; timer: number }>())
  const repeatRemindersRef = useRef(new Map<string, number>())

  useEffect(() => () => {
    notificationBatchesRef.current.forEach((batch) => window.clearTimeout(batch.timer))
    repeatRemindersRef.current.forEach((timer) => window.clearTimeout(timer))
    if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current)
    if (scheduledNoticeTimerRef.current !== null) window.clearTimeout(scheduledNoticeTimerRef.current)
  }, [])
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const voiceRoomIDRef = useRef('')
  const voiceTimeoutRef = useRef<number | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const voiceRecordingActive = voiceCaptureStatus === 'recording' && captureKind === 'voice'
  const videoRecordingActive = voiceCaptureStatus === 'recording' && captureKind === 'video'
  const captureNoun = captureKind === 'video' ? 'video message' : 'voice note'
  useEffect(() => {
    if (videoPreviewRef.current) videoPreviewRef.current.srcObject = voiceStreamRef.current
  }, [videoRecordingActive])
  const roomSearchInputRef = useRef<HTMLInputElement>(null)
  const menuActionRef = useRef<(action: string) => void>(() => undefined)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const [aiPanel, setAIPanel] = useState<AIPanel | null>(null)
  const [languageTutorState, setLanguageTutorState] = useState<LanguageTutorState | null>(null)
  const languageTutorRequestRef = useRef('')
  // imageSendRun tracks an image being generated from the composer draft for roomID. Progress arrives on local-ai:image-progress.
  const [imageSendRun, setImageSendRun] = useState<{ requestID: string; roomID: string; stage: string; step: number; totalSteps: number } | null>(null)
  // generatedImageReview holds a generated image that waits for approval before it is sent.
  const [generatedImageReview, setGeneratedImageReview] = useState<{ roomID: string; prompt: string; sourceDraft: string; encoded: string } | null>(null)
  const [chatTranslation, setChatTranslation] = useState<ChatTranslationState | null>(null)
  // activeAIRequestRef holds the request the AI panel is waiting on. stoppedAIRequestRef marks a request the user stopped.
  const activeAIRequestRef = useRef('')
  const stoppedAIRequestRef = useRef('')
  const aiStreamHandlersRef = useRef(new Map<string, AIStreamHandler>())
  const chatTranslationAIRequestRef = useRef('')
  const chatTranslationRequestRef = useRef(0)
  const quickSwitcherInputRef = useRef<HTMLInputElement>(null)
  const pendingSearchJumpRef = useRef<{ roomID: string; eventID: string; timelineCursor: number } | null>(null)

  useEffect(() => {
    chatTranslationRequestRef.current++
    setChatTranslation(null)
  }, [selectedRoomID])

  useEffect(() => {
    let active = true
    void AppService.NativeNotificationsSupported()
      .then((supported) => {
        if (active) nativeNotificationsRef.current = supported
      })
      .catch(() => { })
    return () => { active = false }
  }, [])

  const preferences = useMemo(() => snapshot?.preferences ?? {}, [snapshot?.preferences])
  const languageRoles = resolveLanguageRoles(preferences)
  const translateRecentLabel = `Translate messages received since your last message to ${languageName(languageRoles.defaultLanguage)}`
  const rooms = snapshot?.rooms ?? EMPTY_ROOMS
  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomID), [rooms, selectedRoomID])
  const selectedRoomAvatar = useMemo(() => selectedRoom?.avatar || (
    historyRoomIDRef.current === selectedRoomID
      ? newestOtherAvatar(messages)
      : ''
  ), [messages, selectedRoom?.avatar, selectedRoomID])
  const selectedRoomAvatarSource = useMemo(() => matrixMXCMediaURL(selectedRoomAvatar), [selectedRoomAvatar])
  const typingStatus = formatTypingStatus(typingUsers, roomMembers, messages, selectedRoom?.direct ? selectedRoom.name : '')
  const imageEngineReady = preferenceString(preferences, 'ai.image.binary_path', '') !== '' && preferenceString(preferences, 'ai.image.model_path', '') !== ''
  const imageRunHere = imageSendRun !== null && imageSendRun.roomID === selectedRoomID ? imageSendRun : null
  const imageRunStatus = imageRunHere?.stage === 'generating' ? `Generating image · step ${imageRunHere.step} of ${imageRunHere.totalSteps}` : 'Starting image engine…'
  const imageButtonTooltip = imageRunHere ? 'Stop image generation' : imageEngineReady ? 'Generate an image from the draft to review before sending' : 'Generate an image from the draft · set up the image engine in Settings > AI first'
  const roomAgentsPreferenceKey = selectedRoom ? `room.ai_agents.${selectedRoom.id}` : ''
  const roomAgents = useMemo<ChatAgentCollection>(() => parseChatAgents(preferenceString(preferences, roomAgentsPreferenceKey, JSON.stringify(EMPTY_CHAT_AGENTS))), [preferences, roomAgentsPreferenceKey])
  const localAIAgents = useMemo<ChatAgentCollection>(() => parseChatAgents(preferenceString(preferences, 'ai.local_agents', JSON.stringify(EMPTY_CHAT_AGENTS))), [preferences])
  const localAIActiveChat = localAIChatList.chats.find((chat) => chat.id === localAIChatId) ?? null
  const localAIAgentCandidate = localAIActiveChat ? localAIActiveChat.agentId : localAINewChatAgentId
  const localAIAgentId = localAIAgents.agents.some((agent) => agent.id === localAIAgentCandidate) ? localAIAgentCandidate : ''

  function startLocalAIChat(initialDraft = '', kind: LocalAIChatKind = 'chat') {
    setLocalAIChatId(null)
    setLocalAINewChatAgentId(localAIAgents.defaultAgentId)
    setLocalAINewChatKind(kind)
    localAIInitialDraftVersion.current++
    setLocalAIInitialDraft({ version: localAIInitialDraftVersion.current, content: initialDraft })
    openLocalAIChatView()
  }

  // Saves a chat agent to the shared list. The size check matters: an oversized list is dropped on read.
  async function createLocalAIAgent(agent: ChatAgentProfile) {
    const serialized = serializeChatAgents({ ...localAIAgents, agents: [...localAIAgents.agents, agent] })
    if (new TextEncoder().encode(serialized).byteLength > MAX_AGENT_COLLECTION_LENGTH) return false
    return setPreference('ai.local_agents', serialized)
  }

  function selectLocalAIChat(chatID: string) {
    setLocalAIChatId(chatID)
    openLocalAIChatView()
  }

  // The private chat pane replaces the Matrix conversation, so the Matrix selection is cleared.
  function openLocalAIChatView() {
    if (selectedRoomRef.current) showRoom('')
    setLocalAIChatOpen(true)
    setLocalAIRenameDraft(null)
    setMobilePane('conversation')
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

  async function renameLocalAIChat(chatID: string, title: string) {
    await AppService.RenameLocalAIChat(chatID, title)
    localAIChatList.reload()
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

  const appZoom = preferenceNumber(preferences, 'appearance.zoom', 100, 75, 125)
  const scheduleTimeSuggestions = parseTimeSuggestionMinutes(preferenceString(preferences, 'schedule.suggestions_minutes', '5,15,60'))
  const answeredShortcut = preferenceString(preferences, 'shortcuts.mark_answered', 'E').trim().toUpperCase() || 'E'
  const singleKeyShortcuts = preferenceBoolean(preferences, 'shortcuts.single_keys', true)
  const hideDeletedMessages = preferenceBoolean(preferences, 'appearance.hide_deleted_messages')
  const automaticArchiveEnabled = preferenceBoolean(preferences, 'archive.automatic')
  const visibleMessages = useMemo(() => hideDeletedMessages ? messages.filter((message) => !message.redacted) : messages, [messages, hideDeletedMessages])
  preferencesRef.current = preferences
  roomsRef.current = rooms
  messagesRef.current = messages
  composeTextRef.current = composeText
  currentUserIDRef.current = snapshot?.profile.userId ?? ''
  currentDisplayNameRef.current = snapshot?.profile.displayName ?? ''

  useEffect(() => Events.On('ai:stream', (event: { data: unknown }) => {
    const chunk = event.data as AIStreamChunk | undefined
    if (!chunk?.requestId) return
    aiStreamHandlersRef.current.get(chunk.requestId)?.(chunk)
  }), [])
  // Progress is only listened to while an image from the composer is generating.
  const imageRunRequestID = imageSendRun?.requestID ?? ''
  useEffect(() => {
    if (!imageRunRequestID) return
    return Events.On('local-ai:image-progress', (event: { data: unknown }) => {
      const update = event.data as { requestId?: string; stage?: string; step?: number; totalSteps?: number } | undefined
      if (update?.requestId !== imageRunRequestID) return
      setImageSendRun((current) => current?.requestID === imageRunRequestID
        ? { ...current, stage: update.stage ?? current.stage, step: update.step ?? current.step, totalSteps: update.totalSteps ?? current.totalSteps }
        : current)
    })
  }, [imageRunRequestID])
  // Export progress is only listened to while a room export is running.
  const runningChatExportRoomID = chatExport?.phase === 'running' ? chatExport.roomID : ''
  const chatExportForSelectedRoom = chatExport && chatExport.roomID === selectedRoom?.id ? chatExport : null
  useEffect(() => {
    if (!runningChatExportRoomID) return
    return Events.On('chat-export:progress', (event: { data: unknown }) => {
      const update = event.data as ChatExportProgressEvent | undefined
      if (update?.roomId !== runningChatExportRoomID) return
      setChatExport((current) => current?.phase === 'running' && current.roomID === runningChatExportRoomID
        ? { ...current, stage: update.stage, mediaDone: update.mediaDone, mediaTotal: update.mediaTotal }
        : current)
    })
  }, [runningChatExportRoomID])
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
  }

  const audioInputDevicePreference = preferenceString(preferences, 'audio.input_device', '')
  useEffect(() => {
    setSelectedAudioInputDeviceId(audioInputDevicePreference)
  }, [audioInputDevicePreference])

  useEffect(() => {
    let active = true
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.enumerateDevices) return

    const refreshAudioInputDevices = () => {
      void mediaDevices.enumerateDevices().then((devices) => {
        if (active) setAudioInputDevices(devices.filter((device) => device.kind === 'audioinput'))
      }).catch(() => { })
    }
    refreshAudioInputDevices()
    mediaDevices.addEventListener?.('devicechange', refreshAudioInputDevices)
    return () => {
      active = false
      mediaDevices.removeEventListener?.('devicechange', refreshAudioInputDevices)
    }
  }, [])
  hasOlderRef.current = hasOlder
  editTargetRef.current = editTarget
  const inboxAccountCount = snapshot?.accounts?.length ?? 0
  const activeAccountID = snapshot?.activeAccountId ?? ''
  const archivedPreferenceKey = useCallback((roomID: string, accountID = '') => `room.archived.${accountID || activeAccountID || 'primary'}.${roomID}`, [activeAccountID])
  // Subscription handlers read these through a ref so the event listeners are attached once.
  const matrixUpdateHandlersRef = useRef({ archivedPreferenceKey, deliverNotification, queueNotificationBatch })
  matrixUpdateHandlersRef.current = { archivedPreferenceKey, deliverNotification, queueNotificationBatch }
  useEffect(() => {
    if (inboxAccountCount < 2) return
    let active = true
    const refreshOtherAccountRooms = () => {
      void AppService.AccountRooms().then((accountRooms) => {
        if (active) setOtherAccountRooms((accountRooms ?? []).filter((room) => room.accountId !== activeAccountID))
      }).catch(() => undefined)
    }
    refreshOtherAccountRooms()
    const timer = window.setInterval(refreshOtherAccountRooms, 15000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [inboxAccountCount, activeAccountID])
  // Rooms of signed-in accounts other than the active one are cached and refreshed on an interval.
  const effectiveAccountScope = inboxAccountCount > 1 ? inboxAccountScope : 'all'
  const crossAccountRooms = inboxAccountCount > 1 ? otherAccountRooms : EMPTY_ROOMS
  const scopedRooms = useMemo(() => effectiveAccountScope === 'all'
    ? (crossAccountRooms.length > 0 ? [...rooms, ...crossAccountRooms] : rooms)
    : effectiveAccountScope === activeAccountID ? rooms : crossAccountRooms.filter((room) => room.accountId === effectiveAccountScope),
    [rooms, crossAccountRooms, effectiveAccountScope, activeAccountID])
  const localAIRooms = useMemo(() => localAIChatList.chats.map((chat) => localAIChatToRoom(chat, preferenceBoolean(preferences, localAIFavoritePreference(chat.id)))), [localAIChatList.chats, preferences])
  // Private model chats belong to no Matrix account, so they are hidden while the list is limited to one account.
  const localAIRoomsForList = useMemo(() => roomScope === 'local-ai' ? localAIRooms : localAIRooms.filter((room) => {
    const chatID = localAIChatIDFromRoomID(room.id)
    return chatID !== null && preferenceBoolean(preferences, localAIIncludeInAllPreference(chatID))
  }), [localAIRooms, preferences, roomScope])
  const localAIIconByRoomID = useMemo(() => new Map(localAIChatList.chats.map((chat) => [localAIRoomID(chat.id), localAIChatIcon(chat)] as const)), [localAIChatList.chats])
  const localAIFolderIDByRoomID = useMemo(() => new Map(localAIChatList.chats.map((chat) => [localAIRoomID(chat.id), chat.folderId] as const)), [localAIChatList.chats])
  const localAIActiveFolder = localAIFolderFilter ? localAIChatList.folders.find((folder) => folder.id === localAIFolderFilter) ?? null : null
  const listRooms = useMemo(() => effectiveAccountScope === 'all' ? [...scopedRooms, ...localAIRoomsForList] : scopedRooms, [scopedRooms, localAIRoomsForList, effectiveAccountScope])
  const filteredRooms = useMemo(() => {
    const query = search.trim().toLowerCase()
    const today = Date.now()
    return listRooms.filter((room) => {
      const matchesQuery = !query || `${room.name} ${room.id} ${room.preview}`.toLowerCase().includes(query)
      const localAI = isLocalAIRoomID(room.id)
      const archived = !localAI && preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId))
      const matchesArchive = roomScope === 'local-ai' ? localAI : roomScope === 'archived' ? archived : !archived || Boolean(query)
      const matchesRefinements = (!roomRefinements.unanswered || (!localAI && isUnansweredRoom(room)))
        && (!roomRefinements.needsReply || isNeedsReplyRoom(room))
        && (!roomRefinements.favorite || room.favorite)
      const matchesFolder = roomScope !== 'local-ai' || localAIFolderFilter === null || (localAIFolderIDByRoomID.get(room.id) ?? '') === localAIFolderFilter
      return matchesQuery && matchesArchive && matchesRefinements && matchesFolder
    }).sort((left, right) => {
      const favoriteOrder = preferenceString(preferences, 'sidebar.pinned_style', 'Top of list') === 'Top of list'
        ? Number(right.favorite) - Number(left.favorite)
        : 0
      return favoriteOrder || compareRoomActivity(left, right, today)
    })
  }, [listRooms, search, preferences, roomScope, roomRefinements, localAIFolderFilter, localAIFolderIDByRoomID, archivedPreferenceKey])
  // The open private chat takes the highlight, because the Matrix selection is cleared while it is open.
  const activeListRoomID = localAIChatOpen ? (localAIChatId ? localAIRoomID(localAIChatId) : '') : selectedRoomID
  const selectedRoomListIndex = filteredRooms.findIndex((room) => room.id === activeListRoomID && isActiveAccountRoom(room))
  const quickSwitcherRooms = useMemo(() => rankQuickSwitcherRooms(rooms, quickSwitcherQuery), [rooms, quickSwitcherQuery])
  const needsReplyCount = useMemo(() => scopedRooms.filter((room) => isNeedsReplyRoom(room) && !preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId))).length, [scopedRooms, preferences, archivedPreferenceKey])
  const readRoomCount = useMemo(() => rooms.filter((room) => room.unread === 0 && !room.markedUnread && !preferenceBoolean(preferences, archivedPreferenceKey(room.id))).length, [rooms, preferences, archivedPreferenceKey])
  const contextMenuRooms = roomContextMenu
    ? (selectedRoomIDs.includes(roomContextMenu.roomID) ? selectedRoomIDs : [roomContextMenu.roomID])
      .map((roomID) => rooms.find((room) => room.id === roomID))
      .filter((room): room is Room => Boolean(room))
    : []
  const contextMenuNeedsReplyAddRooms = contextMenuRooms.filter((room) => isUnansweredRoom(room) && !isNeedsReplyRoom(room))
  const contextMenuNeedsReplyAddCount = contextMenuNeedsReplyAddRooms.length
  const contextMenuIsBulk = contextMenuRooms.length > 1
  const contextMenuHasUnread = contextMenuRooms.some((room) => room.unread > 0 || room.markedUnread)
  const contextMenuNeedsArchive = contextMenuRooms.some((room) => !preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId)))
  const contextMenuNeedsFavorite = contextMenuRooms.some((room) => !room.favorite)
  const contextMenuChatID = roomContextMenu ? localAIChatIDFromRoomID(roomContextMenu.roomID) : null
  const contextMenuLocalAIRoom = contextMenuChatID === null ? null : localAIRooms.find((room) => room.id === roomContextMenu?.roomID) ?? null
  const contextMenuLocalAIInAll = contextMenuChatID !== null && preferenceBoolean(preferences, localAIIncludeInAllPreference(contextMenuChatID))
  const contextMenuLocalAIFolderID = contextMenuChatID === null ? '' : localAIChatList.chats.find((chat) => chat.id === contextMenuChatID)?.folderId ?? ''
  const scheduledJobCount = scheduledJobs.length

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

  useEffect(() => {
    setSelectedRoomIDs([])
    roomSelectionAnchorRef.current = ''
  }, [effectiveAccountScope, roomScope, roomRefinements.unanswered, roomRefinements.needsReply, roomRefinements.favorite, search])
  const mentionOptions = mentionStart < 0 ? [] : roomMembers.filter((member) => {
    const query = mentionQuery.toLowerCase()
    return `${member.displayName} ${member.id}`.toLowerCase().includes(query)
  }).slice(0, 8)
  const themePreference = preferenceString(preferences, 'appearance.theme', SYSTEM_THEME_NAME)
  const themeChoice = themeIdForPreference(themePreference, systemPrefersDark)
  const accentPalette = accentPaletteFor(preferenceString(preferences, 'appearance.accent_color', DEFAULT_ACCENT_NAME))
  const bubbleColor = preferenceString(preferences, 'appearance.bubble_color', accentPalette.base)
  const safeBubbleColor = /^#[0-9a-fA-F]{6}$/.test(bubbleColor) ? bubbleColor : accentPalette.base
  const composerContextMessage = editTarget ?? replyTarget

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    setSystemPrefersDark(mediaQuery.matches)
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  async function refreshScheduledJobs() {
    setScheduledLoading(true)
    try {
      const jobs = await AppService.ScheduledJobs()
      const nextJobs = jobs ?? []
      setScheduledJobs(nextJobs)
      setScheduledTimes(Object.fromEntries(nextJobs.map((job) => [job.id, localDateTimeInputValue(job.dueAt)])))
      setScheduledJobsError('')
    } catch (jobsError) {
      setScheduledJobsError(describeError(jobsError))
    } finally {
      setScheduledLoading(false)
    }
  }

  function openScheduledJobs() {
    setScheduledJobsOpen(true)
    setScheduledJobsError('')
    void refreshScheduledJobs()
  }

  function openScheduleMessage() {
    if (!selectedRoomID || !composeText.trim() || editTarget) return
    setScheduledDraft({
      kind: 'message',
      roomID: selectedRoomID,
      text: composeText.trim(),
      replyToEventID: replyTarget?.id,
      replyToSender: replyTarget?.senderName || replyTarget?.sender,
      replyToPreview: replyTarget?.body,
    })
    setScheduledDueAt(localDateTimeInputValue(Date.now() + defaultScheduleDelayMinutes('schedule.default_send_minutes', 5) * 60_000))
    setScheduledDialogError('')
  }

  function openReminder(message: Message) {
    if (!selectedRoomID || !message.id || message.id.startsWith('~') || message.redacted) return
    setScheduledDraft({ kind: 'reminder', roomID: selectedRoomID, eventID: message.id, text: '', archiveAfter: false })
    setScheduledDueAt(localDateTimeInputValue(Date.now() + defaultScheduleDelayMinutes('schedule.default_reminder_minutes', 60) * 60_000))
    setScheduledDialogError('')
  }

  function defaultScheduleDelayMinutes(key: string, fallback: number) {
    const minutes = Number(preferenceString(preferences, key, String(fallback)))
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 10080 ? minutes : fallback
  }

  useEffect(() => {
    selectedRoomRef.current = selectedRoomID
    void AppService.SetActiveRoom(selectedRoomID)
  }, [selectedRoomID, snapshot?.activeAccountId])

  useEffect(() => {
    const handleContentBlurShortcut = (event: globalThis.KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      if (!event.shiftKey || event.altKey || event.repeat || event.isComposing || event.key.toLowerCase() !== 'p') return
      event.preventDefault()
      event.stopPropagation()
      void setPreferenceRef.current('privacy.incognito', !preferenceBoolean(preferencesRef.current, 'privacy.incognito'))
    }
    const handleHideImagesShortcut = (event: globalThis.KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      if (!event.shiftKey || event.altKey || event.repeat || event.isComposing || event.key.toLowerCase() !== 'i') return
      event.preventDefault()
      event.stopPropagation()
      void setPreferenceRef.current('appearance.hide_images_and_videos', !preferenceBoolean(preferencesRef.current, 'appearance.hide_images_and_videos'))
    }

    window.addEventListener('keydown', handleContentBlurShortcut)
    window.addEventListener('keydown', handleHideImagesShortcut)
    return () => {
      window.removeEventListener('keydown', handleContentBlurShortcut)
      window.removeEventListener('keydown', handleHideImagesShortcut)
    }
  }, [])

  useEffect(() => {
    const handleGlobalAnsweredShortcut = (event: globalThis.KeyboardEvent) => {
      if (!singleKeyShortcuts || event.repeat || event.altKey || event.metaKey || event.ctrlKey || event.key.toUpperCase() !== answeredShortcut) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (settingsOpen || roomInfoOpen || leaveConfirmOpen || redactTarget || quickSwitcherOpen) return
      const roomID = roomContextMenu?.roomID ?? selectedRoomID
      const room = roomsRef.current.find((candidate) => candidate.id === roomID)
      if (!room || !isNeedsReplyRoom(room)) return
      event.preventDefault()
      void markRoomAnsweredRef.current(roomID)
    }
    window.addEventListener('keydown', handleGlobalAnsweredShortcut)
    return () => window.removeEventListener('keydown', handleGlobalAnsweredShortcut)
  }, [answeredShortcut, singleKeyShortcuts, leaveConfirmOpen, quickSwitcherOpen, roomContextMenu, roomInfoOpen, redactTarget, selectedRoomID, settingsOpen])

  useEffect(() => {
    if (!roomContextMenu && !messageContextMenu) return
    const dismissOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element) {
        if (event.target.closest('.room-context-menu')) return
        if (event.target.closest('.message-context-menu')) return
      }
      setRoomContextMenu(null)
      setMessageContextMenu(null)
    }
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setRoomContextMenu(null)
      setMessageContextMenu(null)
    }
    // Only one menu is ever open: opening one clears the other.
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(roomContextMenu ? '.room-context-menu button' : '.message-context-menu button')?.focus())
    document.addEventListener('pointerdown', dismissOnOutsideClick)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', dismissOnOutsideClick)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [roomContextMenu, messageContextMenu])

  // The reaction picker used to be toggled off by its own toolbar button, which
  // now lives in the right-click menu. Give it a dismissal path of its own.
  useEffect(() => {
    if (!reactingMessageID) return
    const dismissOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.reaction-picker')) return
      setReactingMessageID('')
    }
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setReactingMessageID('')
    }
    document.addEventListener('pointerdown', dismissOnOutsideClick)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsideClick)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [reactingMessageID])

  function isNearBottom(element: HTMLElement, tolerance = 96) {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= tolerance
  }

  function isNearTop(element: HTMLElement, tolerance = 240) {
    return element.scrollTop <= tolerance
  }

  function pinTimelineToBottom(timeline: HTMLElement) {
    timeline.scrollTop = timeline.scrollHeight
    pinnedScrollTopRef.current = timeline.scrollTop
  }

  function scrollTimelineToBottom(behavior: ScrollBehavior = 'auto') {
    const timeline = timelineRef.current
    if (!timeline) return
    if (typeof timeline.scrollTo === 'function') timeline.scrollTo({ top: timeline.scrollHeight, behavior })
    else timeline.scrollTop = timeline.scrollHeight
  }

  function jumpToLatest() {
    stickToBottomRef.current = true
    scrollTimelineToBottom('smooth')
  }

  function focusTimelineMessage(eventID: string) {
    const timeline = timelineRef.current
    if (!timeline || !eventID) return
    const target = Array.from(timeline.querySelectorAll<HTMLElement>('[data-event-id]'))
      .find((element) => element.dataset.eventId === eventID)
    if (!target) return
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    target.focus({ preventScroll: true })
  }

  function focusTimelineItem(index: number) {
    const timeline = timelineRef.current
    const items = timeline ? Array.from(timeline.querySelectorAll<HTMLElement>('[data-event-id]')) : []
    const target = items[index]
    if (!target) return
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    target.focus({ preventScroll: true })
  }

  function moveTimelineFocus(direction: number, boundary?: 'first' | 'last') {
    const timeline = timelineRef.current
    if (!timeline) return
    const items = Array.from(timeline.querySelectorAll<HTMLElement>('[data-event-id]'))
    if (items.length === 0) return
    if (boundary) {
      focusTimelineItem(boundary === 'first' ? 0 : items.length - 1)
      return
    }
    const activeItem = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-event-id]')
      : null
    const currentIndex = activeItem ? items.indexOf(activeItem) : -1
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : items.length - 1
      : currentIndex + direction
    if (nextIndex >= 0 && nextIndex < items.length) focusTimelineItem(nextIndex)
  }

  function handleTimelineKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || isTextEntryTarget(event.target)) return
    const target = event.target instanceof HTMLElement ? event.target : null
    const row = target?.closest<HTMLElement>('[data-event-id]')
    if (!row && target !== event.currentTarget) return

    if (!singleKeyShortcuts && event.key.length === 1) return

    if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') {
      if (event.key.startsWith('Arrow') && target !== row && target !== event.currentTarget) return
      event.preventDefault()
      moveTimelineFocus(1)
    } else if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
      if (event.key.startsWith('Arrow') && target !== row && target !== event.currentTarget) return
      event.preventDefault()
      moveTimelineFocus(-1)
    } else if (event.key === 'Home' && (target === row || target === event.currentTarget)) {
      event.preventDefault()
      moveTimelineFocus(1, 'first')
    } else if (event.key === 'End' && (target === row || target === event.currentTarget)) {
      event.preventDefault()
      moveTimelineFocus(-1, 'last')
    } else if (event.key.toLowerCase() === 'r' && row) {
      const message = messages.find((item) => item.id === row.dataset.eventId || item.transactionId === row.dataset.eventId)
      if (!message?.id || message.id.startsWith('~')) return
      event.preventDefault()
      setEditTarget(null)
      setReplyTarget(message)
      requestAnimationFrame(() => composerInputRef.current?.focus())
    }
  }

  useLayoutEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) return
    const previousHeight = timelineHeightBeforePrepend.current
    if (previousHeight !== null) {
      timeline.scrollTop += timeline.scrollHeight - previousHeight
      timelineHeightBeforePrepend.current = null
      return
    }
    if (roomSwitchRef.current || stickToBottomRef.current) {
      pinTimelineToBottom(timeline)
      if (!roomSwitchRef.current || historyRoomIDRef.current === selectedRoomID) roomSwitchRef.current = false
    }
  }, [messages, selectedRoomID])

  // Media, fonts, and composer or banner changes resize the timeline without changing `messages`.
  // Re-pin to the newest message after each resize while the reader is following the conversation.
  useLayoutEffect(() => {
    const timeline = timelineRef.current
    if (!timeline || typeof ResizeObserver === 'undefined') return
    if (!timelineResizeObserverRef.current) {
      timelineResizeObserverRef.current = new ResizeObserver(() => {
        const current = timelineRef.current
        if (current && stickToBottomRef.current) pinTimelineToBottom(current)
      })
    }
    const observer = timelineResizeObserverRef.current
    observer.disconnect()
    observer.observe(timeline)
    for (const child of Array.from(timeline.children)) observer.observe(child)
  }, [messages, selectedRoomID])

  useEffect(() => {
    return () => {
      timelineResizeObserverRef.current?.disconnect()
      timelineResizeObserverRef.current = null
    }
  }, [])

  useEffect(() => {
    setSearchOpen(false)
    setMessageSearch('')
    setSearchResults([])
    setSearchStatus('')
    setRoomInfoOpen(false)
    setAgentEditor(null)
    setAgentSettingsError('')
    setLeaveConfirmOpen(false)
    setMentionBindings([])
    setMentionStart(-1)
    setEmojiPickerOpen(false)
    setTypingUsers([])
    setComposeText(draftsRef.current.get(selectedRoomID) ?? '')
    stickToBottomRef.current = true
    pinnedScrollTopRef.current = null
    setReplyTarget(null)
    setEditTarget(null)
  }, [selectedRoomID])

  useEffect(() => {
    if (!emojiPickerOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && composerEmojiControlRef.current?.contains(event.target)) return
      setEmojiPickerOpen(false)
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setEmojiPickerOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [emojiPickerOpen])

  useEffect(() => {
    if (!quickSwitcherOpen) return
    const frame = window.requestAnimationFrame(() => quickSwitcherInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [quickSwitcherOpen])

  useEffect(() => {
    setQuickSwitcherIndex(0)
  }, [quickSwitcherQuery])

  useEffect(() => {
    if (!selectedRoomID) {
      setRoomMembers([])
      setRoomMembersLoading(false)
      setRoomMembersError('')
      return
    }
    let active = true
    setRoomMembers([])
    setRoomMembersLoading(true)
    setRoomMembersError('')
    AppService.RoomMembers(selectedRoomID)
      .then((members) => { if (active) setRoomMembers(members ?? []) })
      .catch((membersError: unknown) => { if (active) setRoomMembersError(describeError(membersError)) })
      .finally(() => { if (active) setRoomMembersLoading(false) })
    return () => { active = false }
  }, [selectedRoomID])

  useEffect(() => {
    if (!selectedRoomID || !preferenceBoolean(preferences, 'privacy.send_typing', true)) return
    const timeout = window.setTimeout(() => {
      const timeoutMilliseconds = composeText.trim() ? 5000 : 0
      void AppService.SetTyping(selectedRoomID, timeoutMilliseconds).catch((typingError: unknown) => setError(describeError(typingError)))
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [composeText, selectedRoomID, preferences])

  const matrixUpdateHandlerRef = useRef<((update: MatrixUpdate) => void) | null>(null)

  useEffect(() => {
    let active = true
    const applyMatrixUpdate = (update: MatrixUpdate) => {
      if (!active) return
      const previousRooms = roomsRef.current
      const nextTypingUsers = update.typingUsers?.[selectedRoomRef.current] ?? []
      setSnapshot((current) => {
        if (!current) return current
        const rooms = reconcileRoomSnapshots(current.rooms, update.rooms ?? [])
        const slidingSyncListCounts = update.slidingSyncListCounts ?? current.slidingSyncListCounts
        const currentListCounts = current.slidingSyncListCounts ?? {}
        const nextListCounts = slidingSyncListCounts ?? {}
        const listCountsChanged = Object.keys(currentListCounts).length !== Object.keys(nextListCounts).length
          || Object.entries(nextListCounts).some(([listKey, count]) => currentListCounts[listKey] !== count)
        const syncReady = current.syncReady || update.initialSyncComplete
        const needsVerification = update.needsVerification
        const connectionState = update.connectionState || current.connectionState
        const profile = current.profile.verified === !needsVerification
          ? current.profile
          : { ...current.profile, verified: !needsVerification }
        if (
          rooms === current.rooms
          && !listCountsChanged
          && syncReady === current.syncReady
          && needsVerification === current.needsVerification
          && profile === current.profile
          && connectionState === current.connectionState
        ) return current
        return { ...current, rooms, slidingSyncListCounts, syncReady, needsVerification, profile, connectionState }
      })
      setTypingUsers((current) => current.length === nextTypingUsers.length && current.every((user, index) => user === nextTypingUsers[index])
        ? current
        : nextTypingUsers)
      for (const roomID of update.timelineChangedRoomId ?? []) {
        const updatedRoom = (update.rooms ?? []).find((room) => room.id === roomID)
        const previousRoom = previousRooms.find((room) => room.id === roomID)
        if (!updatedRoom?.lastEventId || !previousRoom || updatedRoom.lastEventId === previousRoom.lastEventId) continue
        const key = matrixUpdateHandlersRef.current.archivedPreferenceKey(roomID, updatedRoom.accountId)
        if (preferenceBoolean(preferencesRef.current, key)) void setPreferenceRef.current(key, false)
      }
      for (const notification of update.notifications ?? []) {
        const currentPreferences = preferencesRef.current
        if (!notificationAllowed(currentPreferences, notification.roomId, notification.category)) continue
        if (notification.roomId === selectedRoomRef.current) continue
        if (preferenceBoolean(currentPreferences, 'notifications.only_when_unfocused', true) && document.hasFocus()) continue
        const oneTimeCode = detectOneTimeCode(notification.body)
        if (oneTimeCode && preferenceBoolean(currentPreferences, 'notifications.otp_copy')) {
          void navigator.clipboard?.writeText(oneTimeCode).catch(() => undefined)
        }
        const batchSeconds = preferenceNumber(currentPreferences, 'notifications.batch_seconds', 0, 0, 30)
        const immediate = Boolean(oneTimeCode) && preferenceBoolean(currentPreferences, 'notifications.otp_immediate', true)
        if (batchSeconds > 0 && !immediate) {
          matrixUpdateHandlersRef.current.queueNotificationBatch(notification, batchSeconds)
          continue
        }
        const text = notificationText(currentPreferences, notification, notificationRoomName(notification))
        matrixUpdateHandlersRef.current.deliverNotification(currentPreferences, notification, text)
      }
      // Background sync errors are not shown as banners.
      // Belt-and-braces: if the selected room's sidebar preview moved past the
      // loaded timeline (e.g. a coalesced/dropped timeline signal), force a
      // history refresh so left room list and right message pane stay in sync.
      const selectedID = selectedRoomRef.current
      const timelineTouched = (update.timelineChangedRoomId ?? []).includes(selectedID)
      if (timelineTouched) {
        setHistoryRevision((revision) => revision + 1)
      } else if (selectedID) {
        const selected = (update.rooms ?? []).find((room) => room.id === selectedID)
        const newestLoaded = newestPersistentMessage(messagesRef.current)
        if (selected && newestLoaded && selected.lastEventId && selected.lastEventId !== newestLoaded.id) {
          const newestTimestamp = newestLoaded.timestamp ?? 0
          if (selected.lastSeen > newestTimestamp || (selected.lastSeen === newestTimestamp && selected.lastEventAt >= newestTimestamp)) {
            setHistoryRevision((revision) => revision + 1)
          }
        }
      }
    }
    matrixUpdateHandlerRef.current = applyMatrixUpdate
    const unsubscribe = Events.On('matrix:update', (event: { data: unknown }) => {
      applyMatrixUpdate(event.data as MatrixUpdate)
    })
    const unsubscribePreferences = Events.On('preferences:update', (event: { data: unknown }) => {
      if (!active) return
      const state = event.data as Snapshot | undefined
      if (!state) return
      setSnapshot(state)
      setSelectedRoomID((current) => {
        if (current && (state.rooms ?? []).some((room) => room.id === current)) return current
        return (state.rooms ?? [])[0]?.id || ''
      })
    })
    const unsubscribeHostError = Events.On('matrix:host-error', (event: { data: unknown }) => {
      const message = (event.data as { error?: string } | undefined)?.error
      if (active && message) setError(message)
    })
    const unsubscribeMenuAbout = Events.On('application-menu:about', () => {
      if (!active) return
      setSettingsTab('About')
      setSettingsOpen(true)
    })
    const unsubscribeMenuSettings = Events.On('application-menu:settings', () => {
      if (!active) return
      setSettingsTab('General')
      setSettingsOpen(true)
    })
    const unsubscribeMenuSearch = Events.On('application-menu:search', () => {
      if (active) setSearchOpen(true)
    })
    const unsubscribeMenuAction = Events.On('application-menu:action', (event: { data: unknown }) => {
      if (active) menuActionRef.current(String(event.data))
    })
    const unsubscribeNotificationOpenRoom = Events.On('notification:open-room', (event: { data: unknown }) => {
      const roomID = event.data as string | undefined
      if (active && roomID) {
        window.focus()
        showRoom(roomID)
      }
    })
    const unsubscribeAttachmentSent = Events.On('matrix:attachment-sent', (event: { data: unknown }) => {
      if (active && event.data === selectedRoomRef.current) {
        setHistoryRevision((revision) => revision + 1)
      }
    })
    const unsubscribeScheduledReminder = Events.On('scheduler:reminder', (event: { data: unknown }) => {
      if (!active) return
      const reminder = event.data as ScheduledJob
      const roomName = roomsRef.current.find((room) => room.id === reminder.roomId)?.name || reminder.roomId
      const body = reminder.text.trim() || `You set a reminder for ${roomName}.`
      showScheduledNotice(`${roomName}: ${body}`)
      void refreshScheduledJobs()
      if (nativeNotificationsRef.current) {
        void AppService.SendNotification({ title: `Reminder · ${roomName}`, subtitle: '', body, roomId: reminder.roomId, accountId: '', senderAvatar: '' }).catch((notificationError: unknown) => setScheduledJobsError(describeError(notificationError)))
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const notification = new Notification(`Reminder · ${roomName}`, { body })
          notification.onclick = () => {
            window.focus()
            showRoom(reminder.roomId)
            setScheduledJobsOpen(true)
          }
        } catch (notificationError) {
          setScheduledJobsError(describeError(notificationError))
        }
      }
    })

    void refreshScheduledJobs()
    AppService.Snapshot()
      .then((state) => {
        if (!active) return
        setSnapshot(state)
        setSelectedRoomID((current) => current || (state.rooms ?? [])[0]?.id || '')
      })
      .catch((snapshotError: unknown) => {
        if (active) setError(describeError(snapshotError))
      })

    return () => {
      active = false
      matrixUpdateHandlerRef.current = null
      unsubscribe()
      unsubscribePreferences()
      unsubscribeHostError()
      unsubscribeMenuAbout()
      unsubscribeMenuSettings()
      unsubscribeMenuSearch()
      unsubscribeMenuAction()
      unsubscribeNotificationOpenRoom()
      unsubscribeAttachmentSent()
      unsubscribeScheduledReminder()
    }
  }, [setSettingsOpen, setSettingsTab])

  useMatrixBatch<MatrixUpdate>((batch) => {
    for (const delta of batch.room_deltas ?? []) {
      matrixUpdateHandlerRef.current?.(delta.update)
    }
    const selectedRoomID = selectedRoomRef.current
    if (selectedRoomID && (
      (batch.new_messages ?? []).some((item) => item.roomId === selectedRoomID)
      || (batch.read_receipts ?? []).some((receipt) => receipt.roomId === selectedRoomID)
    )) {
      setHistoryRevision((revision) => revision + 1)
    }
    for (const typing of batch.typing_updates ?? []) {
      if (typing.roomId === selectedRoomID) setTypingUsers(typing.userIds)
    }
  })

  useEffect(() => {
    mediaGalleryRequestRef.current++
    setMediaGalleryOpen(false)
    setMediaGalleryLoading(false)
  }, [selectedRoomID])

  useEffect(() => {
    if (!selectedRoomID) {
      historyRoomIDRef.current = ''
      setMessages([])
      setOlderCursor(0)
      setHasOlder(false)
      return
    }

    let active = true
    const searchJump = pendingSearchJumpRef.current?.roomID === selectedRoomID ? pendingSearchJumpRef.current : null
    if (pendingSearchJumpRef.current && !searchJump) pendingSearchJumpRef.current = null
    historyRoomIDRef.current = ''
    setLoadingHistory(true)
    setOlderCursor(0)
    setHasOlder(false)
    setLoadingOlder(false)
    timelineHeightBeforePrepend.current = null
    roomSwitchRef.current = true
    stickToBottomRef.current = true
    void (async () => {
      try {
        let page = await AppService.History(selectedRoomID, 0)
        if (!active) return
        let loadedMessages = page.messages ?? []
        let nextBefore = page.before
        let hasMore = page.hasMore
        let jumpPages = 0
        while (
          searchJump && searchJump.timelineCursor > 0 &&
          !loadedMessages.some((message) => message.id === searchJump.eventID) &&
          hasMore && nextBefore > searchJump.timelineCursor && jumpPages < 500
        ) {
          page = await AppService.History(selectedRoomID, nextBefore)
          if (!active) return
          const olderMessages = page.messages ?? []
          if (olderMessages.length === 0 || page.before === nextBefore) {
            hasMore = false
            break
          }
          const loadedKeys = new Set(loadedMessages.map((message) => message.id || message.transactionId))
          loadedMessages = [...olderMessages.filter((message) => !loadedKeys.has(message.id || message.transactionId)), ...loadedMessages]
          nextBefore = page.before
          hasMore = page.hasMore
          jumpPages++
        }
        historyRoomIDRef.current = selectedRoomID
        setMessages(loadedMessages)
        setOlderCursor(nextBefore)
        setHasOlder(hasMore)
        if (searchJump && !loadedMessages.some((message) => message.id === searchJump.eventID)) {
          pendingSearchJumpRef.current = null
          setError('Could not load that message from local history.')
        }
        if (pendingHistoryRefreshRoomIDRef.current === selectedRoomID) {
          pendingHistoryRefreshRoomIDRef.current = ''
          setHistoryRevision((revision) => revision + 1)
        }
      } catch (historyError) {
        if (active) setError(describeError(historyError))
      } finally {
        if (active) setLoadingHistory(false)
      }
    })()

    return () => { active = false }
  }, [selectedRoomID, historyPageRevision])

  useEffect(() => {
    const searchJump = pendingSearchJumpRef.current
    if (!searchJump || searchJump.roomID !== selectedRoomID || loadingHistory || historyRoomIDRef.current !== selectedRoomID) return
    if (!messages.some((message) => message.id === searchJump.eventID)) return
    pendingSearchJumpRef.current = null
    requestAnimationFrame(() => focusTimelineMessage(searchJump.eventID))
  }, [loadingHistory, messages, selectedRoomID])

  useEffect(() => {
    const revisionChanged = historyRevision !== lastObservedHistoryRevisionRef.current
    lastObservedHistoryRevisionRef.current = historyRevision
    if (!selectedRoomID || historyRevision === 0) return
    const roomID = selectedRoomID
    if (historyRoomIDRef.current !== roomID) {
      if (revisionChanged) pendingHistoryRefreshRoomIDRef.current = roomID
      return
    }

    let active = true
    AppService.History(roomID, 0)
      .then((page) => {
        if (!active || selectedRoomRef.current !== roomID) return
        setMessages((current) => mergeTimelineMessages(current, page.messages ?? []))
        if (!hasOlderRef.current) setOlderCursor(page.before)
        if (page.hasMore) setHasOlder(true)
      })
      .catch((historyError: unknown) => {
        if (active) setError(describeError(historyError))
      })

    return () => { active = false }
  }, [historyRevision, selectedRoomID])

  useEffect(() => {
    if (!selectedRoomID || loadingHistory || historyRoomIDRef.current !== selectedRoomID) return
    const eventID = selectedRoom?.lastEventId || newestPersistentMessage(messages)?.id
    if (!eventID || lastReadEventByRoom.current.get(selectedRoomID) === eventID) return
    lastReadEventByRoom.current.set(selectedRoomID, eventID)
    void AppService.MarkRead(selectedRoomID, eventID)
      .then(() => setSnapshot((current) => {
        if (!current) return current
        const room = (current.rooms ?? []).find((candidate) => candidate.id === selectedRoomID)
        if (!room || (room.lastEventId && room.lastEventId !== eventID)) return current
        return {
          ...current,
          rooms: (current.rooms ?? []).map((candidate) => candidate.id === selectedRoomID
            ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 }
            : candidate),
        }
      }))
      .catch((readError: unknown) => {
        if (lastReadEventByRoom.current.get(selectedRoomID) === eventID) lastReadEventByRoom.current.delete(selectedRoomID)
        setError(describeError(readError))
      })
  }, [loadingHistory, messages, selectedRoom?.lastEventId, selectedRoom?.unread, selectedRoom?.mentions, selectedRoomID])

  async function loadOlderMessages() {
    if (!selectedRoomID || !hasOlder || loadingOlder || loadingOlderRef.current) return
    const roomID = selectedRoomID
    timelineHeightBeforePrepend.current = timelineRef.current?.scrollHeight ?? null
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const page = await AppService.History(roomID, olderCursor)
      if (selectedRoomRef.current !== roomID) return
      setMessages((current) => {
        const currentKeys = new Set(current.map((message) => message.id || message.transactionId))
        const olderMessages = (page.messages ?? []).filter((message) => !currentKeys.has(message.id || message.transactionId))
        // Nothing new arrived, so drop the saved height: the prepend-detecting
        // layout effect only runs on a `messages` change and would otherwise
        // apply this stale delta to the next unrelated update.
        if (olderMessages.length === 0) timelineHeightBeforePrepend.current = null
        return [...olderMessages, ...current]
      })
      setOlderCursor(page.before)
      setHasOlder(page.hasMore && page.before !== olderCursor)
    } catch (historyError) {
      setError(describeError(historyError))
      timelineHeightBeforePrepend.current = null
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }

  function closeMediaGallery() {
    mediaGalleryRequestRef.current++
    setMediaGalleryOpen(false)
    setMediaGalleryLoading(false)
  }

  async function openMediaGallery() {
    if (!selectedRoomID || loadingHistory || historyRoomIDRef.current !== selectedRoomID) return
    const roomID = selectedRoomID
    const requestID = ++mediaGalleryRequestRef.current
    const initialItems = messages.filter(hasGalleryMedia)
    const seenMessageKeys = new Set(initialItems.map(mediaGalleryMessageKey))
    const collectedItems = [...initialItems]
    let cursor = 0
    let hasMore = true

    setMediaGalleryFilter('all')
    setMediaGalleryOpen(true)
    setMediaGalleryLoading(true)
    setMediaGalleryScanned(0)
    setMediaGalleryError('')
    setMediaGalleryItems([...collectedItems].sort((left, right) => right.timestamp - left.timestamp))

    try {
      while (hasMore) {
        const page = await AppService.History(roomID, cursor)
        if (mediaGalleryRequestRef.current !== requestID || selectedRoomRef.current !== roomID) return
        const pageMessages = page.messages ?? []
        for (const message of pageMessages) {
          if (!hasGalleryMedia(message)) continue
          const messageKey = mediaGalleryMessageKey(message)
          if (seenMessageKeys.has(messageKey)) continue
          seenMessageKeys.add(messageKey)
          collectedItems.push(message)
        }
        setMediaGalleryItems([...collectedItems].sort((left, right) => right.timestamp - left.timestamp))
        setMediaGalleryScanned((count) => count + pageMessages.length)
        if (page.before === cursor) {
          if (page.hasMore) throw new Error('Room history pagination did not advance.')
          break
        }
        cursor = page.before
        hasMore = page.hasMore
      }
    } catch (galleryError) {
      if (mediaGalleryRequestRef.current === requestID && selectedRoomRef.current === roomID) {
        setMediaGalleryError(describeError(galleryError))
      }
    } finally {
      if (mediaGalleryRequestRef.current === requestID && selectedRoomRef.current === roomID) {
        setMediaGalleryLoading(false)
      }
    }
  }

  const loadOlderMessagesRef = useRef(loadOlderMessages)
  loadOlderMessagesRef.current = loadOlderMessages

  // Keep the viewport filled. A room whose newest page is shorter than the
  // timeline box can't be scrolled at all, so the scroll handler below would
  // never fire and older history would stay stuck behind the button. This
  // terminates: a page either grows the content (stopping the fill) or stops
  // advancing the cursor, which makes loadOlderMessages clear `hasOlder`.
  useEffect(() => {
    const timeline = timelineRef.current
    if (!selectedRoomID || loadingHistory || loadingOlder || !hasOlder) return
    if (!timeline || timeline.clientHeight <= 0) return
    if (timeline.scrollHeight > timeline.clientHeight) return
    void loadOlderMessagesRef.current()
  }, [selectedRoomID, loadingHistory, loadingOlder, hasOlder, messages])

  function messageSearchRequest(nextBatch = ''): MessageSearchRequest | null {
    const query = messageSearch.trim()
    if (!query) return null
    if (searchFrom && searchTo && searchFrom > searchTo) {
      setSearchStatus('The start date must be before the end date.')
      return null
    }
    const minTimestamp = searchFrom ? new Date(`${searchFrom}T00:00:00`).getTime() : 0
    const maxTimestamp = searchTo ? new Date(`${searchTo}T23:59:59.999`).getTime() : 0
    return {
      query,
      roomID: searchRoomID,
      sender: searchSender.trim(),
      minTimestamp,
      maxTimestamp,
      limit: 50,
      nextBatch,
    }
  }

  async function submitMessageSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const request = messageSearchRequest()
    if (!request || searching) return
    setSearching(true)
    setSearchStatus('')
    setSearchResults([])
    setSearchNextBatch('')
    try {
      const found = await AppService.SearchMessages(request)
      const results = found.results ?? []
      setSearchResults(results)
      setSearchNextBatch(found.nextBatch)
      setSearchStatus(results.length === 0 ? 'No matching messages in local history.' : `${results.length} results shown`)
    } catch (searchError) {
      setSearchResults([])
      setSearchStatus(describeError(searchError))
    } finally {
      setSearching(false)
    }
  }

  async function loadMoreSearchResults() {
    const request = messageSearchRequest(searchNextBatch)
    if (!request || !searchNextBatch || searching) return
    setSearching(true)
    setSearchStatus('')
    try {
      const page = await AppService.SearchMessages(request)
      const nextResults = page.results ?? []
      setSearchResults((current) => [...current, ...nextResults])
      setSearchNextBatch(page.nextBatch)
      setSearchStatus(`${searchResults.length + nextResults.length} results shown`)
    } catch (searchError) {
      setSearchStatus(describeError(searchError))
    } finally {
      setSearching(false)
    }
  }

  function openSearchResult(result: MessageSearchResult) {
    const eventID = result.message.id
    if (!eventID) return
    setSearchOpen(false)
    if (selectedRoomID === result.roomID && messages.some((message) => message.id === eventID)) {
      requestAnimationFrame(() => focusTimelineMessage(eventID))
      return
    }
    pendingSearchJumpRef.current = { roomID: result.roomID, eventID, timelineCursor: result.message.timelineCursor }
    if (selectedRoomID === result.roomID) setHistoryPageRevision((revision) => revision + 1)
    else showRoom(result.roomID)
  }

  function closeMessageSearch() {
    setSearchOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Search messages"]')?.focus())
  }

  async function setPreference(key: string, value: boolean | string) {
    const previous = snapshot?.preferences?.[key]
    const roomPreference = /^room\.(favorite|muted)\.(.+)$/.exec(key)
    setSnapshot((current) => {
      if (!current) return current
      const rooms = roomPreference && typeof value === 'boolean'
        ? (current.rooms ?? []).map((room) => room.id === roomPreference[2] ? { ...room, [roomPreference[1]]: value } : room)
        : current.rooms
      return { ...current, preferences: { ...current.preferences, [key]: value }, rooms }
    })
    try {
      if (typeof value === 'boolean') {
        await AppService.SetBooleanPreference(key, value)
      } else {
        await AppService.SetStringPreference(key, value)
      }
      if (key === 'history.initial_messages') setHistoryPageRevision((revision) => revision + 1)
      return true
    } catch (preferenceError) {
      setSnapshot((current) => {
        if (!current) return current
        const nextPreferences = { ...current.preferences }
        if (previous === undefined) delete nextPreferences[key]
        else nextPreferences[key] = previous
        const rooms = roomPreference && (previous === undefined || typeof previous === 'boolean')
          ? (current.rooms ?? []).map((room) => room.id === roomPreference[2] ? { ...room, [roomPreference[1]]: previous === true } : room)
          : current.rooms
        return { ...current, preferences: nextPreferences, rooms }
      })
      setError(describeError(preferenceError))
      return false
    }
  }

  setPreferenceRef.current = setPreference

  function nextRoomByBehavior(excludedRoomIDs: Set<string>, behavior: string) {
    const candidates = filteredRooms.filter((room) => !excludedRoomIDs.has(room.id) && isActiveAccountRoom(room))
    if (behavior === 'none') return ''
    if (behavior === 'next_unread') return candidates.find((room) => room.unread > 0 || room.markedUnread)?.id ?? ''
    return candidates[0]?.id ?? ''
  }

  function nextRoomAfterArchive(archivedRoomIDs: Set<string>) {
    const behavior = preferenceString(preferences, 'archive.next_room', 'next_visible')
    return nextRoomByBehavior(archivedRoomIDs, behavior)
  }

  function clearRoomSelection() {
    setSelectedRoomIDs([])
    roomSelectionAnchorRef.current = ''
  }

  function showUndoToast(roomID: string) {
    if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current)
    setUndoRoomID(roomID)
    undoToastTimerRef.current = window.setTimeout(() => {
      setUndoRoomID((current) => current === roomID ? '' : current)
      undoToastTimerRef.current = null
    }, IN_APP_NOTICE_TIMEOUT_MS)
  }

  function showScheduledNotice(notice: string) {
    if (scheduledNoticeTimerRef.current !== null) window.clearTimeout(scheduledNoticeTimerRef.current)
    setScheduledNotice(notice)
    scheduledNoticeTimerRef.current = window.setTimeout(() => {
      setScheduledNotice('')
      scheduledNoticeTimerRef.current = null
    }, IN_APP_NOTICE_TIMEOUT_MS)
  }

  function clearScheduledNotice() {
    if (scheduledNoticeTimerRef.current !== null) window.clearTimeout(scheduledNoticeTimerRef.current)
    scheduledNoticeTimerRef.current = null
    setScheduledNotice('')
  }

  function clearUndoToast() {
    if (undoToastTimerRef.current !== null) window.clearTimeout(undoToastTimerRef.current)
    undoToastTimerRef.current = null
    setUndoRoomID('')
  }

  async function markRoomRead(roomID: string) {
    const room = rooms.find((candidate) => candidate.id === roomID)
    if (!room || (room.unread === 0 && !room.markedUnread) || !room.lastEventId) return
    try {
      await AppService.MarkRead(room.id, room.lastEventId)
      setSnapshot((current) => current ? {
        ...current,
        rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
      } : current)
      setRoomContextMenu(null)
      clearRoomSelection()
      const behavior = preferenceString(preferences, 'inbox.after_read', 'stay')
      if (behavior !== 'stay') showRoom(nextRoomByBehavior(new Set([roomID]), behavior))
    } catch (readError) {
      setError(describeError(readError))
    }
  }

  async function markRoomUnread(roomID: string) {
    const room = rooms.find((candidate) => candidate.id === roomID)
    if (!room || room.unread > 0 || room.markedUnread) return
    try {
      await AppService.MarkUnread(room.id)
      setSnapshot((current) => current ? {
        ...current,
        rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, markedUnread: true } : candidate),
      } : current)
      setRoomContextMenu(null)
      clearRoomSelection()
      const behavior = preferenceString(preferences, 'inbox.after_read', 'stay')
      if (behavior !== 'stay') showRoom(nextRoomByBehavior(new Set([roomID]), behavior))
    } catch (readError) {
      setError(describeError(readError))
    }
  }

  async function setRoomArchived(roomID: string, archived: boolean) {
    const room = rooms.find((candidate) => candidate.id === roomID)
    if (!room) return
    if (archived && (room.unread > 0 || room.markedUnread) && room.lastEventId) {
      try {
        await AppService.MarkRead(room.id, room.lastEventId)
        setSnapshot((current) => current ? {
          ...current,
          rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
        } : current)
      } catch (readError) {
        setError(describeError(readError))
        return
      }
    }
    const saved = await setPreference(archivedPreferenceKey(roomID), archived)
    setRoomContextMenu(null)
    clearRoomSelection()
    if (saved && archived && selectedRoomID === roomID) {
      showRoom(nextRoomAfterArchive(new Set([roomID])))
    }
  }

  async function archiveAllReadRooms() {
    const readRooms = rooms.filter((room) => room.unread === 0 && !room.markedUnread && !preferenceBoolean(preferences, archivedPreferenceKey(room.id)))
    for (const room of readRooms) await setPreference(archivedPreferenceKey(room.id), true)
    if (readRooms.some((room) => room.id === selectedRoomID)) {
      showRoom(nextRoomAfterArchive(new Set(readRooms.map((room) => room.id))))
    }
  }

  async function archiveInactiveRooms() {
    const ageDays = Number(preferenceString(preferences, 'archive.older_than_days', '90'))
    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000
    const inactiveRooms = rooms.filter((room) => {
      const activityAt = roomActivityAt(room)
      return activityAt > 0 && activityAt < cutoff && !preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId))
    })
    const archivedRoomIDs = new Set<string>()
    for (const room of inactiveRooms) {
      if ((room.unread > 0 || room.markedUnread) && room.lastEventId) {
        try {
          await AppService.MarkRead(room.id, room.lastEventId)
          setSnapshot((current) => current ? {
            ...current,
            rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
          } : current)
        } catch (readError) {
          setError(describeError(readError))
          continue
        }
      }
      if (await setPreference(archivedPreferenceKey(room.id, room.accountId), true)) archivedRoomIDs.add(room.id)
    }
    if (archivedRoomIDs.has(selectedRoomID)) showRoom(nextRoomAfterArchive(archivedRoomIDs))
  }

  const archiveInactiveRoomsRef = useRef(archiveInactiveRooms)
  archiveInactiveRoomsRef.current = archiveInactiveRooms

  useEffect(() => {
    if (!automaticArchiveEnabled) return
    const runArchive = () => {
      if (automaticArchiveInFlightRef.current) return
      automaticArchiveInFlightRef.current = true
      void archiveInactiveRoomsRef.current().finally(() => {
        automaticArchiveInFlightRef.current = false
      })
    }
    runArchive()
    const timer = window.setInterval(runArchive, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [automaticArchiveEnabled, preferences, rooms, selectedRoomID, snapshot?.activeAccountId])

  function openRoomContextMenu(roomID: string, x: number, y: number) {
    const menuWidth = 232
    const menuHeight = isLocalAIRoomID(roomID) ? 340 : selectedRoomIDs.includes(roomID) && selectedRoomIDs.length > 1 ? 232 : 200
    if (!isLocalAIRoomID(roomID) && !selectedRoomIDs.includes(roomID)) {
      setSelectedRoomIDs([roomID])
      roomSelectionAnchorRef.current = roomID
    }
    setLocalAIDeleteArmedID('')
    setMessageContextMenu(null)
    setRoomContextMenu({
      roomID,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    })
  }

  function updateRoomNeedsReply(roomID: string, needsReply: boolean) {
    setSnapshot((current) => current ? {
      ...current,
      rooms: (current.rooms ?? []).map((room) => room.id === roomID ? { ...room, needsReply } : room),
    } : current)
  }

  function openMessageContextMenu(message: Message, x: number, y: number) {
    const menuWidth = 260
    const menuHeight = Math.max(0, Math.min(620, window.innerHeight - 16))
    const targetKey = message.id || message.transactionId
    const targetRow = Array.from(document.querySelectorAll<HTMLElement>('.message-row[data-event-id]'))
      .find((candidate) => candidate.dataset.eventId === targetKey)
    const targetElement = targetRow?.querySelector<HTMLElement>('.message-body') ?? targetRow
    const bounds = targetElement?.getBoundingClientRect()
    setRoomContextMenu(null)
    setMessageContextMenu({
      message,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
      targetBounds: {
        left: Math.max(0, (bounds?.left ?? x) - 8),
        top: Math.max(0, (bounds?.top ?? y) - 8),
        right: Math.min(window.innerWidth, (bounds?.right ?? x) + 8),
        bottom: Math.min(window.innerHeight, (bounds?.bottom ?? y) + 8),
      },
    })
  }

  // The same eligibility rules the old inline action bar used, expressed once
  // so the menu can't drift from what the backend allows.
  function messageContextMenuItems(message: Message): MessageMenuItem[] {
    const unsent = !message.id || message.id.startsWith('~')
    const manageable = !unsent && !message.redacted
    const body = displayMessageBody(message).trim()
    const bookmarkKey = `message.bookmark.${encodeURIComponent(selectedRoomID)}.${encodeURIComponent(message.id)}`
    const bookmarked = preferenceBoolean(preferences, bookmarkKey)
    const room = rooms.find((candidate) => candidate.id === selectedRoomID)
    const canMarkUnread = Boolean(room && room.unread === 0 && !room.markedUnread)
    const canForward = rooms.some((candidate) => candidate.id !== selectedRoomID && isActiveAccountRoom(candidate))
    const receivedAt = message.timestamp > 0
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(message.timestamp))
      : 'unknown time'
    const items: MessageMenuItem[] = [
      { key: 'reply', label: 'Reply', ariaLabel: `Reply to ${message.senderName || message.sender}`, icon: <Reply size={14} />, disabled: unsent, run: () => { setEditTarget(null); setReplyTarget(message) } },
      { key: 'react', label: 'React', ariaLabel: 'Add reaction', icon: <Smile size={14} />, disabled: unsent, run: () => startReaction(message) },
      { key: 'bookmark', label: bookmarked ? 'Remove bookmark' : 'Bookmark', ariaLabel: bookmarked ? 'Remove message bookmark' : 'Bookmark message', icon: <Star size={14} fill={bookmarked ? 'currentColor' : 'none'} />, disabled: !manageable, run: () => void setPreference(bookmarkKey, !bookmarked) },
      { key: 'mark-unread', label: 'Mark as unread', ariaLabel: 'Mark room as unread', icon: <CircleDot size={14} />, disabled: !canMarkUnread, run: () => void markRoomUnread(selectedRoomID) },
      { key: 'copy', label: 'Copy message', ariaLabel: 'Copy message', icon: <Copy size={14} />, disabled: !body, separatorBefore: true, run: () => void copyMessage(message) },
      { key: 'copy-timestamp', label: 'Copy with timestamp', ariaLabel: 'Copy message with timestamp', icon: <Clock3 size={14} />, disabled: !body, run: () => void copyMessage(message, true) },
      { key: 'forward', label: 'Forward...', ariaLabel: 'Forward message', icon: <ArrowUpRight size={14} />, disabled: !manageable || !body || Boolean(message.mediaUri || message.mediaType || message.mediaMime) || !canForward, run: () => openMessageForward(message) },
      { key: 'received-at', label: `Received at ${receivedAt}`, ariaLabel: `Received at ${receivedAt}`, icon: <Clock3 size={14} />, disabled: true, separatorBefore: true, run: () => { } },
      { key: 'remind', label: 'Set reminder', ariaLabel: 'Set reminder for message', icon: <BellRing size={14} />, disabled: !manageable, separatorBefore: true, run: () => openReminder(message) },
      { key: 'language-tutor', label: 'Analyze with Language Tutor', ariaLabel: 'Analyze message with Language Tutor', icon: <Languages size={14} />, disabled: !aiEnabled || !body || Boolean(message.redacted), run: () => void analyzeWithLanguageTutor(body, 'message') },
      { key: 'ai-reply', label: 'Draft reply with AI', ariaLabel: 'Draft reply with local AI', icon: <Reply size={14} />, disabled: !aiEnabled || !manageable || !message.body, run: () => draftAIReply(message) },
      { key: 'ai-explain', label: 'Explain message', ariaLabel: 'Explain message with local AI', icon: <Sparkles size={14} />, disabled: !aiEnabled || !manageable || !message.body, run: () => explainMessage(message) },
    ]
    if (message.own && manageable) {
      items.push({ key: 'edit', label: 'Edit', ariaLabel: 'Edit message', icon: <Pencil size={13} />, run: () => { setReplyTarget(null); setEditTarget(message); setComposeText(message.body); setMentionBindings([]); setMentionStart(-1) } })
      items.push({ key: 'delete', label: 'Delete', ariaLabel: 'Delete message', danger: true, icon: <Trash2 size={13} />, run: () => setRedactTarget(message) })
    }
    if (message.sendError && message.sendError !== 'not sent' && message.transactionId) {
      items.push({ key: 'retry', label: 'Retry sending', ariaLabel: 'Retry sending message', icon: <RotateCcw size={13} />, run: () => void retryMessage(message) })
    }
    return items
  }

  async function copyMessage(message: Message, includeTimestamp = preferenceBoolean(preferences, 'clipboard.copy_timestamp')) {
    const body = displayMessageBody(message)
    const timestamp = includeTimestamp
      ? `[${new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(message.timestamp))}] ${message.senderName || message.sender}: `
      : ''
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
      await navigator.clipboard.writeText(`${timestamp}${body}`)
    } catch (copyError) {
      setError(describeError(copyError))
    }
  }

  function openMessageForward(message: Message) {
    const destination = rooms.find((candidate) => candidate.id !== selectedRoomID && isActiveAccountRoom(candidate))
    if (!destination) return
    setMessageContextMenu(null)
    setForwardTargetRoomID(destination.id)
    setForwardError('')
    setForwardingMessage(message)
  }

  async function confirmMessageForward() {
    if (!forwardingMessage || forwardBusy) return
    const destination = rooms.find((candidate) => candidate.id === forwardTargetRoomID && isActiveAccountRoom(candidate))
    const body = displayMessageBody(forwardingMessage).trim()
    if (!destination || !body) return
    setForwardBusy(true)
    setForwardError('')
    try {
      const sender = forwardingMessage.senderName || forwardingMessage.sender || 'Unknown sender'
      await dispatchMessage({ roomID: destination.id, text: `Forwarded from ${sender}:\n\n${body}`, replyTo: null, mentionUserIDs: [] })
      setForwardingMessage(null)
      void refreshRoomSnapshotAfterSend()
    } catch (sendError) {
      setForwardError(describeError(sendError))
    } finally {
      setForwardBusy(false)
    }
  }

  // Records the answered mark. Unanswered stays set; only Needs reply clears.
  async function clearNeedsReply(room: Room) {
    await AppService.SetRoomUnanswered(room.id, false)
    updateRoomNeedsReply(room.id, false)
  }

  async function markRoomAnswered(roomID: string) {
    setRoomContextMenu(null)
    clearRoomSelection()
    const targetRoom = roomsRef.current.find((room) => room.id === roomID)
    if (triageBusyRef.current || !targetRoom || !isNeedsReplyRoom(targetRoom)) return
    triageBusyRef.current = true
    setError('')
    const wasSelected = selectedRoomRef.current === roomID
    const visibleIndex = filteredRooms.findIndex((room) => room.id === roomID)
    const nextRoom = visibleIndex >= 0 && filteredRooms.length > 1
      ? filteredRooms[(visibleIndex + 1) % filteredRooms.length]
      : roomsRef.current.find((room) => room.id !== roomID)
    try {
      await clearNeedsReply(targetRoom)
      showUndoToast(roomID)
      if (wasSelected && nextRoom && isActiveAccountRoom(nextRoom)) showRoom(nextRoom.id)
    } catch (triageError) {
      setError(describeError(triageError))
    } finally {
      triageBusyRef.current = false
    }
  }
  markRoomAnsweredRef.current = markRoomAnswered

  async function applyBulkRoomAction(action: 'answered' | 'needs-reply' | 'read' | 'unread' | 'archive' | 'restore' | 'favorite' | 'unfavorite', targetRooms: Room[]) {
    const targetRoomIDs = new Set(targetRooms.map((room) => room.id))
    setRoomContextMenu(null)
    clearRoomSelection()

    if (action === 'favorite' || action === 'unfavorite') {
      for (const room of targetRooms) await setPreference(`room.favorite.${room.id}`, action === 'favorite')
      return
    }

    if (action === 'answered') {
      let changed = false
      for (const room of targetRooms) {
        if (!isNeedsReplyRoom(room)) continue
        try {
          await clearNeedsReply(room)
          changed = true
        } catch (actionError) {
          setError(describeError(actionError))
        }
      }
      if (changed && targetRoomIDs.has(selectedRoomID)) {
        const selectedIndex = filteredRooms.findIndex((room) => room.id === selectedRoomID)
        const candidates = selectedIndex >= 0
          ? [...filteredRooms.slice(selectedIndex + 1), ...filteredRooms.slice(0, selectedIndex)]
          : filteredRooms
        const nextRoom = candidates.find((room) => !targetRoomIDs.has(room.id) && isActiveAccountRoom(room))
        if (nextRoom) showRoom(nextRoom.id)
      }
      return
    }

    if (action === 'needs-reply') {
      for (const room of targetRooms) {
        if (!isUnansweredRoom(room) || isNeedsReplyRoom(room)) continue
        try {
          await AppService.SetRoomUnanswered(room.id, true)
          updateRoomNeedsReply(room.id, true)
        } catch (actionError) {
          setError(describeError(actionError))
        }
      }
      return
    }

    if (action === 'read' || action === 'unread') {
      for (const room of targetRooms) {
        if (action === 'read') {
          if ((room.unread === 0 && !room.markedUnread) || !room.lastEventId) continue
          try {
            await AppService.MarkRead(room.id, room.lastEventId)
            setSnapshot((current) => current ? {
              ...current,
              rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
            } : current)
          } catch (actionError) {
            setError(describeError(actionError))
          }
        } else {
          if (room.unread > 0 || room.markedUnread) continue
          try {
            await AppService.MarkUnread(room.id)
            setSnapshot((current) => current ? {
              ...current,
              rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, markedUnread: true } : candidate),
            } : current)
          } catch (actionError) {
            setError(describeError(actionError))
          }
        }
      }
      const behavior = preferenceString(preferences, 'inbox.after_read', 'stay')
      if (behavior !== 'stay') showRoom(nextRoomByBehavior(targetRoomIDs, behavior))
      return
    }

    const archivedRoomIDs = new Set<string>()
    for (const room of targetRooms) {
      const archived = action === 'archive'
      const key = archivedPreferenceKey(room.id, room.accountId)
      if (archived && (room.unread > 0 || room.markedUnread) && room.lastEventId) {
        try {
          await AppService.MarkRead(room.id, room.lastEventId)
          setSnapshot((current) => current ? {
            ...current,
            rooms: (current.rooms ?? []).map((candidate) => candidate.id === room.id ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 } : candidate),
          } : current)
        } catch (actionError) {
          setError(describeError(actionError))
          continue
        }
      }
      if (await setPreference(key, archived) && archived) archivedRoomIDs.add(room.id)
    }
    if (action === 'archive' && archivedRoomIDs.has(selectedRoomID)) showRoom(nextRoomAfterArchive(archivedRoomIDs))
  }

  function handleMarkAnsweredKeyDown(event: KeyboardEvent<HTMLElement>, roomID: string) {
    if (!singleKeyShortcuts || event.altKey || event.metaKey || event.ctrlKey || event.key.toUpperCase() !== answeredShortcut) return
    const room = roomsRef.current.find((candidate) => candidate.id === roomID)
    if (!room || !isNeedsReplyRoom(room)) return
    event.preventDefault()
    event.stopPropagation()
    void markRoomAnswered(roomID)
  }

  function handleRoomActionShortcut(event: KeyboardEvent<HTMLElement>, targetRooms: Room[]) {
    const key = event.key.toLowerCase()
    if (!singleKeyShortcuts || event.repeat || event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
    if (!['n', 'u', 'a', 'f'].includes(key) || targetRooms.length === 0) return false

    let action: 'needs-reply' | 'read' | 'unread' | 'archive' | 'restore' | 'favorite' | 'unfavorite'
    let actionRooms = targetRooms
    if (key === 'n') {
      action = 'needs-reply'
      actionRooms = targetRooms.filter((room) => isUnansweredRoom(room) && !isNeedsReplyRoom(room))
      if (actionRooms.length === 0) return false
    } else if (key === 'u') {
      action = targetRooms.some(isUnreadRoom) ? 'read' : 'unread'
    } else if (key === 'a') {
      action = targetRooms.some((room) => !preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId))) ? 'archive' : 'restore'
    } else {
      action = targetRooms.some((room) => !room.favorite) ? 'favorite' : 'unfavorite'
    }

    event.preventDefault()
    void applyBulkRoomAction(action, actionRooms)
    return true
  }

  async function undoAnswered() {
    const roomID = undoRoomID
    if (!roomID || triageBusyRef.current) return
    triageBusyRef.current = true
    setError('')
    try {
      await AppService.SetRoomUnanswered(roomID, true)
      updateRoomNeedsReply(roomID, true)
      clearUndoToast()
      showRoom(roomID)
    } catch (triageError) {
      setError(describeError(triageError))
    } finally {
      triageBusyRef.current = false
    }
  }

  function showRoom(roomID: string) {
    if (roomID) setLocalAIChatOpen(false)
    if (selectedRoomRef.current === roomID && historyRoomIDRef.current === roomID) {
      setHistoryRevision((revision) => revision + 1)
    }
    if (selectedRoomRef.current !== roomID) {
      historyRoomIDRef.current = ''
      setMessages([])
      setLoadingHistory(Boolean(roomID))
      setOlderCursor(0)
      setHasOlder(false)
      setLoadingOlder(false)
      timelineHeightBeforePrepend.current = null
    }
    roomSwitchRef.current = true
    stickToBottomRef.current = true
    setSelectedRoomID(roomID)
    setMobilePane(roomID ? 'conversation' : 'rooms')
    requestAnimationFrame(() => {
      if (roomID) composerInputRef.current?.focus()
    })
  }

  function isActiveAccountRoom(room: Room) {
    return !room.accountId || room.accountId === snapshot?.activeAccountId
  }

  function isLastMessageByCurrentUser(room: Room) {
    const userID = isActiveAccountRoom(room)
      ? snapshot?.profile.userId
      : snapshot?.accounts?.find((account) => account.id === room.accountId)?.profile.userId
    return Boolean(room.lastEventSender && userID === room.lastEventSender)
  }

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

  function selectRoomByOffset(direction: number, unansweredOnly = false) {
    const availableRooms = filteredRooms.filter((room) => !unansweredOnly || isNeedsReplyRoom(room))
    if (availableRooms.length === 0) return
    const currentIndex = availableRooms.findIndex((room) => room.id === selectedRoomRef.current && isActiveAccountRoom(room))
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : availableRooms.length - 1
      : (currentIndex + direction + availableRooms.length) % availableRooms.length
    openInboxRoom(availableRooms[nextIndex])
  }

  function handleApplicationKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (settingsOpen || roomInfoOpen || leaveConfirmOpen || redactTarget || quickSwitcherOpen || messageContextMenu) return
    if (event.key === 'Escape' && searchOpen) {
      event.preventDefault()
      closeMessageSearch()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'g' && localAIChatOpen && localAIChatId) {
      event.preventDefault()
      const preferenceKey = localAIIncludeInAllPreference(localAIChatId)
      void setPreference(preferenceKey, !preferenceBoolean(preferences, preferenceKey))
      return
    }
    if (isTextEntryTarget(event.target)) return

    const shortcutRooms = roomContextMenu
      ? contextMenuRooms
      : rooms.filter((room) => room.id === selectedRoomID && isActiveAccountRoom(room))
    if (roomContextMenu) {
      handleRoomActionShortcut(event, shortcutRooms)
      return
    }
    if (handleRoomActionShortcut(event, shortcutRooms)) return

    const key = event.key.toLowerCase()
    const hasPrimaryModifier = event.metaKey || event.ctrlKey
    const accountShortcutNumber = event.code.match(/^Digit([1-9])$/)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : '')
    if (hasPrimaryModifier && event.altKey && accountShortcutNumber) {
      const account = snapshot?.accounts?.[Number(accountShortcutNumber) - 1]
      if (account) {
        event.preventDefault()
        void switchAccount(account.id)
      }
      return
    }
    if (!hasPrimaryModifier && !event.altKey && event.key === '?') {
      event.preventDefault()
      setSettingsTab('Keyboard')
      setSettingsOpen(true)
      return
    }
    if (!hasPrimaryModifier && !event.altKey && event.key === '/') {
      event.preventDefault()
      roomSearchInputRef.current?.focus()
      return
    }
    if (hasPrimaryModifier && !event.altKey) {
      if (key === 'k') {
        event.preventDefault()
        if (roomsRef.current.length > 0) {
          setQuickSwitcherQuery('')
          setQuickSwitcherIndex(0)
          setQuickSwitcherOpen(true)
        }
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        void setPreference('appearance.zoom', String(Math.min(125, appZoom + 5)))
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        void setPreference('appearance.zoom', String(Math.max(75, appZoom - 5)))
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        void setPreference('appearance.zoom', '100')
        return
      }
      if (key === 'f' && !event.shiftKey) {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (event.key === ',' || event.code === 'Comma') {
        event.preventDefault()
        setSettingsOpen(true)
        return
      }
      if (event.shiftKey && key === 's') {
        event.preventDefault()
        roomSearchInputRef.current?.focus()
        return
      }
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        selectRoomByOffset(event.key === 'ArrowDown' ? 1 : -1, true)
        return
      }
      if (event.shiftKey && key === 'a') {
        event.preventDefault()
        setRoomScope('all')
        setRoomRefinements({ unanswered: false, needsReply: false, favorite: false })
        return
      }
      if (event.shiftKey && key === 'h') {
        event.preventDefault()
        setRoomScope('archived')
        setRoomRefinements({ unanswered: false, needsReply: false, favorite: false })
        return
      }
      if (event.shiftKey && key === 'r') {
        event.preventDefault()
        setRoomScope('all')
        setRoomRefinements({ unanswered: true, needsReply: false, favorite: false })
        return
      }
      if (event.shiftKey && key === 'f') {
        event.preventDefault()
        setRoomScope('all')
        setRoomRefinements({ unanswered: false, needsReply: false, favorite: true })
        return
      }
      if (event.shiftKey && key === 'u') {
        event.preventDefault()
        setRoomScope('all')
        setRoomRefinements({ unanswered: false, needsReply: true, favorite: false })
        return
      }
      if (event.shiftKey && key === 'm') {
        event.preventDefault()
        startLocalAIChat()
        return
      }
      if (event.shiftKey && key === 'l') {
        event.preventDefault()
        jumpToLatest()
        return
      }
      if (/^[1-9]$/.test(event.key)) {
        const room = filteredRooms[Number(event.key) - 1]
        if (room) {
          event.preventDefault()
          openInboxRoom(room)
        }
        return
      }
      if (key === 'z' && undoRoomID) {
        event.preventDefault()
        void undoAnswered()
        return
      }
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      selectRoomByOffset(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  function handleRoomKeyDown(event: KeyboardEvent<HTMLButtonElement>, room: Room, index: number) {
    if (isActiveAccountRoom(room)) handleMarkAnsweredKeyDown(event, room.id)
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (isActiveAccountRoom(room) && ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu')) {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      openRoomContextMenu(room.id, bounds.right - 216, bounds.bottom)
      return
    }
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? filteredRooms.length - 1 : index + direction
    if (direction === 0 && event.key !== 'Home' && event.key !== 'End') return
    const list = roomListRef.current
    const nextButton = list?.querySelector<HTMLButtonElement>(`.room-button[data-room-index="${nextIndex}"]`)
    if (nextButton) {
      event.preventDefault()
      nextButton.focus()
    } else if (list && nextIndex >= 0 && nextIndex < filteredRooms.length) {
      event.preventDefault()
      const rowHeight = preferenceBoolean(preferences, 'sidebar.compact_chat_list') ? 46 : 62
      list.scrollTop = nextIndex * rowHeight
      list.dispatchEvent(new Event('scroll'))
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        list.querySelector<HTMLButtonElement>(`.room-button[data-room-index="${nextIndex}"]`)?.focus()
      }))
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await AppService.Login(homeserver.trim(), username.trim(), password)
      setPassword('')
      const state = await AppService.Snapshot()
      setSnapshot(state)
      setSelectedRoomID((state.rooms ?? [])[0]?.id ?? '')
    } catch (loginError) {
      setError(describeError(loginError))
    } finally {
      setBusy(false)
    }
  }

  function resetAccountWorkspace(state: Snapshot) {
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
    draftsRef.current.clear()
    lastReadEventByRoom.current.clear()
    historyRoomIDRef.current = ''
    pendingHistoryRefreshRoomIDRef.current = ''
    void refreshScheduledJobs()
  }

  async function switchAccount(accountID: string, roomID = '') {
    if (accountID === snapshot?.activeAccountId) {
      setAccountManagerOpen(false)
      if (roomID) showRoom(roomID)
      return
    }
    setBusy(true)
    setAccountError('')
    try {
      const state = await AppService.SwitchAccount(accountID)
      resetAccountWorkspace(state)
      if (roomID) showRoom(roomID)
      setAccountManagerOpen(false)
    } catch (switchError) {
      setAccountError(describeError(switchError))
    } finally {
      setBusy(false)
    }
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

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await AppService.Verify(recoveryKey.trim())
      setRecoveryKey('')
      setSnapshot(await AppService.Snapshot())
    } catch (verificationError) {
      setError(describeError(verificationError))
    } finally {
      setBusy(false)
    }
  }

  async function submitScheduledDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!scheduledDraft || scheduledSaving) return
    const dueAt = new Date(scheduledDueAt).getTime()
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
      setScheduledDialogError('Choose a time in the future.')
      return
    }
    setScheduledSaving(true)
    setScheduledDialogError('')
    try {
      if (scheduledDraft.kind === 'message') {
        if (scheduledDraft.replyToEventID) {
          await AppService.ScheduleReply(scheduledDraft.roomID, scheduledDraft.text, scheduledDraft.replyToEventID, dueAt)
        } else {
          await AppService.ScheduleMessage(scheduledDraft.roomID, scheduledDraft.text, dueAt)
        }
        draftsRef.current.delete(scheduledDraft.roomID)
        if (selectedRoomRef.current === scheduledDraft.roomID) setComposeText('')
        setMentionBindings([])
        setMentionStart(-1)
        setReplyTarget(null)
      } else {
        await AppService.ScheduleReminder(scheduledDraft.roomID, scheduledDraft.eventID, scheduledDraft.text, dueAt)
        if (scheduledDraft.archiveAfter) await setRoomArchived(scheduledDraft.roomID, true)
      }
      setScheduledDraft(null)
      await refreshScheduledJobs()
    } catch (scheduleError) {
      setScheduledDialogError(describeError(scheduleError))
    } finally {
      setScheduledSaving(false)
    }
  }

  async function manageScheduledJob(id: string, action: 'reschedule' | 'cancel' | 'retry' | 'dismiss') {
    if (scheduledBusyID) return
    setScheduledBusyID(id)
    setScheduledJobsError('')
    try {
      if (action === 'reschedule') {
        const dueAt = new Date(scheduledTimes[id] ?? '').getTime()
        if (!Number.isFinite(dueAt) || dueAt <= Date.now()) throw new Error('Choose a time in the future.')
        await AppService.UpdateScheduledJob(id, dueAt)
      } else if (action === 'cancel') {
        await AppService.CancelScheduledJob(id)
      } else if (action === 'retry') {
        await AppService.RetryScheduledMessage(id)
      } else {
        await AppService.DismissScheduledJob(id)
      }
      await refreshScheduledJobs()
    } catch (jobError) {
      setScheduledJobsError(describeError(jobError))
    } finally {
      setScheduledBusyID('')
    }
  }

  async function dispatchMessage(message: OutgoingMessage) {
    if (message.replyTo) await AppService.SendReply(message.roomID, message.text, message.replyTo.id)
    else if (message.mentionUserIDs.length > 0) await AppService.SendMessageWithMentions(message.roomID, message.text, message.mentionUserIDs)
    else await AppService.SendMessage(message.roomID, message.text)
    if (preferenceString(preferencesRef.current, 'sounds.effects', 'Off') === 'Sent messages') {
      playNotificationSound(preferenceNumber(preferencesRef.current, 'notifications.volume', 50), 'Soft')
    }
  }

  async function refreshRoomSnapshotAfterSend() {
    try {
      setSnapshot(await AppService.Snapshot())
    } catch {
    }
  }

  function notificationRoomName(notification: MatrixNotification) {
    return notification.room || roomsRef.current.find((room) => room.id === notification.roomId)?.name || notification.roomId
  }

  function playNotificationAlert(preferences: PreferenceValues, category: string) {
    if (!preferenceBoolean(preferences, 'notifications.sound')) return
    playNotificationSound(preferenceNumber(preferences, 'notifications.volume', 50), notificationTone(preferences, category))
  }

  function deliverNotification(preferences: PreferenceValues, notification: MatrixNotification, text: NotificationText, scheduleRepeat = true) {
    if (nativeNotificationsRef.current) {
      void AppService.SendNotification({
        title: text.title,
        subtitle: text.subtitle,
        body: text.body,
        roomId: notification.roomId,
        accountId: notification.accountId ?? '',
        senderAvatar: notification.senderAvatar ?? '',
      })
        .then((delivered) => {
          if (delivered) playNotificationAlert(preferences, notification.category)
        })
        .catch((notificationError: unknown) => setError(describeError(notificationError)))
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const systemNotification = new Notification(text.title, { body: text.subtitle ? `${text.subtitle}: ${text.body}` : text.body })
        systemNotification.onclick = () => {
          window.focus()
          showRoom(notification.roomId)
        }
        playNotificationAlert(preferences, notification.category)
      } catch (notificationError) {
        setError(describeError(notificationError))
      }
    }
    if (scheduleRepeat) scheduleRepeatReminder(preferences, notification)
  }

  function queueNotificationBatch(notification: MatrixNotification, batchSeconds: number) {
    const batches = notificationBatchesRef.current
    const existing = batches.get(notification.roomId)
    if (existing) {
      existing.notifications.push(notification)
      return
    }
    const timer = window.setTimeout(() => flushNotificationBatch(notification.roomId), batchSeconds * 1000)
    batches.set(notification.roomId, { notifications: [notification], timer })
  }

  function flushNotificationBatch(roomID: string) {
    const batch = notificationBatchesRef.current.get(roomID)
    notificationBatchesRef.current.delete(roomID)
    if (!batch || batch.notifications.length === 0) return
    const preferences = preferencesRef.current
    if (selectedRoomRef.current === roomID) return
    const [first] = batch.notifications
    if (!notificationAllowed(preferences, roomID, first.category)) return
    if (batch.notifications.length === 1) {
      deliverNotification(preferences, first, notificationText(preferences, first, notificationRoomName(first)))
      return
    }
    const hidden = preferenceString(preferences, 'notifications.privacy', 'Sender and message preview') === 'Hidden content'
    const senders = [...new Set(batch.notifications.map((item) => item.sender).filter(Boolean))]
    const roomName = notificationRoomName(first)
    const singleSender = senders.length === 1 && first.category !== 'direct'
    const body = `${batch.notifications.length} new messages${senders.length > 0 ? ` from ${senders.slice(0, 3).join(', ')}` : ''}`
    const text: NotificationText = hidden
      ? { title: 'Matrix', subtitle: '', body: 'New activity' }
      : { title: senders.length === 1 ? senders[0] : roomName, subtitle: singleSender ? roomName : '', body }
    deliverNotification(preferences, first, text)
  }

  function scheduleRepeatReminder(preferences: PreferenceValues, notification: MatrixNotification) {
    const minutes = preferenceNumber(preferences, 'notifications.repeat_minutes', 0, 0, 60)
    const reminders = repeatRemindersRef.current
    const existing = reminders.get(notification.roomId)
    if (existing !== undefined) window.clearTimeout(existing)
    reminders.delete(notification.roomId)
    if (minutes <= 0) return
    const timer = window.setTimeout(() => {
      reminders.delete(notification.roomId)
      const current = preferencesRef.current
      const room = roomsRef.current.find((item) => item.id === notification.roomId)
      if (!room || (room.unread <= 0 && !room.markedUnread) || selectedRoomRef.current === notification.roomId) return
      if (!notificationAllowed(current, notification.roomId, notification.category)) return
      const roomName = notificationRoomName(notification)
      const hidden = preferenceString(current, 'notifications.privacy', 'Sender and message preview') === 'Hidden content'
      deliverNotification(current, notification, { title: hidden ? 'Matrix' : `Still unread · ${roomName}`, subtitle: '', body: 'You still have unread messages.' }, false)
    }, minutes * 60_000)
    reminders.set(notification.roomId, timer)
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

  function handleTimelineAudioEnded(messageID: string) {
    if (!preferenceBoolean(preferences, 'voice.autoplay_next')) return
    const index = visibleMessages.findIndex((message) => message.id === messageID)
    for (let nextIndex = index + 1; nextIndex < visibleMessages.length; nextIndex++) {
      const message = visibleMessages[nextIndex]
      const mime = message.mediaMime || ''
      if (message.mediaUri && !message.redacted && !message.decryptionError && (mime.startsWith('audio/') || message.mediaType === 'm.audio')) {
        setAutoPlayNextMessageId(message.id)
        return
      }
    }
    setAutoPlayNextMessageId(null)
  }

  // Staged files are sent with the next message and are held back while a message is being edited.
  const stagedRoomAttachments = stagedAttachments.filter((item) => item.roomID === selectedRoomID)
  const sendableStagedAttachments = editTarget ? [] : stagedRoomAttachments

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const roomID = selectedRoomID
    const customReplacements = parseCustomEmoticonReplacements(preferenceString(preferences, 'emoji.emoticon_replacements', ''))
    const text = (preferenceBoolean(preferences, 'emoji.replace_emoticons', true) ? replaceEmoticons(composeText, customReplacements) : composeText).trim()
    if (!roomID || (!text && sendableStagedAttachments.length === 0) || busy) return
    const mentionUserIDs = [...new Set(mentionBindings.filter(({ token }) => text.includes(token)).map(({ userID }) => userID))]
    const attachments = sendableStagedAttachments
    if (attachments.some((item) => mediaKindForFile(item.file) !== 'file')) {
      setMediaApproval({
        items: attachments.map((item) => mediaApprovalItemFromFile(item.id, item.file, item.previewURL)),
        onApprove: () => void sendComposerDraft(roomID, text, mentionUserIDs, attachments),
      })
      return
    }
    await sendComposerDraft(roomID, text, mentionUserIDs, attachments)
  }

  // resolveMediaApproval closes the media approval dialog and runs the pending send only when approved. Cancelling keeps staged attachments in the composer.
  function resolveMediaApproval(approved: boolean) {
    const request = mediaApproval
    setMediaApproval(null)
    if (!request) return
    if (approved) request.onApprove()
    else request.onCancel?.()
  }

  // sendComposerDraft uploads staged attachments, then sends the text message or edit. Media sends reach it only after the approval dialog is accepted.
  async function sendComposerDraft(roomID: string, text: string, mentionUserIDs: string[], attachments: StagedAttachment[]) {
    setBusy(true)
    setError('')
    try {
      for (const item of attachments) {
        await uploadAttachmentFile(roomID, item.file)
        removeStagedAttachment(item)
      }
      if (!text) {
        stickToBottomRef.current = true
        scrollTimelineToBottom()
        setHistoryRevision((revision) => revision + 1)
        return
      }
      if (editTarget) {
        await AppService.EditMessage(roomID, text, editTarget.id)
      } else {
        await dispatchMessage({ roomID, text, replyTo: replyTarget, mentionUserIDs })
        await refreshRoomSnapshotAfterSend()
      }
      const nextDraft = editTarget ? draftsRef.current.get(roomID) ?? '' : ''
      if (!editTarget) draftsRef.current.delete(roomID)
      if (selectedRoomRef.current === roomID) setComposeText(nextDraft)
      setMentionBindings([])
      setMentionStart(-1)
      setReplyTarget(null)
      setEditTarget(null)
      stickToBottomRef.current = true
      scrollTimelineToBottom()
      setHistoryRevision((revision) => revision + 1)
    } catch (sendError) {
      setError(describeError(sendError))
    } finally {
      setBusy(false)
    }
  }

  async function uploadAttachmentFile(roomID: string, file: File, recording?: RecordedUpload) {
    const query = new URLSearchParams({
      filename: file.name,
      voiceNote: String(recording?.kind === 'voice'),
      videoMessage: String(recording?.kind === 'video'),
      durationMs: String(recording?.durationMilliseconds ?? 0),
    })
    // WKWebView can deliver a File body as an empty stream on the app's custom scheme; raw bytes arrive intact.
    const bytes = new Uint8Array(await file.arrayBuffer())
    await requestLocalAsset(`/media/ipc/attachment/${encodeURIComponent(roomID)}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: bytes,
    })
  }

  async function sendAttachmentFiles(files: File[], roomID = selectedRoomID, recording?: RecordedUpload) {
    if (files.length === 0) return
    if (!roomID) {
      setError('Select a room before uploading files.')
      return
    }
    if (busy) return
    setBusy(true)
    setError('')
    try {
      let uploadedAny = false
      for (const file of files) {
        if (file.size > maxAttachmentBytes) {
          setError(`${file.name || 'Attachments'} cannot exceed 50 MiB.`)
          continue
        }
        await uploadAttachmentFile(roomID, file, recording)
        uploadedAny = true
      }
      if (uploadedAny) setHistoryRevision((revision) => revision + 1)
    } catch (uploadError) {
      setError(describeError(uploadError))
    } finally {
      setBusy(false)
    }
  }

  function stageAttachmentFiles(files: File[]) {
    const roomID = selectedRoomID
    if (!roomID) {
      setError('Select a room before attaching files.')
      return
    }
    setError('')
    const staged: StagedAttachment[] = []
    for (const file of files) {
      if (file.size > maxAttachmentBytes) {
        setError(`${file.name || 'Attachments'} cannot exceed 50 MiB.`)
        continue
      }
      staged.push({
        id: globalThis.crypto?.randomUUID?.() ?? `staged-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        roomID,
        file,
        previewURL: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      })
    }
    if (staged.length > 0) setStagedAttachments((current) => [...current, ...staged])
  }

  function removeStagedAttachment(item: StagedAttachment) {
    if (item.previewURL) URL.revokeObjectURL(item.previewURL)
    setStagedAttachments((current) => current.filter((staged) => staged.id !== item.id))
  }

  function handleAttachmentInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) stageAttachmentFiles([file])
  }

  async function startRecording(kind: CaptureKind) {
    if (!selectedRoomID || busy || voiceCaptureStatus) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(`${kind === 'video' ? 'Video' : 'Voice'} recording is not supported in this environment.`)
      return
    }
    let stream: MediaStream | null = null
    try {
      const audioConstraints: MediaStreamConstraints['audio'] = selectedAudioInputDeviceId
        ? { deviceId: { exact: selectedAudioInputDeviceId } }
        : true
      const constraints: MediaStreamConstraints = kind === 'video'
        ? { audio: audioConstraints, video: { width: { ideal: 640 }, height: { ideal: 480 } } }
        : { audio: audioConstraints }
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      void navigator.mediaDevices.enumerateDevices?.().then((devices) => {
        setAudioInputDevices(devices.filter((device) => device.kind === 'audioinput'))
      }).catch(() => { })
      const startedAt = Date.now()
      const mimeType = kind === 'video' ? preferredVideoMimeType() : ''
      const recorder = kind === 'video'
        ? new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_000_000 })
        : new MediaRecorder(stream)
      voiceChunksRef.current = []
      voiceRoomIDRef.current = selectedRoomID
      voiceStreamRef.current = stream
      voiceRecorderRef.current = recorder
      recorder.ondataavailable = (event) => { if (event.data.size > 0) voiceChunksRef.current.push(event.data) }
      recorder.onstop = () => {
        const roomID = voiceRoomIDRef.current
        const chunks = voiceChunksRef.current
        voiceChunksRef.current = []
        voiceRecorderRef.current = null
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = null
        if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current)
        voiceTimeoutRef.current = null
        if (chunks.length === 0) {
          setVoiceCaptureStatus(null)
          return
        }
        setVoiceCaptureStatus('processing')
        if (kind === 'video') {
          const durationMilliseconds = Math.max(1, Math.min(Date.now() - startedAt, maxVideoMessageMilliseconds))
          const extension = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'
          const file = new File(chunks, `video-message-${Date.now()}.${extension}`, { type: recorder.mimeType || `video/${extension}` })
          setMediaApproval({
            items: [mediaApprovalItemFromFile(file.name, file, '')],
            onApprove: () => void sendAttachmentFiles([file], roomID, { kind, durationMilliseconds }).finally(() => setVoiceCaptureStatus(null)),
            onCancel: () => setVoiceCaptureStatus(null),
          })
          return
        }
        void (async () => {
          const audioContext = new AudioContext()
          try {
            const decoded = await audioContext.decodeAudioData(await new Blob(chunks).arrayBuffer())
            const wav = encodeVoiceNoteWav(decoded)
            const durationMilliseconds = Math.round(decoded.duration * 1000)
            const file = new File([wav], `voice-note-${Date.now()}.wav`, { type: 'audio/wav' })
            setMediaApproval({
              items: [mediaApprovalItemFromFile(file.name, file, '')],
              onApprove: () => void sendAttachmentFiles([file], roomID, { kind, durationMilliseconds }).finally(() => setVoiceCaptureStatus(null)),
              onCancel: () => setVoiceCaptureStatus(null),
            })
          } catch (recordError) {
            setError(describeError(recordError))
            setVoiceCaptureStatus(null)
          } finally {
            await audioContext.close().catch(() => { })
          }
        })()
      }
      recorder.onerror = () => {
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = null
        voiceRecorderRef.current = null
        if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current)
        voiceTimeoutRef.current = null
        setVoiceCaptureStatus(null)
        setError(kind === 'video' ? 'Camera recording failed.' : 'Microphone recording failed.')
      }
      recorder.start(250)
      setError('')
      setCaptureKind(kind)
      setVoiceCaptureStatus('recording')
      voiceTimeoutRef.current = window.setTimeout(stopRecording, kind === 'video' ? maxVideoMessageMilliseconds : 4 * 60 * 1000)
    } catch (recordError) {
      stream?.getTracks().forEach((track) => track.stop())
      voiceStreamRef.current = null
      voiceRecorderRef.current = null
      setError(describeError(recordError))
    }
  }

  function stopRecording() {
    const recorder = voiceRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current)
    voiceTimeoutRef.current = null
    recorder.stop()
  }

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

  function handleFileDragEnter(event: DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepthRef.current++
    setIsDraggingFiles(true)
  }

  function handleFileDragOver(event: DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleFileDragLeave(event: DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    dragDepthRef.current = 0
    setIsDraggingFiles(false)
  }

  function handleFileDrop(event: DragEvent<HTMLElement>) {
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDraggingFiles(false)
    stageAttachmentFiles(files)
  }

  async function sendReaction(message: Message, emoji: string) {
    if (!selectedRoomID || !message.id || message.id.startsWith('~')) return
    setReactingMessageID('')
    try {
      await AppService.React(selectedRoomID, message.id, emoji)
      setHistoryRevision((revision) => revision + 1)
    } catch (reactionError) {
      setError(describeError(reactionError))
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
    if (!selectedRoomID || !message.id || message.id.startsWith('~')) return
    try {
      await AppService.RemoveReaction(selectedRoomID, message.id, emoji)
      setHistoryRevision((revision) => revision + 1)
    } catch (reactionError) {
      setError(describeError(reactionError))
    }
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

  function applyMention(member: Member) {
    if (mentionStart < 0) return
    const token = `@${member.displayName || member.id}`
    const suffix = composeText.slice(mentionEnd)
    const separator = suffix.startsWith(' ') ? '' : ' '
    const nextText = composeText.slice(0, mentionStart) + token + separator + suffix
    setComposeText(nextText)
    if (!editTarget && selectedRoomID) draftsRef.current.set(selectedRoomID, nextText)
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

  function updateEmojiQuery(value: string, cursor: number) {
    setEmojiMatch(emojiQueryAt(value, cursor))
    setEmojiActiveIndex(0)
  }

  const aiEndpoint = preferenceString(preferences, 'ai.endpoint', '')
  const aiEnabled = aiEndpoint !== ''
  // Native menu state mirrors the selected room and filters; menu actions reuse the keyboard handlers.
  const menuRoom = selectedRoom && isActiveAccountRoom(selectedRoom) && !isLocalAIRoomID(selectedRoom.id) ? selectedRoom : undefined
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
      privateChatOpen: menuPrivateChatOpen,
      privateChatInAll: menuPrivateChatInAll,
      draftReady: menuDraftReady,
      filter: menuFilter,
    }
    void AppService.SetMenuState(menuState)
  }, [menuRoomSelected, menuRoomUnread, menuRoomArchived, menuRoomFavorite, menuRoomUnanswered, menuRoomNeedsReply, menuPrivateChatOpen, menuPrivateChatInAll, menuDraftReady, menuFilter])

  function applyMenuFilter(filter: string) {
    setRoomScope(filter === 'archived' ? 'archived' : filter === 'private' ? 'local-ai' : 'all')
    setRoomRefinements({
      unanswered: filter === 'unanswered',
      needsReply: filter === 'needs-reply',
      favorite: filter === 'favorites',
    })
  }

  function runMenuAction(action: string) {
    if (action.startsWith('account:')) {
      void switchAccount(action.slice('account:'.length))
      return
    }
    if (action.startsWith('settings:')) {
      const tab = SETTINGS_TABS.find((candidate) => candidate === action.slice('settings:'.length))
      if (tab) setSettingsTab(tab)
      setSettingsOpen(true)
      return
    }
    if (action.startsWith('filter:')) {
      applyMenuFilter(action.slice('filter:'.length))
      return
    }
    switch (action) {
      case 'quick-switch':
        if (roomsRef.current.length > 0) {
          setQuickSwitcherQuery('')
          setQuickSwitcherIndex(0)
          setQuickSwitcherOpen(true)
        }
        return
      case 'room-search':
        roomSearchInputRef.current?.focus()
        return
      case 'jump-latest':
        jumpToLatest()
        return
      case 'private-chat-new':
        startLocalAIChat()
        return
      case 'private-chat-all': {
        if (localAIChatOpen && localAIChatId) {
          const preferenceKey = localAIIncludeInAllPreference(localAIChatId)
          void setPreference(preferenceKey, !preferenceBoolean(preferences, preferenceKey))
        }
        return
      }
      case 'tutor-draft':
        if (menuDraftReady) void analyzeWithLanguageTutor(composeText, 'draft')
        return
      case 'undo':
        if (isTextEntryTarget(document.activeElement)) document.execCommand('undo')
        else if (undoRoomID) void undoAnswered()
        return
      case 'room-next':
        selectRoomByOffset(1)
        return
      case 'room-previous':
        selectRoomByOffset(-1)
        return
      case 'needs-reply-next':
        selectRoomByOffset(1, true)
        return
      case 'needs-reply-previous':
        selectRoomByOffset(-1, true)
        return
      case 'room-read':
        if (menuRoom) void applyBulkRoomAction(menuRoomUnread ? 'read' : 'unread', [menuRoom])
        return
      case 'room-answered':
        if (menuRoom && menuRoomNeedsReply) void markRoomAnswered(menuRoom.id)
        return
      case 'room-needs-reply':
        if (menuRoom && !menuRoomNeedsReply) void applyBulkRoomAction('needs-reply', [menuRoom])
        return
      case 'room-archive':
        if (menuRoom) void applyBulkRoomAction(menuRoomArchived ? 'restore' : 'archive', [menuRoom])
        return
      case 'room-favorite':
        if (menuRoom) void applyBulkRoomAction(menuRoomFavorite ? 'unfavorite' : 'favorite', [menuRoom])
        return
    }
  }
  menuActionRef.current = runMenuAction
  function promptMessages(source: Message[]): PromptMessage[] {
    return source.map((message) => ({
      senderName: message.senderName,
      sender: message.sender,
      body: message.body,
      redacted: message.redacted,
    }))
  }

  const hasAIConversationContext = useMemo(
    () => messages.some((message) => message.body.trim().length > 0 && !message.redacted),
    [messages],
  )

  function newAIRequestID() {
    return globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  // registerAIStream routes ai:stream chunks for requestID to handler. The returned function unregisters it.
  function registerAIStream(requestID: string, handler: AIStreamHandler) {
    aiStreamHandlersRef.current.set(requestID, handler)
    return () => {
      if (aiStreamHandlersRef.current.get(requestID) === handler) aiStreamHandlersRef.current.delete(requestID)
    }
  }

  function cancelAIRequest(requestID: string) {
    if (!requestID) return
    void Promise.resolve(AppService.AICancel(requestID)).catch(() => false)
  }

  // aiInstructions returns the tunable prompt for a feature. Built-in defaults are returned when no override is saved.
  function aiInstructions(featureID: AIFeatureID) {
    return resolveAIFeatureTuning(preferencesRef.current, featureID).prompt
  }

  async function runAIRequest(title: string, request: AIMessage[], featureID: AIFeatureID, acceptAction: AIAcceptAction = { kind: 'none' }) {
    const requestID = newAIRequestID()
    const tuning = resolveAIFeatureTuning(preferencesRef.current, featureID)
    activeAIRequestRef.current = requestID
    setAIPanel({ title, busy: true, result: '', error: '', acceptAction, featureID, requestID, conversation: request, followUp: '', stopped: false })
    const unregister = registerAIStream(requestID, (chunk) => {
      setAIPanel((current) => current?.requestID === requestID
        ? { ...current, result: (chunk.reset ? '' : current.result) + chunk.text }
        : current)
    })
    try {
      const reply = await AppService.AIComplete(request, requestID, tuning.temperature, tuning.maxTokens)
      if (activeAIRequestRef.current !== requestID) return
      // The resolved reply is authoritative. Stream events can arrive after this resolves.
      setAIPanel((current) => current?.requestID === requestID
        ? { ...current, busy: false, result: reply, conversation: [...request, { role: 'assistant', content: reply }], stopped: stoppedAIRequestRef.current === requestID }
        : current)
    } catch (aiError) {
      if (activeAIRequestRef.current !== requestID) return
      const stopped = stoppedAIRequestRef.current === requestID
      setAIPanel((current) => current?.requestID === requestID
        ? stopped
          ? { ...current, busy: false, stopped: true }
          : { ...current, busy: false, error: describeError(aiError) }
        : current)
    } finally {
      unregister()
      if (activeAIRequestRef.current === requestID) activeAIRequestRef.current = ''
    }
  }

  // stopAIRequest keeps the partial answer. The conversation is left without an assistant turn, so Regenerate restarts it.
  function stopAIRequest() {
    const requestID = activeAIRequestRef.current
    if (!requestID) return
    stoppedAIRequestRef.current = requestID
    setAIPanel((current) => current?.requestID === requestID ? { ...current, status: 'Stopping…' } : current)
    cancelAIRequest(requestID)
  }

  function regenerateAIResult() {
    if (!aiPanel || aiPanel.busy) return
    const history = endsWithAssistantTurn(aiPanel.conversation) ? aiPanel.conversation.slice(0, -1) : aiPanel.conversation
    if (history.length === 0) return
    void runAIRequest(aiPanel.title, history, aiPanel.featureID, aiPanel.acceptAction)
  }

  function setAIFollowUp(followUp: string) {
    setAIPanel((current) => current ? { ...current, followUp } : current)
  }

  function sendAIFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = aiPanel?.followUp.trim()
    if (!aiPanel || !question || aiPanel.busy || !endsWithAssistantTurn(aiPanel.conversation)) return
    void runAIRequest(aiPanel.title, [...aiPanel.conversation, { role: 'user', content: question }], aiPanel.featureID, aiPanel.acceptAction)
  }

  // generateImageToRoom generates an image from the draft for review. Nothing is sent until the review is approved.
  async function generateImageToRoom() {
    const roomID = selectedRoomID
    const sourceDraft = composeText
    const prompt = sourceDraft.trim()
    if (!roomID || !prompt || busy || editTarget || imageSendRun || generatedImageReview) return
    const requestID = newAIRequestID()
    setError('')
    setImageSendRun({ requestID, roomID, stage: 'starting', step: 0, totalSteps: 0 })
    try {
      const encoded = await AppService.GenerateRoomImage(prompt, requestID)
      setGeneratedImageReview({ roomID, prompt, sourceDraft, encoded })
    } catch (imageError) {
      setError(describeError(imageError))
    } finally {
      setImageSendRun(null)
    }
  }

  // approveGeneratedImage sends the reviewed image. The draft is cleared only if it was not edited while the image was generating.
  async function approveGeneratedImage() {
    const review = generatedImageReview
    if (!review) return
    setGeneratedImageReview(null)
    setBusy(true)
    setError('')
    try {
      await AppService.SendRoomImage(review.roomID, review.encoded)
      if (draftsRef.current.get(review.roomID) === review.sourceDraft) draftsRef.current.delete(review.roomID)
      if (selectedRoomRef.current === review.roomID && composeTextRef.current === review.sourceDraft) {
        setComposeText('')
        setMentionBindings([])
        setMentionStart(-1)
      }
      stickToBottomRef.current = true
      scrollTimelineToBottom()
      setHistoryRevision((revision) => revision + 1)
    } catch (sendError) {
      setError(describeError(sendError))
    } finally {
      setBusy(false)
    }
  }

  function stopImageGeneration() {
    if (imageSendRun) cancelAIRequest(imageSendRun.requestID)
  }

  async function analyzeWithLanguageTutor(text: string, mode: LanguageTutorState['mode'], explanationLanguage?: string) {
    const originalText = text.trim()
    if (!originalText) {
      setError(mode === 'draft' ? 'Write a draft first.' : 'This message has no text to analyze.')
      return
    }
    if (!aiEnabled) {
      setError('Set a local AI endpoint in Settings > AI to use Language Tutor.')
      return
    }
    const explanation = explanationLanguage || languageRoles.defaultLanguage
    // A new run replaces the one in progress, such as when the explanation language changes.
    cancelAIRequest(languageTutorRequestRef.current)
    const requestID = newAIRequestID()
    languageTutorRequestRef.current = requestID
    setLanguageTutorState({ mode, originalText, explanationLanguage: explanation, analysis: null, busy: true, error: '', requestID, preview: '' })
    const unregister = registerAIStream(requestID, (chunk) => {
      setLanguageTutorState((current) => current?.requestID === requestID
        ? { ...current, preview: (chunk.reset ? '' : current.preview) + chunk.text }
        : current)
    })
    try {
      const analysis = await LanguageTutorService.Analyze(originalText, mode, explanation, requestID)
      if (languageTutorRequestRef.current === requestID) {
        setLanguageTutorState((current) => current ? { ...current, analysis, busy: false, preview: '' } : current)
      }
    } catch (analysisError) {
      if (languageTutorRequestRef.current === requestID) {
        setLanguageTutorState((current) => current ? { ...current, busy: false, error: describeError(analysisError) } : current)
      }
    } finally {
      unregister()
      if (languageTutorRequestRef.current === requestID) languageTutorRequestRef.current = ''
    }
  }

  function closeLanguageTutor() {
    cancelAIRequest(languageTutorRequestRef.current)
    languageTutorRequestRef.current = ''
    setLanguageTutorState(null)
  }

  function useLanguageTutorDraft() {
    const text = languageTutorState?.analysis?.text_to_insert.trim()
    if (languageTutorState?.mode !== 'draft' || !text || editTarget) return
    setComposeDraft(text)
    closeLanguageTutor()
    requestAnimationFrame(() => composerInputRef.current?.focus())
  }

  function closeAIResult() {
    cancelAIRequest(activeAIRequestRef.current)
    activeAIRequestRef.current = ''
    setAIPanel(null)
  }

  // Prepare a Local AI chat with the full room transcript and an editable summary request.
  async function summarizeRoom() {
    if (!selectedRoomID || !aiEnabled || summaryLoadingRef.current) return
    if (loadingOlderRef.current) {
      setError('Wait for older messages to finish loading.')
      return
    }
    const roomID = selectedRoomID
    let fetched: Message[] = []
    let cursor = olderCursor
    let moreHistory = hasOlder
    const loadedMessages = () => mergeTimelineMessages(messages, fetched)
    const pagingHistory = moreHistory
    summaryLoadingRef.current = true
    if (pagingHistory) {
      loadingOlderRef.current = true
      setLoadingOlder(true)
    }
    setSummaryStatus(pagingHistory ? 'Loading older messages…' : 'Preparing Local AI chat…')

    try {
      while (moreHistory) {
        if (selectedRoomRef.current !== roomID) return
        const page = await AppService.History(roomID, cursor)
        if (selectedRoomRef.current !== roomID) return
        if (page.before === cursor && page.hasMore) throw new Error('Could not continue loading the rest of this chat history.')
        fetched = mergeTimelineMessages(fetched, page.messages ?? [])
        cursor = page.before
        moreHistory = page.hasMore
        setSummaryStatus(`Loading older messages… (${loadedMessages().length.toLocaleString()} loaded)`)
      }

      if (selectedRoomRef.current !== roomID) return
      const context = promptMessages(loadedMessages())
      if (!context.some((message) => message.body.trim() && !message.redacted)) {
        setError('There are no messages to summarize yet.')
        return
      }
      startLocalAIChat(buildSummaryChatDraft(context, aiInstructions('summarize')), 'summary')
    } catch (summaryError) {
      if (selectedRoomRef.current === roomID) setError(describeError(summaryError))
    } finally {
      summaryLoadingRef.current = false
      setSummaryStatus('')
      if (pagingHistory) {
        loadingOlderRef.current = false
        setLoadingOlder(false)
      }
    }
  }

  async function translateRecentMessages() {
    if (!selectedRoomID || !aiEnabled || (!hasAIConversationContext && !hasOlder)) return
    const roomID = selectedRoomID
    const requestID = chatTranslationRequestRef.current + 1
    chatTranslationRequestRef.current = requestID
    const currentUserID = snapshot?.profile.userId ?? ''
    const explanation = resolveLanguageRoles(preferencesRef.current).defaultLanguage
    const targetLanguage = languageName(explanation)
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
        ? { ...current, targetMessageIDs, status: 'Translating…' }
        : current)

      for (const [index, message] of targetMessages.entries()) {
        if (chatTranslationRequestRef.current !== requestID || selectedRoomRef.current !== roomID) return
        const analysisRequestID = newAIRequestID()
        let receivedCharacters = 0
        const showMessageProgress = () => setChatTranslation((current) => current?.requestID === requestID
          ? { ...current, status: `Translating ${index + 1} of ${targetMessages.length}… (${receivedCharacters.toLocaleString()} characters received)` }
          : current)
        const unregisterStream = registerAIStream(analysisRequestID, (chunk) => {
          receivedCharacters = (chunk.reset ? 0 : receivedCharacters) + chunk.text.length
          showMessageProgress()
        })
        chatTranslationAIRequestRef.current = analysisRequestID
        let analysis: TutorAnalysis
        try {
          showMessageProgress()
          analysis = await LanguageTutorService.Analyze(message.body, 'message', explanation, analysisRequestID)
        } finally {
          unregisterStream()
          if (chatTranslationAIRequestRef.current === analysisRequestID) chatTranslationAIRequestRef.current = ''
        }
        if (chatTranslationRequestRef.current !== requestID || selectedRoomRef.current !== roomID) return
        if (!analysis.translation.trim()) throw new Error('Language Tutor returned an empty translation.')
        const messageID = timelineMessageID(message)
        setChatTranslation((current) => current?.requestID === requestID
          ? { ...current, analyses: { ...current.analyses, [messageID]: analysis }, status: `Translated ${index + 1} of ${targetMessages.length}…` }
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
      if (pagingHistory) {
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
    void runAIRequest('Draft reply', buildReplyPrompt(promptMessages([message])[0], promptMessages(context), aiInstructions('draft_reply')), 'draft_reply', { kind: 'reply', target: message })
  }

  function explainMessage(message: Message) {
    void runAIRequest('Explain message', buildExplainPrompt(promptMessages([message])[0], aiInstructions('explain')), 'explain')
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

  function createAgentProfile() {
    const id = globalThis.crypto?.randomUUID?.() ?? `agent-${Date.now()}`
    setAgentSettingsError('')
    setAgentEditor({ id, name: '', instructions: '' })
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

  function setComposeDraft(text: string) {
    composeTextRef.current = text
    setComposeText(text)
    if (!editTarget && selectedRoomID) {
      if (text) draftsRef.current.set(selectedRoomID, text)
      else draftsRef.current.delete(selectedRoomID)
    }
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

  async function leaveSelectedRoom() {
    if (!selectedRoomID || leavingRoom) return
    const roomID = selectedRoomID
    const remainingRooms = rooms.filter((room) => room.id !== roomID)
    setLeaveRoomError('')
    setLeavingRoom(true)
    try {
      await AppService.LeaveRoom(roomID)
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
      setChatExport({ roomID, phase: 'failed', stage: '', mediaDone: 0, mediaTotal: 0, result: null, error: describeError(folderError) })
      return
    }
    if (!folder) return
    setChatExport({ roomID, phase: 'running', stage: '', mediaDone: 0, mediaTotal: 0, result: null, error: '' })
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const snippetHandled = snippetExpander.handleKeyDown(
      event,
      !(mentionStart >= 0 && mentionOptions.length > 0) && emojiOptions.length === 0,
    )
    if (snippetHandled) return
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 't') {
      event.preventDefault()
      void analyzeWithLanguageTutor(composeText, 'draft')
      return
    }
    if (event.key === 'ArrowUp' && !composeText && preferenceBoolean(preferences, 'composer.arrow_up_focus_timeline')) {
      event.preventDefault()
      timelineRef.current?.focus()
      return
    }
    if (mentionStart >= 0 && mentionOptions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionActiveIndex((index) => (index + 1) % mentionOptions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionActiveIndex((index) => (index - 1 + mentionOptions.length) % mentionOptions.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        applyMention(mentionOptions[mentionActiveIndex] ?? mentionOptions[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionStart(-1)
        return
      }
    }
    if (emojiOptions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setEmojiActiveIndex((index) => (index + 1) % emojiOptions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setEmojiActiveIndex((index) => (index - 1 + emojiOptions.length) % emojiOptions.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        applyEmojiSuggestion((emojiOptions[emojiActiveIndex] ?? emojiOptions[0])[1])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setEmojiMatch(null)
        return
      }
    }
    const ctrlEnter = preferenceBoolean(preferences, 'composer.ctrl_enter')
    if (event.key === 'Enter' && !event.shiftKey && (!ctrlEnter || event.ctrlKey)) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  if (!snapshot) {
    return (
      <main className="boot-screen">
        <div className="boot-mark"><MessageCircleMore size={20} /></div>
        <span>Pinger</span>
        {error && <p role="alert">{error}</p>}
      </main>
    )
  }

  if (!snapshot.loggedIn) {
    return (
      <main className="auth-screen">
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-brand">
            <span className="brand-glyph"><MessageCircleMore size={22} strokeWidth={2.1} /></span>
            <span>Pinger</span>
          </div>
          <div className="auth-heading">
            <span className="eyebrow">MATRIX ACCOUNT</span>
            <h1 id="auth-title">Sign in</h1>
            <p>Use your homeserver credentials to continue.</p>
          </div>
          <form className="auth-form" onSubmit={submitLogin}>
            <label>
              <span>Homeserver</span>
              <input value={homeserver} onChange={(event) => setHomeserver(event.target.value)} type="url" autoComplete="url" spellCheck={false} autoCorrect="off" autoCapitalize="off" required />
            </label>
            <label>
              <span>Username</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoCorrect="off" required />
            </label>
            <label>
              <span>Password</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
            </label>
            {error && <div className="form-error" role="alert"><CircleAlert size={16} />{error}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {busy ? 'Connecting…' : 'Continue'}
              {!busy && <ArrowDown className="button-arrow" size={17} />}
            </button>
          </form>
          <div className="auth-footnote"><LockKeyhole size={14} /><span>Session and encryption keys stay on this device.</span></div>
        </section>
        <div className="auth-side" aria-hidden="true">
          <div className="auth-side-mark">P.</div>
          <div className="auth-side-grid" />
          <div className="auth-side-bottom"><span>PINGER</span><span>01 / 01</span></div>
        </div>
      </main>
    )
  }

  if (snapshot.needsVerification && !snapshot.syncReady && snapshot.connectionState !== 'offline') {
    return (
      <main className="boot-screen">
        <div className="boot-mark"><ShieldCheck size={20} /></div>
        <span>Checking device verification…</span>
      </main>
    )
  }

  if (snapshot.needsVerification) {
    return (
      <main className="auth-screen">
        <section className="auth-panel" aria-labelledby="verify-title">
          <div className="auth-brand">
            <span className="brand-glyph"><ShieldCheck size={21} /></span>
            <span>Pinger</span>
          </div>
          <div className="auth-heading">
            <span className="eyebrow">ENCRYPTION SETUP</span>
            <h1 id="verify-title">Verify this device</h1>
            <p>Enter your recovery key or security passphrase.</p>
          </div>
          <form className="auth-form" onSubmit={submitVerification}>
            <label>
              <span>Recovery key or passphrase</span>
              <input value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} type="password" autoComplete="off" required />
            </label>
            {error && <div className="form-error" role="alert"><CircleAlert size={16} />{error}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify device'}
              {!busy && <ShieldCheck size={17} />}
            </button>
          </form>
          <div className="auth-footnote"><LockKeyhole size={14} /><span>Your key is used locally to verify encryption.</span></div>
        </section>
        <div className="auth-side" aria-hidden="true">
          <div className="auth-side-mark">P.</div>
          <div className="auth-side-grid" />
          <div className="auth-side-bottom"><span>PINGER</span><span>01 / 01</span></div>
        </div>
      </main>
    )
  }

  return (
    <main
      className="app-shell"
      onKeyDown={handleApplicationKeyDown}
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
      data-theme={themeChoice}
      data-mobile-pane={mobilePane}
      data-content-blur={preferenceBoolean(preferences, 'privacy.incognito')}
      data-message-animations={preferenceBoolean(preferences, 'appearance.message_animations', true)}
      data-font-size={preferenceString(preferences, 'appearance.font_size', 'Medium').toLowerCase()}
      data-wallpaper={preferenceString(preferences, 'appearance.chat_wallpaper', 'None').toLowerCase()}
      data-room-previews={preferenceBoolean(preferences, 'sidebar.show_previews', true)}
      data-unread-counts={preferenceBoolean(preferences, 'sidebar.show_unread_counts', true)}
      data-compact-chat-list={preferenceBoolean(preferences, 'sidebar.compact_chat_list')}
      data-pointer-cursor={preferenceBoolean(preferences, 'appearance.pointer_cursor', true)}
      data-balanced-text={preferenceBoolean(preferences, 'appearance.balanced_text')}
      style={{
        '--own-bubble': safeBubbleColor,
        '--app-zoom': `${appZoom}%`,
        ...accentCssVariables(accentPalette),
      } as React.CSSProperties}
    >
      <aside className="sidebar">
        <ConnectionStatusBanner problem={connectionProblem} />
        <>
          <label className="room-search">
            <Search size={16} />
            <input ref={roomSearchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a room" aria-label="Find a room" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
            {search && <button type="button" aria-label="Clear room search" onClick={() => setSearch('')}>×</button>}
          </label>
          <div className="room-filters" role="group" aria-label="Filter rooms">
            {inboxAccountCount > 1 && (
              <select className="room-account-filter" aria-label="Filter rooms by account" value={effectiveAccountScope} onChange={(event) => setInboxAccountScope(event.target.value)}>
                <option value="all">All accounts</option>
                {(snapshot?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.profile.displayName || account.profile.userId}</option>)}
              </select>
            )}
            <div className="room-scope-filters" role="group" aria-label="Room visibility">
              <button type="button" className={roomScope === 'all' ? 'is-active' : ''} aria-pressed={roomScope === 'all'} aria-keyshortcuts="Control+Shift+A Meta+Shift+A" title="All rooms (Ctrl / ⌘ + Shift + A)" onClick={() => { setRoomScope('all') }}><MessageCircleMore size={13} /><span className="filter-label">All</span><kbd aria-hidden="true">{primaryModifierLabel()}⇧A</kbd></button>
              <button type="button" className={roomScope === 'archived' ? 'is-active' : ''} aria-label="Archived rooms" aria-pressed={roomScope === 'archived'} aria-keyshortcuts="Control+Shift+H Meta+Shift+H" title="Archived rooms (Ctrl / ⌘ + Shift + H)" onClick={() => { setRoomScope('archived'); setRoomRefinements({ unanswered: false, needsReply: false, favorite: false }) }}><Archive size={13} /><span className="filter-label">Archive</span><kbd aria-hidden="true">{primaryModifierLabel()}⇧H</kbd></button>
            </div>
            <div className="room-refinement-filters" role="group" aria-label="Room categories">
              <button type="button" className={roomRefinements.unanswered ? 'is-active' : ''} aria-label="Unanswered rooms" aria-pressed={roomRefinements.unanswered} aria-keyshortcuts="Control+Shift+R Meta+Shift+R" title="Unanswered rooms (Ctrl / ⌘ + Shift + R)" onClick={() => { setRoomRefinements((current) => ({ ...current, unanswered: !current.unanswered })) }}><Reply size={14} /><span className="filter-label">Unanswered</span><kbd aria-hidden="true">{primaryModifierLabel()}⇧R</kbd></button>
              <button type="button" className={roomRefinements.needsReply ? 'is-active' : ''} aria-label="Needs reply" aria-pressed={roomRefinements.needsReply} aria-keyshortcuts={`${answeredShortcut} Control+Shift+U Meta+Shift+U`} title={`Needs reply (Ctrl / ⌘ + Shift + U; ${answeredShortcut} marks answered)`} onClick={() => { setRoomRefinements((current) => ({ ...current, needsReply: !current.needsReply })) }} onKeyDown={(event) => handleMarkAnsweredKeyDown(event, selectedRoomID)}>
                <CircleDot size={14} /><span className="filter-label">Needs reply</span><kbd aria-hidden="true">{primaryModifierLabel()}⇧U</kbd>{needsReplyCount > 0 && <span className="filter-count">{needsReplyCount}</span>}
              </button>
              <button type="button" className={roomRefinements.favorite ? 'is-active' : ''} aria-label="Favorite rooms" aria-pressed={roomRefinements.favorite} aria-keyshortcuts="Control+Shift+F Meta+Shift+F" title="Favorites (Ctrl / ⌘ + Shift + F)" onClick={() => { setRoomRefinements((current) => ({ ...current, favorite: !current.favorite })) }}><Star size={14} /><span className="filter-label">Favorites</span><kbd aria-hidden="true">{primaryModifierLabel()}⇧F</kbd></button>
              <button type="button" className={roomScope === 'local-ai' ? 'is-active' : ''} aria-label="Local AI chats" aria-pressed={roomScope === 'local-ai'} title="Private model chats" onClick={() => setRoomScope((current) => current === 'local-ai' ? 'all' : 'local-ai')}><Sparkles size={14} /><span className="filter-label">Local AI</span></button>
            </div>
          </div>
          {roomScope === 'local-ai' && <div className="local-ai-folder-bar" role="group" aria-label="AI chat folders">
            <button type="button" className={localAIFolderFilter === null ? 'is-active' : ''} aria-label="All AI chats" aria-pressed={localAIFolderFilter === null} onClick={() => setLocalAIFolderFilter(null)}>All</button>
            <button type="button" className={localAIFolderFilter === '' ? 'is-active' : ''} aria-label="Unfiled AI chats" aria-pressed={localAIFolderFilter === ''} onClick={() => setLocalAIFolderFilter('')}>Unfiled</button>
            {localAIChatList.folders.map((folder) => (
              <button key={folder.id} type="button" className={localAIFolderFilter === folder.id ? 'is-active' : ''} title={folder.name} aria-pressed={localAIFolderFilter === folder.id} onClick={() => setLocalAIFolderFilter(folder.id)}>
                <Folder size={12} /><span>{folder.name}</span>
              </button>
            ))}
            <button type="button" className="local-ai-folder-action" aria-label="New folder" title="New folder" onClick={() => {
              setLocalAIFolderDeleteArmedID('')
              setLocalAIFolderDraft({ folderID: '', name: '' })
            }}><FolderPlus size={13} /></button>
            {localAIActiveFolder && <button type="button" className="local-ai-folder-action" aria-label="Rename folder" title="Rename folder" onClick={() => {
              setLocalAIFolderDeleteArmedID('')
              setLocalAIFolderDraft({ folderID: localAIActiveFolder.id, name: localAIActiveFolder.name })
            }}><Pencil size={13} /></button>}
            {localAIActiveFolder && <button type="button" className={`local-ai-folder-action${localAIFolderDeleteArmedID === localAIActiveFolder.id ? ' is-armed' : ''}`} aria-label={localAIFolderDeleteArmedID === localAIActiveFolder.id ? 'Confirm delete folder' : 'Delete folder'} title="Delete folder. Its chats stay in the list." onClick={() => {
              if (localAIFolderDeleteArmedID !== localAIActiveFolder.id) {
                setLocalAIFolderDeleteArmedID(localAIActiveFolder.id)
                return
              }
              void deleteLocalAIFolder(localAIActiveFolder.id)
            }}><Trash2 size={13} />{localAIFolderDeleteArmedID === localAIActiveFolder.id && <span>Confirm</span>}</button>}
            {localAIFolderDraft && <input className="local-ai-folder-input" aria-label={localAIFolderDraft.folderID ? 'Folder name' : 'New folder name'} placeholder="Folder name" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={localAIFolderDraft.name} maxLength={LOCAL_AI_FOLDER_NAME_CHARACTERS} autoFocus onChange={(event) => setLocalAIFolderDraft({ folderID: localAIFolderDraft.folderID, name: event.currentTarget.value })} onBlur={() => setLocalAIFolderDraft(null)} onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setLocalAIFolderDraft(null)
              } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void saveLocalAIFolderDraft(localAIFolderDraft.folderID, event.currentTarget.value)
              }
            }} />}
          </div>}
          <div className="room-section-label"><span>{roomScope === 'archived' ? 'ARCHIVED' : roomScope === 'local-ai' ? 'AI CHATS' : 'ROOMS'}</span><span className="room-section-actions">{roomScope === 'all' && <button className="room-archive-all" type="button" aria-label="Archive all read rooms" title="Archive all read rooms" disabled={readRoomCount === 0} onClick={() => void archiveAllReadRooms()}><Archive size={13} /></button>}{roomScope === 'local-ai' && <button className="room-archive-all" type="button" aria-label="New private chat" title="New private chat (Ctrl / ⌘ + Shift + M)" onClick={() => startLocalAIChat()}><Plus size={13} /></button>}{filteredRooms.length.toString().padStart(2, '0')}</span></div>
          <VirtualRoomList
            listRef={roomListRef}
            rooms={filteredRooms}
            selectedRoomIndex={selectedRoomListIndex}
            rowHeight={preferenceBoolean(preferences, 'sidebar.compact_chat_list') ? 46 : 62}
            listCount={Math.max(filteredRooms.length, snapshot?.slidingSyncListCounts?.main ?? 0)}
            rangeKey={snapshot?.activeAccountId ?? ''}
            onVisibleRange={reportRoomListVisibleRange}
            renderRoom={(room, index) => (
              <RoomButton
                key={`${room.accountId}:${room.id}`}
                room={room}
                index={index}
                active={room.id === activeListRoomID && isActiveAccountRoom(room)}
                needsReply={isNeedsReplyRoom(room)}
                multiSelected={selectedRoomIDs.length > 1 && selectedRoomIDs.includes(room.id)}
                lastMessageByMe={isLastMessageByCurrentUser(room)}
                use24Hour={preferenceBoolean(preferences, 'appearance.time_24_hour')}
                showNetwork={preferenceBoolean(preferences, 'sidebar.network_icons')}
                showUnreadCounts={preferenceBoolean(preferences, 'sidebar.show_unread_counts', true)}
                aiIcon={localAIIconByRoomID.get(room.id)}
                actionsRef={roomButtonActionsRef}
              />
            )}
            emptyContent={filteredRooms.length === 0 && (
              <div className="room-empty">{listRooms.length === 0 ? 'No rooms yet' : search ? 'No matching rooms' : roomScope === 'archived' ? 'No archived rooms' : roomScope === 'local-ai' ? (localAIFolderFilter === null ? 'No private model chats yet' : 'No chats in this folder') : 'No rooms match these filters'}</div>
            )}
          />
          {roomContextMenu && contextMenuChatID !== null && contextMenuLocalAIRoom && <div className="room-context-menu" role="menu" style={{ left: roomContextMenu.x, top: roomContextMenu.y }}>
            <button type="button" role="menuitem" onClick={() => {
              setRoomContextMenu(null)
              selectLocalAIChat(contextMenuChatID)
              // Seed the raw title so an untitled chat is not renamed to the "Untitled chat" placeholder.
              setLocalAIRenameDraft(localAIChatList.chats.find((chat) => chat.id === contextMenuChatID)?.title ?? '')
            }}>
              <Pencil size={15} /><span>Rename chat</span>
            </button>
            <button type="button" role="menuitem" aria-keyshortcuts="Control+Shift+G Meta+Shift+G" title={`${contextMenuLocalAIInAll ? 'Remove from' : 'Add to'} All rooms (Ctrl / ⌘ + Shift + G)`} onClick={() => {
              setRoomContextMenu(null)
              const preferenceKey = localAIIncludeInAllPreference(contextMenuChatID)
              void setPreference(preferenceKey, !contextMenuLocalAIInAll)
            }}>
              <MessageCircleMore size={15} /><span>{contextMenuLocalAIInAll ? 'Remove from All rooms' : 'Add to All rooms'}</span><kbd aria-hidden="true">{primaryModifierLabel()}⇧G</kbd>
            </button>
            <button type="button" role="menuitem" onClick={() => {
              setRoomContextMenu(null)
              clearRoomSelection()
              void setPreference(localAIFavoritePreference(contextMenuChatID), !contextMenuLocalAIRoom.favorite)
            }}>
              <Star size={15} /><span>{contextMenuLocalAIRoom.favorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
            </button>
            <div className="room-context-menu-group" role="group" aria-label="Move to folder">
              <div className="room-context-menu-label">Move to folder</div>
              <button type="button" role="menuitemradio" aria-checked={contextMenuLocalAIFolderID === ''} onClick={() => {
                setRoomContextMenu(null)
                void moveLocalAIChatToFolder(contextMenuChatID, '')
              }}>
                <Folder size={15} /><span>No folder</span>
              </button>
              <div className="room-context-menu-folders">
                {localAIChatList.folders.map((folder) => (
                  <button key={folder.id} type="button" role="menuitemradio" aria-checked={contextMenuLocalAIFolderID === folder.id} onClick={() => {
                    setRoomContextMenu(null)
                    void moveLocalAIChatToFolder(contextMenuChatID, folder.id)
                  }}>
                    <Folder size={15} /><span>{folder.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <button type="button" role="menuitem" onClick={() => {
              if (localAIDeleteArmedID !== contextMenuChatID) {
                setLocalAIDeleteArmedID(contextMenuChatID)
                return
              }
              setRoomContextMenu(null)
              clearRoomSelection()
              setLocalAIDeleteArmedID('')
              void deleteLocalAIChat(contextMenuChatID)
            }}>
              <Trash2 size={15} /><span>{localAIDeleteArmedID === contextMenuChatID ? 'Confirm delete' : 'Delete chat'}</span>
            </button>
          </div>}
          {roomContextMenu && contextMenuChatID === null && <div className="room-context-menu" role="menu" style={{ left: roomContextMenu.x, top: roomContextMenu.y }}>
            {contextMenuIsBulk && <div className="room-context-menu-count">{contextMenuRooms.length} chats selected</div>}
            {contextMenuNeedsReplyAddCount > 0 && <button type="button" role="menuitem" aria-keyshortcuts="N" title="Add to Needs reply (N)" onClick={() => void applyBulkRoomAction('needs-reply', contextMenuNeedsReplyAddRooms)}>
              <Reply size={15} /><span>{contextMenuIsBulk ? `Add ${contextMenuNeedsReplyAddCount} to Needs reply` : 'Add to Needs reply'}</span><kbd aria-hidden="true">N</kbd>
            </button>}
            {contextMenuRooms.some((room) => isNeedsReplyRoom(room)) && <button type="button" role="menuitem" aria-keyshortcuts={answeredShortcut} onClick={() => contextMenuIsBulk ? void applyBulkRoomAction('answered', contextMenuRooms) : void markRoomAnswered(roomContextMenu.roomID)} onKeyDown={(event) => {
              if (!contextMenuIsBulk) {
                handleMarkAnsweredKeyDown(event, roomContextMenu.roomID)
                return
              }
              if (event.altKey || event.ctrlKey || event.metaKey || event.key.toUpperCase() !== answeredShortcut) return
              event.preventDefault()
              event.stopPropagation()
              void applyBulkRoomAction('answered', contextMenuRooms)
            }}>
              <Check size={15} /><span>{contextMenuIsBulk ? `Remove ${contextMenuRooms.length} from Needs reply` : 'Remove from Needs reply'}</span><kbd aria-hidden="true">{answeredShortcut}</kbd>
            </button>}
            {contextMenuRooms.length > 0 && <button type="button" role="menuitem" aria-keyshortcuts="U" title="Toggle room unread (U)" onClick={() => {
              if (contextMenuIsBulk) void applyBulkRoomAction(contextMenuHasUnread ? 'read' : 'unread', contextMenuRooms)
              else void (contextMenuHasUnread ? markRoomRead(roomContextMenu.roomID) : markRoomUnread(roomContextMenu.roomID))
            }}>
              {contextMenuHasUnread ? <><Check size={15} /><span>{contextMenuIsBulk ? `Mark ${contextMenuRooms.length} chats read` : 'Mark room read'}</span></> : <><CircleDot size={15} /><span>{contextMenuIsBulk ? `Mark ${contextMenuRooms.length} chats unread` : 'Mark room unread'}</span></>}<kbd aria-hidden="true">U</kbd>
            </button>}
            {contextMenuRooms.length > 0 && <button type="button" role="menuitem" aria-keyshortcuts="A" title="Archive or restore room (A)" onClick={() => {
              if (contextMenuIsBulk) void applyBulkRoomAction(contextMenuNeedsArchive ? 'archive' : 'restore', contextMenuRooms)
              else void setRoomArchived(roomContextMenu.roomID, contextMenuNeedsArchive)
            }}>
              {contextMenuNeedsArchive ? <Archive size={15} /> : <ArchiveRestore size={15} />}
              <span>{contextMenuIsBulk ? `${contextMenuNeedsArchive ? 'Archive' : 'Restore'} ${contextMenuRooms.length} chats` : contextMenuNeedsArchive ? 'Archive room' : 'Restore room'}</span><kbd aria-hidden="true">A</kbd>
            </button>}
            {contextMenuRooms.length > 0 && <button type="button" role="menuitem" aria-keyshortcuts="F" title="Toggle favorite (F)" onClick={() => {
              if (contextMenuIsBulk) void applyBulkRoomAction(contextMenuNeedsFavorite ? 'favorite' : 'unfavorite', contextMenuRooms)
              else {
                setRoomContextMenu(null)
                clearRoomSelection()
                void setPreference(`room.favorite.${roomContextMenu.roomID}`, contextMenuNeedsFavorite)
              }
            }}>
              <Star size={15} fill={contextMenuNeedsFavorite ? 'none' : 'currentColor'} />
              <span>{contextMenuIsBulk ? `${contextMenuNeedsFavorite ? 'Add' : 'Remove'} ${contextMenuRooms.length} ${contextMenuNeedsFavorite ? 'to' : 'from'} Favorites` : contextMenuNeedsFavorite ? 'Add to Favorites' : 'Remove from Favorites'}</span><kbd aria-hidden="true">F</kbd>
            </button>}
          </div>}
        </>
        <div className="sidebar-profile">
          <button className="account-switcher-trigger" type="button" aria-label="Manage Matrix accounts" title="Manage Matrix accounts" onClick={() => { setAccountError(''); setAddingAccount(false); setAccountManagerOpen(true) }}>
            <Avatar uri={snapshot.profile.avatarUri} label={snapshot.profile.displayName || snapshot.profile.userId} className="profile-avatar" />
            <span className="profile-copy">
              <strong>{snapshot.profile.displayName || snapshot.profile.userId}</strong>
              <span>{snapshot.profile.userId}</span>
            </span>
            <ChevronDown size={14} />
          </button>
          <button className="sidebar-icon" type="button" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
        </div>
      </aside>

      <section className="conversation" aria-label="Conversation">
        <header className="conversation-header">
          <button className="mobile-back-button icon-button" type="button" aria-label="Back to rooms" title="Back to rooms" onClick={() => setMobilePane('rooms')}>
            <ArrowLeft size={17} />
          </button>
          {preferenceBoolean(preferences, 'privacy.incognito') && <span className="content-blur-indicator" role="status" aria-label="Content blur is on" title="Content blur is on"><EyeOff size={14} /></span>}
          {localAIChatOpen ? (
            <>
              <div className="conversation-title">
                {localAIRenameDraft === null ? <h2>{localAIActiveChat?.title || 'Local AI'}</h2> : <input className="local-ai-title-input" aria-label="Chat title" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={localAIRenameDraft} maxLength={LOCAL_AI_TITLE_CHARACTERS} autoFocus onChange={(event) => setLocalAIRenameDraft(event.currentTarget.value)} onBlur={() => setLocalAIRenameDraft(null)} onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setLocalAIRenameDraft(null)
                  } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void saveLocalAIRename(event.currentTarget.value)
                  }
                }} />}
                <span>Private model chat</span>
              </div>
            </>
          ) : selectedRoom ? (
            <>
              {selectedRoomAvatarSource ? (
                <button
                  className="profile-photo-trigger"
                  type="button"
                  aria-label={`Open profile photo for ${selectedRoom.name || selectedRoom.id}`}
                  title="Open profile photo"
                  onClick={() => setProfilePhotoPreview({ source: selectedRoomAvatarSource, label: selectedRoom.name || selectedRoom.id })}
                >
                  <Avatar uri={selectedRoomAvatar} label={selectedRoom.name || selectedRoom.id} className="conversation-room-avatar" />
                </button>
              ) : (
                <Avatar uri={selectedRoomAvatar} label={selectedRoom.name || selectedRoom.id} className="conversation-room-avatar" />
              )}
              <div className="conversation-title">
                <h2>{selectedRoom.name || selectedRoom.id}</h2>
              </div>
              <div className="conversation-actions">
                <div className="conversation-action-group" role="group" aria-label="Conversation utilities">
                  <IconTooltip label="Scheduled messages">
                    <button className="icon-button scheduled-jobs-button" type="button" aria-label="Scheduled messages and reminders" onClick={openScheduledJobs}>
                      <Clock3 size={16} />{scheduledJobCount > 0 && <span className="scheduled-job-count">{scheduledJobCount}</span>}
                    </button>
                  </IconTooltip>
                  <IconTooltip label="Media gallery">
                    <button className="icon-button" type="button" aria-label="Media gallery" disabled={loadingHistory} onClick={() => void openMediaGallery()}>
                      <Images size={16} />
                    </button>
                  </IconTooltip>
                  <IconTooltip label="Export chat">
                    <button className="icon-button" type="button" aria-label="Export chat" disabled={chatExport?.phase === 'running'} onClick={() => void exportSelectedRoomChat()}>
                      <Download size={16} />
                    </button>
                  </IconTooltip>
                  <IconTooltip label="Search messages">
                    <button className="icon-button" type="button" aria-label="Search messages" onClick={() => setSearchOpen(true)}>
                      <Search size={16} />
                    </button>
                  </IconTooltip>
                </div>
                <div className="conversation-action-group" role="group" aria-label="Room controls">
                  {isNeedsReplyRoom(selectedRoom) && <IconTooltip label="Mark room answered"><button className="icon-button" type="button" aria-label="Mark room answered" onClick={() => void markRoomAnswered(selectedRoom.id)}><Check size={16} /></button></IconTooltip>}
                  <IconTooltip label={selectedRoom.favorite ? 'Remove from Favorites' : 'Add to Favorites'}>
                    <button
                      className={`icon-button ${selectedRoom.favorite ? 'is-selected' : ''}`}
                      type="button"
                      aria-label={selectedRoom.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
                      aria-pressed={selectedRoom.favorite}
                      onClick={() => void setPreference(`room.favorite.${selectedRoom.id}`, !selectedRoom.favorite)}
                    >
                      <Star size={16} fill={selectedRoom.favorite ? 'currentColor' : 'none'} />
                    </button>
                  </IconTooltip>
                  <IconTooltip label={selectedRoom.muted ? 'Unmute room' : 'Mute room'}>
                    <button
                      className={`icon-button ${selectedRoom.muted ? 'is-selected' : ''}`}
                      type="button"
                      aria-label={selectedRoom.muted ? 'Unmute room' : 'Mute room'}
                      aria-pressed={selectedRoom.muted}
                      onClick={() => void setPreference(`room.muted.${selectedRoom.id}`, !selectedRoom.muted)}
                    >
                      {selectedRoom.muted ? <BellOff size={16} /> : <Bell size={16} />}
                    </button>
                  </IconTooltip>
                </div>
                <div className="conversation-action-group" role="group" aria-label="Room details">
                  <IconTooltip label="Room details">
                    <button className="icon-button" type="button" aria-label="Room details" onClick={() => void openRoomInfo()}>
                      <UsersRound size={16} />
                    </button>
                  </IconTooltip>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="conversation-title">
                <h2>Matrix</h2>
                <span>Choose a room to start chatting</span>
              </div>
              <div className="conversation-actions">
                <div className="conversation-action-group" role="group" aria-label="Conversation utilities">
                  <IconTooltip label="Scheduled messages">
                    <button className="icon-button scheduled-jobs-button" type="button" aria-label="Scheduled messages and reminders" onClick={openScheduledJobs}>
                      <Clock3 size={16} />{scheduledJobCount > 0 && <span className="scheduled-job-count">{scheduledJobCount}</span>}
                    </button>
                  </IconTooltip>
                  <IconTooltip label="Search messages">
                    <button className="icon-button" type="button" aria-label="Search messages" onClick={() => setSearchOpen(true)}>
                      <Search size={16} />
                    </button>
                  </IconTooltip>
                </div>
              </div>
            </>
          )}
        </header>

        <div className="conversation-workspace">
          <LocalAIChat
            hidden={!localAIChatOpen}
            chatId={localAIChatId}
            chatTitle={localAIActiveChat?.title ?? ''}
            agentId={localAIAgentId}
            agents={localAIAgents.agents}
            initialDraft={localAIInitialDraft.content}
            initialDraftVersion={localAIInitialDraft.version}
            onAgentChange={setLocalAINewChatAgentId}
            onCreateAgent={createLocalAIAgent}
            onChatCreated={(chat) => {
              setLocalAIChatId(chat.id)
              setLocalAINewChatAgentId(chat.agentId)
              localAIChatList.reload()
            }}
            onChatsChanged={localAIChatList.reload}
            newChatKind={localAINewChatKind}
          />
          {localAIChatOpen ? null : <>
            <div className="conversation-thread">
              {(chatExportForSelectedRoom || scheduledNotice || undoRoomID) && <div className="chat-notice-stack" aria-label="Notifications">
                {chatExportForSelectedRoom?.phase === 'running' && <div className="scheduled-notice chat-export-notice" role="status">
                  <Download size={16} />
                  <span>{chatExportStatusText(chatExportForSelectedRoom)}</span>
                  <button type="button" onClick={() => void cancelChatExport()}>Cancel export</button>
                </div>}
                {chatExportForSelectedRoom?.phase === 'done' && chatExportForSelectedRoom.result && <div className="scheduled-notice chat-export-notice" role="status">
                  <Download size={16} />
                  <span>Exported {chatExportForSelectedRoom.result.messages} messages and {chatExportForSelectedRoom.result.media} media files{chatExportForSelectedRoom.result.mediaFailed > 0 ? `, ${chatExportForSelectedRoom.result.mediaFailed} could not be saved` : ''}.</span>
                  <button type="button" title={chatExportForSelectedRoom.result.path} onClick={() => void revealChatExport(chatExportForSelectedRoom.result?.path ?? '')}>Show in file manager</button>
                  <button className="icon-button" type="button" aria-label="Dismiss export notice" title="Dismiss export notice" onClick={dismissChatExport}><X size={15} /></button>
                </div>}
                {chatExportForSelectedRoom?.error && <div className="scheduled-notice chat-export-notice" role="alert">
                  <CircleAlert size={16} />
                  <span>{chatExportForSelectedRoom.error}</span>
                  <button className="icon-button" type="button" aria-label="Dismiss export error" title="Dismiss export error" onClick={dismissChatExport}><X size={15} /></button>
                </div>}
                {scheduledNotice && <div className="scheduled-notice" role="status">
                  <BellRing size={16} />
                  <span>{scheduledNotice}</span>
                  <button type="button" title="Open reminders" onClick={openScheduledJobs}>View reminders</button>
                  <button className="icon-button" type="button" aria-label="Dismiss reminder notice" title="Dismiss reminder notice" onClick={clearScheduledNotice}><X size={15} /></button>
                </div>}
                {undoRoomID && <div className="triage-toast" role="status">
                  <Check className="triage-toast-icon" size={16} aria-hidden="true" />
                  <span>Marked {rooms.find((room) => room.id === undoRoomID)?.name || 'room'} answered</span>
                  <button type="button" onClick={() => void undoAnswered()}><RotateCcw size={14} />Undo</button>
                  <button className="icon-button" type="button" aria-label="Dismiss notification" title="Dismiss notification" onClick={clearUndoToast}><X size={15} /></button>
                </div>}
              </div>}

              {searchOpen && (
                <section className="message-search-panel" aria-label="Search messages across rooms">
                  <div className="message-search-heading">
                    <h3>Search messages</h3>
                    <button className="icon-button" type="button" aria-label="Close message search" title="Close search" onClick={closeMessageSearch}>
                      <X size={16} />
                    </button>
                  </div>
                  <form className="message-search-form" onSubmit={submitMessageSearch}>
                    <input
                      autoFocus
                      value={messageSearch}
                      onChange={(event) => setMessageSearch(event.target.value)}
                      placeholder="Search all chats"
                      aria-label="Search local message history"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                    />
                    <button className="search-submit" type="submit" aria-label="Search" title="Search messages" disabled={!messageSearch.trim() || searching}>
                      <Search size={16} />
                    </button>
                  </form>
                  <details className="message-search-filters">
                    <summary>Filters</summary>
                    <div className="message-search-filter-grid">
                      <label>
                        <span>Chat</span>
                        <select aria-label="Filter by room" value={searchRoomID} onChange={(event) => setSearchRoomID(event.target.value)}>
                          <option value="">All chats</option>
                          {rooms.map((room) => <option key={room.id} value={room.id}>{room.name || room.id}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Sender</span>
                        <input aria-label="Filter by sender" value={searchSender} onChange={(event) => setSearchSender(event.target.value)} placeholder="@user:server" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
                      </label>
                      <label>
                        <span>From</span>
                        <input aria-label="Search from date" type="date" value={searchFrom} onChange={(event) => setSearchFrom(event.target.value)} />
                      </label>
                      <label>
                        <span>To</span>
                        <input aria-label="Search to date" type="date" value={searchTo} onChange={(event) => setSearchTo(event.target.value)} />
                      </label>
                    </div>
                  </details>
                  {searchStatus && <p className="message-search-status" role="status">{searchStatus}</p>}
                  <div className="message-search-results" aria-live="polite">
                    {searching && <div className="message-search-empty"><span className="loading-mark" />Searching local history</div>}
                    {!searching && searchResults.map((result, index) => {
                      const room = rooms.find((candidate) => candidate.id === result.roomID)
                      const message = result.message
                      return <button className="message-search-result" key={`${result.roomID}:${message.id || message.transactionId || index}`} type="button" aria-label={`Open message in ${room?.name || result.roomID}`} title={`Open message in ${room?.name || result.roomID}`} onClick={() => openSearchResult(result)}>
                        <span className="message-search-room">{room?.name || result.roomID}{room?.bridge && <small>{room.bridge}</small>}</span>
                        <div className="message-search-meta">
                          <strong>{message.senderName || message.sender}</strong>
                          {message.timestamp > 0 && <time>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(message.timestamp))}</time>}
                        </div>
                        <p>{message.body}</p>
                      </button>
                    })}
                    {!searching && searchNextBatch && <button className="message-search-more" type="button" onClick={() => void loadMoreSearchResults()}>Load more results</button>}
                  </div>
                </section>
              )}

              {error && <div className="inline-error" role="alert"><CircleAlert size={15} />{error}<button aria-label="Dismiss error" title="Dismiss error" onClick={() => setError('')}>×</button></div>}

              <div className="timeline" key={selectedRoomID} ref={timelineRef} role="region" aria-label="Message timeline" tabIndex={0} onKeyDown={handleTimelineKeyDown} onScroll={(event) => {
                const element = event.currentTarget
                const atPinnedPosition = pinnedScrollTopRef.current !== null && Math.abs(element.scrollTop - pinnedScrollTopRef.current) < 1
                // Only a scroll away from the bottom that is not our own pin stops following the newest message.
                if (isNearBottom(element)) stickToBottomRef.current = true
                else if (!atPinnedPosition) stickToBottomRef.current = false
                // Infinite scroll: reaching the top of the loaded history fetches the
                // next older page. The refs keep a burst of scroll events from
                // starting several fetches before `loadingOlder` commits.
                if (hasOlderRef.current && !loadingOlderRef.current && isNearTop(element)) {
                  void loadOlderMessages()
                }
              }}>
                {!selectedRoom && <div className="timeline-empty"><MessageCircleMore size={25} /><span>Select a room</span></div>}
                {selectedRoom && loadingHistory && messages.length === 0 && <div className="timeline-empty"><span className="loading-mark" />Loading messages</div>}
                {selectedRoom && !loadingHistory && visibleMessages.length === 0 && <div className="timeline-empty"><MessageCircleMore size={25} /><span>{messages.length > 0 ? 'Deleted messages are hidden' : hasOlder ? 'No messages in the past 24 hours' : 'No messages yet'}</span></div>}
                {selectedRoom && hasOlder && (
                  <button className="load-older" type="button" title={loadingOlder ? 'Loading older messages' : 'Load older messages'} onClick={loadOlderMessages} disabled={loadingOlder}>
                    {loadingOlder ? <><span className="loading-mark" />Loading older messages</> : 'Load older messages'}
                  </button>
                )}
                <TimelineMessageList
                  messages={messages}
                  hideDeleted={preferenceBoolean(preferences, 'appearance.hide_deleted_messages')}
                  preferences={preferences}
                  currentUserID={snapshot?.profile.userId ?? ''}
                  selectedRoomID={selectedRoomID}
                  groupChat={Boolean(selectedRoom && !isDirectLikeRoom(selectedRoom))}
                  chatTranslation={chatTranslation?.roomID === selectedRoomID ? chatTranslation : null}
                  contextMessageID={messageContextMenu?.message.id || messageContextMenu?.message.transactionId || ''}
                  reactingMessageID={reactingMessageID}
                  autoPlayNextMessageId={autoPlayNextMessageId}
                  canUseTranscriptAsDraft={!editTarget}
                  actionsRef={timelineMessageActionsRef}
                />
                {chatTranslation?.roomID === selectedRoomID && <div className="chat-translation-status">
                  {chatTranslation.busy && <p role="status">{chatTranslation.status}</p>}
                  {chatTranslation.error && <p role="alert">{chatTranslation.error}</p>}
                </div>}
              </div>
              {typingStatus && <div className="typing-indicator" aria-live="polite"><UsersRound size={13} />{typingStatus}</div>}
              {messageContextMenu && <div className="message-context-scrim" aria-hidden="true">
                <div className="message-context-scrim-panel message-context-scrim-top" style={{ height: messageContextMenu.targetBounds.top }} />
                <div className="message-context-scrim-panel message-context-scrim-left" style={{ top: messageContextMenu.targetBounds.top, width: messageContextMenu.targetBounds.left, height: messageContextMenu.targetBounds.bottom - messageContextMenu.targetBounds.top }} />
                <div className="message-context-scrim-panel message-context-scrim-right" style={{ left: messageContextMenu.targetBounds.right, top: messageContextMenu.targetBounds.top, height: messageContextMenu.targetBounds.bottom - messageContextMenu.targetBounds.top }} />
                <div className="message-context-scrim-panel message-context-scrim-bottom" style={{ top: messageContextMenu.targetBounds.bottom }} />
              </div>}
              {messageContextMenu && <div className="message-context-menu" role="menu" aria-label="Message actions" style={{ left: messageContextMenu.x, top: messageContextMenu.y }}>
                {messageContextMenuItems(messageContextMenu.message).map((item) => (
                  <Fragment key={item.key}>
                    {item.separatorBefore && <div className="message-context-separator" role="separator" />}
                    <button
                      type="button"
                      role="menuitem"
                      className={item.danger ? 'is-danger' : undefined}
                      aria-label={item.ariaLabel}
                      title={item.ariaLabel}
                      disabled={item.disabled}
                      onClick={() => { setMessageContextMenu(null); item.run() }}
                    >
                      {item.icon}<span>{item.label}</span>
                    </button>
                  </Fragment>
                ))}
              </div>}
              <form className="composer" onSubmit={submitMessage}>
                <input ref={attachmentInputRef} className="visually-hidden" type="file" aria-hidden="true" tabIndex={-1} onChange={handleAttachmentInput} />
                {emojiOptions.length > 0 && <div className="mention-menu emoji-menu" role="listbox" aria-label="Emoji suggestions">
                  {emojiOptions.map(([name, emoji], index) => <button key={name} className={`mention-option ${index === emojiActiveIndex ? 'is-active' : ''}`} type="button" role="option" aria-selected={index === emojiActiveIndex} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setEmojiActiveIndex(index)} onClick={() => applyEmojiSuggestion(emoji)}><span aria-hidden="true">{emoji}</span> :{name}:</button>)}
                </div>}
                {mentionOptions.length > 0 && <div className="mention-menu" role="listbox" aria-label="Mention someone">
                  {mentionOptions.map((member, index) => <button key={member.id} className={`mention-option ${index === mentionActiveIndex ? 'is-active' : ''}`} type="button" role="option" aria-selected={index === mentionActiveIndex} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setMentionActiveIndex(index)} onClick={() => applyMention(member)}>
                    <span className="room-member-avatar">{initials(member.displayName || member.id)}</span><span><strong>{member.displayName || member.id}</strong><small>{member.id}</small></span>
                  </button>)}
                </div>}
                {composerContextMessage && <div className={`composer-context ${editTarget ? 'is-editing' : 'is-replying'}`}>
                  <span className="composer-context-icon" aria-hidden="true">{editTarget ? <Pencil size={15} /> : <Reply size={15} />}</span>
                  <div className="composer-context-copy">
                    <strong>{editTarget ? 'Editing message' : `Replying to ${replyTarget?.senderName || replyTarget?.sender}`}</strong>
                    <span title={composerContextMessage.body}>{composerContextMessage.body}</span>
                  </div>
                  <button className="composer-context-link" type="button" title="View message in the timeline" onClick={() => focusTimelineMessage(composerContextMessage.id)}>View message</button>
                  <button type="button" className="icon-button" aria-label="Cancel reply or edit" title="Cancel" onClick={() => {
                    const nextDraft = editTarget ? draftsRef.current.get(selectedRoomID) ?? '' : ''
                    if (!editTarget) draftsRef.current.delete(selectedRoomID)
                    setReplyTarget(null)
                    setEditTarget(null)
                    setComposeText(nextDraft)
                    setMentionBindings([])
                    setMentionStart(-1)
                  }}><X size={14} /></button>
                </div>}
                {stagedRoomAttachments.length > 0 && <ul className="composer-staged-attachments" aria-label="Attachments to send">
                  {stagedRoomAttachments.map((item) => (
                    <li key={item.id}>
                      {item.previewURL ? <img src={item.previewURL} alt="" /> : <Paperclip size={12} />}
                      <span>{item.file.name || 'Attachment'}</span>
                      <button className="icon-button" type="button" aria-label={`Remove ${item.file.name || 'attachment'}`} disabled={busy} onClick={() => removeStagedAttachment(item)}><X size={12} /></button>
                    </li>
                  ))}
                </ul>}
                <div className="composer-input-wrap">
                  <textarea
                    ref={composerInputRef}
                    value={composeText}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    onChange={(event) => {
                      const rawValue = event.currentTarget.value
                      const rawCursor = event.currentTarget.selectionStart
                      const customReplacements = parseCustomEmoticonReplacements(preferenceString(preferencesRef.current, 'emoji.emoticon_replacements', ''))
                      const converted = preferenceBoolean(preferencesRef.current, 'emoji.replace_emoticons', true)
                        ? replaceEmoticonsAtCursor(rawValue, rawCursor, customReplacements)
                        : { text: rawValue, cursor: rawCursor }
                      const value = converted.text
                      if (value !== rawValue) {
                        requestAnimationFrame(() => {
                          // Skip the restore when the user has typed again, so a stale cursor cannot move the caret back.
                          if (composeTextRef.current === value && document.activeElement === composerInputRef.current) composerInputRef.current?.setSelectionRange(converted.cursor, converted.cursor)
                        })
                      }
                      composeTextRef.current = value
                      setComposeText(value)
                      if (!editTarget && selectedRoomID) {
                        if (value) draftsRef.current.set(selectedRoomID, value)
                        else draftsRef.current.delete(selectedRoomID)
                      }
                      setMentionBindings((current) => current.every(({ token }) => value.includes(token))
                        ? current
                        : current.filter(({ token }) => value.includes(token)))
                      updateMentionQuery(value, converted.cursor)
                      updateEmojiQuery(value, converted.cursor)
                      snippetExpander.handleChange(value, converted.cursor)
                    }}
                    onKeyDown={handleComposerKeyDown}
                    onClick={(event) => snippetExpander.handleClick(event.currentTarget.value, event.currentTarget.selectionStart)}
                    onKeyUp={(event) => {
                      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                        snippetExpander.handleKeyUp(event.currentTarget.value, event.currentTarget.selectionStart)
                      }
                    }}
                    onPaste={handleComposerPaste}
                    placeholder={selectedRoom ? `Message ${selectedRoom.name || selectedRoom.id}` : 'Select a room to start'}
                    aria-label="Message"
                    aria-controls={snippetMenuVisible ? 'snippet-suggestions' : undefined}
                    aria-activedescendant={snippetMenuVisible ? `snippet-option-${snippetExpander.activeIndex}` : undefined}
                    disabled={!selectedRoom || busy || voiceCaptureStatus !== null}
                    rows={1}
                  />
                  {snippetMenuVisible && snippetMatch && <SnippetPopover
                    inputRef={composerInputRef}
                    value={composeText}
                    caret={snippetExpander.caret}
                    snippets={snippetOptions}
                    activeIndex={snippetExpander.activeIndex}
                    onActiveIndexChange={snippetExpander.setActiveIndex}
                    onSelect={snippetExpander.select}
                  />}
                </div>
                {videoRecordingActive && <div className="video-capture-preview"><video ref={videoPreviewRef} muted playsInline autoPlay aria-label="Camera preview" /></div>}
                <div className="composer-footer">
                  <div className="composer-toolbar-row composer-toolbar-row-compose">
                    {preferenceBoolean(preferences, 'composer.formatting_toolbar') && <div className="composer-format-toolbar" role="toolbar" aria-label="Formatting">
                      <div className="composer-format-group" role="group" aria-label="Inline formatting">
                        <IconTooltip label="Bold text"><button className="icon-button" type="button" aria-label="Bold" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('bold')}><Bold size={15} /></button></IconTooltip>
                        <IconTooltip label="Italic text"><button className="icon-button" type="button" aria-label="Italic" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('italic')}><Italic size={15} /></button></IconTooltip>
                        <IconTooltip label="Strikethrough text"><button className="icon-button" type="button" aria-label="Strikethrough" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('strikethrough')}><Strikethrough size={15} /></button></IconTooltip>
                        <IconTooltip label="Inline code"><button className="icon-button" type="button" aria-label="Inline code" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('inlineCode')}><Code size={15} /></button></IconTooltip>
                      </div>
                      <div className="composer-format-group" role="group" aria-label="Link insertion">
                        <IconTooltip label="Insert link"><button className="icon-button" type="button" aria-label="Insert link" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('link')}><Link size={15} /></button></IconTooltip>
                      </div>
                      <div className="composer-format-group" role="group" aria-label="Block formatting">
                        <IconTooltip label="Format as heading"><button className="icon-button" type="button" aria-label="Heading" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('heading')}><Heading1 size={15} /></button></IconTooltip>
                        <IconTooltip label="Start a bulleted list"><button className="icon-button" type="button" aria-label="Bulleted list" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('bulletList')}><List size={15} /></button></IconTooltip>
                        <IconTooltip label="Start a numbered list"><button className="icon-button" type="button" aria-label="Numbered list" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('numberedList')}><ListOrdered size={15} /></button></IconTooltip>
                        <IconTooltip label="Format as quote"><button className="icon-button" type="button" aria-label="Quote" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('quote')}><Quote size={15} /></button></IconTooltip>
                        <IconTooltip label="Insert a code block"><button className="icon-button" type="button" aria-label="Code block" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('codeBlock')}><SquareCode size={15} /></button></IconTooltip>
                      </div>
                    </div>}
                    <div className="composer-tool-group composer-tool-group-message" role="group" aria-label="Message tools">
                      <div className="composer-tool-cluster" role="group" aria-label="Add content">
                        <IconTooltip label="Attach file"><button className="icon-button" type="button" aria-label="Attach file" disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onClick={() => attachmentInputRef.current?.click()}><Paperclip size={15} /></button></IconTooltip>
                        <div className="composer-emoji-control" ref={composerEmojiControlRef}>
                          <IconTooltip label="Choose an emoji"><button className="icon-button" type="button" aria-label="Emoji picker" aria-haspopup="dialog" aria-expanded={emojiPickerOpen} disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onMouseDown={(event) => event.preventDefault()} onClick={toggleComposerEmojiPicker}><Smile size={15} /></button></IconTooltip>
                          {emojiPickerOpen && <div className="composer-emoji-popover" role="dialog" aria-label="Choose an emoji">
                            <EmojiPicker
                              className="composer-emoji-picker-widget"
                              colorScheme={themeModeForPreference(themePreference, systemPrefersDark)}
                              width="100%"
                              height={360}
                              autoFocusSearch
                              previewConfig={{ showPreview: false }}
                              onEmojiClick={(emojiData) => insertPickedEmoji(emojiData.emoji)}
                            />
                          </div>}
                        </div>
                      </div>
                      <div className="composer-tool-cluster" role="group" aria-label="Delivery options">
                        <IconTooltip label={voiceRecordingActive ? 'Stop and send voice note' : 'Record voice note'}><button className="icon-button" type="button" aria-label={voiceRecordingActive ? 'Stop and send voice note' : 'Record voice note'} aria-pressed={voiceRecordingActive} disabled={!selectedRoom || busy || voiceCaptureStatus === 'processing' || videoRecordingActive} onClick={() => voiceRecordingActive ? stopRecording() : void startRecording('voice')}>{voiceRecordingActive ? <Square size={15} /> : <Mic size={15} />}</button></IconTooltip>
                        <IconTooltip label={videoRecordingActive ? 'Stop and send video message' : 'Record video message'}><button className="icon-button" type="button" aria-label={videoRecordingActive ? 'Stop and send video message' : 'Record video message'} aria-pressed={videoRecordingActive} disabled={!selectedRoom || busy || voiceCaptureStatus === 'processing' || voiceRecordingActive} onClick={() => videoRecordingActive ? stopRecording() : void startRecording('video')}>{videoRecordingActive ? <Square size={15} /> : <Video size={15} />}</button></IconTooltip>
                        <IconTooltip label={replyTarget ? 'Schedule reply' : 'Schedule message'}><button className="icon-button" type="button" aria-label={replyTarget ? 'Schedule reply' : 'Schedule message'} disabled={!selectedRoom || !composeText.trim() || busy || voiceCaptureStatus !== null || Boolean(editTarget)} onClick={openScheduleMessage}><Clock3 size={15} /></button></IconTooltip>
                      </div>
                    </div>
                  </div>
                  <div className="composer-toolbar-row composer-toolbar-row-assist">
                    <div className="composer-tool-group composer-tool-group-ai" role="group" aria-label="AI tools">
                      <span className="composer-tool-group-label" aria-hidden="true"><Sparkles size={13} />AI</span>
                      <div className="composer-tool-cluster" role="group" aria-label="Draft assistance">
                        <IconTooltip label={aiEnabled ? 'Analyze draft with Language Tutor · Ctrl+Shift+T' : 'Analyze draft with Language Tutor · set up a local AI endpoint'}><button className="composer-assist-button" type="button" aria-label="Analyze draft with Language Tutor" disabled={!selectedRoom || !composeText.trim() || busy || !aiEnabled || Boolean(editTarget)} onClick={() => void analyzeWithLanguageTutor(composeText, 'draft')}><GraduationCap size={14} /><span>Tutor</span></button></IconTooltip>
                        <IconTooltip label={imageButtonTooltip}><button className="composer-assist-button" type="button" aria-label={imageRunHere ? 'Stop image generation' : 'Generate image from draft'} disabled={!imageRunHere && (!selectedRoom || !imageEngineReady || !composeText.trim() || busy || Boolean(editTarget) || imageSendRun !== null || generatedImageReview !== null)} onClick={imageRunHere ? stopImageGeneration : () => void generateImageToRoom()}>{imageRunHere ? <Square size={14} /> : <ImagePlus size={14} />}<span>{imageRunHere ? 'Stop' : 'Image'}</span></button></IconTooltip>
                      </div>
                      <div className="composer-tool-cluster" role="group" aria-label="Conversation analysis and translation">
                        <IconTooltip label={summaryStatus || (aiEnabled ? 'Prepare a summary in Local AI' : 'Prepare a summary in Local AI · unavailable')}><button className="composer-assist-button" type="button" aria-label="Summarize with Local AI" aria-busy={Boolean(summaryStatus)} disabled={!selectedRoom || busy || loadingOlder || Boolean(summaryStatus) || !aiEnabled || (!hasAIConversationContext && !hasOlder)} onClick={() => void summarizeRoom()}>{summaryStatus ? <span className="loading-mark" aria-hidden="true" /> : <ScrollText size={14} />}<span>Summarize</span></button></IconTooltip>
                        <IconTooltip label={aiEnabled ? translateRecentLabel : `${translateRecentLabel} · unavailable`}><button className="composer-assist-button" type="button" aria-label={translateRecentLabel} disabled={!selectedRoom || busy || loadingOlder || !aiEnabled || (!hasAIConversationContext && !hasOlder)} onClick={() => void translateRecentMessages()}><Languages size={14} /><span>Translate</span></button></IconTooltip>
                        {chatTranslation?.roomID === selectedRoomID && <IconTooltip label="Clear message translations"><button className="composer-assist-button" type="button" aria-label="Clear message translations" onClick={clearChatTranslation}><X size={14} /><span>Clear translations</span></button></IconTooltip>}
                      </div>
                    </div>
                    <span className={`composer-hint${voiceCaptureStatus !== null || busy || imageRunHere ? ' is-status' : ''}`}>{voiceCaptureStatus === 'recording' ? `Recording ${captureNoun} · click stop to send` : voiceCaptureStatus === 'processing' ? `Preparing ${captureNoun}…` : imageRunHere ? imageRunStatus : selectedRoom ? busy ? 'Sending…' : preferenceBoolean(preferences, 'composer.ctrl_enter') ? 'Ctrl + Enter to send' : 'Enter to send · Shift + Enter for a new line' : ' '}</span>
                  </div>
                  <IconTooltip label={editTarget ? 'Save edit' : 'Send message'} className="send-tooltip">
                    <button className="send-button" type="submit" aria-label={editTarget ? 'Save edit' : 'Send message'} disabled={!selectedRoom || (!composeText.trim() && sendableStagedAttachments.length === 0) || busy || voiceCaptureStatus !== null}>
                      {editTarget ? <Check size={17} /> : <Send size={17} />}
                    </button>
                  </IconTooltip>
                </div>
              </form>
            </div>
          </>}
        </div>
      </section>
      {forwardingMessage && <Suspense fallback={null}>
        <ForwardMessageDialog
          message={forwardingMessage}
          destinations={rooms.filter((room) => room.id !== selectedRoomID && isActiveAccountRoom(room))}
          targetRoomID={forwardTargetRoomID}
          busy={forwardBusy}
          error={forwardError}
          onTargetChange={setForwardTargetRoomID}
          onClose={() => setForwardingMessage(null)}
          onConfirm={() => void confirmMessageForward()}
        />
      </Suspense>}
      {(aiPanel || languageTutorState) && <Suspense fallback={null}>
        <AIResultDialogs
          aiPanel={aiPanel}
          languageTutorState={languageTutorState}
          hasEditTarget={Boolean(editTarget)}
          languageRoles={languageRoles}
          onCloseAIResult={closeAIResult}
          onAcceptAIResult={acceptAIResult}
          onStopAIRequest={stopAIRequest}
          onRegenerateAIResult={regenerateAIResult}
          onFollowUpChange={setAIFollowUp}
          onSendFollowUp={sendAIFollowUp}
          onCloseLanguageTutor={closeLanguageTutor}
          onAnalyzeWithLanguageTutor={analyzeWithLanguageTutor}
          onUseLanguageTutorDraft={useLanguageTutorDraft}
        />
      </Suspense>}
      {accountManagerOpen && <div className="room-info-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAccountManagerOpen(false) }}>
        <DialogSurface className="room-info-dialog account-dialog" labelledBy="account-manager-title" onClose={() => { if (!busy) setAccountManagerOpen(false) }} onClick={(event) => event.stopPropagation()}>
          <header className="room-info-header">
            <div><span className="eyebrow">MATRIX</span><h2 id="account-manager-title">{addingAccount ? 'Add account' : 'Accounts'}</h2></div>
            <button className="icon-button" type="button" aria-label="Close account manager" disabled={busy} onClick={() => setAccountManagerOpen(false)}><X size={16} /></button>
          </header>
          {accountError && <p className="account-manager-error" role="alert">{accountError}</p>}
          {addingAccount ? <form className="account-add-form" onSubmit={submitAddAccount}>
            <div className="account-add-field-group">
              <label className="field" htmlFor="account-homeserver">
                <span>Homeserver</span>
                <input id="account-homeserver" type="url" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={accountHomeserver} onChange={(event) => setAccountHomeserver(event.target.value)} autoComplete="url" aria-describedby="account-homeserver-help" required />
              </label>
              <p className="field-help" id="account-homeserver-help">Example: https://matrix.org</p>
            </div>
            <label className="field" htmlFor="account-username">
              <span>Username</span>
              <input id="account-username" value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoCorrect="off" required />
            </label>
            <label className="field" htmlFor="account-password">
              <span>Password</span>
              <input id="account-password" type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} autoComplete="new-password" required />
            </label>
            <div className="account-manager-actions">
              <button className="settings-command" type="button" disabled={busy} onClick={() => { setAddingAccount(false); setAccountError('') }}>Cancel</button>
              <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Add account'}{!busy && <Plus size={15} />}</button>
            </div>
          </form> : <div className="account-manager-content">
            <div className="account-option-list" aria-label="Connected Matrix accounts">
              {(snapshot.accounts ?? []).map((account) => {
                const label = account.profile.displayName || account.profile.userId
                const active = account.id === snapshot.activeAccountId
                return <button key={account.id} className="account-option" type="button" aria-current={active ? 'true' : undefined} disabled={busy} onClick={() => void switchAccount(account.id)}>
                  <Avatar uri={account.profile.avatarUri} label={label} className="profile-avatar" />
                  <span className="account-option-copy"><strong>{label}</strong><span>{account.profile.userId}</span></span>
                  {active ? <Check size={16} aria-label="Current account" /> : <span className="account-option-homeserver">{account.profile.homeserver}</span>}
                </button>
              })}
            </div>
            <button className="settings-command account-add-button" type="button" disabled={busy} onClick={() => { setAccountError(''); setAddingAccount(true) }}><Plus size={15} />Add account</button>
          </div>}
        </DialogSurface>
      </div>}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            tab={settingsTab}
            profile={snapshot.profile}
            preferences={preferences}
            snippets={snippets}
            rooms={rooms}
            audioInputDevices={audioInputDevices}
            selectedAudioInputDeviceId={selectedAudioInputDeviceId}
            onArchiveInactiveRooms={archiveInactiveRooms}
            onTabChange={setSettingsTab}
            onClose={() => setSettingsOpen(false)}
            onLogout={async () => {
              await AppService.Logout()
              setSettingsOpen(false)
              try {
                resetAccountWorkspace(await AppService.Snapshot())
              } catch {
                // The app is closing after logout from the final account.
              }
            }}
            onPreferenceChange={(key, value) => setPreference(key, value)}
            onSnippetsChange={updateSnippets}
          />
        </Suspense>
      )}
      {scheduledJobsOpen && <Suspense fallback={null}>
        <ScheduledJobsDialog
          rooms={rooms}
          jobs={scheduledJobs}
          loading={scheduledLoading}
          error={scheduledJobsError}
          times={scheduledTimes}
          setTimes={setScheduledTimes}
          busyID={scheduledBusyID}
          onManage={(id, action) => void manageScheduledJob(id, action)}
          onClose={() => setScheduledJobsOpen(false)}
        />
      </Suspense>}
      {scheduledDraft && <Suspense fallback={null}>
        <ScheduledDraftDialog
          draft={scheduledDraft}
          rooms={rooms}
          dueAt={scheduledDueAt}
          setDueAt={setScheduledDueAt}
          setDraft={setScheduledDraft}
          saving={scheduledSaving}
          error={scheduledDialogError}
          suggestions={scheduleTimeSuggestions}
          onSubmit={submitScheduledDraft}
          onClose={() => setScheduledDraft(null)}
        />
      </Suspense>}
      {roomInfoOpen && selectedRoom && <RoomInfoDialog
        room={selectedRoom}
        agents={roomAgents}
        agentEditor={agentEditor}
        agentSettingsError={agentSettingsError}
        members={roomMembers}
        membersLoading={roomMembersLoading}
        membersError={roomMembersError}
        onClose={() => setRoomInfoOpen(false)}
        onAgentEditorChange={setAgentEditor}
        onDefaultAgentChange={(agentID) => void persistRoomAgents({ ...roomAgents, defaultAgentId: agentID })}
        onEditAgent={(agent) => { setAgentSettingsError(''); setAgentEditor(agent) }}
        onDeleteAgent={(agent) => void deleteAgentProfile(agent)}
        onSaveAgent={(event) => void saveAgentProfile(event)}
        onCreateAgent={createAgentProfile}
        onLeave={() => { setLeaveRoomError(''); setLeaveConfirmOpen(true) }}
      />}
      {mediaGalleryOpen && selectedRoom && <Suspense fallback={null}>
        <MediaGalleryDialog
          roomID={selectedRoom.id}
          roomName={selectedRoom.name || selectedRoom.id}
          items={mediaGalleryItems}
          filter={mediaGalleryFilter}
          loading={mediaGalleryLoading}
          scanned={mediaGalleryScanned}
          error={mediaGalleryError}
          preferences={preferences}
          onFilterChange={setMediaGalleryFilter}
          onClose={closeMediaGallery}
          onRetry={() => void openMediaGallery()}
        />
      </Suspense>}
      {mediaApproval && <Suspense fallback={null}>
        <MediaApprovalDialog request={mediaApproval} onResolve={resolveMediaApproval} />
      </Suspense>}
      {generatedImageReview && <Suspense fallback={null}>
        <GeneratedImageDialog review={generatedImageReview} onDiscard={() => setGeneratedImageReview(null)} onApprove={() => void approveGeneratedImage()} />
      </Suspense>}
      {leaveConfirmOpen && selectedRoom && <Suspense fallback={null}>
        <LeaveRoomDialog roomName={selectedRoom.name || selectedRoom.id} error={leaveRoomError} leaving={leavingRoom} onCancel={() => setLeaveConfirmOpen(false)} onConfirm={() => void leaveSelectedRoom()} />
      </Suspense>}
      {redactTarget && <Suspense fallback={null}>
        <RedactDialog busy={busy} onCancel={() => setRedactTarget(null)} onConfirm={() => void redactMessage()} />
      </Suspense>}
      {quickSwitcherOpen && <QuickSwitcher
        results={quickSwitcherRooms}
        query={quickSwitcherQuery}
        activeIndex={quickSwitcherIndex}
        inputRef={quickSwitcherInputRef}
        onQueryChange={setQuickSwitcherQuery}
        onActiveIndexChange={setQuickSwitcherIndex}
        onSelect={(roomID) => { showRoom(roomID); setQuickSwitcherOpen(false) }}
        onClose={() => setQuickSwitcherOpen(false)}
      />}
      {profilePhotoPreview && <ProfilePhotoViewer source={profilePhotoPreview.source} label={profilePhotoPreview.label} onClose={() => setProfilePhotoPreview(null)} />}
      {isDraggingFiles && <div className="drop-overlay" role="status"><div><Upload size={21} /><span>{selectedRoom ? `Add files to ${selectedRoom.name || selectedRoom.id}` : 'Select a room to upload files'}</span></div></div>}
    </main>
  )
}

function App() {
  return (
    <SettingsProvider>
      <AppBody />
    </SettingsProvider>
  )
}

export default App
