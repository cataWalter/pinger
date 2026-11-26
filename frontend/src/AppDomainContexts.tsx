import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import type { AppState } from './appState'

export type SessionRoomsState = Pick<
  AppState,
  | 'acceptInvite'
  | 'activeAccountID'
  | 'activeListRoomID'
  | 'aiEnabled'
  | 'aiInstructions'
  | 'aiReplyDraftBatch'
  | 'answeredShortcut'
  | 'appZoom'
  | 'applyBulkRoomAction'
  | 'applyMenuFilter'
  | 'busy'
  | 'cancelAIDraftBatch'
  | 'chatExport'
  | 'clearRoomSelection'
  | 'connectionProblem'
  | 'createLocalAIAgent'
  | 'declineInvite'
  | 'deleteLocalAIChat'
  | 'deleteLocalAIFolder'
  | 'exportSelectedRoomChat'
  | 'filteredRooms'
  | 'generateNeedsReplyDrafts'
  | 'getRoomContextMenuState'
  | 'handleMarkAnsweredKeyDown'
  | 'inviteBusyRoomID'
  | 'isLastMessageByCurrentUser'
  | 'languageRoles'
  | 'listRooms'
  | 'loadingHistory'
  | 'localAIActiveChat'
  | 'localAIActiveFolder'
  | 'localAIAgentId'
  | 'localAIAgents'
  | 'localAIChatId'
  | 'localAIChatList'
  | 'localAIChatOpen'
  | 'localAIDeleteArmedID'
  | 'localAIFolderDeleteArmedID'
  | 'localAIFolderDraft'
  | 'localAIFolderFilter'
  | 'localAIIconByRoomID'
  | 'localAIInitialDraft'
  | 'localAINewChatKind'
  | 'localAIRenameDraft'
  | 'markRoomAnswered'
  | 'markRoomRead'
  | 'markRoomUnread'
  | 'menuFilter'
  | 'moveLocalAIChatToFolder'
  | 'needsReplyCount'
  | 'openMediaGallery'
  | 'openRoomInfo'
  | 'openScheduledJobs'
  | 'preferences'
  | 'roomButtonActionsRef'
  | 'roomListRef'
  | 'roomRefinements'
  | 'roomScope'
  | 'roomSearchInputRef'
  | 'reorderLocalAIFolders'
  | 'saveLocalAIFolderDraft'
  | 'saveLocalAIRename'
  | 'scheduledJobCount'
  | 'search'
  | 'selectLocalAIChat'
  | 'selectedRoom'
  | 'selectedRoomAvatar'
  | 'selectedRoomAvatarSource'
  | 'selectedRoomID'
  | 'selectedRoomIDs'
  | 'selectedRoomListIndex'
  | 'setLocalAIChatId'
  | 'setLocalAIDeleteArmedID'
  | 'setLocalAIFolderDeleteArmedID'
  | 'setLocalAIFolderDraft'
  | 'setLocalAIFolderFilter'
  | 'setLocalAINewChatAgentId'
  | 'setLocalAIRenameDraft'
  | 'setMobilePane'
  | 'setPreference'
  | 'setProfilePhotoPreview'
  | 'setRoomArchived'
  | 'setRoomContextMenu'
  | 'setSearch'
  | 'setSearchOpen'
  | 'setSettingsOpen'
  | 'snapshot'
  | 'startLocalAIChat'
  | 'toggleRoomRefinement'
  | 'uiOverlayStore'
  | 'volatileAIDrafts'
> & {
  hasEditTarget: boolean
}

export type TimelineState = Pick<
  AppState,
  | 'activeAccountID'
  | 'activeUnreadMarker'
  | 'appZoom'
  | 'autoPlayNextMessageId'
  | 'cancelChatExport'
  | 'chatExportForSelectedRoom'
  | 'chatTranslation'
  | 'clearScheduledNotice'
  | 'clearUndoToast'
  | 'closeMessageSearch'
  | 'dismissChatExport'
  | 'editTarget'
  | 'error'
  | 'focusTimelineMessage'
  | 'handleTimelineKeyDown'
  | 'hasOlder'
  | 'hasOlderRef'
  | 'isNearBottom'
  | 'isNearTop'
  | 'loadMoreSearchResults'
  | 'loadOlderMessages'
  | 'loadingHistory'
  | 'loadingOlder'
  | 'loadingOlderRef'
  | 'messageContextMenuItems'
  | 'messageSearch'
  | 'messages'
  | 'observeUnreadDivider'
  | 'openScheduledJobs'
  | 'openSearchResult'
  | 'pinnedScrollTopRef'
  | 'preferences'
  | 'reactingMessageID'
  | 'revealChatExport'
  | 'rooms'
  | 'roomsByID'
  | 'scheduledNotice'
  | 'searchFrom'
  | 'searchNextBatch'
  | 'searchResults'
  | 'searchRoomID'
  | 'searchSender'
  | 'searchStatus'
  | 'searchTo'
  | 'searching'
  | 'selectedRoom'
  | 'selectedRoomID'
  | 'setChatTranslation'
  | 'setError'
  | 'setMessageContextMenu'
  | 'setMessageSearch'
  | 'setSearchFrom'
  | 'setSearchRoomID'
  | 'setSearchSender'
  | 'setSearchTo'
  | 'setUnreadMarker'
  | 'snapshot'
  | 'stickToBottomRef'
  | 'submitMessageSearch'
  | 'systemPrefersDark'
  | 'themePreference'
  | 'threadSummaries'
  | 'timelineListRef'
  | 'timelineMessageActionsRef'
  | 'timelineMessages'
  | 'timelineRef'
  | 'typingStatus'
  | 'uiOverlayStore'
  | 'undoAnswered'
  | 'undoRoomID'
  | 'unreadMarkerID'
  | 'visibleMessages'
>

