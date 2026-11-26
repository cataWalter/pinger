import { Fragment, lazy, memo, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Virtuoso, type ListItem, type VirtuosoHandle } from 'react-virtuoso'
import { CheckCheck, MessagesSquare, MoreHorizontal, Reply, Smile } from 'lucide-react'
import { type Message } from '../bindings/mychat/desktop/models.js'
import { firstPreviewableURL, LinkPreviewCard } from './LinkPreview'
import { type ThreadSummary } from './threads'
import { type PreferenceValues, type ChatTranslationState, type TimelineMessageActions, type TimelineListHandle } from './appTypes'
import { VIRTUAL_TIMELINE_THRESHOLD } from './appConstants'
import { Avatar } from './avatar'
import { displayMessageBody, imageFileNameBodyPattern, timelineMessageID, isOwnMessage, appendedTimelineMessageIDs, timelineFirstItemIndex } from './messages'
import { isSameDay, formatDayLabel, formatTime, createTimelineTimeFormatter } from './format'
import { preferenceBoolean, preferenceString, linkPreviewsEnabled } from './preferences'
import { preferredScrollBehavior } from './dom'
import { MessageMedia } from './messageMedia'
import { roomDetectedChatLanguage } from './aiLanguages'
import { MessageReactionPicker } from './MessageReactionPicker'
import { type ThemeMode } from './themes'

export const MarkdownMessage = lazy(() => import('./MarkdownMessage'))

type TimelineTopRow = { scope: string; eventID: string; offset: number }

// Virtuoso skips its prepend compensation when scrollTop is exactly 0, so the reading position is restored from the DOM.
function captureTopRow(scrollParent: HTMLElement, scope: string): TimelineTopRow | null {
  const parentTop = scrollParent.getBoundingClientRect().top
  const row = Array.from(scrollParent.querySelectorAll<HTMLElement>('[data-event-id]'))
    .find((candidate) => candidate.dataset.eventId && candidate.getBoundingClientRect().bottom > parentTop)
  if (!row?.dataset.eventId) return null
  return { scope, eventID: row.dataset.eventId, offset: row.getBoundingClientRect().top - parentTop }
}

