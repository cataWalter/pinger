import { Fragment, lazy, memo, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { ArrowUpRight, Bot, Check, Copy, FileText, MessageSquare, Sparkles, Star, X, Download, ZoomIn, ZoomOut } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { type AIMessage, type ChatExportResult, type Member, type Message, type Room, type Snapshot, type TutorAnalysis } from '../bindings/mychat/desktop/models.js'
import { fuzzyScore } from './fuzzy'
import { languageName, type AIFeatureID } from './aiSettings'
import { matrixMediaURL, matrixMXCMediaURL } from './ChatMediaRenderer'
import { VoiceMessagePlayer } from './VoiceMessagePlayer'
import { DialogSurface } from './DialogSurface'
import { isLocalAIRoomID, type LocalAIChatIcon } from './localAIChats'

export const MarkdownMessage = lazy(() => import('./MarkdownMessage'))

export type MatrixUpdate = {
  accountId?: string
  notificationPreferences?: PreferenceValues
  rooms: Room[]
  slidingSyncListCounts?: Record<string, number> | null
  timelineChangedRoomId: string[] | null
  typingUsers?: Record<string, string[]> | null
  notifications?: MatrixNotification[] | null
  initialSyncComplete: boolean
  needsVerification: boolean
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
export type MessageMenuItem = { key: string; label: string; ariaLabel: string; icon: ReactElement; danger?: boolean; disabled?: boolean; meta?: boolean; separatorBefore?: boolean; run: () => void }
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
export type LanguageTutorState = { accountID: string; roomID: string; mode: 'draft' | 'message'; originalText: string; explanationLanguage: string; analysis: TutorAnalysis | null; busy: boolean; error: string; requestID: string; preview: string }
export type ChatTranslationState = { requestID: number; roomID: string; targetLanguage: string; targetMessageIDs: string[]; analyses: Record<string, TutorAnalysis>; busy: boolean; status: string; error: string }
export type ChatExportState = { roomID: string; phase: 'running' | 'done' | 'failed'; stage: string; mediaDone: number; mediaTotal: number; result: ChatExportResult | null; error: string }
export type ChatExportProgressEvent = { roomId: string; stage: string; messages: number; mediaDone: number; mediaTotal: number }
export type ScheduledDraft =
  | { kind: 'message'; roomID: string; text: string; replyToEventID?: string; replyToSender?: string; replyToPreview?: string }
  | { kind: 'reminder'; roomID: string; eventID: string; text: string; archiveAfter?: boolean }
export type MediaGalleryFilter = 'all' | 'images' | 'videos' | 'audio' | 'files'
export const MEDIA_GALLERY_FILTERS: { value: MediaGalleryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'files', label: 'Files' },
]

export function mediaGalleryCategory(message: Message): Exclude<MediaGalleryFilter, 'all'> {
  if (message.mediaMime.startsWith('audio/') || message.mediaType === 'm.audio') return 'audio'
  if (message.mediaMime.startsWith('image/') || message.mediaType === 'm.image') return 'images'
  if (message.mediaMime.startsWith('video/') || message.mediaType === 'm.video') return 'videos'
  return 'files'
}

export function filterMediaGalleryItems(items: Message[], filter: MediaGalleryFilter) {
  return filter === 'all' ? items : items.filter((message) => mediaGalleryCategory(message) === filter)
}

export function hasGalleryMedia(message: Message) {
  return Boolean(message.mediaUri && !message.redacted && !message.decryptionError)
}

export function mediaGalleryMessageKey(message: Message) {
  return message.id || message.transactionId || `${message.timestamp}:${message.sender}:${message.mediaUri}:${message.body}`
}

export type TimelineMessageActions = {
  onDoubleClick: (message: Message) => void
  onOpenContextMenu: (message: Message, x: number, y: number) => void
  onFocusMessage: (eventID: string) => void
  onAudioEnded: (messageID: string) => void
  onUseTranscript: (text: string) => void
  onSendReaction: (message: Message, emoji: string) => void
  onRemoveReaction: (message: Message, emoji: string) => void
  onStartDirectChat: (message: Message) => void
}
export type RoomButtonActions = {
  onSelect: (room: Room, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
  onKeyDown: (room: Room, index: number, event: KeyboardEvent<HTMLButtonElement>) => void
  onContextMenu: (room: Room, event: React.MouseEvent<HTMLButtonElement>) => void
}

export const IN_APP_NOTICE_TIMEOUT_MS = 10_000
export const EMPTY_ROOMS: Room[] = []
export const MAX_CACHED_AVATARS = 128
export const MAX_MISSING_AVATARS = 512
export const ROOM_LIST_VIRTUALIZATION_THRESHOLD = 100
export const ROOM_LIST_RANGE_PREFETCH = 20
export const ROOM_LIST_MAX_SYNC_RANGE = 200

export function cachedAvatarSource(uri: string) {
  const cached = avatarSources.get(uri)
  if (cached) {
    avatarSources.delete(uri)
    avatarSources.set(uri, cached)
  }
  return cached
}

export function cacheMissingAvatar(uri: string) {
  avatarSources.delete(uri)
  missingAvatarSources.delete(uri)
  missingAvatarSources.add(uri)
  if (missingAvatarSources.size > MAX_MISSING_AVATARS) {
    const oldest = missingAvatarSources.values().next().value
    if (oldest) missingAvatarSources.delete(oldest)
  }
}

export function newestPersistentMessage(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.id && !message.id.startsWith('~')) return message
  }
  return null
}

export function isMatrixUserID(value: string) {
  return /^@[^:\s]+:[^\s]+$/.test(value.trim())
}

