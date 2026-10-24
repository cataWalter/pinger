import { Events } from '@wailsio/runtime'
import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowDown, CircleAlert, Copy, Download, FileText, Paperclip, Pencil, RotateCcw, RotateCw, Send, Sparkles, Square, X } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import type { LocalAIChatAttachment, LocalAIChatMessage, LocalAIChatSummary } from '../bindings/mychat/desktop/models.js'
import type { ChatAgentProfile } from './aiPrompts'
import {
  LOCAL_AI_ATTACHMENT_ACCEPT,
  LOCAL_AI_ATTACHMENT_LIMIT,
  LOCAL_AI_HISTORY_TURN_LIMIT,
  LOCAL_AI_IMAGE_LIMIT,
  LOCAL_AI_MESSAGE_CHARACTERS,
  LOCAL_AI_STARTER_PROMPTS,
  buildLocalAIModelMessages,
  exportLocalAIChat,
  localAIErrorMessage,
  localAIMessageLength,
  newLocalAIMessage,
  readLocalAIAttachment,
} from './localAIChats'

const MarkdownMessage = lazy(() => import('./MarkdownMessage'))

type LocalAIChatStreamChunk = {
  requestId: string
  text: string
}

type LocalAIRun = {
  chatId: string
  requestId: string
  text: string
  stopping: boolean
}

type LocalAIFailure = {
  chatId: string
  message: string
  history: LocalAIChatMessage[]
  agentId: string
}

type LocalAIEdit = {
  seq: number
  content: string
}

export type LocalAIChatProps = {
  chatId: string | null
  chatTitle: string
  agentId: string
  agents: ChatAgentProfile[]
  hidden: boolean
  onAgentChange: (agentId: string) => void
  onChatCreated: (chat: LocalAIChatSummary) => void
  onChatsChanged: () => void
}

function createLocalAIRequestID() {
  return globalThis.crypto?.randomUUID?.() ?? `local-ai-${Date.now()}-${Math.random()}`
}