export const virtualTimelineComponents = {
  Header: ({ context }: { context?: { header?: ReactNode } }) => <div style={{ display: 'flex', flexDirection: 'column' }}>{context?.header}</div>,
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
  reactionColorScheme,
  autoPlayNextMessageId,
  canUseTranscriptAsDraft,
  actionsRef,
  scrollParentRef,
  listHandleRef,
  unreadMarkerID = '',
  unreadDividerRef,
  threadSummaries,
  onAnalysesUnloaded,
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
  reactionColorScheme?: ThemeMode
  autoPlayNextMessageId: string | null
  canUseTranscriptAsDraft: boolean
  actionsRef: { current: TimelineMessageActions }
  scrollParentRef?: RefObject<HTMLDivElement | null>
  listHandleRef?: RefObject<TimelineListHandle | null>
  unreadMarkerID?: string
  unreadDividerRef?: (element: HTMLDivElement | null) => void
  threadSummaries?: Map<string, ThreadSummary>
  onAnalysesUnloaded?: (messageIDs: string[]) => void
}) {
  const visibleMessages = hideDeleted ? messages.filter((message) => !message.redacted) : messages
  const scope = `${accountID}:${selectedRoomID}`
  const virtualized = Boolean(scrollParentRef && visibleMessages.length > VIRTUAL_TIMELINE_THRESHOLD)
  const visibleMessagesRef = useRef(visibleMessages)
  visibleMessagesRef.current = visibleMessages
  const firstRowRef = useRef<HTMLElement>(null)
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null)
  const virtualRef = useRef<VirtuosoHandle>(null)
  const renderedReportRef = useRef<{ scope: string; messageIDs: Set<string> } | null>(null)
  const latestReportRef = useRef({ scope, onAnalysesUnloaded })
  latestReportRef.current = { scope, onAnalysesUnloaded }
  const focusFrameRef = useRef<number | null>(null)
  const [anchor, setAnchor] = useState({ scope, source: messages, visible: visibleMessages, hideDeleted, firstIndex: 1000000 })
  const previousRef = useRef<{ scope: string; messages: Message[] } | null>(null)
  const topRowRef = useRef<TimelineTopRow | null>(null)
  const previousFirstIndexRef = useRef(anchor.firstIndex)
  const animateMessages = preferenceBoolean(preferences, 'appearance.message_animations', true)
  const formatTimestamp = createTimelineTimeFormatter(preferences)

  const anchorMatches = anchor.scope === scope && anchor.source === messages && anchor.hideDeleted === hideDeleted
  const currentFirstIndex = anchorMatches
    ? anchor.firstIndex
    : (anchor.scope === scope ? timelineFirstItemIndex(anchor.visible, visibleMessages, anchor.firstIndex) : 1000000)

  // Compute the latest index synchronously in state via React's supported
  // "adjusting state when props change" pattern, or in an effect when only
  // `messages` changed. Here `messages` is unchanged while typing, so checking
  // `anchorMatches` avoids any state update during composer typing.
  if (!anchorMatches) {
    setAnchor({
      scope,
      source: messages,
      visible: visibleMessages,
      hideDeleted,
      firstIndex: currentFirstIndex,
    })
  }

  useEffect(() => {
    setScrollParent(scrollParentRef?.current ?? null)
  }, [scrollParentRef, selectedRoomID])

  useEffect(() => {
    if (!scrollParent) return
    let frame: number | null = null
    const capture = () => {
      frame = null
      topRowRef.current = captureTopRow(scrollParent, scope)
    }
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(capture)
    }
    scrollParent.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scrollParent.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [scope, scrollParent])

  useLayoutEffect(() => {
    const previous = previousFirstIndexRef.current
    previousFirstIndexRef.current = anchor.firstIndex
    const snapshot = topRowRef.current
    if (!virtualized || !scrollParent || anchor.firstIndex >= previous || !snapshot || snapshot.scope !== scope) return
    let frames = 0
    let settledFrames = 0
    let scrolledToIndex = false
    const settle = () => {
      frames += 1
      const row = Array.from(scrollParent.querySelectorAll<HTMLElement>('[data-event-id]'))
        .find((candidate) => candidate.dataset.eventId === snapshot.eventID)
      if (row) {
        const delta = row.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top - snapshot.offset
        if (Math.abs(delta) > 0.5) {
          scrollParent.scrollTop += delta
          settledFrames = 0
        } else {
          settledFrames += 1
        }
      } else {
        settledFrames = 0
        const index = visibleMessagesRef.current.findIndex((message) => message.id === snapshot.eventID || message.transactionId === snapshot.eventID)
        if (!scrolledToIndex && index >= 0 && virtualRef.current) {
          scrolledToIndex = true
          virtualRef.current.scrollToIndex({ index, align: 'start', behavior: 'auto' })
        }
      }
      if (settledFrames < 2 && frames < 12) requestAnimationFrame(settle)
    }
    requestAnimationFrame(settle)
  }, [anchor.firstIndex, scope, scrollParent, virtualized])

  useLayoutEffect(() => {
    if (!listHandleRef) return
    listHandleRef.current = {
      virtualized,
      focusMessage: (eventID) => {
        const index = visibleMessages.findIndex((message) => message.id === eventID || message.transactionId === eventID)
        if (index < 0 || !virtualRef.current) return false
        let initialRowOffset: number | null = null
        virtualRef.current.scrollToIndex({
          get index() {
            return Math.max(0, visibleMessagesRef.current.findIndex((message) => message.id === eventID || message.transactionId === eventID))
          },
          get offset() {
            const row = Array.from(scrollParentRef?.current?.querySelectorAll<HTMLElement>('[data-event-id]') ?? [])
              .find((row) => row.dataset.eventId === eventID)
            const item = row?.closest<HTMLElement>('[data-index]')
            const currentOffset = row && item ? row.getBoundingClientRect().top - item.getBoundingClientRect().top : 0
            return initialRowOffset === null ? 0 : currentOffset - initialRowOffset
          },
          align: index === 0 ? 'start' : 'center', behavior: 'auto',
        })
        if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
        let remainingFrames = 60
        const focus = () => {
          const target = Array.from(scrollParentRef?.current?.querySelectorAll<HTMLElement>('[data-event-id]') ?? [])
            .find((row) => row.dataset.eventId === eventID)
          target?.focus({ preventScroll: true })
          if (target && document.activeElement === target) {
            const item = target.closest<HTMLElement>('[data-index]')
            if (item) initialRowOffset = target.getBoundingClientRect().top - item.getBoundingClientRect().top
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
    const previewURL = linkPreviewsEnabled(preferences, message) ? firstPreviewableURL(displayBody) : ''
    const thread = message.id ? threadSummaries?.get(message.id) : undefined
    return (
      <Fragment key={message.id || message.transactionId}>
        {showDayDivider && message.timestamp > 0 && <div className="day-divider" aria-label={formatDayLabel(message.timestamp)}><span>{formatDayLabel(message.timestamp)}</span></div>}
        {unreadMarkerID && messageID === unreadMarkerID && <div ref={unreadDividerRef} className="unread-divider" role="separator" aria-label="New messages"><span>New messages</span></div>}
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
            {messageID && !message.redacted && (
              <div className="message-hover-actions" role="group" aria-label="Quick message actions">
                <button type="button" aria-label="React to message" title="React" disabled={messageID.startsWith('~')} onClick={() => actionsRef.current.onReact(message)}><Smile size={13} /></button>
                <button type="button" aria-label="Reply to message" title="Reply" disabled={messageID.startsWith('~')} onClick={() => actionsRef.current.onReply(message)}><Reply size={13} /></button>
                <button type="button" aria-label="Reply in thread" title="Reply in thread" disabled={messageID.startsWith('~')} onClick={() => actionsRef.current.onOpenThread(message.threadRootId || message.id)}><MessagesSquare size={13} /></button>
                <button type="button" aria-label="More message actions" title="More actions" onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  actionsRef.current.onOpenContextMenu(message, bounds.left, bounds.bottom + 4)
                }}><MoreHorizontal size={13} /></button>
              </div>
            )}
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
            {previewURL && <LinkPreviewCard url={previewURL} showImage={!hideImagesAndVideos} />}
            {message.mediaUri && !message.redacted && !message.decryptionError && !(hideImagesAndVideos && isImageOrVideoAttachment) && (
              <MessageMedia
                roomID={selectedRoomID}
                message={message}
                autoPlayNext={autoPlayNextMessageId === message.id}
                aiEnabled={Boolean(preferenceString(preferences, 'ai.endpoint', '').trim())}
                chatLanguage={roomDetectedChatLanguage(preferences, selectedRoomID)}
                canUseDraft={canUseTranscriptAsDraft}
                onUseDraft={(text) => actionsRef.current.onUseTranscript(text)}
                onAudioEnded={() => actionsRef.current.onAudioEnded(message.id)}
              />
            )}
            {ownMessage && message.seenAt > 0 && <time className="message-seen-status" dateTime={new Date(message.seenAt).toISOString()}>
              <CheckCheck size={12} aria-hidden="true" />
              Seen at {formatTime(message.seenAt, preferenceBoolean(preferences, 'appearance.time_24_hour'))}
            </time>}
            {Object.keys(message.reactions ?? {}).length > 0 && <div className="message-reactions">
              {Object.entries(message.reactions ?? {}).map(([emoji, count]) => (
                <button key={emoji} type="button" className={`reaction-chip ${message.reacted?.[emoji] ? 'is-reacted' : ''}`} aria-label={`${message.reacted?.[emoji] ? 'Remove' : 'Add'} ${emoji} reaction`} title={`${message.reacted?.[emoji] ? 'Remove' : 'Add'} ${emoji} reaction`} aria-pressed={message.reacted?.[emoji] ?? false} onClick={() => message.reacted?.[emoji] ? actionsRef.current.onRemoveReaction(message, emoji) : actionsRef.current.onSendReaction(message, emoji)}>{emoji} {typeof count === 'number' ? count : 0}</button>
              ))}
            </div>}
            {thread && <button className="thread-summary" type="button" aria-label={`Open thread, ${thread.count === 1 ? '1 reply' : `${thread.count} replies`}`} onClick={() => actionsRef.current.onOpenThread(message.id)}>
              <MessagesSquare size={13} aria-hidden="true" />
              <span className="thread-summary-count">{thread.count === 1 ? '1 reply' : `${thread.count} replies`}</span>
              <span className="thread-summary-latest">{thread.latest.senderName || thread.latest.sender}: {displayMessageBody(thread.latest)}</span>
            </button>}
            {message.threadRootId && <button className="thread-summary is-reply" type="button" onClick={() => actionsRef.current.onOpenThread(message.threadRootId)}>
              <MessagesSquare size={13} aria-hidden="true" />
              <span className="thread-summary-count">View thread</span>
            </button>}
            {message.sendError && message.sendError !== 'not sent' && <span className="message-error">{message.sendError}</span>}
            {message.sending && !message.sendError && <span className="message-pending">Sending…</span>}
            {reactingMessageID === message.id && <MessageReactionPicker preferences={preferences} colorScheme={reactionColorScheme} onSendReaction={(emoji) => actionsRef.current.onSendReaction(message, emoji)} />}
          </div>
          {showTranslation && <aside className="message-translation" role="note" aria-label={`${chatTranslation?.targetLanguage || 'Translation'} translation`} aria-live="polite">
            <span className="message-translation-label">{chatTranslation?.targetLanguage || 'Translation'}</span>
            {translatedAnalysis ? <p>{translatedAnalysis.translation}</p> : <p>Translating…</p>}
          </aside>}
        </article>
      </Fragment>
    )
  }

  if (virtualized) {
    if (!scrollParent) return null
    // reportRenderedMessages compares each rendered set with the previous one. Rows that dropped out are unloaded by virtual loading.
    function reportRenderedMessages(items: ListItem<Message>[]) {
      const { scope: currentScope, onAnalysesUnloaded: notifyUnloaded } = latestReportRef.current
      const messageIDs = new Set<string>()
      for (const item of items) {
        if ('data' in item && item.data) messageIDs.add(timelineMessageID(item.data))
      }
      const previous = renderedReportRef.current
      renderedReportRef.current = { scope: currentScope, messageIDs }
      if (!previous || previous.scope !== currentScope || !notifyUnloaded) return
      const unloaded = Array.from(previous.messageIDs).filter((messageID) => !messageIDs.has(messageID))
      if (unloaded.length > 0) notifyUnloaded(unloaded)
    }
    return <Virtuoso<Message, { header?: ReactNode }>
      ref={virtualRef}
      className="virtual-timeline"
      components={virtualTimelineComponents}
      context={{ header }}
      customScrollParent={scrollParent}
      data={visibleMessages}
      firstItemIndex={currentFirstIndex}
      computeItemKey={(_index, message) => timelineMessageID(message)}
      itemsRendered={reportRenderedMessages}
      itemSize={(element, field) => element[field]}
      defaultItemHeight={48}
      increaseViewportBy={{ top: 240, bottom: 240 }}
      initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
      itemContent={(index, message) => <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>{renderMessage(index - anchor.firstIndex, message)}</div>}
    />
  }

  return <>{header}{visibleMessages.map((message, index) => renderMessage(index, message))}</>
})