export function formatTypingStatus(userIDs: string[], members: Member[], messages: Message[], directRoomName: string) {
  if (userIDs.length === 0) return ''
  const names = userIDs.map((userID) => {
    const memberName = members.find((member) => member.id === userID)?.displayName.trim()
    if (memberName && !isMatrixUserID(memberName)) return memberName
    const senderName = messages.find((message) => message.sender === userID && message.senderName.trim())?.senderName.trim()
    if (senderName && !isMatrixUserID(senderName)) return senderName
    const roomName = directRoomName.trim()
    return roomName && !isMatrixUserID(roomName) ? roomName : 'Someone'
  })
  if (names.length === 1) return `${names[0]} is typing`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are typing`
}

export function newestOtherAvatar(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message.own && message.avatar) return message.avatar
  }
  return ''
}

export function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function chatExportStatusText(state: ChatExportState) {
  if (state.stage === 'media') return `Saving media ${state.mediaDone} of ${state.mediaTotal}`
  if (state.stage === 'finishing') return 'Writing transcript'
  if (state.stage === 'history') return 'Reading room history'
  return 'Starting export'
}

export function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]')))
}

export function displayMessageBody(message: Message) {
  if (message.redacted) return 'Message removed'
  if (message.decryptionError || /^\s*Decrypting message from .+ failed, waiting for sender to re-send\b/i.test(message.body)) {
    return "This message couldn't be opened. Ask the sender to resend it."
  }
  return message.body
}

// Matrix uses the filename as the body of an uncaptioned image. The inline preview already shows it.
export const imageFileNameBodyPattern = /^\S+\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i

export function initials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean)
  const parts = words.length > 1 ? words.slice(0, 2) : [words[0]?.slice(0, 2) ?? '?']
  return parts
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function avatarHue(label: string) {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

export function avatarStyle(label: string) {
  const hue = avatarHue(label || '?')
  return {
    '--avatar-hue': String(hue),
    background: `linear-gradient(135deg, hsl(${hue} 32% 88%) 0%, hsl(${(hue + 24) % 360} 30% 80%) 100%)`,
    color: `hsl(${hue} 32% 26%)`,
  } as React.CSSProperties
}

export const avatarSources = new Map<string, string>()
export const missingAvatarSources = new Set<string>()
export const mediaVisibilityCallbacks = new Map<Element, (isNearViewport: boolean) => void>()
export let mediaVisibilityObserver: IntersectionObserver | null = null

export function observeMediaVisibility(element: Element, callback: (isNearViewport: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true)
    return () => { }
  }
  if (!mediaVisibilityObserver) {
    mediaVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) mediaVisibilityCallbacks.get(entry.target)?.(entry.isIntersecting)
    }, { rootMargin: '240px' })
  }
  mediaVisibilityCallbacks.set(element, callback)
  mediaVisibilityObserver.observe(element)
  return () => {
    mediaVisibilityCallbacks.delete(element)
    const observer = mediaVisibilityObserver
    observer?.unobserve(element)
    if (mediaVisibilityCallbacks.size === 0) {
      observer?.disconnect()
      if (mediaVisibilityObserver === observer) mediaVisibilityObserver = null
    }
  }
}

export function loadAvatarSource(uri: string) {
  const cached = cachedAvatarSource(uri)
  if (cached) return Promise.resolve(cached)
  if (missingAvatarSources.has(uri)) return Promise.resolve(null)

  const source = matrixMXCMediaURL(uri)
  if (!source) {
    cacheMissingAvatar(uri)
    return Promise.resolve(null)
  }
  avatarSources.set(uri, source)
  if (avatarSources.size > MAX_CACHED_AVATARS) {
    const oldest = avatarSources.keys().next().value
    if (oldest) avatarSources.delete(oldest)
  }
  return Promise.resolve(source)
}

export function Avatar({ uri, label, className, style, deferLoad = false }: {
  uri?: string
  label: string
  className: string
  style?: React.CSSProperties
  deferLoad?: boolean
}) {
  const avatarRef = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState(() => uri ? cachedAvatarSource(uri) ?? null : null)
  const [nearViewport, setNearViewport] = useState(!deferLoad)

  useEffect(() => {
    if (!deferLoad || nearViewport || !uri) return
    const element = avatarRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true)
        observer.disconnect()
      }
    }, { rootMargin: '96px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [deferLoad, nearViewport, uri])

  useEffect(() => {
    let active = true
    const cached = uri ? cachedAvatarSource(uri) : undefined
    if (!uri || cached) {
      setSource(cached ?? null)
      return () => { active = false }
    }
    if (!nearViewport) {
      setSource(null)
      return () => { active = false }
    }

    setSource(null)
    void loadAvatarSource(uri).then((loadedSource) => {
      if (active) setSource(loadedSource)
    })
    return () => { active = false }
  }, [uri, nearViewport])

  return (
    <div ref={avatarRef} className={className} style={style}>
      {source ? <img className="avatar-image" src={source} alt="" onError={() => {
        if (uri) cacheMissingAvatar(uri)
        setSource(null)
      }} /> : initials(label)}
    </div>
  )
}

export function isSameDay(left: number, right: number) {
  if (!left || !right) return true
  const a = new Date(left)
  const b = new Date(right)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatDayLabel(timestamp: number) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(date, today)) return 'Today'
  if (sameDay(date, yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)
}

export function localDateTimeInputValue(timestamp: number) {
  const localTime = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000)
  return localTime.toISOString().slice(0, 16)
}

export function formatScheduledTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

export function preferenceBoolean(preferences: PreferenceValues, key: string, fallback = false) {
  const value = preferences[key]
  return typeof value === 'boolean' ? value : fallback
}

export function preferenceString(preferences: PreferenceValues, key: string, fallback: string) {
  const value = preferences[key]
  return typeof value === 'string' ? value : fallback
}

export function preferenceNumber(preferences: PreferenceValues, key: string, fallback: number, minimum = 0, maximum = 100) {
  const value = preferences[key]
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

export function parseTimeSuggestionMinutes(value: string) {
  const parts = value.split(',').map((part) => part.trim())
  if (parts.length < 1 || parts.length > 6 || parts.some((part) => !/^\d+$/.test(part))) return []
  const minutes = parts.map(Number)
  if (minutes.some((value) => value < 1 || value > 10080) || new Set(minutes).size !== minutes.length) return []
  return minutes
}

export function formatTimeSuggestion(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  if (minutes % 60 === 0) return `${minutes / 60} hr`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

export function sameRoomSnapshot(leftRoom: Room, rightRoom: Room) {
  return leftRoom.id === rightRoom.id
    && leftRoom.name === rightRoom.name
    && leftRoom.topic === rightRoom.topic
    && leftRoom.avatar === rightRoom.avatar
    && leftRoom.preview === rightRoom.preview
    && leftRoom.lastSeen === rightRoom.lastSeen
    && leftRoom.direct === rightRoom.direct
    && leftRoom.favorite === rightRoom.favorite
    && leftRoom.muted === rightRoom.muted
    && leftRoom.unread === rightRoom.unread
    && leftRoom.markedUnread === rightRoom.markedUnread
    && leftRoom.mentions === rightRoom.mentions
    && leftRoom.unanswered === rightRoom.unanswered
    && leftRoom.needsReply === rightRoom.needsReply
    && leftRoom.lastEventId === rightRoom.lastEventId
    && leftRoom.lastEventSender === rightRoom.lastEventSender
    && leftRoom.lastEventAt === rightRoom.lastEventAt
    && leftRoom.bridge === rightRoom.bridge
    && leftRoom.accountId === rightRoom.accountId
}

export function reconcileRoomSnapshots(currentRooms: Room[] | null, incomingRooms: Room[]) {
  if (!currentRooms) return incomingRooms
  const previousByKey = new Map(currentRooms.map((room) => [`${room.accountId}\u0000${room.id}`, room]))
  let unchanged = currentRooms.length === incomingRooms.length
  const rooms = incomingRooms.map((room, index) => {
    const previous = previousByKey.get(`${room.accountId}\u0000${room.id}`)
    if (!previous || !sameRoomSnapshot(previous, room)) {
      unchanged = false
      return room
    }
    if (currentRooms[index] !== previous) unchanged = false
    return previous
  })
  return unchanged ? currentRooms : rooms
}

export function mergeTimelineMessages(current: Message[], incoming: Message[]) {
  const merged = [...current]
  const indexes = new Map<string, number>()
  const keysFor = (message: Message) => [message.id, message.transactionId].filter(Boolean)

  merged.forEach((message, index) => {
    for (const key of keysFor(message)) indexes.set(key, index)
  })

  for (const message of incoming) {
    const existingIndex = keysFor(message).map((key) => indexes.get(key)).find((index) => index !== undefined)
    if (existingIndex !== undefined) {
      merged[existingIndex] = { ...merged[existingIndex], ...message }
      for (const key of keysFor(merged[existingIndex])) indexes.set(key, existingIndex)
      continue
    }

    const index = merged.push(message) - 1
    for (const key of keysFor(message)) indexes.set(key, index)
  }

  return merged.sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
}

export function timelineMessageID(message: Message) {
  return message.id || message.transactionId
}

export function isOwnMessage(message: Message, currentUserID: string) {
  return message.own || Boolean(message.sender && message.sender === currentUserID)
}

// incomingSinceOwnMessage returns the text messages from others that follow the user's latest loaded message.
export function incomingSinceOwnMessage(timeline: Message[], currentUserID: string) {
  let lastOwnIndex = -1
  timeline.forEach((message, index) => {
    if (isOwnMessage(message, currentUserID)) lastOwnIndex = index
  })
  const incoming = timeline.slice(lastOwnIndex + 1).filter((message) =>
    Boolean(timelineMessageID(message)) && !message.redacted && Boolean(message.body.trim()),
  )
  return { foundOwnMessage: lastOwnIndex >= 0, incoming }
}

export function isDirectLikeRoom(room: Room) {
  return room.direct || room.bridge === 'IG'
}

// Matrix flags rooms whose last message is not from you. Only direct and Instagram chats count; Local AI chats never do.
export function isUnansweredRoom(room: Room) {
  return !isLocalAIRoomID(room.id) && room.unanswered && isDirectLikeRoom(room)
}

// Unanswered rooms that are not marked answered for their latest event.
export function isNeedsReplyRoom(room: Room) {
  return isUnansweredRoom(room) && room.needsReply
}

export function isUnreadRoom(room: Room) {
  return room.unread > 0 || room.markedUnread
}

export function primaryModifierLabel() {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
}

export function preferredScrollBehavior(behavior: ScrollBehavior = 'smooth'): ScrollBehavior {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior
}

export function appendedTimelineMessageIDs(previous: Message[], next: Message[]): Set<string> {
  if (previous.length === 0) return new Set()
  const tail = previous[previous.length - 1]
  const tailIndex = next.findIndex((message) => timelineMessageID(message) === timelineMessageID(tail) || Boolean(tail.transactionId && message.transactionId === tail.transactionId))
  if (tailIndex < 0) return new Set()
  const known = new Set(previous.flatMap((message) => [message.id, message.transactionId].filter(Boolean)))
  return new Set(next.slice(tailIndex + 1).filter((message) => !known.has(message.id) && !known.has(message.transactionId)).map(timelineMessageID))
}

export const VIRTUAL_TIMELINE_THRESHOLD = 200

export type TimelineListHandle = {
  virtualized: boolean
  focusMessage: (eventID: string) => boolean
}

export function timelineFirstItemIndex(previous: Message[], next: Message[], firstIndex: number) {
  if (previous.length === 0 || next.length === 0) return firstIndex
  const matches = (candidate: Message, reference: Message) => Boolean(
    (candidate.id && candidate.id === reference.id)
    || (candidate.transactionId && candidate.transactionId === reference.transactionId),
  )
  const prepended = next.findIndex((message) => matches(message, previous[0]))
  if (prepended >= 0) return Math.max(1, firstIndex - prepended)
  const removed = previous.findIndex((message) => matches(message, next[0]))
  return removed >= 0 ? firstIndex + removed : firstIndex
}

const virtualTimelineComponents = {
  Header: ({ context }: { context?: { header?: ReactNode; zoom?: number } }) => <div style={{ zoom: context?.zoom ?? 1, display: 'flex', flexDirection: 'column' }}>{context?.header}</div>,
}

export const TimelineMessageList = memo(function TimelineMessageList({
  messages,
  header,
  hideDeleted,
  preferences,
  currentUserID,
  accountID,
  selectedRoomID,
  groupChat,
  chatTranslation,
  contextMessageID,
  reactingMessageID,
  autoPlayNextMessageId,
  canUseTranscriptAsDraft,
  actionsRef,
  scrollParentRef,
  listHandleRef,
}: {
  messages: Message[]
  header?: ReactNode
  hideDeleted: boolean
  preferences: PreferenceValues
  currentUserID: string
  accountID: string
  selectedRoomID: string
  groupChat: boolean
  chatTranslation: ChatTranslationState | null
  contextMessageID: string
  reactingMessageID: string
  autoPlayNextMessageId: string | null
  canUseTranscriptAsDraft: boolean
  actionsRef: { current: TimelineMessageActions }
  scrollParentRef?: RefObject<HTMLDivElement | null>
  listHandleRef?: RefObject<TimelineListHandle | null>
}) {
  const visibleMessages = hideDeleted ? messages.filter((message) => !message.redacted) : messages
  const scope = `${accountID}:${selectedRoomID}`
  const virtualized = Boolean(scrollParentRef && visibleMessages.length > VIRTUAL_TIMELINE_THRESHOLD)
  const timelineZoom = preferenceNumber(preferences, 'appearance.zoom', 100, 75, 125) / 100
  const firstRowRef = useRef<HTMLElement>(null)
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null)
  const virtualRef = useRef<VirtuosoHandle>(null)
  const focusFrameRef = useRef<number | null>(null)
  const [anchor, setAnchor] = useState({ scope, source: messages, visible: visibleMessages, hideDeleted, firstIndex: 1000000 })
  const previousRef = useRef<{ scope: string; messages: Message[] } | null>(null)
  const animateMessages = preferenceBoolean(preferences, 'appearance.message_animations', true)
  const formatTimestamp = createTimelineTimeFormatter(preferences)

  if (anchor.scope !== scope || anchor.source !== messages || anchor.hideDeleted !== hideDeleted) {
    setAnchor({
      scope,
      source: messages,
      visible: visibleMessages,
      hideDeleted,
      firstIndex: anchor.scope === scope ? timelineFirstItemIndex(anchor.visible, visibleMessages, anchor.firstIndex) : 1000000,
    })
  }

  useEffect(() => {
    setScrollParent(scrollParentRef?.current ?? null)
  }, [scrollParentRef, selectedRoomID])

  useLayoutEffect(() => {
    if (!listHandleRef) return
    listHandleRef.current = {
      virtualized,
      focusMessage: (eventID) => {
        const index = visibleMessages.findIndex((message) => message.id === eventID || message.transactionId === eventID)
        if (index < 0 || !virtualRef.current) return false
        virtualRef.current.scrollToIndex({ index, align: 'center', behavior: 'auto' })
        if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
        let remainingFrames = 60
        const focus = () => {
          const target = Array.from(scrollParentRef?.current?.querySelectorAll<HTMLElement>('[data-event-id]') ?? [])
            .find((row) => row.dataset.eventId === eventID)
          target?.focus({ preventScroll: true })
          if (target && document.activeElement === target) {
            focusFrameRef.current = null
          } else if (--remainingFrames > 0) {
            focusFrameRef.current = requestAnimationFrame(focus)
          } else {
            focusFrameRef.current = null
          }
        }
        focusFrameRef.current = requestAnimationFrame(focus)
        return true
      },
    }
    return () => {
      listHandleRef.current = null
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = null
    }
  }, [listHandleRef, virtualized, visibleMessages, anchor.firstIndex, scrollParentRef])

  useEffect(() => {
    const scope = `${accountID}:${selectedRoomID}`
    const previous = previousRef.current
    const timeline = scrollParentRef?.current ?? firstRowRef.current?.closest('.timeline')
    const rows = timeline?.querySelectorAll<HTMLElement>('.message-row') ?? []
    const changedScope = previous?.scope !== scope
    const additions = !changedScope && previous ? appendedTimelineMessageIDs(previous.messages, messages) : new Set<string>()
    if (changedScope || !animateMessages) {
      for (const row of rows) delete row.dataset.liveMessage
    } else if (additions.size > 0 && preferredScrollBehavior() !== 'auto') {
      const viewport = timeline?.getBoundingClientRect()
      for (const row of rows) {
        if (!additions.has(row.dataset.eventId ?? '')) continue
        const bounds = row.getBoundingClientRect()
        if (viewport && bounds.bottom > viewport.top && bounds.top < viewport.bottom) row.dataset.liveMessage = 'true'
      }
    }
    previousRef.current = { scope, messages }
  }, [messages, accountID, selectedRoomID, animateMessages, scrollParentRef])

  function renderMessage(index: number, message: Message) {
      const ownMessage = isOwnMessage(message, currentUserID)
      const messageID = timelineMessageID(message)
      const translatedAnalysis = !ownMessage ? chatTranslation?.analyses[messageID] : undefined
      const translationPending = Boolean(!ownMessage && chatTranslation?.busy && chatTranslation.targetMessageIDs.includes(messageID))
      const showTranslation = Boolean(translatedAnalysis || translationPending)
      const isAudioAttachment = Boolean(message.mediaUri && (message.mediaMime.startsWith('audio/') || message.mediaType === 'm.audio'))
      const isFileAttachment = Boolean(message.mediaUri && message.mediaType === 'm.file' && !message.redacted && !message.decryptionError)
      const isImageOrVideoAttachment = !isAudioAttachment && (
        message.mediaMime.startsWith('image/') || message.mediaMime.startsWith('video/') || message.mediaType === 'm.image' || message.mediaType === 'm.video'
      )
      const hideImagesAndVideos = preferenceBoolean(preferences, 'appearance.hide_images_and_videos')
      const previous = index > 0 ? visibleMessages[index - 1] : null
      const grouped = Boolean(previous && !previous.redacted && previous.sender === message.sender && message.timestamp - previous.timestamp < 5 * 60_000 && isSameDay(previous.timestamp, message.timestamp))
      const next = index + 1 < visibleMessages.length ? visibleMessages[index + 1] : null
      const nextIsGrouped = Boolean(next && !message.redacted && !next.redacted && next.sender === message.sender && next.timestamp - message.timestamp < 5 * 60_000 && isSameDay(message.timestamp, next.timestamp))
      const lastInGroup = !nextIsGrouped
      const showDayDivider = !previous || !isSameDay(previous.timestamp, message.timestamp)
      const displayBody = displayMessageBody(message)
      const showsImagePreview = Boolean(message.mediaUri && !message.redacted && !message.decryptionError && !hideImagesAndVideos && (message.mediaMime.startsWith('image/') || message.mediaType === 'm.image'))
      const hideFileNameBody = showsImagePreview && imageFileNameBodyPattern.test(displayBody.trim())
      const isContextTarget = (message.id || message.transactionId) === contextMessageID
      const showSender = groupChat && !ownMessage && !grouped
      const senderName = message.senderName || message.sender
      return (
        <Fragment key={message.id || message.transactionId}>
          {showDayDivider && message.timestamp > 0 && <div className="day-divider" aria-label={formatDayLabel(message.timestamp)}><span>{formatDayLabel(message.timestamp)}</span></div>}
          <article ref={index === 0 ? firstRowRef : undefined} className={`message-row ${ownMessage ? 'is-own' : ''} ${grouped ? 'is-grouped' : 'is-first'} ${lastInGroup ? 'is-last' : ''} ${ownMessage && lastInGroup ? 'is-tail' : ''} ${showTranslation ? 'has-translation' : ''} ${isContextTarget ? 'is-context-target' : ''} ${groupChat && !ownMessage ? 'is-group-incoming' : ''}`} data-event-id={messageID} tabIndex={messageID ? -1 : undefined} onAnimationEnd={(event) => { if (event.target === event.currentTarget) delete event.currentTarget.dataset.liveMessage }} onDoubleClick={() => actionsRef.current.onDoubleClick(message)} onContextMenu={(event) => {
            if (!selectedRoomID) return
            event.preventDefault()
            actionsRef.current.onOpenContextMenu(message, event.clientX, event.clientY)
          }} onKeyDown={(event) => {
            if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
            event.preventDefault()
            const bounds = event.currentTarget.getBoundingClientRect()
            actionsRef.current.onOpenContextMenu(message, bounds.left + 8, bounds.bottom)
          }}>
            {showSender && <Avatar uri={message.avatar} label={senderName} className="message-sender-avatar" deferLoad />}
            <div className="message-body-wrap">
              {!grouped && <div className="message-meta">
                {showSender && <button className="message-sender-name" type="button" title={`Start a direct chat with ${senderName}`} aria-label={`Start a direct chat with ${senderName}`} onClick={() => actionsRef.current.onStartDirectChat(message)}>{senderName}</button>}
                {message.timestamp > 0 && preferenceBoolean(preferences, 'appearance.show_timestamps', true) && <time>{formatTimestamp(message.timestamp)}</time>}
                {message.edited && <span className="edited-mark" title={message.editHistory?.length ? message.editHistory.join('\n') : 'Edited message'}>edited{(message.editHistory?.length ?? 0) > 0 && ` (${message.editHistory?.length} prior)`}</span>}
              </div>}
              {message.replyToEventId && <button className="reply-preview" type="button" title="Jump to quoted message" onClick={() => actionsRef.current.onFocusMessage(message.replyToEventId)}>
                <span className="reply-preview-sender">{message.replyToSender || 'Reply'}</span>
                <span className="reply-preview-text">{message.replyToPreview || 'Original message unavailable'}</span>
              </button>}
              {!isAudioAttachment && !isFileAttachment && !hideFileNameBody && <Suspense fallback={<div className="message-body">{displayBody}</div>}>
                <MarkdownMessage body={displayBody} />
              </Suspense>}
              {message.mediaUri && !message.redacted && !message.decryptionError && !(hideImagesAndVideos && isImageOrVideoAttachment) && (
                <MessageMedia
                  roomID={selectedRoomID}
                  message={message}
                  autoPlayNext={autoPlayNextMessageId === message.id}
                  aiEnabled={Boolean(preferenceString(preferences, 'ai.endpoint', '').trim())}
                  canUseDraft={canUseTranscriptAsDraft}
                  onUseDraft={(text) => actionsRef.current.onUseTranscript(text)}
                  onAudioEnded={() => actionsRef.current.onAudioEnded(message.id)}
                />
              )}
              {ownMessage && message.seenAt > 0 && <time className="message-seen-status" dateTime={new Date(message.seenAt).toISOString()}>
                Seen at {formatTime(message.seenAt, preferenceBoolean(preferences, 'appearance.time_24_hour'))}
              </time>}
              {Object.keys(message.reactions ?? {}).length > 0 && <div className="message-reactions">
                {Object.entries(message.reactions ?? {}).map(([emoji, count]) => (
                  <button key={emoji} type="button" className={`reaction-chip ${message.reacted?.[emoji] ? 'is-reacted' : ''}`} aria-label={`${message.reacted?.[emoji] ? 'Remove' : 'Add'} ${emoji} reaction`} title={`${message.reacted?.[emoji] ? 'Remove' : 'Add'} ${emoji} reaction`} aria-pressed={message.reacted?.[emoji] ?? false} onClick={() => message.reacted?.[emoji] ? actionsRef.current.onRemoveReaction(message, emoji) : actionsRef.current.onSendReaction(message, emoji)}>{emoji} {typeof count === 'number' ? count : 0}</button>
                ))}
              </div>}
              {message.sendError && message.sendError !== 'not sent' && <span className="message-error">{message.sendError}</span>}
              {message.sending && !message.sendError && <span className="message-pending">Sending…</span>}
              {reactingMessageID === message.id && <div className="reaction-picker" aria-label="Quick reactions">
                {quickReactionOptions(preferences).map((emoji) => <button key={emoji} type="button" aria-label={`React with ${emoji}`} title={`React with ${emoji}`} onClick={() => actionsRef.current.onSendReaction(message, emoji)}>{emoji}</button>)}
              </div>}
            </div>
            {showTranslation && <aside className="message-translation" role="note" aria-label={`${chatTranslation?.targetLanguage || 'Translation'} translation`} aria-live="polite">
              <span className="message-translation-label">{chatTranslation?.targetLanguage || 'Translation'}</span>
              {translatedAnalysis ? <LanguageTutorAnalysisDetails analysis={translatedAnalysis} originalText={message.body} /> : <p>Translating…</p>}
            </aside>}
          </article>
        </Fragment>
      )
  }

  if (virtualized) {
    if (!scrollParent) return null
    return <Virtuoso<Message, { header?: ReactNode; zoom?: number }>
      ref={virtualRef}
      className="virtual-timeline"
      components={virtualTimelineComponents}
      context={{ header, zoom: timelineZoom }}
      customScrollParent={scrollParent}
      data={visibleMessages}
      firstItemIndex={anchor.firstIndex}
      computeItemKey={(_index, message) => timelineMessageID(message)}
      itemSize={(element, field) => element[field]}
      defaultItemHeight={48}
      increaseViewportBy={{ top: 240, bottom: 240 }}
      initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
      itemContent={(index, message) => <div style={{ zoom: timelineZoom, display: 'flex', flexDirection: 'column', minWidth: 0 }}>{renderMessage(index - anchor.firstIndex, message)}</div>}
    />
  }

  return <>{header}{visibleMessages.map((message, index) => renderMessage(index, message))}</>
})

export const chatWallpapers = [
  { name: 'None', swatch: 'var(--paper)' },
  { name: 'Meadow', swatch: 'linear-gradient(135deg, #e8f2e8, #f7f5e9)' },
  { name: 'Tide', swatch: 'linear-gradient(135deg, #e3eff1, #f1f3eb)' },
  { name: 'Rose', swatch: 'linear-gradient(135deg, #f1e5e8, #f5efe4)' },
] as const

export function formatTime(timestamp: number, use24Hour = false) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: !use24Hour }).format(new Date(timestamp))
}

export function isWithinDay(timestamp: number) {
  return Math.abs(Date.now() - timestamp) < 24 * 60 * 60_000
}

export function formatTimeOrDate(timestamp: number, use24Hour = false) {
  if (isSameDay(timestamp, Date.now())) return formatTime(timestamp, use24Hour)
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(timestamp))
}

export function roomActivityAt(room: Room) {
  return room.lastEventAt > 0 ? room.lastEventAt : room.lastSeen
}

export function compareRoomActivity(left: Room, right: Room, today: number) {
  const leftActivity = roomActivityAt(left)
  const rightActivity = roomActivityAt(right)
  const leftDate = new Date(leftActivity)
  const rightDate = new Date(rightActivity)
  leftDate.setHours(0, 0, 0, 0)
  rightDate.setHours(0, 0, 0, 0)
  const dateOrder = rightDate.getTime() - leftDate.getTime()
  if (dateOrder !== 0) return dateOrder
  if (leftActivity > 0 && isSameDay(leftActivity, today)) return rightActivity - leftActivity
  return 0
}

export function formatTimelineTime(timestamp: number, preferences: PreferenceValues) {
  return createTimelineTimeFormatter(preferences)(timestamp)
}

export function createTimelineTimeFormatter(preferences: PreferenceValues): (timestamp: number) => string {
  const useRelativeTime = preferenceBoolean(preferences, 'appearance.relative_timestamps')
  const use24Hour = preferenceBoolean(preferences, 'appearance.time_24_hour')
  let clock: Intl.DateTimeFormat | undefined
  let relative: Intl.RelativeTimeFormat | undefined
  return (timestamp) => {
    if (useRelativeTime && isWithinDay(timestamp)) {
      const minutes = Math.round((timestamp - Date.now()) / 60_000)
      relative ??= new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
      if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
      return relative.format(Math.round(minutes / 60), 'hour')
    }
    clock ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: !use24Hour })
    return clock.format(new Date(timestamp))
  }
}

export function formatMediaGalleryDateTime(timestamp: number, preferences: PreferenceValues) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: !preferenceBoolean(preferences, 'appearance.time_24_hour'),
  }).format(new Date(timestamp))
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${(bytes / 1024 ** (unitIndex + 1)).toFixed(1)} ${units[unitIndex]}`
}