type LocalAIMessageViewProps = {
  message: LocalAIChatMessage
  idle: boolean
  editContent: string | null
  onStartEdit: () => void
  onEditChange: (content: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onCopy: () => void
  onRegenerate: () => void
}

function LocalAIMessageView({ message, idle, editContent, onStartEdit, onEditChange, onCancelEdit, onSaveEdit, onCopy, onRegenerate }: LocalAIMessageViewProps) {
  const isUser = message.role === 'user'
  const attachments = message.attachments ?? []
  if (editContent !== null) {
    return (
      <article className="local-ai-message is-user is-editing">
        <span className="local-ai-message-label">You</span>
        <textarea className="local-ai-edit-input" aria-label="Edit message" value={editContent} onChange={(event) => onEditChange(event.currentTarget.value)} rows={3} />
        <div className="local-ai-edit-actions">
          <button type="button" onClick={onCancelEdit}>Cancel</button>
          <button type="button" onClick={onSaveEdit} disabled={editContent.trim() === '' && attachments.length === 0}>Save and send</button>
        </div>
      </article>
    )
  }
  return (
    <article className={`local-ai-message is-${message.role}`}>
      <span className="local-ai-message-label">
        {isUser ? 'You' : 'Local AI'}
        {message.status === 'stopped' && ' · Stopped'}
      </span>
      {attachments.length > 0 && (
        <ul className="local-ai-attachment-list" aria-label="Attachments">
          {attachments.map((attachment, index) => (
            <li key={`${attachment.name}:${index}`}><FileText size={12} /><span>{attachment.name}</span></li>
          ))}
        </ul>
      )}
      {message.content && (isUser ? (
        <div className="local-ai-user-text">{message.content}</div>
      ) : (
        <Suspense fallback={<div className="message-body markdown-message">{message.content}</div>}>
          <MarkdownMessage body={message.content} />
        </Suspense>
      ))}
      <div className="local-ai-message-actions">
        <button className="icon-button" type="button" aria-label="Copy message" title="Copy" onClick={onCopy}><Copy size={13} /></button>
        {idle && !isUser && <button className="icon-button" type="button" aria-label="Regenerate response" title="Regenerate" onClick={onRegenerate}><RotateCw size={13} /></button>}
        {idle && isUser && <button className="icon-button" type="button" aria-label="Edit message" title="Edit" onClick={onStartEdit}><Pencil size={13} /></button>}
      </div>
    </article>
  )
}

export default function LocalAIChat({ chatId, chatTitle, agentId, agents, hidden, onAgentChange, onChatCreated, onChatsChanged }: LocalAIChatProps) {
  const [messages, setMessages] = useState<LocalAIChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<LocalAIChatAttachment[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [runView, setRunView] = useState<LocalAIRun | null>(null)
  const [failure, setFailure] = useState<LocalAIFailure | null>(null)
  const [edit, setEdit] = useState<LocalAIEdit | null>(null)
  const [composerError, setComposerError] = useState('')
  const [showJump, setShowJump] = useState(false)
  const chatIdRef = useRef<string | null>(chatId)
  const loadedChatIdRef = useRef<string | null>(null)
  const runRef = useRef<LocalAIRun | null>(null)
  const shouldFollowRef = useRef(true)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const busy = submitting || loading || runView !== null
  const runHere = runView !== null && runView.chatId === chatId
  const runElsewhere = runView !== null && !runHere
  const canSend = !busy && (draft.trim() !== '' || attachments.length > 0)
  const trimmed = messages.length > LOCAL_AI_HISTORY_TURN_LIMIT

  useEffect(() => Events.On('local-ai:stream', (event: { data: unknown }) => {
    const chunk = event.data as LocalAIChatStreamChunk | undefined
    const run = runRef.current
    if (!run || !chunk || chunk.requestId !== run.requestId || !chunk.text) return
    run.text += chunk.text
    setRunView({ ...run })
  }), [])

  useEffect(() => {
    chatIdRef.current = chatId
    if (chatId === loadedChatIdRef.current) return undefined
    loadedChatIdRef.current = chatId
    shouldFollowRef.current = true
    setEdit(null)
    setComposerError('')
    setMessages([])
    if (!chatId) {
      setLoading(false)
      return undefined
    }
    let active = true
    setLoading(true)
    AppService.LoadLocalAIChatMessages(chatId)
      .then((list) => {
        if (active) setMessages(list ?? [])
      })
      .catch((loadError: unknown) => {
        if (active) setComposerError(localAIErrorMessage(loadError, 'The chat could not be opened.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [chatId])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript && shouldFollowRef.current) transcript.scrollTop = transcript.scrollHeight
  }, [messages, runView])

  function handleTranscriptScroll() {
    const transcript = transcriptRef.current
    if (!transcript) return
    const atLatest = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48
    shouldFollowRef.current = atLatest
    setShowJump(!atLatest)
  }

  function jumpToLatest() {
    const transcript = transcriptRef.current
    shouldFollowRef.current = true
    setShowJump(false)
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }

  async function saveAssistantTurn(chatID: string, content: string, status: string) {
    const saved = await AppService.AppendLocalAIChatMessage(chatID, newLocalAIMessage('assistant', content, status, []))
    if (chatIdRef.current === chatID) setMessages((current) => (current.some((item) => item.seq === saved.seq) ? current : [...current, saved]))
  }

  async function runModel(runChatID: string, history: LocalAIChatMessage[], runAgentID: string) {
    const run: LocalAIRun = { chatId: runChatID, requestId: createLocalAIRequestID(), text: '', stopping: false }
    const agentInstructions = agents.find((agent) => agent.id === runAgentID)?.instructions ?? ''
    runRef.current = run
    shouldFollowRef.current = true
    setShowJump(false)
    setFailure(null)
    setRunView({ ...run })
    try {
      const reply = await AppService.LocalAIChat({ messages: buildLocalAIModelMessages(history), requestId: run.requestId, agentInstructions })
      if (!reply.trim()) throw new Error('The local model returned an empty reply.')
      await saveAssistantTurn(runChatID, reply, 'complete')
    } catch (runError) {
      if (!run.stopping) {
        setFailure({ chatId: runChatID, message: localAIErrorMessage(runError, 'The local model could not complete this message.'), history, agentId: runAgentID })
      } else if (run.text.trim()) {
        await saveAssistantTurn(runChatID, run.text, 'stopped').catch((saveError: unknown) => {
          setFailure({ chatId: runChatID, message: localAIErrorMessage(saveError, 'The partial reply could not be saved.'), history, agentId: runAgentID })
        })
      } else {
        setFailure({ chatId: runChatID, message: 'Generation stopped before a reply arrived.', history, agentId: runAgentID })
      }
    } finally {
      if (runRef.current === run) runRef.current = null
      setRunView(null)
      onChatsChanged()
    }
  }

  function stopRun() {
    const run = runRef.current
    if (!run || run.stopping) return
    run.stopping = true
    setRunView({ ...run })
    void AppService.AICancel(run.requestId).catch(() => undefined)
  }

  function retryRun() {
    if (!failure || busy || failure.chatId !== chatId) return
    void runModel(failure.chatId, failure.history, failure.agentId)
  }

  async function sendMessage() {
    const content = draft.trim()
    if (busy || (content === '' && attachments.length === 0)) return
    if (localAIMessageLength(content, attachments) > LOCAL_AI_MESSAGE_CHARACTERS) {
      setComposerError(`Keep each message and its attached text under ${LOCAL_AI_MESSAGE_CHARACTERS.toLocaleString()} characters.`)
      return
    }
    const pending = attachments
    shouldFollowRef.current = true
    setComposerError('')
    setFailure(null)
    setDraft('')
    setAttachments([])
    setSubmitting(true)
    try {
      let activeChatID = chatIdRef.current
      if (!activeChatID) {
        const chat = await AppService.CreateLocalAIChat(agentId)
        activeChatID = chat.id
        chatIdRef.current = chat.id
        loadedChatIdRef.current = chat.id
        setMessages([])
        onChatCreated(chat)
      }
      const userTurn = await AppService.AppendLocalAIChatMessage(activeChatID, newLocalAIMessage('user', content, 'complete', pending))
      const history = [...messages, userTurn]
      setMessages(history)
      onChatsChanged()
      void runModel(activeChatID, history, agentId)
    } catch (sendError) {
      setDraft((current) => (current === '' ? content : current))
      setAttachments((current) => (current.length === 0 ? pending : current))
      setComposerError(localAIErrorMessage(sendError, 'The message could not be saved.'))
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage()
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void sendMessage()
    }
  }

  function insertStarter(prompt: string) {
    setDraft((current) => (current.trim() ? `${current}\n\n${prompt}` : prompt))
    composerRef.current?.focus()
  }

  function copyMessage(content: string) {
    if (!navigator.clipboard?.writeText) {
      setComposerError('Clipboard access is unavailable.')
      return
    }
    navigator.clipboard.writeText(content).catch(() => setComposerError('Clipboard access is unavailable.'))
  }

  async function attachFiles(files: File[]) {
    const next: LocalAIChatAttachment[] = []
    let problem = ''
    for (const file of files) {
      if (attachments.length + next.length >= LOCAL_AI_ATTACHMENT_LIMIT) {
        problem = `Attach up to ${LOCAL_AI_ATTACHMENT_LIMIT} files per message.`
        break
      }
      try {
        const attachment = await readLocalAIAttachment(file)
        const images = [...attachments, ...next].filter((item) => item.kind === 'image').length
        if (attachment.kind === 'image' && images >= LOCAL_AI_IMAGE_LIMIT) {
          problem = `Attach up to ${LOCAL_AI_IMAGE_LIMIT} images per message.`
          break
        }
        next.push(attachment)
      } catch (readError) {
        problem = localAIErrorMessage(readError, `${file.name} could not be attached.`)
        break
      }
    }
    if (next.length > 0) setAttachments((current) => [...current, ...next])
    setComposerError(problem)
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const picked: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : []
    event.currentTarget.value = ''
    if (picked.length > 0) void attachFiles(picked)
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, position) => position !== index))
  }

  async function changeAgent(nextAgentID: string) {
    onAgentChange(nextAgentID)
    const currentChatID = chatIdRef.current
    if (!currentChatID) return
    try {
      await AppService.SetLocalAIChatAgent(currentChatID, nextAgentID)
      onChatsChanged()
    } catch (agentError) {
      setComposerError(localAIErrorMessage(agentError, 'The agent could not be changed.'))
    }
  }

  async function regenerate(message: LocalAIChatMessage) {
    const currentChatID = chatIdRef.current
    const index = messages.findIndex((item) => item.seq === message.seq)
    const history = index > 0 ? messages.slice(0, index) : []
    if (busy || !currentChatID || history[history.length - 1]?.role !== 'user') return
    shouldFollowRef.current = true
    setComposerError('')
    setSubmitting(true)
    try {
      await AppService.TruncateLocalAIChat(currentChatID, message.seq)
      setMessages(history)
      onChatsChanged()
      void runModel(currentChatID, history, agentId)
    } catch (regenerateError) {
      setComposerError(localAIErrorMessage(regenerateError, 'The response could not be regenerated.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function saveEdit() {
    const currentChatID = chatIdRef.current
    const target = edit ? messages.find((item) => item.seq === edit.seq) : undefined
    if (busy || !edit || !target || !currentChatID) return
    const content = edit.content.trim()
    const pending = target.attachments ?? []
    if (content === '' && pending.length === 0) return
    if (localAIMessageLength(content, pending) > LOCAL_AI_MESSAGE_CHARACTERS) {
      setComposerError(`Keep each message and its attached text under ${LOCAL_AI_MESSAGE_CHARACTERS.toLocaleString()} characters.`)
      return
    }
    const history = messages.slice(0, messages.indexOf(target))
    shouldFollowRef.current = true
    setEdit(null)
    setComposerError('')
    setSubmitting(true)
    try {
      await AppService.TruncateLocalAIChat(currentChatID, target.seq)
      setMessages(history)
      const userTurn = await AppService.AppendLocalAIChatMessage(currentChatID, newLocalAIMessage('user', content, 'complete', pending))
      const next = [...history, userTurn]
      setMessages(next)
      onChatsChanged()
      void runModel(currentChatID, next, agentId)
    } catch (editError) {
      setComposerError(localAIErrorMessage(editError, 'The edited message could not be sent.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function exportCurrentChat() {
    setComposerError('')
    try {
      await exportLocalAIChat(chatTitle, messages)
    } catch (exportError) {
      setComposerError(localAIErrorMessage(exportError, 'The chat could not be exported.'))
    }
  }

  return (
    <section className="local-ai-chat" aria-label="Local AI chat" hidden={hidden}>
      <div className="local-ai-chat-toolbar">
        {agents.length > 0 && (
          <label className="local-ai-agent-picker">
            <span>Agent</span>
            <select value={agentId} onChange={(event) => void changeAgent(event.currentTarget.value)} disabled={busy} aria-label="Agent for this chat">
              <option value="">No agent</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
        )}
        <button className="icon-button" type="button" aria-label="Export local AI chat" title="Export chat" onClick={() => void exportCurrentChat()} disabled={messages.length === 0 || loading}>
          <Download size={15} />
        </button>
      </div>
      <div className="local-ai-transcript" ref={transcriptRef} onScroll={handleTranscriptScroll} role="log" aria-label="Local AI conversation" aria-live="polite" aria-busy={runHere}>
        {trimmed && <p className="local-ai-notice">Only the latest {LOCAL_AI_HISTORY_TURN_LIMIT} messages are sent to the model.</p>}
        {loading && messages.length === 0 && <p className="local-ai-status" role="status">Loading chat…</p>}
        {!loading && messages.length === 0 && !runHere && (
          <div className="local-ai-empty">
            <Sparkles size={24} />
            <p>Start a conversation</p>
            <div className="local-ai-starters">
              {LOCAL_AI_STARTER_PROMPTS.map((starter) => (
                <button key={starter.label} type="button" onClick={() => insertStarter(starter.prompt)}>{starter.label}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <LocalAIMessageView
            key={message.seq}
            message={message}
            idle={!busy}
            editContent={edit && edit.seq === message.seq ? edit.content : null}
            onStartEdit={() => setEdit({ seq: message.seq, content: message.content })}
            onEditChange={(content) => setEdit((current) => (current ? { ...current, content } : current))}
            onCancelEdit={() => setEdit(null)}
            onSaveEdit={() => void saveEdit()}
            onCopy={() => copyMessage(message.content)}
            onRegenerate={() => void regenerate(message)}
          />
        ))}
        {runHere && runView && (
          <article className="local-ai-message is-assistant">
            <span className="local-ai-message-label">Local AI</span>
            {runView.text ? (
              <Suspense fallback={<div className="message-body markdown-message">{runView.text}</div>}>
                <MarkdownMessage body={runView.text} />
              </Suspense>
            ) : (
              <p className="local-ai-status" role="status">{runView.stopping ? 'Stopping…' : 'Waiting for the local model…'}</p>
            )}
          </article>
        )}
        {failure && failure.chatId === chatId && (
          <div className="local-ai-error" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <div className="local-ai-error-body">
              <p className="local-ai-error-title">Local AI could not reply</p>
              <p className="local-ai-error-message">{failure.message}</p>
            </div>
            <button className="local-ai-retry" type="button" onClick={retryRun} disabled={busy}><RotateCcw size={14} />Retry</button>
          </div>
        )}
      </div>
      {showJump && <button className="local-ai-jump" type="button" aria-label="Scroll to latest message" onClick={jumpToLatest}><ArrowDown size={14} />Latest</button>}
      <form className="local-ai-composer" onSubmit={handleSubmit}>
        {attachments.length > 0 && (
          <ul className="local-ai-attachment-list is-pending" aria-label="Pending attachments">
            {attachments.map((attachment, index) => (
              <li key={`${attachment.name}:${index}`}>
                <FileText size={12} />
                <span>{attachment.name}</span>
                <button className="icon-button" type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(index)} disabled={busy}><X size={12} /></button>
              </li>
            ))}
          </ul>
        )}
        {composerError && <p className="local-ai-composer-error" role="alert">{composerError}</p>}
        {runElsewhere && <p className="local-ai-notice" role="status">Local AI is replying in another chat.</p>}
        <div className="local-ai-composer-row">
          <button className="icon-button" type="button" aria-label="Attach files" title="Attach images or text files" onClick={() => fileInputRef.current?.click()} disabled={busy || attachments.length >= LOCAL_AI_ATTACHMENT_LIMIT}>
            <Paperclip size={16} />
          </button>
          <input ref={fileInputRef} type="file" multiple accept={LOCAL_AI_ATTACHMENT_ACCEPT} hidden onChange={handleFileInput} />
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message your local model"
            aria-label="Message local AI"
            rows={2}
            disabled={busy}
          />
          {runHere ? (
            <button className="local-ai-stop" type="button" aria-label="Stop generating" title="Stop generating" onClick={stopRun} disabled={runView?.stopping ?? false}>
              <Square size={13} />
            </button>
          ) : (
            <button className="send-button" type="submit" aria-label="Send to local AI" disabled={!canSend}>
              <Send size={17} />
            </button>
          )}
        </div>
      </form>
    </section>
  )
}