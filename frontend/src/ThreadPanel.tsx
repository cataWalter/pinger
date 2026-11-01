import { Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { MessagesSquare, Send, X } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import type { Message } from '../bindings/mychat/desktop/models.js'
import { DialogSurface } from './DialogSurface'
import { Avatar, MarkdownMessage, describeError, displayMessageBody, formatTime, isOwnMessage, preferenceBoolean, type PreferenceValues } from './appShared'

function ThreadMessage({ message, own, use24Hour }: { message: Message; own: boolean; use24Hour: boolean }) {
  const name = message.senderName || message.sender
  const body = displayMessageBody(message)
  return (
    <article className={`thread-message ${own ? 'is-own' : ''}`} data-event-id={message.id || message.transactionId}>
      <Avatar uri={message.avatar} label={name} className="thread-message-avatar" deferLoad />
      <div className="thread-message-body">
        <div className="thread-message-meta">
          <strong>{own ? 'You' : name}</strong>
          {message.timestamp > 0 && <time>{formatTime(message.timestamp, use24Hour)}</time>}
        </div>
        {message.replyToEventId && message.replyToPreview && <p className="thread-message-quote">{message.replyToSender ? `${message.replyToSender}: ` : ''}{message.replyToPreview}</p>}
        <Suspense fallback={<div className="message-body">{body}</div>}>
          <MarkdownMessage body={body} />
        </Suspense>
        {message.sending && !message.sendError && <span className="message-pending">Sending…</span>}
        {message.sendError && message.sendError !== 'not sent' && <span className="message-error">{message.sendError}</span>}
      </div>
    </article>
  )
}

export function ThreadPanel({ roomID, rootID, rootMessage, revision, currentUserID, preferences, onClose }: {
  roomID: string
  rootID: string
  rootMessage?: Message
  revision: number
  currentUserID: string
  preferences: PreferenceValues
  onClose: () => void
}) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  // Runs after DialogSurface focuses its first button, so the composer wins.
  useEffect(() => composerRef.current?.focus(), [])

  useEffect(() => {
    let active = true
    AppService.ThreadMessages(roomID, rootID)
      .then((list) => {
        if (!active) return
        setMessages(list ?? [])
        setLoadError('')
      })
      .catch((error: unknown) => {
        if (active) setLoadError(describeError(error))
      })
    return () => { active = false }
  }, [roomID, rootID, revision, reload])

  const root = messages?.find((message) => message.id === rootID) ?? rootMessage
  const replies = (messages ?? []).filter((message) => message.id !== rootID)
  const replyCount = replies.length
  const use24Hour = preferenceBoolean(preferences, 'appearance.time_24_hour')

  useLayoutEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [replyCount])

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setSendError('')
    try {
      await AppService.SendThreadReply(roomID, text, rootID)
      setDraft('')
      setReload((value) => value + 1)
    } catch (error) {
      setSendError(describeError(error))
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  return (
    <div className="room-info-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <DialogSurface className="room-info-dialog thread-panel" labelledBy="thread-title" onClose={onClose} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header">
          <div><span className="eyebrow">THREAD</span><h2 id="thread-title">{replyCount === 1 ? '1 reply' : `${replyCount} replies`}</h2></div>
          <button className="icon-button" type="button" aria-label="Close thread" title="Close thread" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="thread-panel-messages" ref={listRef} role="log" aria-label="Thread messages" aria-busy={messages === null && !loadError}>
          {root
            ? <div className="thread-root"><ThreadMessage message={root} own={isOwnMessage(root, currentUserID)} use24Hour={use24Hour} /></div>
            : messages !== null && <p className="thread-panel-note">Original message unavailable</p>}
          {messages === null && !loadError && <p className="thread-panel-note"><span className="loading-mark" />Loading thread</p>}
          {loadError && <p className="message-error" role="alert">Could not load thread: {loadError}</p>}
          {messages !== null && replyCount === 0 && <p className="thread-panel-note"><MessagesSquare size={14} aria-hidden="true" />No replies yet</p>}
          {replies.map((message) => <ThreadMessage key={message.id || message.transactionId} message={message} own={isOwnMessage(message, currentUserID)} use24Hour={use24Hour} />)}
        </div>
        <form className="thread-panel-composer" onSubmit={(event) => void send(event)}>
          <textarea ref={composerRef} aria-label="Reply in thread" placeholder="Reply in thread" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} />
          <button className="is-primary" type="submit" aria-label="Send thread reply" title="Send thread reply" disabled={sending || !draft.trim()}><Send size={15} /></button>
        </form>
        {sendError && <p className="message-error thread-panel-error" role="alert">Could not send reply: {sendError}</p>}
      </DialogSurface>
    </div>
  )
}