export function rankQuickSwitcherRooms(rooms: Room[], query: string) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return rooms
  const ranked: { room: Room; score: number; index: number }[] = []
  rooms.forEach((room, index) => {
    const nameScore = fuzzyScore(normalizedQuery, room.name)
    const idScore = fuzzyScore(normalizedQuery, room.id)
    if (nameScore === null && idScore === null) return
    ranked.push({ room, score: Math.max(nameScore ?? Number.NEGATIVE_INFINITY, idScore ?? Number.NEGATIVE_INFINITY), index })
  })
  return ranked.sort((left, right) => right.score - left.score || left.index - right.index).map(({ room }) => room)
}

export const notificationTones: Record<string, { type: OscillatorType; frequency: number; duration: number; gain: number }> = {
  Chime: { type: 'sine', frequency: 720, duration: 0.12, gain: 0.035 },
  Pulse: { type: 'square', frequency: 480, duration: 0.09, gain: 0.012 },
  Soft: { type: 'triangle', frequency: 360, duration: 0.2, gain: 0.02 },
}

export const builtInQuickReactions = ['👍', '❤️', '😂', '🎉', '👀', '🙏']

export function playNotificationSound(volume: number, tone = 'Chime') {
  const profile = notificationTones[tone]
  if (volume <= 0 || !profile) return
  try {
    const audio = new AudioContext()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = profile.type
    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.onended = () => { void audio.close() }
    void audio.resume().then(() => {
      const startTime = audio.currentTime
      oscillator.frequency.setValueAtTime(profile.frequency, startTime)
      gain.gain.setValueAtTime(profile.gain * volume / 100, startTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + profile.duration)
      oscillator.start(startTime)
      oscillator.stop(startTime + profile.duration)
    }).catch(() => { void audio.close() })
  } catch {
    return
  }
}