export type ComposerState = Pick<
  AppState,
  | 'applyEmojiSuggestion'
  | 'applyFormatting'
  | 'applyMention'
  | 'attachmentInputRef'
  | 'busy'
  | 'cancelSuggestedReplies'
  | 'captureNoun'
  | 'chatTutorLanguage'
  | 'composeDraftStore'
  | 'composeTextRef'
  | 'composerAIItems'
  | 'composerContextMessage'
  | 'composerEmojiControlRef'
  | 'composerInputRef'
  | 'editTarget'
  | 'emojiActiveIndex'
  | 'emojiOptions'
  | 'emojiPickerOpen'
  | 'focusTimelineMessage'
  | 'handleAttachmentInput'
  | 'handleComposerKeyDown'
  | 'handleComposerPaste'
  | 'imageRunHere'
  | 'imageRunStatus'
  | 'improveRestore'
  | 'insertPickedEmoji'
  | 'mentionActiveIndex'
  | 'mentionOptions'
  | 'openScheduleMessage'
  | 'preferencesRef'
  | 'removeStagedAttachment'
  | 'replyTarget'
  | 'restoreImprovedDraft'
  | 'roomChatGoal'
  | 'roomDrafts'
  | 'saveChatGoal'
  | 'selectedRoom'
  | 'selectedRoomID'
  | 'sendableStagedAttachments'
  | 'setComposeDraft'
  | 'setComposeText'
  | 'setEditTarget'
  | 'setEmojiActiveIndex'
  | 'setMentionActiveIndex'
  | 'setMentionBindings'
  | 'setMentionStart'
  | 'setReplyTarget'
  | 'snippetExpander'
  | 'snippetMatch'
  | 'snippetMenuVisible'
  | 'snippetOptions'
  | 'stagedRoomAttachments'
  | 'startRecording'
  | 'stopImageGeneration'
  | 'stopRecording'
  | 'submitMessage'
  | 'suggestRepliesForRoom'
  | 'suggestedReplies'
  | 'summaryStatus'
  | 'systemPrefersDark'
  | 'themePreference'
  | 'toggleComposerEmojiPicker'
  | 'updateEmojiQuery'
  | 'updateMentionQuery'
  | 'useSuggestedReply'
  | 'videoPreviewRef'
  | 'videoRecordingActive'
  | 'voiceCaptureStatus'
  | 'voiceRecordingActive'
>

export type OverlaysState = Pick<
  AppState,
  | 'acceptAIResult'
  | 'activeAccountID'
  | 'activeThread'
  | 'agentEditor'
  | 'agentSettingsError'
  | 'aiEnabled'
  | 'aiPanel'
  | 'analyzeWithLanguageTutor'
  | 'applyImprovedDraft'
  | 'approveGeneratedImage'
  | 'archiveInactiveRooms'
  | 'audioInputDevices'
  | 'busy'
  | 'closeAIResult'
  | 'closeImproveDraft'
  | 'closeLanguageTutor'
  | 'closeMediaGallery'
  | 'confirmMessageForward'
  | 'createAgentProfile'
  | 'deleteAgentProfile'
  | 'editTarget'
  | 'forwardBusy'
  | 'forwardError'
  | 'forwardTargetRoomID'
  | 'forwardingMessage'
  | 'generatedImageReview'
  | 'historyRevision'
  | 'improveDraft'
  | 'inferChatGoal'
  | 'inviteToSelectedRoom'
  | 'languageRoles'
  | 'languageTutorState'
  | 'leaveConfirmOpen'
  | 'leaveRoomError'
  | 'leaveSelectedRoom'
  | 'leavingRoom'
  | 'manageScheduledJob'
  | 'mediaApproval'
  | 'mediaGalleryError'
  | 'mediaGalleryFilter'
  | 'mediaGalleryItems'
  | 'mediaGalleryLoading'
  | 'mediaGalleryOpen'
  | 'mediaGalleryScanned'
  | 'messages'
  | 'onlineAIConfirmation'
  | 'openMediaGallery'
  | 'persistRoomAgents'
  | 'preferences'
  | 'profilePhotoPreview'
  | 'quickSwitcherIndex'
  | 'quickSwitcherInputRef'
  | 'quickSwitcherQuery'
  | 'quickSwitcherRooms'
  | 'redactMessage'
  | 'redactTarget'
  | 'regenerateAIResult'
  | 'resetAccountWorkspace'
  | 'resolveMediaApproval'
  | 'resolveOnlineAIConfirmation'
  | 'roomAgents'
  | 'roomChatGoal'
  | 'roomDrafts'
  | 'roomInfoOpen'
  | 'roomMembers'
  | 'roomMembersError'
  | 'roomMembersLoading'
  | 'rooms'
  | 'runImproveDraft'
  | 'saveAgentProfile'
  | 'saveChatGoal'
  | 'scheduleTimeSuggestions'
  | 'scheduledBusyID'
  | 'scheduledDialogError'
  | 'scheduledDraft'
  | 'scheduledDueAt'
  | 'scheduledJobs'
  | 'scheduledJobsError'
  | 'scheduledJobsOpen'
  | 'scheduledLoading'
  | 'scheduledSaving'
  | 'scheduledTimes'
  | 'selectedAudioInputDeviceId'
  | 'selectedRoom'
  | 'selectedRoomID'
  | 'sendAIFollowUp'
  | 'setAIFollowUp'
  | 'setAgentEditor'
  | 'setAgentSettingsError'
  | 'setForwardTargetRoomID'
  | 'setForwardingMessage'
  | 'setGeneratedImageReview'
  | 'setImproveDraftGoal'
  | 'setLeaveConfirmOpen'
  | 'setLeaveRoomError'
  | 'setMediaGalleryFilter'
  | 'setOpenThread'
  | 'setPreference'
  | 'setPreferenceWithTransition'
  | 'setPreferences'
  | 'setProfilePhotoPreview'
  | 'setQuickSwitcherIndex'
  | 'setQuickSwitcherOpen'
  | 'setQuickSwitcherQuery'
  | 'setRedactTarget'
  | 'setRoomInfoOpen'
  | 'setScheduledDraft'
  | 'setScheduledDueAt'
  | 'setScheduledJobsOpen'
  | 'setScheduledTimes'
  | 'setSettingsOpen'
  | 'setSettingsTab'
  | 'setStagedAttachments'
  | 'showRoom'
  | 'snapshot'
  | 'snippets'
  | 'stopAIRequest'
  | 'stopImproveReview'
  | 'submitScheduledDraft'
  | 'uiOverlayStore'
  | 'updateSnippets'
  | 'useLanguageTutorDraft'
>

