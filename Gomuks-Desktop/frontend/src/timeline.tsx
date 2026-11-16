import { Fragment, lazy, memo, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { MessagesSquare } from 'lucide-react'
import { type Message } from '../bindings/mychat/desktop/models.js'
import { firstPreviewableURL, LinkPreviewCard } from './LinkPreview'
import { type ThreadSummary } from './threads'
import { type PreferenceValues, type ChatTranslationState, type TimelineMessageActions, type TimelineListHandle } from './appTypes'
import { VIRTUAL_TIMELINE_THRESHOLD } from './appConstants'
import { Avatar } from './avatar'
import { displayMessageBody, imageFileNameBodyPattern, timelineMessageID, isOwnMessage, appendedTimelineMessageIDs, timelineFirstItemIndex } from './messages'
import { isSameDay, formatDayLabel, formatTime, createTimelineTimeFormatter } from './format'
import { preferenceBoolean, preferenceString, preferenceNumber, linkPreviewsEnabled } from './preferences'
import { preferredScrollBehavior } from './dom'
import { MessageMedia } from './messageMedia'
import { MessageReactionPicker } from './MessageReactionPicker'
import { type ThemeMode } from './themes'

export const MarkdownMessage = lazy(() => import('./MarkdownMessage'))

export const virtualTimelineComponents = {
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
  reactionColorScheme,
  autoPlayNextMessageId,
  canUseTranscriptAsDraft,
  actionsRef,
  scrollParentRef,
  listHandleRef,
  unreadMarkerID = '',
  unreadDividerRef,
  threadSummaries,
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
}) {
  const visibleMessages = hideDeleted ? messages.filter((message) => !message.redacted) : messages
  const scope = `${accountID}:${selectedRoomID}`
  const virtualized = Boolean(scrollParentRef && visibleMessages.length > VIRTUAL_TIMELINE_THRESHOLD)
  const visibleMessagesRef = useRef(visibleMessages)
  visibleMessagesRef.current = visibleMessages
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