export function notificationAllowed(preferences: PreferenceValues, roomID: string, category: string) {
  if (!preferenceBoolean(preferences, 'notifications.enabled', true)) return false
  if (preferenceBoolean(preferences, `room.muted.${roomID}`)) return false
  switch (category) {
    case 'group': return preferenceBoolean(preferences, 'notifications.group')
    case 'mention': return preferenceBoolean(preferences, 'notifications.mentions', true)
    case 'direct': return preferenceBoolean(preferences, 'notifications.direct', true)
    default: return true
  }
}

export function notificationTone(preferences: PreferenceValues, category: string) {
  const keys: Record<string, string> = { direct: 'notifications.sound_direct', mention: 'notifications.sound_mention', group: 'notifications.sound_group' }
  return preferenceString(preferences, keys[category] ?? 'notifications.sound_mention', 'Chime')
}

export function notificationText(preferences: PreferenceValues, notification: MatrixNotification, roomName: string): NotificationText {
  // The sender is the title. Group and mention alerts show the room as the subtitle.
  const direct = notification.category === 'direct'
  let title = notification.sender || roomName
  let subtitle = notification.sender && !direct ? roomName : ''
  let body = notification.body
  switch (preferenceString(preferences, 'notifications.privacy', 'Sender and message preview')) {
    case 'Sender only':
      body = 'New message'
      break
    case 'Hidden content':
      title = 'Matrix'
      subtitle = ''
      body = 'New activity'
      break
  }
  return { title, subtitle, body }
}