const SessionRoomsContext = createContext<SessionRoomsState | null>(null)
const TimelineContext = createContext<TimelineState | null>(null)
const ComposerContext = createContext<ComposerState | null>(null)
const OverlaysContext = createContext<OverlaysState | null>(null)

export function AppDomainProviders({ app, children }: { app: AppState; children: ReactNode }) {
  const latestAppRef = useRef(app)
  latestAppRef.current = app

  const stableActions = useMemo(() => ({
    acceptInvite: (...args: Parameters<AppState['acceptInvite']>) => latestAppRef.current.acceptInvite(...args),
    declineInvite: (...args: Parameters<AppState['declineInvite']>) => latestAppRef.current.declineInvite(...args),
    applyBulkRoomAction: (...args: Parameters<AppState['applyBulkRoomAction']>) => latestAppRef.current.applyBulkRoomAction(...args),
    applyMenuFilter: (...args: Parameters<AppState['applyMenuFilter']>) => latestAppRef.current.applyMenuFilter(...args),
    cancelAIDraftBatch: () => latestAppRef.current.cancelAIDraftBatch(),
    clearRoomSelection: () => latestAppRef.current.clearRoomSelection(),
    createLocalAIAgent: (...args: Parameters<AppState['createLocalAIAgent']>) => latestAppRef.current.createLocalAIAgent(...args),
    deleteLocalAIChat: (...args: Parameters<AppState['deleteLocalAIChat']>) => latestAppRef.current.deleteLocalAIChat(...args),
    deleteLocalAIFolder: (...args: Parameters<AppState['deleteLocalAIFolder']>) => latestAppRef.current.deleteLocalAIFolder(...args),
    exportSelectedRoomChat: () => latestAppRef.current.exportSelectedRoomChat(),
    generateNeedsReplyDrafts: () => latestAppRef.current.generateNeedsReplyDrafts(),
    getRoomContextMenuState: (...args: Parameters<AppState['getRoomContextMenuState']>) => latestAppRef.current.getRoomContextMenuState(...args),
    handleMarkAnsweredKeyDown: (...args: Parameters<AppState['handleMarkAnsweredKeyDown']>) => latestAppRef.current.handleMarkAnsweredKeyDown(...args),
    markRoomAnswered: (...args: Parameters<AppState['markRoomAnswered']>) => latestAppRef.current.markRoomAnswered(...args),
    markRoomRead: (...args: Parameters<AppState['markRoomRead']>) => latestAppRef.current.markRoomRead(...args),
    markRoomUnread: (...args: Parameters<AppState['markRoomUnread']>) => latestAppRef.current.markRoomUnread(...args),
    moveLocalAIChatToFolder: (...args: Parameters<AppState['moveLocalAIChatToFolder']>) => latestAppRef.current.moveLocalAIChatToFolder(...args),
    openMediaGallery: () => latestAppRef.current.openMediaGallery(),
    openRoomInfo: () => latestAppRef.current.openRoomInfo(),
    openScheduledJobs: () => latestAppRef.current.openScheduledJobs(),
    reorderLocalAIFolders: (...args: Parameters<AppState['reorderLocalAIFolders']>) => latestAppRef.current.reorderLocalAIFolders(...args),
    saveLocalAIFolderDraft: (...args: Parameters<AppState['saveLocalAIFolderDraft']>) => latestAppRef.current.saveLocalAIFolderDraft(...args),
    saveLocalAIRename: (...args: Parameters<AppState['saveLocalAIRename']>) => latestAppRef.current.saveLocalAIRename(...args),
    selectLocalAIChat: (...args: Parameters<AppState['selectLocalAIChat']>) => latestAppRef.current.selectLocalAIChat(...args),
    setLocalAIChatId: (...args: Parameters<AppState['setLocalAIChatId']>) => latestAppRef.current.setLocalAIChatId(...args),
    setLocalAIDeleteArmedID: (...args: Parameters<AppState['setLocalAIDeleteArmedID']>) => latestAppRef.current.setLocalAIDeleteArmedID(...args),
    setLocalAIFolderDeleteArmedID: (...args: Parameters<AppState['setLocalAIFolderDeleteArmedID']>) => latestAppRef.current.setLocalAIFolderDeleteArmedID(...args),
    setLocalAIFolderDraft: (...args: Parameters<AppState['setLocalAIFolderDraft']>) => latestAppRef.current.setLocalAIFolderDraft(...args),
    setLocalAIFolderFilter: (...args: Parameters<AppState['setLocalAIFolderFilter']>) => latestAppRef.current.setLocalAIFolderFilter(...args),
    setLocalAINewChatAgentId: (...args: Parameters<AppState['setLocalAINewChatAgentId']>) => latestAppRef.current.setLocalAINewChatAgentId(...args),
    setLocalAIRenameDraft: (...args: Parameters<AppState['setLocalAIRenameDraft']>) => latestAppRef.current.setLocalAIRenameDraft(...args),
    setMobilePane: (...args: Parameters<AppState['setMobilePane']>) => latestAppRef.current.setMobilePane(...args),
    setPreference: (...args: Parameters<AppState['setPreference']>) => latestAppRef.current.setPreference(...args),
    setProfilePhotoPreview: (...args: Parameters<AppState['setProfilePhotoPreview']>) => latestAppRef.current.setProfilePhotoPreview(...args),
    setRoomArchived: (...args: Parameters<AppState['setRoomArchived']>) => latestAppRef.current.setRoomArchived(...args),
    setRoomContextMenu: (...args: Parameters<AppState['setRoomContextMenu']>) => latestAppRef.current.setRoomContextMenu(...args),
    setSearch: (...args: Parameters<AppState['setSearch']>) => latestAppRef.current.setSearch(...args),
    setSearchOpen: (...args: Parameters<AppState['setSearchOpen']>) => latestAppRef.current.setSearchOpen(...args),
    setSettingsOpen: (...args: Parameters<AppState['setSettingsOpen']>) => latestAppRef.current.setSettingsOpen(...args),
    startLocalAIChat: (...args: Parameters<AppState['startLocalAIChat']>) => latestAppRef.current.startLocalAIChat(...args),
    toggleRoomRefinement: (...args: Parameters<AppState['toggleRoomRefinement']>) => latestAppRef.current.toggleRoomRefinement(...args),
    cancelChatExport: () => latestAppRef.current.cancelChatExport(),
    clearScheduledNotice: () => latestAppRef.current.clearScheduledNotice(),
    clearUndoToast: () => latestAppRef.current.clearUndoToast(),
    closeMessageSearch: () => latestAppRef.current.closeMessageSearch(),
    dismissChatExport: () => latestAppRef.current.dismissChatExport(),
    focusTimelineMessage: (...args: Parameters<AppState['focusTimelineMessage']>) => latestAppRef.current.focusTimelineMessage(...args),
    handleTimelineKeyDown: (...args: Parameters<AppState['handleTimelineKeyDown']>) => latestAppRef.current.handleTimelineKeyDown(...args),
    isNearBottom: (...args: Parameters<AppState['isNearBottom']>) => latestAppRef.current.isNearBottom(...args),
    isNearTop: (...args: Parameters<AppState['isNearTop']>) => latestAppRef.current.isNearTop(...args),
    loadMoreSearchResults: () => latestAppRef.current.loadMoreSearchResults(),
    loadOlderMessages: () => latestAppRef.current.loadOlderMessages(),
    openSearchResult: (...args: Parameters<AppState['openSearchResult']>) => latestAppRef.current.openSearchResult(...args),
    revealChatExport: (...args: Parameters<AppState['revealChatExport']>) => latestAppRef.current.revealChatExport(...args),
    setChatTranslation: (...args: Parameters<AppState['setChatTranslation']>) => latestAppRef.current.setChatTranslation(...args),
    setError: (...args: Parameters<AppState['setError']>) => latestAppRef.current.setError(...args),
    setMessageContextMenu: (...args: Parameters<AppState['setMessageContextMenu']>) => latestAppRef.current.setMessageContextMenu(...args),
    setMessageSearch: (...args: Parameters<AppState['setMessageSearch']>) => latestAppRef.current.setMessageSearch(...args),
    setSearchFrom: (...args: Parameters<AppState['setSearchFrom']>) => latestAppRef.current.setSearchFrom(...args),
    setSearchRoomID: (...args: Parameters<AppState['setSearchRoomID']>) => latestAppRef.current.setSearchRoomID(...args),
    setSearchSender: (...args: Parameters<AppState['setSearchSender']>) => latestAppRef.current.setSearchSender(...args),
    setSearchTo: (...args: Parameters<AppState['setSearchTo']>) => latestAppRef.current.setSearchTo(...args),
    setUnreadMarker: (...args: Parameters<AppState['setUnreadMarker']>) => latestAppRef.current.setUnreadMarker(...args),
    submitMessageSearch: (...args: Parameters<AppState['submitMessageSearch']>) => latestAppRef.current.submitMessageSearch(...args),
    undoAnswered: () => latestAppRef.current.undoAnswered(),
    applyEmojiSuggestion: (...args: Parameters<AppState['applyEmojiSuggestion']>) => latestAppRef.current.applyEmojiSuggestion(...args),
    applyFormatting: (...args: Parameters<AppState['applyFormatting']>) => latestAppRef.current.applyFormatting(...args),
    applyMention: (...args: Parameters<AppState['applyMention']>) => latestAppRef.current.applyMention(...args),
    cancelSuggestedReplies: () => latestAppRef.current.cancelSuggestedReplies(),
    handleAttachmentInput: (...args: Parameters<AppState['handleAttachmentInput']>) => latestAppRef.current.handleAttachmentInput(...args),
    handleComposerKeyDown: (...args: Parameters<AppState['handleComposerKeyDown']>) => latestAppRef.current.handleComposerKeyDown(...args),
    handleComposerPaste: (...args: Parameters<AppState['handleComposerPaste']>) => latestAppRef.current.handleComposerPaste(...args),
    insertPickedEmoji: (...args: Parameters<AppState['insertPickedEmoji']>) => latestAppRef.current.insertPickedEmoji(...args),
    openScheduleMessage: () => latestAppRef.current.openScheduleMessage(),
    removeStagedAttachment: (...args: Parameters<AppState['removeStagedAttachment']>) => latestAppRef.current.removeStagedAttachment(...args),
    restoreImprovedDraft: () => latestAppRef.current.restoreImprovedDraft(),
    saveChatGoal: (...args: Parameters<AppState['saveChatGoal']>) => latestAppRef.current.saveChatGoal(...args),
    setComposeDraft: (...args: Parameters<AppState['setComposeDraft']>) => latestAppRef.current.setComposeDraft(...args),
    setComposeText: (...args: Parameters<AppState['setComposeText']>) => latestAppRef.current.setComposeText(...args),
    setEditTarget: (...args: Parameters<AppState['setEditTarget']>) => latestAppRef.current.setEditTarget(...args),
    setEmojiActiveIndex: (...args: Parameters<AppState['setEmojiActiveIndex']>) => latestAppRef.current.setEmojiActiveIndex(...args),
    setMentionActiveIndex: (...args: Parameters<AppState['setMentionActiveIndex']>) => latestAppRef.current.setMentionActiveIndex(...args),
    setMentionBindings: (...args: Parameters<AppState['setMentionBindings']>) => latestAppRef.current.setMentionBindings(...args),
    setMentionStart: (...args: Parameters<AppState['setMentionStart']>) => latestAppRef.current.setMentionStart(...args),
    setReplyTarget: (...args: Parameters<AppState['setReplyTarget']>) => latestAppRef.current.setReplyTarget(...args),
    startRecording: (...args: Parameters<AppState['startRecording']>) => latestAppRef.current.startRecording(...args),
    stopImageGeneration: () => latestAppRef.current.stopImageGeneration(),
    stopRecording: () => latestAppRef.current.stopRecording(),
    submitMessage: (...args: Parameters<AppState['submitMessage']>) => latestAppRef.current.submitMessage(...args),
    suggestRepliesForRoom: (...args: Parameters<AppState['suggestRepliesForRoom']>) => latestAppRef.current.suggestRepliesForRoom(...args),
    toggleComposerEmojiPicker: () => latestAppRef.current.toggleComposerEmojiPicker(),
    updateEmojiQuery: (...args: Parameters<AppState['updateEmojiQuery']>) => latestAppRef.current.updateEmojiQuery(...args),
    updateMentionQuery: (...args: Parameters<AppState['updateMentionQuery']>) => latestAppRef.current.updateMentionQuery(...args),
    useSuggestedReply: (...args: Parameters<AppState['useSuggestedReply']>) => latestAppRef.current.useSuggestedReply(...args),
    acceptAIResult: () => latestAppRef.current.acceptAIResult(),
    analyzeWithLanguageTutor: (...args: Parameters<AppState['analyzeWithLanguageTutor']>) => latestAppRef.current.analyzeWithLanguageTutor(...args),
    applyImprovedDraft: (...args: Parameters<AppState['applyImprovedDraft']>) => latestAppRef.current.applyImprovedDraft(...args),
    approveGeneratedImage: () => latestAppRef.current.approveGeneratedImage(),
    archiveInactiveRooms: (...args: Parameters<AppState['archiveInactiveRooms']>) => latestAppRef.current.archiveInactiveRooms(...args),
    closeAIResult: () => latestAppRef.current.closeAIResult(),
    closeImproveDraft: () => latestAppRef.current.closeImproveDraft(),
    closeLanguageTutor: () => latestAppRef.current.closeLanguageTutor(),
    closeMediaGallery: () => latestAppRef.current.closeMediaGallery(),
    confirmMessageForward: () => latestAppRef.current.confirmMessageForward(),
    createAgentProfile: () => latestAppRef.current.createAgentProfile(),
    deleteAgentProfile: (...args: Parameters<AppState['deleteAgentProfile']>) => latestAppRef.current.deleteAgentProfile(...args),
    inferChatGoal: () => latestAppRef.current.inferChatGoal(),
    inviteToSelectedRoom: (...args: Parameters<AppState['inviteToSelectedRoom']>) => latestAppRef.current.inviteToSelectedRoom(...args),
    leaveSelectedRoom: () => latestAppRef.current.leaveSelectedRoom(),
    manageScheduledJob: (...args: Parameters<AppState['manageScheduledJob']>) => latestAppRef.current.manageScheduledJob(...args),
    persistRoomAgents: (...args: Parameters<AppState['persistRoomAgents']>) => latestAppRef.current.persistRoomAgents(...args),
    redactMessage: () => latestAppRef.current.redactMessage(),
    regenerateAIResult: () => latestAppRef.current.regenerateAIResult(),
    resetAccountWorkspace: (...args: Parameters<AppState['resetAccountWorkspace']>) => latestAppRef.current.resetAccountWorkspace(...args),
    resolveMediaApproval: (...args: Parameters<AppState['resolveMediaApproval']>) => latestAppRef.current.resolveMediaApproval(...args),
    resolveOnlineAIConfirmation: (...args: Parameters<AppState['resolveOnlineAIConfirmation']>) => latestAppRef.current.resolveOnlineAIConfirmation(...args),
    runImproveDraft: () => latestAppRef.current.runImproveDraft(),
    saveAgentProfile: (...args: Parameters<AppState['saveAgentProfile']>) => latestAppRef.current.saveAgentProfile(...args),
    sendAIFollowUp: (...args: Parameters<AppState['sendAIFollowUp']>) => latestAppRef.current.sendAIFollowUp(...args),
    setAIFollowUp: (...args: Parameters<AppState['setAIFollowUp']>) => latestAppRef.current.setAIFollowUp(...args),
    setAgentEditor: (...args: Parameters<AppState['setAgentEditor']>) => latestAppRef.current.setAgentEditor(...args),
    setAgentSettingsError: (...args: Parameters<AppState['setAgentSettingsError']>) => latestAppRef.current.setAgentSettingsError(...args),
    setForwardTargetRoomID: (...args: Parameters<AppState['setForwardTargetRoomID']>) => latestAppRef.current.setForwardTargetRoomID(...args),
    setForwardingMessage: (...args: Parameters<AppState['setForwardingMessage']>) => latestAppRef.current.setForwardingMessage(...args),
    setGeneratedImageReview: (...args: Parameters<AppState['setGeneratedImageReview']>) => latestAppRef.current.setGeneratedImageReview(...args),
    setImproveDraftGoal: (...args: Parameters<AppState['setImproveDraftGoal']>) => latestAppRef.current.setImproveDraftGoal(...args),
    setLeaveConfirmOpen: (...args: Parameters<AppState['setLeaveConfirmOpen']>) => latestAppRef.current.setLeaveConfirmOpen(...args),
    setLeaveRoomError: (...args: Parameters<AppState['setLeaveRoomError']>) => latestAppRef.current.setLeaveRoomError(...args),
    setMediaGalleryFilter: (...args: Parameters<AppState['setMediaGalleryFilter']>) => latestAppRef.current.setMediaGalleryFilter(...args),
    setOpenThread: (...args: Parameters<AppState['setOpenThread']>) => latestAppRef.current.setOpenThread(...args),
    setPreferenceWithTransition: (...args: Parameters<AppState['setPreferenceWithTransition']>) => latestAppRef.current.setPreferenceWithTransition(...args),
    setPreferences: (...args: Parameters<AppState['setPreferences']>) => latestAppRef.current.setPreferences(...args),
    setQuickSwitcherIndex: (...args: Parameters<AppState['setQuickSwitcherIndex']>) => latestAppRef.current.setQuickSwitcherIndex(...args),
    setQuickSwitcherOpen: (...args: Parameters<AppState['setQuickSwitcherOpen']>) => latestAppRef.current.setQuickSwitcherOpen(...args),
    setQuickSwitcherQuery: (...args: Parameters<AppState['setQuickSwitcherQuery']>) => latestAppRef.current.setQuickSwitcherQuery(...args),
    setRedactTarget: (...args: Parameters<AppState['setRedactTarget']>) => latestAppRef.current.setRedactTarget(...args),
    setRoomInfoOpen: (...args: Parameters<AppState['setRoomInfoOpen']>) => latestAppRef.current.setRoomInfoOpen(...args),
    setScheduledDraft: (...args: Parameters<AppState['setScheduledDraft']>) => latestAppRef.current.setScheduledDraft(...args),
    setScheduledDueAt: (...args: Parameters<AppState['setScheduledDueAt']>) => latestAppRef.current.setScheduledDueAt(...args),
    setScheduledJobsOpen: (...args: Parameters<AppState['setScheduledJobsOpen']>) => latestAppRef.current.setScheduledJobsOpen(...args),
    setScheduledTimes: (...args: Parameters<AppState['setScheduledTimes']>) => latestAppRef.current.setScheduledTimes(...args),
    setSettingsTab: (...args: Parameters<AppState['setSettingsTab']>) => latestAppRef.current.setSettingsTab(...args),
    setStagedAttachments: (...args: Parameters<AppState['setStagedAttachments']>) => latestAppRef.current.setStagedAttachments(...args),
    showRoom: (...args: Parameters<AppState['showRoom']>) => latestAppRef.current.showRoom(...args),
    stopAIRequest: () => latestAppRef.current.stopAIRequest(),
    stopImproveReview: () => latestAppRef.current.stopImproveReview(),
    submitScheduledDraft: (...args: Parameters<AppState['submitScheduledDraft']>) => latestAppRef.current.submitScheduledDraft(...args),
    updateSnippets: (...args: Parameters<AppState['updateSnippets']>) => latestAppRef.current.updateSnippets(...args),
    useLanguageTutorDraft: (...args: Parameters<AppState['useLanguageTutorDraft']>) => latestAppRef.current.useLanguageTutorDraft(...args),
  }), [])

  const hasEditTarget = Boolean(app.editTarget)

  const sessionRoomsValue = useMemo<SessionRoomsState>(() => ({
    ...stableActions,
    activeAccountID: app.activeAccountID,
    activeListRoomID: app.activeListRoomID,
    aiEnabled: app.aiEnabled,
    aiInstructions: app.aiInstructions,
    aiReplyDraftBatch: app.aiReplyDraftBatch,
    answeredShortcut: app.answeredShortcut,
    appZoom: app.appZoom,
    busy: app.busy,
    chatExport: app.chatExport,
    connectionProblem: app.connectionProblem,
    filteredRooms: app.filteredRooms,
    hasEditTarget,
    inviteBusyRoomID: app.inviteBusyRoomID,
    isLastMessageByCurrentUser: app.isLastMessageByCurrentUser,
    languageRoles: app.languageRoles,
    listRooms: app.listRooms,
    loadingHistory: app.loadingHistory,
    localAIActiveChat: app.localAIActiveChat,
    localAIActiveFolder: app.localAIActiveFolder,
    localAIAgentId: app.localAIAgentId,
    localAIAgents: app.localAIAgents,
    localAIChatId: app.localAIChatId,
    localAIChatList: app.localAIChatList,
    localAIChatOpen: app.localAIChatOpen,
    localAIDeleteArmedID: app.localAIDeleteArmedID,
    localAIFolderDeleteArmedID: app.localAIFolderDeleteArmedID,
    localAIFolderDraft: app.localAIFolderDraft,
    localAIFolderFilter: app.localAIFolderFilter,
    localAIIconByRoomID: app.localAIIconByRoomID,
    localAIInitialDraft: app.localAIInitialDraft,
    localAINewChatKind: app.localAINewChatKind,
    localAIRenameDraft: app.localAIRenameDraft,
    menuFilter: app.menuFilter,
    needsReplyCount: app.needsReplyCount,
    preferences: app.preferences,
    roomButtonActionsRef: app.roomButtonActionsRef,
    roomListRef: app.roomListRef,
    roomRefinements: app.roomRefinements,
    roomScope: app.roomScope,
    roomSearchInputRef: app.roomSearchInputRef,
    scheduledJobCount: app.scheduledJobCount,
    search: app.search,
    selectedRoom: app.selectedRoom,
    selectedRoomAvatar: app.selectedRoomAvatar,
    selectedRoomAvatarSource: app.selectedRoomAvatarSource,
    selectedRoomID: app.selectedRoomID,
    selectedRoomIDs: app.selectedRoomIDs,
    selectedRoomListIndex: app.selectedRoomListIndex,
    snapshot: app.snapshot,
    uiOverlayStore: app.uiOverlayStore,
    volatileAIDrafts: app.volatileAIDrafts,
  }), [
    stableActions,
    app.activeAccountID,
    app.activeListRoomID,
    app.aiEnabled,
    app.aiInstructions,
    app.aiReplyDraftBatch,
    app.appZoom,
    app.answeredShortcut,
    app.busy,
    app.chatExport,
    app.connectionProblem,
    app.filteredRooms,
    hasEditTarget,
    app.inviteBusyRoomID,
    app.isLastMessageByCurrentUser,
    app.languageRoles,
    app.listRooms,
    app.loadingHistory,
    app.localAIActiveChat,
    app.localAIActiveFolder,
    app.localAIAgentId,
    app.localAIAgents,
    app.localAIChatId,
    app.localAIChatList,
    app.localAIChatOpen,
    app.localAIDeleteArmedID,
    app.localAIFolderDeleteArmedID,
    app.localAIFolderDraft,
    app.localAIFolderFilter,
    app.localAIIconByRoomID,
    app.localAIInitialDraft,
    app.localAINewChatKind,
    app.localAIRenameDraft,
    app.menuFilter,
    app.needsReplyCount,
    app.preferences,
    app.roomButtonActionsRef,
    app.roomListRef,
    app.roomRefinements,
    app.roomScope,
    app.roomSearchInputRef,
    app.scheduledJobCount,
    app.search,
    app.selectedRoom,
    app.selectedRoomAvatar,
    app.selectedRoomAvatarSource,
    app.selectedRoomID,
    app.selectedRoomIDs,
    app.selectedRoomListIndex,
    app.snapshot,
    app.uiOverlayStore,
    app.volatileAIDrafts,
  ])

  const timelineValue = useMemo<TimelineState>(() => ({
    ...stableActions,
    activeAccountID: app.activeAccountID,
    activeUnreadMarker: app.activeUnreadMarker,
    appZoom: app.appZoom,
    autoPlayNextMessageId: app.autoPlayNextMessageId,
    chatExportForSelectedRoom: app.chatExportForSelectedRoom,
    chatTranslation: app.chatTranslation,
    editTarget: app.editTarget,
    error: app.error,
    hasOlder: app.hasOlder,
    hasOlderRef: app.hasOlderRef,
    loadingHistory: app.loadingHistory,
    loadingOlder: app.loadingOlder,
    loadingOlderRef: app.loadingOlderRef,
    messageContextMenuItems: app.messageContextMenuItems,
    messageSearch: app.messageSearch,
    messages: app.messages,
    observeUnreadDivider: app.observeUnreadDivider,
    pinnedScrollTopRef: app.pinnedScrollTopRef,
    preferences: app.preferences,
    reactingMessageID: app.reactingMessageID,
    rooms: app.rooms,
    roomsByID: app.roomsByID,
    scheduledNotice: app.scheduledNotice,
    searchFrom: app.searchFrom,
    searchNextBatch: app.searchNextBatch,
    searchResults: app.searchResults,
    searchRoomID: app.searchRoomID,
    searchSender: app.searchSender,
    searchStatus: app.searchStatus,
    searchTo: app.searchTo,
    searching: app.searching,
    selectedRoom: app.selectedRoom,
    selectedRoomID: app.selectedRoomID,
    snapshot: app.snapshot,
    stickToBottomRef: app.stickToBottomRef,
    systemPrefersDark: app.systemPrefersDark,
    themePreference: app.themePreference,
    threadSummaries: app.threadSummaries,
    timelineListRef: app.timelineListRef,
    timelineMessageActionsRef: app.timelineMessageActionsRef,
    timelineMessages: app.timelineMessages,
    timelineRef: app.timelineRef,
    typingStatus: app.typingStatus,
    uiOverlayStore: app.uiOverlayStore,
    undoRoomID: app.undoRoomID,
    unreadMarkerID: app.unreadMarkerID,
    visibleMessages: app.visibleMessages,
  }), [
    stableActions,
    app.activeAccountID,
    app.activeUnreadMarker,
    app.appZoom,
    app.autoPlayNextMessageId,
    app.chatExportForSelectedRoom,
    app.chatTranslation,
    app.editTarget,
    app.error,
    app.hasOlder,
    app.hasOlderRef,
    app.loadingHistory,
    app.loadingOlder,
    app.loadingOlderRef,
    app.messageContextMenuItems,
    app.messageSearch,
    app.messages,
    app.observeUnreadDivider,
    app.pinnedScrollTopRef,
    app.preferences,
    app.reactingMessageID,
    app.rooms,
    app.roomsByID,
    app.scheduledNotice,
    app.searchFrom,
    app.searchNextBatch,
    app.searchResults,
    app.searchRoomID,
    app.searchSender,
    app.searchStatus,
    app.searchTo,
    app.searching,
    app.selectedRoom,
    app.selectedRoomID,
    app.snapshot,
    app.stickToBottomRef,
    app.systemPrefersDark,
    app.themePreference,
    app.threadSummaries,
    app.timelineListRef,
    app.timelineMessageActionsRef,
    app.timelineMessages,
    app.timelineRef,
    app.typingStatus,
    app.uiOverlayStore,
    app.undoRoomID,
    app.unreadMarkerID,
    app.visibleMessages,
  ])

  const composerValue = useMemo<ComposerState>(() => ({
    ...stableActions,
    attachmentInputRef: app.attachmentInputRef,
    busy: app.busy,
    captureNoun: app.captureNoun,
    chatTutorLanguage: app.chatTutorLanguage,
    composeDraftStore: app.composeDraftStore,
    composeTextRef: app.composeTextRef,
    composerAIItems: app.composerAIItems,
    composerContextMessage: app.composerContextMessage,
    composerEmojiControlRef: app.composerEmojiControlRef,
    composerInputRef: app.composerInputRef,
    editTarget: app.editTarget,
    emojiActiveIndex: app.emojiActiveIndex,
    emojiOptions: app.emojiOptions,
    emojiPickerOpen: app.emojiPickerOpen,
    imageRunHere: app.imageRunHere,
    imageRunStatus: app.imageRunStatus,
    improveRestore: app.improveRestore,
    mentionActiveIndex: app.mentionActiveIndex,
    mentionOptions: app.mentionOptions,
    preferencesRef: app.preferencesRef,
    replyTarget: app.replyTarget,
    roomChatGoal: app.roomChatGoal,
    roomDrafts: app.roomDrafts,
    selectedRoom: app.selectedRoom,
    selectedRoomID: app.selectedRoomID,
    sendableStagedAttachments: app.sendableStagedAttachments,
    snippetExpander: app.snippetExpander,
    snippetMatch: app.snippetMatch,
    snippetMenuVisible: app.snippetMenuVisible,
    snippetOptions: app.snippetOptions,
    stagedRoomAttachments: app.stagedRoomAttachments,
    suggestedReplies: app.suggestedReplies,
    summaryStatus: app.summaryStatus,
    systemPrefersDark: app.systemPrefersDark,
    themePreference: app.themePreference,
    videoPreviewRef: app.videoPreviewRef,
    videoRecordingActive: app.videoRecordingActive,
    voiceCaptureStatus: app.voiceCaptureStatus,
    voiceRecordingActive: app.voiceRecordingActive,
  }), [
    stableActions,
    app.attachmentInputRef,
    app.busy,
    app.captureNoun,
    app.chatTutorLanguage,
    app.composeDraftStore,
    app.composeTextRef,
    app.composerAIItems,
    app.composerContextMessage,
    app.composerEmojiControlRef,
    app.composerInputRef,
    app.editTarget,
    app.emojiActiveIndex,
    app.emojiOptions,
    app.emojiPickerOpen,
    app.imageRunHere,
    app.imageRunStatus,
    app.improveRestore,
    app.mentionActiveIndex,
    app.mentionOptions,
    app.preferencesRef,
    app.replyTarget,
    app.roomChatGoal,
    app.roomDrafts,
    app.selectedRoom,
    app.selectedRoomID,
    app.sendableStagedAttachments,
    app.snippetExpander,
    app.snippetMatch,
    app.snippetMenuVisible,
    app.snippetOptions,
    app.stagedRoomAttachments,
    app.suggestedReplies,
    app.summaryStatus,
    app.systemPrefersDark,
    app.themePreference,
    app.videoPreviewRef,
    app.videoRecordingActive,
    app.voiceCaptureStatus,
    app.voiceRecordingActive,
  ])

  const overlaysValue = useMemo<OverlaysState>(() => ({
    ...stableActions,
    activeAccountID: app.activeAccountID,
    activeThread: app.activeThread,
    agentEditor: app.agentEditor,
    agentSettingsError: app.agentSettingsError,
    aiEnabled: app.aiEnabled,
    aiPanel: app.aiPanel,
    audioInputDevices: app.audioInputDevices,
    busy: app.busy,
    editTarget: app.editTarget,
    forwardBusy: app.forwardBusy,
    forwardError: app.forwardError,
    forwardTargetRoomID: app.forwardTargetRoomID,
    forwardingMessage: app.forwardingMessage,
    generatedImageReview: app.generatedImageReview,
    historyRevision: app.historyRevision,
    improveDraft: app.improveDraft,
    languageRoles: app.languageRoles,
    languageTutorState: app.languageTutorState,
    leaveConfirmOpen: app.leaveConfirmOpen,
    leaveRoomError: app.leaveRoomError,
    leavingRoom: app.leavingRoom,
    mediaApproval: app.mediaApproval,
    mediaGalleryError: app.mediaGalleryError,
    mediaGalleryFilter: app.mediaGalleryFilter,
    mediaGalleryItems: app.mediaGalleryItems,
    mediaGalleryLoading: app.mediaGalleryLoading,
    mediaGalleryOpen: app.mediaGalleryOpen,
    mediaGalleryScanned: app.mediaGalleryScanned,
    messages: app.messages,
    onlineAIConfirmation: app.onlineAIConfirmation,
    preferences: app.preferences,
    profilePhotoPreview: app.profilePhotoPreview,
    quickSwitcherIndex: app.quickSwitcherIndex,
    quickSwitcherInputRef: app.quickSwitcherInputRef,
    quickSwitcherQuery: app.quickSwitcherQuery,
    quickSwitcherRooms: app.quickSwitcherRooms,
    redactTarget: app.redactTarget,
    roomAgents: app.roomAgents,
    roomChatGoal: app.roomChatGoal,
    roomDrafts: app.roomDrafts,
    roomInfoOpen: app.roomInfoOpen,
    roomMembers: app.roomMembers,
    roomMembersError: app.roomMembersError,
    roomMembersLoading: app.roomMembersLoading,
    rooms: app.rooms,
    scheduleTimeSuggestions: app.scheduleTimeSuggestions,
    scheduledBusyID: app.scheduledBusyID,
    scheduledDialogError: app.scheduledDialogError,
    scheduledDraft: app.scheduledDraft,
    scheduledDueAt: app.scheduledDueAt,
    scheduledJobs: app.scheduledJobs,
    scheduledJobsError: app.scheduledJobsError,
    scheduledJobsOpen: app.scheduledJobsOpen,
    scheduledLoading: app.scheduledLoading,
    scheduledSaving: app.scheduledSaving,
    scheduledTimes: app.scheduledTimes,
    selectedAudioInputDeviceId: app.selectedAudioInputDeviceId,
    selectedRoom: app.selectedRoom,
    selectedRoomID: app.selectedRoomID,
    snapshot: app.snapshot,
    snippets: app.snippets,
    uiOverlayStore: app.uiOverlayStore,
  }), [
    stableActions,
    app.activeAccountID,
    app.activeThread,
    app.agentEditor,
    app.agentSettingsError,
    app.aiEnabled,
    app.aiPanel,
    app.audioInputDevices,
    app.busy,
    app.editTarget,
    app.forwardBusy,
    app.forwardError,
    app.forwardTargetRoomID,
    app.forwardingMessage,
    app.generatedImageReview,
    app.historyRevision,
    app.improveDraft,
    app.languageRoles,
    app.languageTutorState,
    app.leaveConfirmOpen,
    app.leaveRoomError,
    app.leavingRoom,
    app.mediaApproval,
    app.mediaGalleryError,
    app.mediaGalleryFilter,
    app.mediaGalleryItems,
    app.mediaGalleryLoading,
    app.mediaGalleryOpen,
    app.mediaGalleryScanned,
    app.messages,
    app.onlineAIConfirmation,
    app.preferences,
    app.profilePhotoPreview,
    app.quickSwitcherIndex,
    app.quickSwitcherInputRef,
    app.quickSwitcherQuery,
    app.quickSwitcherRooms,
    app.redactTarget,
    app.roomAgents,
    app.roomChatGoal,
    app.roomDrafts,
    app.roomInfoOpen,
    app.roomMembers,
    app.roomMembersError,
    app.roomMembersLoading,
    app.rooms,
    app.scheduleTimeSuggestions,
    app.scheduledBusyID,
    app.scheduledDialogError,
    app.scheduledDraft,
    app.scheduledDueAt,
    app.scheduledJobs,
    app.scheduledJobsError,
    app.scheduledJobsOpen,
    app.scheduledLoading,
    app.scheduledSaving,
    app.scheduledTimes,
    app.selectedAudioInputDeviceId,
    app.selectedRoom,
    app.selectedRoomID,
    app.snapshot,
    app.snippets,
    app.uiOverlayStore,
  ])

  return (
    <SessionRoomsContext.Provider value={sessionRoomsValue}>
      <TimelineContext.Provider value={timelineValue}>
        <ComposerContext.Provider value={composerValue}>
          <OverlaysContext.Provider value={overlaysValue}>
            {children}
          </OverlaysContext.Provider>
        </ComposerContext.Provider>
      </TimelineContext.Provider>
    </SessionRoomsContext.Provider>
  )
}

export function useSessionRooms(): SessionRoomsState {
  const value = useContext(SessionRoomsContext)
  if (!value) throw new Error('useSessionRooms must be used inside AppDomainProviders')
  return value
}

export function useTimeline(): TimelineState {
  const value = useContext(TimelineContext)
  if (!value) throw new Error('useTimeline must be used inside AppDomainProviders')
  return value
}

export function useComposer(): ComposerState {
  const value = useContext(ComposerContext)
  if (!value) throw new Error('useComposer must be used inside AppDomainProviders')
  return value
}

export function useOverlays(): OverlaysState {
  const value = useContext(OverlaysContext)
  if (!value) throw new Error('useOverlays must be used inside AppDomainProviders')
  return value
}
