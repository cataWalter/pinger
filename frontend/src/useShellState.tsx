import { useCallback, useMemo, useRef, useState } from 'react'
import { useSettingsStore } from './SettingsContext'
import { type Member, type Message, type MessageSearchResult, type Snapshot } from '../bindings/mychat/desktop/models.js'
import { type EmojiQuery } from './composerText'
import { createComposerDraftStore, type ComposerDraftStore } from './composerDraftStore'
import { createUIOverlayStore } from './uiOverlayStore'
import { loadSnippets, type Snippet } from './snippets'
import { useConnectionProblem } from './useConnectionProblem'
import { type ChatAgentProfile } from './aiPrompts'
import { type LocalAIChatKind, useLocalAIChatList } from './localAIChats'
import { type RoomScope, type RoomRefinements, type ChatExportState, type ScheduledDraft, type CaptureKind, type StagedAttachment, type MediaApprovalRequest } from './appShared'

export function useShellState() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const activeAccountID = snapshot?.accountId ?? ''
  const workspaceGenerationRef = useRef(0)
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
  const [messages, setMessages] = useState<Message[]>([])
  // Loading older room history before a Local AI summary chat opens.
  const [summaryStatus, setSummaryStatus] = useState('')
  const summaryLoadingRef = useRef(false)
  const composeDraftStoreRef = useRef<ComposerDraftStore | null>(null)
  if (!composeDraftStoreRef.current) composeDraftStoreRef.current = createComposerDraftStore()
  const composeDraftStore = composeDraftStoreRef.current
  const setComposeText = useCallback((next: string) => {
    composeDraftStore.setText(next)
  }, [composeDraftStore])
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
  const [openThread, setOpenThread] = useState<{ roomID: string; rootID: string } | null>(null)
  const [inviteBusyRoomID, setInviteBusyRoomID] = useState('')
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<{ source: string; label: string } | null>(null)
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
  const uiOverlayStore = useMemo(() => createUIOverlayStore(), [])
  const setSearchOpen = uiOverlayStore.setSearchOpen
  const [messageSearch, setMessageSearch] = useState('')
  const [searchRoomID, setSearchRoomID] = useState('')
  const [searchSender, setSearchSender] = useState('')
  const [searchFrom, setSearchFrom] = useState('')
  const [searchTo, setSearchTo] = useState('')
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([])
  const [searchNextBatch, setSearchNextBatch] = useState('')
  const [searchStatus, setSearchStatus] = useState('')
  const [searching, setSearching] = useState(false)
  const [scheduledDraft, setScheduledDraft] = useState<ScheduledDraft | null>(null)
  const [scheduledDueAt, setScheduledDueAt] = useState('')
  const [scheduledSaving, setScheduledSaving] = useState(false)
  const [scheduledBusyID, setScheduledBusyID] = useState('')
  const [scheduledDialogError, setScheduledDialogError] = useState('')
  const [scheduledNotice, setScheduledNotice] = useState('')
  const settingsStore = useSettingsStore()
  const { setSettingsOpen, setSettingsTab } = settingsStore
  const [undoRoomID, setUndoRoomID] = useState('')
  const undoToastTimerRef = useRef<number | null>(null)
  const scheduledNoticeTimerRef = useRef<number | null>(null)
  const setRoomContextMenu = uiOverlayStore.setRoomContextMenu
  const [selectedRoomIDs, setSelectedRoomIDs] = useState<string[]>([])
  // Replaces the always-visible per-message action bar: the actions only
  // surface as a floating menu when the user right-clicks a message.
  const setMessageContextMenu = uiOverlayStore.setMessageContextMenu
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null)
  const [forwardTargetRoomID, setForwardTargetRoomID] = useState('')
  const [forwardBusy, setForwardBusy] = useState(false)
  const [forwardError, setForwardError] = useState('')
  const setQuickSwitcherOpen = uiOverlayStore.setQuickSwitcherOpen
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
  return { snapshot, setSnapshot, activeAccountID, workspaceGenerationRef, connectionProblem, systemPrefersDark, setSystemPrefersDark, selectedRoomID, setSelectedRoomID, localAIChatOpen, setLocalAIChatOpen, localAIChatId, setLocalAIChatId, localAIInitialDraftVersion, localAIInitialDraft, setLocalAIInitialDraft, localAINewChatAgentId, setLocalAINewChatAgentId, localAINewChatKind, setLocalAINewChatKind, localAIChatList, localAIRenameDraft, setLocalAIRenameDraft, localAIDeleteArmedID, setLocalAIDeleteArmedID, localAIFolderFilter, setLocalAIFolderFilter, localAIFolderDraft, setLocalAIFolderDraft, localAIFolderDeleteArmedID, setLocalAIFolderDeleteArmedID, mobilePane, setMobilePane, search, setSearch, roomScope, setRoomScope, roomRefinements, setRoomRefinements, messages, setMessages, summaryStatus, setSummaryStatus, summaryLoadingRef, composeDraftStore, setComposeText, stagedAttachments, setStagedAttachments, mediaApproval, setMediaApproval, snippets, setSnippets, mentionBindings, setMentionBindings, mentionStart, setMentionStart, mentionEnd, setMentionEnd, mentionQuery, setMentionQuery, emojiMatch, setEmojiMatch, emojiPickerOpen, setEmojiPickerOpen, emojiActiveIndex, setEmojiActiveIndex, mentionActiveIndex, setMentionActiveIndex, replyTarget, setReplyTarget, editTarget, setEditTarget, reactingMessageID, setReactingMessageID, redactTarget, setRedactTarget, roomInfoOpen, setRoomInfoOpen, openThread, setOpenThread, inviteBusyRoomID, setInviteBusyRoomID, profilePhotoPreview, setProfilePhotoPreview, agentEditor, setAgentEditor, agentSettingsError, setAgentSettingsError, roomMembers, setRoomMembers, roomMembersLoading, setRoomMembersLoading, roomMembersError, setRoomMembersError, typingUsers, setTypingUsers, leaveConfirmOpen, setLeaveConfirmOpen, leaveRoomError, setLeaveRoomError, leavingRoom, setLeavingRoom, chatExport, setChatExport, uiOverlayStore, setSearchOpen, messageSearch, setMessageSearch, searchRoomID, setSearchRoomID, searchSender, setSearchSender, searchFrom, setSearchFrom, searchTo, setSearchTo, searchResults, setSearchResults, searchNextBatch, setSearchNextBatch, searchStatus, setSearchStatus, searching, setSearching, scheduledDraft, setScheduledDraft, scheduledDueAt, setScheduledDueAt, scheduledSaving, setScheduledSaving, scheduledBusyID, setScheduledBusyID, scheduledDialogError, setScheduledDialogError, scheduledNotice, setScheduledNotice, settingsStore, setSettingsOpen, setSettingsTab, undoRoomID, setUndoRoomID, undoToastTimerRef, scheduledNoticeTimerRef, setRoomContextMenu, selectedRoomIDs, setSelectedRoomIDs, setMessageContextMenu, forwardingMessage, setForwardingMessage, forwardTargetRoomID, setForwardTargetRoomID, forwardBusy, setForwardBusy, forwardError, setForwardError, setQuickSwitcherOpen, quickSwitcherQuery, setQuickSwitcherQuery, quickSwitcherIndex, setQuickSwitcherIndex, homeserver, setHomeserver, username, setUsername, password, setPassword, recoveryKey, setRecoveryKey, busy, setBusy, autoPlayNextMessageId, setAutoPlayNextMessageId, voiceCaptureStatus, setVoiceCaptureStatus, captureKind, setCaptureKind }
}