export function detectOneTimeCode(body: string) {
  if (!/\b(code|otp|one[- ]time|verification|passcode|2fa)\b/i.test(body)) return null
  return /\b(\d{4,8})\b/.exec(body)?.[1] ?? null
}

export function networkHue(label: string) {
  let hash = 0
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

export function quickReactionOptions(preferences: PreferenceValues) {
  const custom = preferenceString(preferences, 'reactions.quick_source', 'Frequent') === 'Custom'
    ? preferenceString(preferences, 'reactions.custom_emojis', '').split(/\s+/).filter(Boolean)
    : []
  const base = custom.length > 0 ? custom : builtInQuickReactions
  const defaultEmoji = preferenceString(preferences, 'reactions.default_emoji', '')
  return [...new Set(defaultEmoji ? [defaultEmoji, ...base] : base)].slice(0, 6)
}

export type CaptureKind = 'voice' | 'video'
export type RecordedUpload = { kind: CaptureKind; durationMilliseconds: number }
export type StagedAttachment = { id: string; accountID: string; roomID: string; file: File; previewURL: string }
export type MediaApprovalItem = { key: string; name: string; kind: 'image' | 'video' | 'audio' | 'file'; sizeBytes: number; previewURL: string }
export type MediaApprovalRequest = { items: MediaApprovalItem[]; onApprove: () => void; onCancel?: () => void }
export const mediaApprovalKindLabels: Record<MediaApprovalItem['kind'], string> = { image: 'Image', video: 'Video', audio: 'Audio', file: 'File' }

// mediaKindForFile returns the approval category for a file. Anything that is not an image, video, or audio file is a plain file.
export function mediaKindForFile(file: File): MediaApprovalItem['kind'] {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'file'
}

export function mediaApprovalItemFromFile(key: string, file: File, previewURL: string): MediaApprovalItem {
  return { key, name: file.name || 'Attachment', kind: mediaKindForFile(file), sizeBytes: file.size, previewURL }
}

export const maxVideoMessageMilliseconds = 3 * 60 * 1000
export const maxAttachmentBytes = 50 * 1024 * 1024

export function preferredVideoMimeType() {
  return ['video/mp4', 'video/webm'].find((type) => MediaRecorder.isTypeSupported?.(type)) ?? ''
}

export async function requestLocalAsset(path: string, init: RequestInit) {
  const response = await fetch(path, init)
  if (!response.ok) {
    const detail = (await response.text()).trim()
    throw new Error(detail || `Local request failed with status ${response.status}.`)
  }
  return response
}

export function encodeVoiceNoteWav(audio: AudioBuffer) {
  const dataLength = audio.length * 2
  if (dataLength + 44 > 50 * 1024 * 1024) throw new Error('Voice note cannot exceed 50 MiB.')
  const buffer = new ArrayBuffer(dataLength + 44)
  const view = new DataView(buffer)
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index))
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, dataLength + 36, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, audio.sampleRate, true)
  view.setUint32(28, audio.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataLength, true)
  for (let frame = 0; frame < audio.length; frame++) {
    let sample = 0
    for (const channel of channels) sample += channel[frame] / channels.length
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + frame * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}


