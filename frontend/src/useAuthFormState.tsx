import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Message, type Room } from '../bindings/mychat/desktop/models.js'
import { useScheduledJobs } from './hooks/useScheduledJobs'
import { type PcmVoiceCapture, type TimelineListHandle } from './appShared'
import { type SuggestedRepliesState } from './SuggestedRepliesPicker'
import { type MatrixNotification, type PreferenceValues, type AIPanel, type AIStreamHandler, type LanguageTutorState, type ChatTranslationState, type TimelineMessageActions, type RoomButtonActions, preferenceString } from './appShared'
import type { useShellState } from './useShellState'
import type { VolatileAIDraftState } from './volatileAIDrafts'

export function useAuthFormState(app: ReturnType<typeof useShellState> & VolatileAIDraftState) {
  const { captureKind, scheduledNoticeTimerRef, selectedRoomID, snapshot, undoToastTimerRef, voiceCaptureStatus, workspaceGenerationRef } = app
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string>(preferenceString(snapshot?.preferences ?? {}, 'audio.input_device', ''))
  // The unread count is captured when a room opens, so the divider stays put after the room is marked read.
  const [unreadMarker, setUnreadMarker] = useState<{ scope: string; count: number; messageID: string; seen: boolean; offscreen: boolean } | null>(null)
  const unreadObserverRef = useRef<IntersectionObserver | null>(null)
  const observeUnreadDivider = useCallback((element: HTMLDivElement | null) => {
    if (element) unreadObserverRef.current?.observe(element)
  }, [])
  const [error, setError] = useState('')
  const {
    jobs: scheduledJobs,
    setJobs: setScheduledJobs,
    open: scheduledJobsOpen,
    setOpen: setScheduledJobsOpen,
    times: scheduledTimes,
    setTimes: setScheduledTimes,
    loading: scheduledLoading,
    error: scheduledJobsError,
    setError: setScheduledJobsError,
    refresh: refreshScheduledJobs,
    openDialog: openScheduledJobs,
  } = useScheduledJobs(workspaceGenerationRef)
  const selectedRoomRef = useRef('')
  const roomListRef = useRef<HTMLElement | null>(null)
  const editTargetRef = useRef<Message | null>(null)
  const markRoomAnsweredRef = useRef<(roomID: string) => Promise<void>>(async () => { })
  const showRoomRef = useRef<(roomID: string) => void>(() => { })
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
  const triageBusyRef = useRef(false)
  const stageDroppedFilesRef = useRef<(files: File[]) => void>(() => undefined)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineListRef = useRef<TimelineListHandle>(null)
  const timelineHeightBeforePrepend = useRef<number | null>(null)
  const stickToBottomRef = useRef(true)
  const roomSwitchRef = useRef(false)
  // scrollTop after the last pin to the newest message. A scroll event at this position comes from
  // that pin, or from content growing below it, so it must not count as the reader scrolling away.
  const pinnedScrollTopRef = useRef<number | null>(null)
  const timelineResizeObserverRef = useRef<ResizeObserver | null>(null)
  const startingDirectChatRef = useRef(false)
  const pendingReactionsRef = useRef(new Set<string>())
  const reactionErrorRef = useRef('')
  const timelineMessageActionsRef = useRef<TimelineMessageActions>({
    onDoubleClick: () => { },
    onOpenContextMenu: () => { },
    onFocusMessage: () => { },
    onAudioEnded: () => { },
    onUseTranscript: () => { },
    onSendReaction: () => { },
    onRemoveReaction: () => { },
    onStartDirectChat: () => { },
    onOpenThread: () => { },
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
  }, [scheduledNoticeTimerRef, undoToastTimerRef])
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voicePcmRef = useRef<PcmVoiceCapture | null>(null)
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
  // Size the composer to its text on every render; CSS max-height caps the growth, so it stays one line until a message wraps.
  useLayoutEffect(() => {
    const input = composerInputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  })
  const [aiPanel, setAIPanel] = useState<AIPanel | null>(null)
  const [languageTutorState, setLanguageTutorState] = useState<LanguageTutorState | null>(null)
  const languageTutorRequestRef = useRef('')
  // suggestedReplies is the open reply picker for one room. Its request is tracked in suggestedRepliesRequestRef.
  const [suggestedReplies, setSuggestedReplies] = useState<SuggestedRepliesState | null>(null)
  const suggestedRepliesRequestRef = useRef('')
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
  return { ...app, scheduledJobs, setScheduledJobs, scheduledJobsOpen, setScheduledJobsOpen, scheduledTimes, setScheduledTimes, scheduledLoading, scheduledJobsError, setScheduledJobsError, refreshScheduledJobs, openScheduledJobs, audioInputDevices, setAudioInputDevices, selectedAudioInputDeviceId, setSelectedAudioInputDeviceId, unreadMarker, setUnreadMarker, unreadObserverRef, observeUnreadDivider, error, setError, selectedRoomRef, roomListRef, editTargetRef, markRoomAnsweredRef, showRoomRef, preferencesRef, setPreferenceRef, automaticArchiveInFlightRef, roomsRef, roomSelectionAnchorRef, messagesRef, composeTextRef, composerEmojiControlRef, composerEmojiSelectionRef, selectedRoomIDRef, nativeNotificationsRef, lastReadEventByRoom, currentUserIDRef, currentDisplayNameRef, triageBusyRef, stageDroppedFilesRef, timelineRef, timelineListRef, timelineHeightBeforePrepend, stickToBottomRef, roomSwitchRef, pinnedScrollTopRef, timelineResizeObserverRef, startingDirectChatRef, pendingReactionsRef, reactionErrorRef, timelineMessageActionsRef, roomButtonActionsRef, notificationBatchesRef, repeatRemindersRef, attachmentInputRef, voiceRecorderRef, voicePcmRef, voiceChunksRef, voiceStreamRef, voiceRoomIDRef, voiceTimeoutRef, videoPreviewRef, voiceRecordingActive, videoRecordingActive, captureNoun, roomSearchInputRef, menuActionRef, composerInputRef, aiPanel, setAIPanel, languageTutorState, setLanguageTutorState, languageTutorRequestRef, suggestedReplies, setSuggestedReplies, suggestedRepliesRequestRef, imageSendRun, setImageSendRun, generatedImageReview, setGeneratedImageReview, chatTranslation, setChatTranslation, activeAIRequestRef, stoppedAIRequestRef, aiStreamHandlersRef, chatTranslationAIRequestRef, chatTranslationRequestRef, quickSwitcherInputRef, pendingSearchJumpRef }
}
