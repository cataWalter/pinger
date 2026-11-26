import { type Member, type Message } from '../bindings/mychat/desktop/models.js'
import { type ChatExportState } from './appTypes'

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

export function newestOtherAvatar(messages: Message[], currentUserID: string) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!isOwnMessage(message, currentUserID) && message.avatar) return message.avatar
  }
  return ''
}

export function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function chatExportStatusText(state: ChatExportState) {
  if (state.stage === 'finishing') return 'Writing text file'
  if (state.stage === 'history') return 'Reading room history'
  return 'Starting export'
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

// Applies edit-derived fields only, so reactions, seen state, and other loaded details are preserved.
export function applyEditedMessages(current: Message[], edits: Message[]) {
  if (edits.length === 0) return current
  const editsByID = new Map(edits.map((edit) => [edit.id, edit]))
  let changed = false
  const next = current.map((message) => {
    const edit = editsByID.get(message.id)
    if (!edit) return message
    changed = true
    return {
      ...message,
      body: edit.body,
      formattedBody: edit.formattedBody,
      edited: edit.edited,
      editHistory: edit.editHistory,
    }
  })
  return changed ? next : current
}

export function applyRedactedEvents(current: Message[], eventIDs: string[]) {
  if (eventIDs.length === 0) return current
  const targets = new Set(eventIDs)
  let changed = false
  const next = current.map((message) => {
    if (!targets.has(message.id) || message.redacted) return message
    changed = true
    return {
      ...message,
      redacted: true,
      body: '',
      formattedBody: '',
      mediaUri: '',
      mediaType: '',
      mediaName: '',
      mediaThumbnailUri: '',
      reactions: {},
      reacted: {},
      editHistory: [],
      urlPreviews: [],
      encrypted: false,
      decryptionError: '',
    }
  })
  return changed ? next : current
}

export function applyReactionDeltas(current: Message[], deltas: Array<{ eventId: string; reactions: Record<string, number>; reacted: Record<string, boolean> }>) {
  if (deltas.length === 0) return current
  const byID = new Map(deltas.map((delta) => [delta.eventId, delta]))
  let changed = false
  const next = current.map((message) => {
    const delta = byID.get(message.id)
    if (!delta) return message
    changed = true
    return {
      ...message,
      reactions: delta.reactions ?? {},
      reacted: delta.reacted ?? {},
    }
  })
  return changed ? next : current
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

    // Reconcile optimistic client-only messages (~optimistic-*) with the confirmed server/local copy.
    if (!message.sending && message.id && !message.id.startsWith('~')) {
      const optimisticIndex = merged.findIndex((candidate) =>
        candidate.transactionId.startsWith('~optimistic-')
        && candidate.sender === message.sender
        && candidate.body === message.body,
      )
      if (optimisticIndex >= 0) {
        merged[optimisticIndex] = { ...merged[optimisticIndex], ...message }
        for (const key of keysFor(merged[optimisticIndex])) indexes.set(key, optimisticIndex)
        continue
      }
    }

    const index = merged.push(message) - 1
    for (const key of keysFor(message)) indexes.set(key, index)
  }

  return merged.sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
}

export function createOptimisticMessage({
  sender,
  senderName,
  body,
  replyTo,
}: {
  sender: string
  senderName: string
  body: string
  replyTo: Message | null
}): Message {
  const transactionId = `~optimistic-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
  return {
    id: '',
    transactionId,
    sender,
    senderName: senderName || sender,
    avatar: '',
    body,
    formattedBody: '',
    replyToEventId: replyTo?.id ?? '',
    replyToSender: replyTo ? (replyTo.senderName || replyTo.sender) : '',
    replyToPreview: replyTo?.body ?? '',
    threadRootId: '',
    timestamp: Date.now(),
    seenAt: 0,
    timelineCursor: 0,
    sending: true,
    sendError: '',
    own: true,
    reactions: {},
    reacted: {},
    mediaUri: '',
    mediaType: '',
    mediaMime: '',
    mediaSize: 0,
    mediaWidth: 0,
    mediaHeight: 0,
    mediaDurationMs: 0,
    encrypted: false,
    decryptionError: '',
    edited: false,
    editHistory: [],
    redacted: false,
  }
}

export function timelineMessageID(message: Message) {
  return message.id || message.transactionId
}

export function isOwnMessage(message: Message, currentUserID: string) {
  return message.own || Boolean(message.sender && message.sender === currentUserID)
}

// firstUnreadMessageID returns the oldest of the newest `unread` messages from others,
// or the oldest loaded one when more messages are unread than loaded.
export function firstUnreadMessageID(timeline: Message[], unread: number, currentUserID: string) {
  let remaining = unread
  let firstID = ''
  for (let index = timeline.length - 1; index >= 0 && remaining > 0; index--) {
    const message = timeline[index]
    if (!message.id || isOwnMessage(message, currentUserID)) continue
    firstID = message.id
    remaining--
  }
  return firstID
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

export function appendedTimelineMessageIDs(previous: Message[], next: Message[]): Set<string> {
  if (previous.length === 0) return new Set()
  const tail = previous[previous.length - 1]
  const tailIndex = next.findIndex((message) => timelineMessageID(message) === timelineMessageID(tail) || Boolean(tail.transactionId && message.transactionId === tail.transactionId))
  if (tailIndex < 0) return new Set()
  const known = new Set(previous.flatMap((message) => [message.id, message.transactionId].filter(Boolean)))
  return new Set(next.slice(tailIndex + 1).filter((message) => !known.has(message.id) && !known.has(message.transactionId)).map(timelineMessageID))
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