export function MessageMedia({ roomID, message, onAudioEnded, autoPlayNext, aiEnabled, canUseDraft, onUseDraft }: {
  roomID: string
  message: Message
  onAudioEnded?: () => void
  autoPlayNext?: boolean
  aiEnabled: boolean
  canUseDraft: boolean
  onUseDraft: (text: string) => void
}) {
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [transcription, setTranscription] = useState('')
  const [transcriptionLoading, setTranscriptionLoading] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState('')
  const [transcriptCopyFeedback, setTranscriptCopyFeedback] = useState('')
  const [viewerOpen, setViewerOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [copyFeedback, setCopyFeedback] = useState('')
  const [nearViewport, setNearViewport] = useState(false)
  const attachmentRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef('')
  const mountedRef = useRef(false)
  const nearViewportRef = useRef(false)
  const loadingRef = useRef(false)
  const mimeType = message.mediaMime || 'application/octet-stream'
  const isImage = mimeType.startsWith('image/')
  const isAudio = mimeType.startsWith('audio/') || message.mediaType === 'm.audio'
  const isVideo = !isAudio && mimeType.startsWith('video/')
  const filename = message.body.trim() || 'matrix-attachment'
  const fileType = mimeType === 'application/pdf' ? 'PDF document' : mimeType.startsWith('text/') ? 'Text document' : 'File attachment'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sourceRef.current = ''
    }
  }, [])

  useEffect(() => {
    sourceRef.current = ''
    setSource('')
    setError('')
  }, [roomID, message.id])

  useEffect(() => {
    if (!viewerOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setViewerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [viewerOpen])

  useEffect(() => {
    if (!isImage) return
    const attachment = attachmentRef.current
    if (!attachment) return
    return observeMediaVisibility(attachment, (isNearViewport) => {
      nearViewportRef.current = isNearViewport
      setNearViewport(isNearViewport)
    })
  }, [isImage, roomID, message.id])

  const prepareMediaRef = useRef(prepareMedia)
  prepareMediaRef.current = prepareMedia

  useEffect(() => {
    if (isImage && nearViewport) void prepareMediaRef.current()
  }, [isImage, nearViewport, roomID, message.id])

  useEffect(() => {
    if (!isImage || nearViewport || !sourceRef.current) return
    sourceRef.current = ''
    setSource('')
  }, [isImage, nearViewport, source])

  async function prepareMedia() {
    if (source) return source
    if (loadingRef.current) return ''
    loadingRef.current = true
    setLoading(true)
    setError('')
    try {
      const mediaURL = matrixMediaURL(roomID, message.id)
      if (!mediaURL) throw new Error('This media event has no server ID.')
      if (!mountedRef.current || (isImage && !nearViewportRef.current)) return ''
      sourceRef.current = mediaURL
      setSource(mediaURL)
      return mediaURL
    } catch (mediaError) {
      setError(describeError(mediaError))
      return ''
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  async function openImage() {
    if (await prepareMedia()) {
      setZoom(1)
      setCopyFeedback('')
      setViewerOpen(true)
    }
  }

  async function downloadFile() {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError('')
    setSavedPath('')
    try {
      const path = await AppService.SaveMedia(message.mediaUri, filename)
      if (path) setSavedPath(path)
    } catch (downloadError) {
      setError(describeError(downloadError))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  async function revealSavedFile() {
    if (!savedPath) return
    try {
      await AppService.RevealFile(savedPath)
    } catch (revealError) {
      setError(describeError(revealError))
    }
  }

  function renderSavedFile() {
    return (
      <>
        Saved to{' '}
        <button className="media-reveal" type="button" title="Show in file manager" onClick={() => void revealSavedFile()}>{savedPath}</button>
      </>
    )
  }

  async function transcribeAudio() {
    if (!aiEnabled || transcriptionLoading) return
    setTranscriptionLoading(true)
    setTranscriptionError('')
    setTranscription('')
    setTranscriptCopyFeedback('')
    try {
      const result = (await AppService.AITranscribeMedia(message.mediaUri, filename, mimeType)).trim()
      if (!result) throw new Error('The AI endpoint returned an empty transcription.')
      if (mountedRef.current) setTranscription(result)
    } catch (transcriptionError) {
      if (mountedRef.current) setTranscriptionError(describeError(transcriptionError))
    } finally {
      if (mountedRef.current) setTranscriptionLoading(false)
    }
  }

  async function copyTranscript() {
    setTranscriptCopyFeedback('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is not available.')
      await navigator.clipboard.writeText(transcription)
      if (mountedRef.current) setTranscriptCopyFeedback('Transcript copied')
    } catch (copyError) {
      if (mountedRef.current) setTranscriptCopyFeedback(describeError(copyError))
    }
  }

  async function copyImage() {
    setCopyFeedback('')
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Image copying is not supported by this webview.')
      }
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not prepare the image for copying.')
      context.drawImage(image, 0, 0)
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the image.')), 'image/png')
      })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setCopyFeedback('Image copied')
    } catch (copyError) {
      setCopyFeedback(describeError(copyError))
    }
  }

  return (
    <div ref={attachmentRef} className={`message-attachment ${isAudio ? 'audio-attachment' : ''} ${isImage ? 'is-image' : ''}`}>
      {isAudio && <VoiceMessagePlayer key={message.id} label={filename} waveformKey={message.mediaUri} durationMs={message.mediaDurationMs} sizeBytes={message.mediaSize} source={source} autoPlay={autoPlayNext} onRequestSource={prepareMedia} onEnded={onAudioEnded} />}
      {isAudio && <div className="audio-attachment-footer">
        <span className="audio-filename" title={filename}>{filename}</span>
        <button className="icon-button audio-download" type="button" title={`Download ${filename}`} aria-label={`Download ${filename}`} disabled={loading} onClick={() => void downloadFile()}><Download size={15} /></button>
      </div>}
      {isAudio && <div className="audio-transcription-controls">
        <button className="audio-transcribe-button" type="button" title={aiEnabled ? 'Upload this audio to the configured endpoint for transcription.' : 'Set an AI endpoint in Settings > AI.'} disabled={!aiEnabled || transcriptionLoading} onClick={() => void transcribeAudio()}>
          {transcriptionLoading ? <span className="loading-mark" /> : <Sparkles size={14} />}
          {transcriptionLoading ? 'Transcribing…' : 'Transcribe with AI'}
        </button>
        <small>{aiEnabled ? 'Audio is sent to the configured endpoint, which may be remote.' : 'Set an AI endpoint in Settings > AI to transcribe audio.'}</small>
      </div>}
      {transcriptionLoading && <p className="audio-transcription-status" role="status">Transcribing audio…</p>}
      {transcriptionError && <span className="media-error" role="alert">{transcriptionError}</span>}
      {transcription && <section className="audio-transcript" aria-label="Audio transcript">
        <header className="audio-transcript-header">
          <strong>Transcript</strong>
          <div className="audio-transcript-actions">
            <button className="icon-button audio-transcript-copy" type="button" title="Copy transcript" aria-label="Copy transcript" onClick={() => void copyTranscript()}><Copy size={14} /></button>
            <button className="audio-transcript-draft" type="button" title={canUseDraft ? 'Put this transcript in the message composer' : 'Finish editing the current message first'} disabled={!canUseDraft} onClick={() => onUseDraft(transcription)}><ArrowUpRight size={13} />Use as draft</button>
          </div>
        </header>
        <p>{transcription}</p>
        {transcriptCopyFeedback && <span className="audio-transcript-feedback" role="status">{transcriptCopyFeedback}</span>}
      </section>}
      {!source && (isImage || isVideo) && <button className="media-load" type="button" title={loading ? 'Loading media' : `Load ${filename}`} disabled={loading} onClick={() => void prepareMedia()}>
        <Download size={14} />{loading ? 'Loading media…' : isImage ? `Preview ${filename}` : 'Load video'}
        {message.mediaSize > 0 && <span>{formatBytes(message.mediaSize)}</span>}
      </button>}
      {error && <span className="media-error" role="status">{error}</span>}
      {source && isImage && <>
        <button className="media-preview-button" type="button" aria-label={`Open image ${filename}`} title={`Open image ${filename}`} onClick={() => void openImage()}>
          <img className="media-preview" src={source} alt={filename} loading="lazy" onError={() => setError('This image could not be loaded.')} />
        </button>
        <div className="media-toolbar"><button className="media-download" type="button" aria-label={`Download ${filename}`} onClick={() => void downloadFile()}><Download size={13} />Download</button>{savedPath && <small className="media-download-status" role="status">{renderSavedFile()}</small>}</div>
      </>}
      {source && isVideo && <>
        <video className="media-player" controls preload="metadata" src={source} aria-label={filename} onError={() => setError('This video could not be played.')} />
        <button className="media-download" type="button" onClick={() => void downloadFile()}><Download size={13} />Download {filename}</button>
        {savedPath && <small className="media-download-status" role="status">{renderSavedFile()}</small>}
      </>}
      {!isImage && !isAudio && !isVideo && <div className="file-card">
        <span className="file-card-icon"><FileText size={17} /></span>
        <span className="file-card-copy"><strong title={filename}>{filename}</strong><small>{fileType}{message.mediaSize > 0 && ` · ${formatBytes(message.mediaSize)}`}</small>{savedPath && <small className="media-download-status" role="status">{renderSavedFile()}</small>}</span>
        <button className="icon-button" type="button" title={loading ? `Saving ${filename}` : `Download ${filename}`} aria-label={loading ? `Saving ${filename}` : `Download ${filename}`} disabled={loading} onClick={() => void downloadFile()}>{loading ? <span className="loading-mark" /> : <Download size={15} />}</button>
      </div>}
      {viewerOpen && source && createPortal(
        <div className="media-viewer-scrim" role="presentation" onClick={() => setViewerOpen(false)}>
          <DialogSurface className="media-viewer" label={`Preview ${filename}`} onClose={() => setViewerOpen(false)} onClick={(event) => event.stopPropagation()}>
            <header className="media-viewer-toolbar">
              <strong>{filename}</strong>
              <div>
                <button className="icon-button" type="button" title="Zoom out" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((current) => Math.max(1, current / 1.25))}><ZoomOut size={15} /></button>
                <button className="icon-button" type="button" title="Zoom in" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((current) => Math.min(4, current * 1.25))}><ZoomIn size={15} /></button>
                <button className="icon-button" type="button" title="Copy image" aria-label="Copy image" onClick={() => void copyImage()}><Copy size={14} /></button>
                <button className="media-download" type="button" onClick={() => void downloadFile()}><Download size={14} />Download</button>
                <button className="icon-button" type="button" aria-label="Close image preview" title="Close image preview" onClick={() => setViewerOpen(false)}><X size={15} /></button>
              </div>
            </header>
            {copyFeedback && <span className="media-viewer-feedback" role="status">{copyFeedback}</span>}
            {savedPath && <span className="media-viewer-feedback" role="status">{renderSavedFile()}</span>}
            <div className="media-viewer-image-wrap">
              <img className="media-viewer-image" src={source} alt={filename} style={{ maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? 'calc(100vh - 100px)' : 'none', transform: `scale(${zoom})` }} />
            </div>
          </DialogSurface>
        </div>,
        document.body,
      )}
    </div>
  )
}

