import { Events } from '@wailsio/runtime'
import { lazy, Suspense, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useEffect } from 'react'
import { RotateCcw, Send, Sparkles, Trash2 } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import type { AIMessage } from '../bindings/mychat/desktop/models.js'

const LOCAL_CHAT_HISTORY_LIMIT = 20
const MarkdownMessage = lazy(() => import('./MarkdownMessage'))

type LocalAIChatStreamChunk = {
  requestId: string
  text: string
}

function createLocalAIChatRequestID() {
  return globalThis.crypto?.randomUUID?.() ?? `local-ai-${Date.now()}-${Math.random()}`
}

export default function LocalAIChat() {
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const shouldFollowTranscriptRef = useRef(true)
  const streamRequestRef = useRef('')
  const streamConversationRef = useRef<AIMessage[]>([])
  const streamedTextRef = useRef('')
  const retryConversationRef = useRef<AIMessage[] | null>(null)

  useEffect(() => Events.On('local-ai:stream', (event: { data: unknown }) => {
    const chunk = event.data as LocalAIChatStreamChunk | undefined
    if (!chunk || chunk.requestId !== streamRequestRef.current || !chunk.text) return
    streamedTextRef.current += chunk.text
    setMessages([...streamConversationRef.current, { role: 'assistant', content: streamedTextRef.current }].slice(-LOCAL_CHAT_HISTORY_LIMIT))
  }), [])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript && shouldFollowTranscriptRef.current) transcript.scrollTop = transcript.scrollHeight
  }, [messages])

  async function completeConversation(conversation: AIMessage[]) {
    const requestID = createLocalAIChatRequestID()
    streamRequestRef.current = requestID
    streamConversationRef.current = conversation
    streamedTextRef.current = ''
    retryConversationRef.current = conversation
    shouldFollowTranscriptRef.current = true
    setBusy(true)
    setError('')
    setMessages(conversation)
    try {
      const reply = await AppService.LocalAIChat(conversation, requestID)
      if (streamRequestRef.current !== requestID) return
      setMessages([...conversation, { role: 'assistant', content: reply }].slice(-LOCAL_CHAT_HISTORY_LIMIT))
      retryConversationRef.current = null
    } catch (requestError) {
      if (streamRequestRef.current === requestID) {
        setError(requestError instanceof Error ? requestError.message : 'The local model could not complete this message.')
      }
    } finally {
      if (streamRequestRef.current === requestID) {
        streamRequestRef.current = ''
        setBusy(false)
      }
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || busy) return
    const retainedMessages = messages.slice(-(LOCAL_CHAT_HISTORY_LIMIT - 2))
    if (retainedMessages[0]?.role === 'assistant') retainedMessages.shift()
    const conversation = [...retainedMessages, { role: 'user', content }]
    shouldFollowTranscriptRef.current = true
    setMessages(conversation)
    setDraft('')
    void completeConversation(conversation)
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  function handleTranscriptScroll() {
    const transcript = transcriptRef.current
    if (!transcript) return
    shouldFollowTranscriptRef.current = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48
  }

  return (
    <section className="local-ai-chat" aria-label="Local AI chat">
      {messages.length > 0 && <div className="local-ai-chat-toolbar">
        <button className="icon-button" type="button" aria-label="Clear local AI conversation" title="New conversation" onClick={() => { setMessages([]); setError(''); retryConversationRef.current = null }} disabled={busy}>
          <Trash2 size={15} />
        </button>
      </div>}
      <div className="local-ai-transcript" ref={transcriptRef} onScroll={handleTranscriptScroll} role="log" aria-label="Local AI conversation" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && <div className="local-ai-empty"><Sparkles size={24} /><p>Start a conversation</p></div>}
        {messages.map((message, index) => (
          <article className={`local-ai-message is-${message.role}`} key={`${index}:${message.role}`}>
            <span className="local-ai-message-label">{message.role === 'user' ? 'You' : 'Local AI'}</span>
            {message.role === 'assistant' ? (
              <Suspense fallback={<div className="message-body markdown-message">{message.content}</div>}>
                <MarkdownMessage body={message.content} />
              </Suspense>
            ) : message.content}
          </article>
        ))}
        {busy && !streamedTextRef.current && <p className="local-ai-empty" role="status">Waiting for the local model…</p>}
        {error && <div className="local-ai-error" role="alert"><p>{error}</p><button className="local-ai-retry" type="button" onClick={() => void completeConversation(retryConversationRef.current ?? messages)} disabled={busy}><RotateCcw size={14} />Retry</button></div>}
      </div>
      <form className="local-ai-composer" ref={formRef} onSubmit={submitMessage}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="Message your local model"
          aria-label="Message local AI"
          rows={2}
          disabled={busy}
        />
        <button className="send-button" type="submit" aria-label="Send to local AI" disabled={!draft.trim() || busy}>
          <Send size={17} />
        </button>
      </form>
    </section>
  )
}