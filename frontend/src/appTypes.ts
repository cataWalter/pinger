import { type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { type AIMessage, type ChatExportResult, type Invite, type Message, type Room, type Snapshot, type TutorAnalysis, type Verification } from '../bindings/mychat/desktop/models.js'
import { type AIFeatureID } from './aiSettings'

export type MatrixUpdate = {
  accountId?: string
  notificationPreferences?: PreferenceValues
  rooms: Room[]
  invites?: Invite[] | null
  slidingSyncListCounts?: Record<string, number> | null
  timelineChangedRoomId: string[] | null
  typingUsers?: Record<string, string[]> | null
  notifications?: MatrixNotification[] | null
  newIncomingMessage?: boolean
  initialSyncComplete: boolean
  needsVerification: boolean
  verification?: Verification | null
  connectionState: string
  error: string
}

export type MatrixNotification = {
  preferences?: PreferenceValues
  roomId: string
  accountId?: string
  room: string
  sender: string
  senderAvatar?: string
  body: string
  mention: boolean
  category: string
}

export type NotificationText = { title: string; subtitle: string; body: string }

export type PreferenceValues = NonNullable<Snapshot['preferences']>

export type RoomScope = 'all' | 'archived' | 'local-ai'

export type RoomRefinements = { unanswered: boolean; needsReply: boolean; favorite: boolean }

export type OutgoingMessage = { roomID: string; text: string; replyTo: Message | null; mentionUserIDs: string[] }

export type MessageMenuItem = { key: string; label: string; ariaLabel: string; icon: ReactElement; primaryShiftKey?: string; danger?: boolean; disabled?: boolean; meta?: boolean; separatorBefore?: boolean; run: () => void }

export type AIAcceptAction = { kind: 'none' } | { kind: 'draft' | 'rewrite' } | { kind: 'reply'; target: Message }

export type AIPanel = {
  title: string
  busy: boolean
  result: string
  error: string
  acceptAction: AIAcceptAction
  status?: string
  featureID: AIFeatureID
  requestID: string
  // conversation holds the messages sent so far. It ends with the assistant reply once a run finishes.
  conversation: AIMessage[]
  followUp: string
  stopped: boolean
}

export type AIStreamChunk = { requestId: string; text: string; reset?: boolean }

export type AIStreamHandler = (chunk: AIStreamChunk) => void

export type LanguageTutorState = { accountID: string; roomID: string; mode: 'draft' | 'message'; originalText: string; learningLanguage: string; explanationLanguage: string; analysis: TutorAnalysis | null; busy: boolean; error: string; requestID: string; preview: string }

export type ChatTranslationState = { requestID: number; roomID: string; targetLanguage: string; targetMessageIDs: string[]; analyses: Record<string, TutorAnalysis>; busy: boolean; status: string; error: string }

export type ChatExportState = { roomID: string; phase: 'running' | 'done' | 'failed'; stage: string; result: ChatExportResult | null; error: string }

export type ChatExportProgressEvent = { roomId: string; stage: string; messages: number }

export type ScheduledDraft =
  | { kind: 'message'; roomID: string; text: string; replyToEventID?: string; replyToSender?: string; replyToPreview?: string }
  | { kind: 'reminder'; roomID: string; eventID: string; text: string; archiveAfter?: boolean }

export type MediaGalleryFilter = 'all' | 'images' | 'videos' | 'audio' | 'files'

export type TimelineMessageActions = {
  onDoubleClick: (message: Message) => void
  onOpenContextMenu: (message: Message, x: number, y: number) => void
  onFocusMessage: (eventID: string) => void
  onAudioEnded: (messageID: string) => void
  onUseTranscript: (text: string) => void
  onSendReaction: (message: Message, emoji: string) => void
  onRemoveReaction: (message: Message, emoji: string) => void
  onStartDirectChat: (message: Message) => void
  onOpenThread: (rootID: string) => void
}

export type RoomButtonActions = {
  onSelect: (room: Room, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
  onKeyDown: (room: Room, index: number, event: KeyboardEvent<HTMLButtonElement>) => void
  onContextMenu: (room: Room, event: React.MouseEvent<HTMLButtonElement>) => void
}

export type TimelineListHandle = {
  virtualized: boolean
  focusMessage: (eventID: string) => boolean
}

export type CaptureKind = 'voice' | 'video'

export type RecordedUpload = { kind: CaptureKind; durationMilliseconds: number }

export type StagedAttachment = { id: string; accountID: string; roomID: string; file: File; previewURL: string }

export type MediaApprovalItem = { key: string; name: string; kind: 'image' | 'video' | 'audio' | 'file'; sizeBytes: number; previewURL: string }

export type MediaApprovalRequest = { items: MediaApprovalItem[]; onApprove: () => void; onCancel?: () => void }

export type ActionMenuEntry = {
  label: string
  caption?: string
  icon: ReactNode
  onSelect: () => void
  primaryShiftKey?: string
  disabled?: boolean
  active?: boolean
  count?: number
  title?: string
}