export const LOCAL_AI_ROW_ICONS: Record<LocalAIChatIcon, typeof MessageSquare> = { agent: Bot, chat: MessageSquare, summary: FileText }

export const RoomButton = memo(function RoomButton({ room, index, active, needsReply, multiSelected, lastMessageByMe, use24Hour, showNetwork, showUnreadCounts, aiIcon, actionsRef }: { room: Room; index: number; active: boolean; needsReply: boolean; multiSelected: boolean; lastMessageByMe: boolean; use24Hour: boolean; showNetwork: boolean; showUnreadCounts: boolean; aiIcon?: LocalAIChatIcon; actionsRef: { current: RoomButtonActions } }) {
  const RowIcon = LOCAL_AI_ROW_ICONS[aiIcon ?? 'chat']
  const hasUnread = room.unread > 0 || room.markedUnread
  // Rooms without a message time show their sorting time, which the sidebar is already ordered by.
  const activityAt = roomActivityAt(room)
  return (
    <button data-room-index={index} className={`room-button ${active ? 'is-active' : ''} ${multiSelected ? 'is-multiselected' : ''} ${room.muted ? 'is-muted' : ''} ${hasUnread ? 'has-unread' : ''}`} onClick={(event) => actionsRef.current.onSelect(room, index, event)} onKeyDown={(event) => actionsRef.current.onKeyDown(room, index, event)} onContextMenu={(event) => actionsRef.current.onContextMenu(room, event)} aria-current={active ? 'page' : undefined} title={room.name || room.id}>
      {isLocalAIRoomID(room.id)
        ? <span className="room-avatar room-avatar-ai" aria-hidden="true"><RowIcon size={16} /></span>
        : <Avatar uri={room.avatar} label={room.name || room.id} className="room-avatar" style={avatarStyle(room.name || room.id)} deferLoad />}
      <span className="room-copy">
        <span className="room-name">{room.favorite && <Star size={10} fill="currentColor" aria-label="Favorite" />}<span className="room-name-text">{room.name || room.id}</span>{room.muted && <span className="room-muted-mark" title="Muted">· muted</span>}{showNetwork && room.bridge && <span className="room-network" style={{ '--network-hue': networkHue(room.bridge) } as React.CSSProperties}>{room.bridge}</span>}</span>
        <span className="room-preview">
          {lastMessageByMe && room.preview && <span className="room-preview-sent" role="img" aria-label="Sent by you" title="Sent by you"><ArrowUpRight size={11} /></span>}
          <span className={`room-preview-text ${room.preview && room.lastEventSender && !lastMessageByMe ? 'is-received' : ''}`}>{room.preview || room.topic}</span>
        </span>
      </span>
      <span className="room-meta">
        {room.unread > 0 ? <span className="unread-count">{room.unread > 99 ? '99+' : room.unread}</span> : room.markedUnread && <span className="unread-dot" aria-label="Unread" />}
        {needsReply && !(showUnreadCounts && room.unread > 0) && <span className="needs-reply-dot" aria-label="Needs reply" title="Needs reply" />}
        {activityAt > 0 && <time>{formatTimeOrDate(activityAt, use24Hour)}</time>}
      </span>
    </button>
  )
})

export function reportRoomListVisibleRange(startIndex: number, endIndex: number) {
  void Promise.resolve(AppService.UpdateVisibleRange('main', startIndex, endIndex)).catch(() => undefined)
}

export function VirtualRoomList({ listRef, rooms, selectedRoomIndex, rowHeight, listCount, rangeKey, onVisibleRange, renderRoom, emptyContent }: {
  listRef: { current: HTMLElement | null }
  rooms: Room[]
  selectedRoomIndex: number
  rowHeight: number
  listCount: number
  rangeKey: string
  onVisibleRange: (startIndex: number, endIndex: number) => void
  renderRoom: (room: Room, index: number) => ReactNode
  emptyContent: ReactNode
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const pendingScrollTop = useRef(0)
  const scrollFrame = useRef(0)
  const virtualized = rooms.length > ROOM_LIST_VIRTUALIZATION_THRESHOLD
  const overscan = 8
  const first = Math.min(rooms.length, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan))
  const visibleEnd = Math.min(rooms.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  const knownListCount = Math.max(rooms.length, listCount)
  const requestedEnd = visibleEnd >= rooms.length && rooms.length < knownListCount
    ? Math.min(knownListCount, rooms.length + ROOM_LIST_RANGE_PREFETCH)
    : visibleEnd
  const rangeEnd = Math.min(requestedEnd, first + ROOM_LIST_MAX_SYNC_RANGE)

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const updateSize = () => {
      setViewportHeight(list.clientHeight || 600)
      pendingScrollTop.current = list.scrollTop
      setScrollTop(list.scrollTop)
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(list)
    return () => observer.disconnect()
  }, [listRef])

  useEffect(() => () => {
    if (scrollFrame.current) window.cancelAnimationFrame(scrollFrame.current)
  }, [])

  useEffect(() => {
    if (rangeEnd <= first) return
    onVisibleRange(first, rangeEnd)
  }, [first, onVisibleRange, rangeEnd, rangeKey])

  useEffect(() => {
    const list = listRef.current
    if (!virtualized || !list || selectedRoomIndex < 0) return
    const top = selectedRoomIndex * rowHeight
    if (top < list.scrollTop || top + rowHeight > list.scrollTop + viewportHeight) {
      list.scrollTop = top
      pendingScrollTop.current = top
      setScrollTop(top)
    }
  }, [listRef, rowHeight, selectedRoomIndex, virtualized, viewportHeight])

  function handleScroll(event: React.UIEvent<HTMLElement>) {
    pendingScrollTop.current = event.currentTarget.scrollTop
    if (scrollFrame.current) return
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = 0
      setScrollTop(pendingScrollTop.current)
    })
  }

  let content: ReactNode
  if (rooms.length === 0) {
    content = emptyContent
  } else if (!virtualized) {
    content = rooms.map((room, index) => renderRoom(room, index))
  } else {
    content = (
      <div className="room-list-virtual-content" style={{ height: rooms.length * rowHeight }}>
        {rooms.slice(first, visibleEnd).map((room, offset) => {
          const index = first + offset
          return <div className="room-list-virtual-row" key={`${room.accountId}:${room.id}`} style={{ top: index * rowHeight }}>{renderRoom(room, index)}</div>
        })}
      </div>
    )
  }

  return (
    <nav
      ref={(element) => { listRef.current = element }}
      className={`room-list ${virtualized ? 'is-virtualized' : ''}`}
      aria-label="Rooms"
      onScroll={handleScroll}
      style={virtualized ? { '--room-row-height': `${rowHeight}px` } as React.CSSProperties : undefined}
    >
      {content}
    </nav>
  )
}


export function LanguageTutorAnalysisDetails({ analysis, originalText }: { analysis: TutorAnalysis; originalText: string }) {
  const detectedCode = analysis.detected_language
  const learningCode = analysis.target_language
  const explanationCode = analysis.explanation_language
  const phrases = analysis.phrases ?? []
  return <>
    <section className="language-tutor-section">
      <span className="eyebrow">ORIGINAL · {languageName(detectedCode).toUpperCase()}</span>
      <p lang={detectedCode}>{originalText}</p>
    </section>
    {analysis.corrected_text && <section className="language-tutor-section">
      <span className="eyebrow">CORRECTED · {languageName(learningCode).toUpperCase()}</span>
      <p lang={learningCode}>{analysis.corrected_text}</p>
      {analysis.has_grammar_errors && analysis.error_explanation && <small className="language-tutor-error-note">{analysis.error_explanation}</small>}
    </section>}
    <section className="language-tutor-section">
      <span className="eyebrow">TRANSLATION · {languageName(explanationCode).toUpperCase()}</span>
      <p lang={explanationCode}>{analysis.translation}</p>
    </section>
    {phrases.length > 0 && <section className="language-tutor-section">
      <span className="eyebrow">WORD-BY-WORD</span>
      {phrases.map((phrase, phraseIndex) => <div className="language-tutor-phrase" key={`${phrase.text}-${phraseIndex}`}>
        <div className="language-tutor-phrase-head">
          <strong lang={learningCode}>{phrase.text}</strong>
          <span>{phrase.meaning}</span>
        </div>
        <ol className="language-tutor-morphemes">
          {(phrase.words ?? []).map((item, index) => <li key={`${item.word}-${index}`}>
            <strong lang={learningCode}>{item.word}</strong>
            <span>{item.breakdown}</span>
            <small>{item.meaning}</small>
          </li>)}
        </ol>
      </div>)}
    </section>}
    {analysis.grammar_rule && <section className="language-tutor-section language-tutor-rule">
      <span className="eyebrow">GRAMMAR RULE</span>
      <p>{analysis.grammar_rule}</p>
    </section>}
  </>
}

export function IconTooltip({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`icon-tooltip${className ? ` ${className}` : ''}`} data-tooltip={label}>{children}</div>
}

export type ActionMenuEntry = {
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  active?: boolean
  count?: number
  title?: string
}

export function ActionMenu({ label, icon, items, side = 'bottom', showLabel = false, disabled = false, count = 0 }: {
  label: string
  icon: ReactNode
  items: ActionMenuEntry[]
  side?: 'top' | 'bottom'
  showLabel?: boolean
  disabled?: boolean
  count?: number
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const focusLastRef = useRef(false)

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const menu = menuRef.current
      const trigger = triggerRef.current
      if (!menu || !trigger) return
      menu.style.setProperty('--menu-shift', '0px')
      const bounds = menu.getBoundingClientRect()
      const scale = menu.offsetWidth > 0 ? bounds.width / menu.offsetWidth : 1
      const anchor = trigger.getBoundingClientRect()
      const availableHeight = side === 'top' ? anchor.top - 16 : window.innerHeight - anchor.bottom - 16
      menu.style.maxHeight = `${Math.max(32, availableHeight / scale)}px`
      const shift = bounds.left < 8 ? 8 - bounds.left : bounds.right > window.innerWidth - 8 ? window.innerWidth - 8 - bounds.right : 0
      menu.style.setProperty('--menu-shift', `${shift / scale}px`)
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open, side])

  useEffect(() => {
    if (!open) return
    const enabled = menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    const initial = enabled?.[focusLastRef.current ? enabled.length - 1 : 0]
    const target = initial ?? menuRef.current
    target?.focus()
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      close()
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && enabled.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
      enabled[next].focus()
    }
  }

  return <div className="action-menu-control" data-side={side} ref={rootRef}>
    <IconTooltip label={label}>
      <button ref={triggerRef} className={`icon-button action-menu-trigger${showLabel ? ' has-label' : ''}`} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (open) close(); else { focusLastRef.current = false; setOpen(true) } }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          focusLastRef.current = event.key === 'ArrowUp'
          setOpen(true)
        }
      }}>
        {icon}{showLabel && <span>{label}</span>}{count > 0 && <span className="action-menu-count">{count}</span>}
      </button>
    </IconTooltip>
    {open && <div id={id} className="action-menu" role="menu" aria-label={label} ref={menuRef} tabIndex={-1} onKeyDown={navigate}>
      {items.map((item) => <button key={item.label} type="button" role={item.active === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-label={item.label} aria-description={item.count ? `${item.count} items` : undefined} aria-checked={item.active} title={item.title} tabIndex={-1} disabled={item.disabled} onClick={() => { close(); item.onSelect() }}>
        {item.icon}<span>{item.label}</span>{item.count !== undefined && item.count > 0 && <small aria-hidden="true">{item.count}</small>}{item.active && <Check className="action-menu-check" size={14} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}
