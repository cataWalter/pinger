import { Events } from '@wailsio/runtime'
import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowDown, CircleAlert, Copy, Download, FileText, ImagePlus, Paperclip, Pencil, Plus, RotateCcw, RotateCw, Send, Sparkles, Square, X } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import type { LocalAIChatAttachment, LocalAIChatMessage, LocalAIChatSummary } from '../bindings/mychat/desktop/models.js'
import { MAX_AGENT_INSTRUCTIONS_LENGTH, MAX_AGENT_NAME_LENGTH, MAX_CHAT_AGENTS, chatAgentDraftError, newChatAgentID, type ChatAgentProfile } from './aiPrompts'
import {
  LOCAL_AI_ATTACHMENT_ACCEPT,
  LOCAL_AI_ATTACHMENT_LIMIT,
  LOCAL_AI_HISTORY_TURN_LIMIT,
  LOCAL_AI_IMAGE_LIMIT,
  LOCAL_AI_MESSAGE_CHARACTERS,
  LOCAL_AI_STARTER_PROMPTS,
  buildLocalAIModelMessages,
  exportLocalAIChat,
  isLocalAIImageTurn,
  localAIErrorMessage,
  localAIMessageLength,
  newLocalAIMessage,
  readLocalAIAttachment,
  type LocalAIChatKind,
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

type LocalAIImageRun = {
  chatId: string
  requestId: string
  stage: string
  step: number
  totalSteps: number
  preview: string
  stopping: boolean
}

type LocalAIImageProgress = {
  requestId: string
  stage: string
  step: number
  totalSteps: number
  preview?: string
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

type LocalAIAgentDraft = {
  name: string
  instructions: string
}

export type LocalAIChatProps = {
  chatId: string | null
  chatTitle: string
  agentId: string
  agents: ChatAgentProfile[]
  hidden: boolean
  initialDraft?: string
  initialDraftVersion?: number
  onAgentChange: (agentId: string) => void
  onCreateAgent: (agent: ChatAgentProfile) => Promise<boolean>
  onChatCreated: (chat: LocalAIChatSummary) => void
  onChatsChanged: () => void
  newChatKind?: LocalAIChatKind
}

function createLocalAIRequestID() {
  return globalThis.crypto?.randomUUID?.() ?? `local-ai-${Date.now()}-${Math.random()}`
}

function localAIImageURL(attachment: LocalAIChatAttachment) {
  return `data:${attachment.mediaType ?? ''};base64,${attachment.data ?? ''}`
}

// Clipboard screenshots often arrive without a usable file name.
function namePastedImage(file: File, index: number) {
  if (file.name.trim()) return file
  const extension = file.type.split('/')[1] || 'png'
  return new File([file], `pasted-image-${Date.now()}-${index + 1}.${extension}`, { type: file.type })
}

// User turns that asked for an image. Editing one would send its prompt to the text model, so Edit is hidden for them.
function localAIImagePromptSeqs(messages: LocalAIChatMessage[]) {
  const seqs = new Set<number>()
  messages.forEach((message, index) => {
    const next = messages[index + 1]
    if (message.role === 'user' && next && isLocalAIImageTurn(next)) seqs.add(message.seq)
  })
  return seqs
}

function imageRunStatus(run: LocalAIImageRun) {
  if (run.stopping) return 'Stopping…'
  if (run.stage === 'starting') return 'Starting the image engine…'
  if (run.totalSteps > 0) return `Generating image, step ${run.step} of ${run.totalSteps}`
  return 'Generating image…'
}

type LocalAIMessageViewProps = {
  message: LocalAIChatMessage
  idle: boolean
  imagePrompt: boolean
  editContent: string | null
  onStartEdit: () => void
  onEditChange: (content: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onCopy: () => void
  onRegenerate: () => void
}

function LocalAIMessageView({ message, idle, imagePrompt, editContent, onStartEdit, onEditChange, onCancelEdit, onSaveEdit, onCopy, onRegenerate }: LocalAIMessageViewProps) {
  const isUser = message.role === 'user'
  const imageTurn = isLocalAIImageTurn(message)
  const attachments = message.attachments ?? []
  if (editContent !== null) {
    return (
      <article className="local-ai-message is-user is-editing">
        <span className="local-ai-message-label">You</span>
        <textarea className="local-ai-edit-input" aria-label="Edit message" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={editContent} onChange={(event) => onEditChange(event.currentTarget.value)} rows={3} />
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
            attachment.kind === 'image' && attachment.data ? (
              <li key={`${attachment.name}:${index}`} className="is-image"><img className="local-ai-message-image" src={localAIImageURL(attachment)} alt={attachment.name} /></li>
            ) : (
              <li key={`${attachment.name}:${index}`}><FileText size={12} /><span>{attachment.name}</span></li>
            )
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
        {message.content && <button className="icon-button" type="button" aria-label="Copy message" title="Copy" onClick={onCopy}><Copy size={13} /></button>}
        {idle && !isUser && !imageTurn && <button className="icon-button" type="button" aria-label="Regenerate response" title="Regenerate" onClick={onRegenerate}><RotateCw size={13} /></button>}
        {idle && isUser && !imagePrompt && <button className="icon-button" type="button" aria-label="Edit message" title="Edit" onClick={onStartEdit}><Pencil size={13} /></button>}
      </div>
    </article>
  )
}

export default function LocalAIChat({ chatId, chatTitle, agentId, agents, hidden, initialDraft = '', initialDraftVersion = 0, onAgentChange, onCreateAgent, onChatCreated, onChatsChanged, newChatKind = 'chat' }: LocalAIChatProps) {
  const [messages, setMessages] = useState<LocalAIChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<LocalAIChatAttachment[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [runView, setRunView] = useState<LocalAIRun | null>(null)
  const [failure, setFailure] = useState<LocalAIFailure | null>(null)
  const [edit, setEdit] = useState<LocalAIEdit | null>(null)
  const [composerError, setComposerError] = useState('')
  const [agentDraft, setAgentDraft] = useState<LocalAIAgentDraft | null>(null)
  const [agentError, setAgentError] = useState('')
  const [savingAgent, setSavingAgent] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const [imageRun, setImageRun] = useState<LocalAIImageRun | null>(null)
  const chatIdRef = useRef<string | null>(chatId)
  const loadedChatIdRef = useRef<string | null>(null)
  const runRef = useRef<LocalAIRun | null>(null)
  const imageRunRef = useRef<LocalAIImageRun | null>(null)
  const shouldFollowRef = useRef(true)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const busy = submitting || loading || runView !== null || imageRun !== null
  const runHere = runView !== null && runView.chatId === chatId
  const runElsewhere = runView !== null && !runHere
  const imageHere = imageRun !== null && imageRun.chatId === chatId
  const imageElsewhere = imageRun !== null && !imageHere
  const imagePromptSeqs = localAIImagePromptSeqs(messages)
  const canSend = !busy && (draft.trim() !== '' || attachments.length > 0)
  const trimmed = messages.length > LOCAL_AI_HISTORY_TURN_LIMIT

  useEffect(() => Events.On('local-ai:stream', (event: { data: unknown }) => {
    const chunk = event.data as LocalAIChatStreamChunk | undefined
    const run = runRef.current
    if (!run || !chunk || chunk.requestId !== run.requestId || !chunk.text) return
    run.text += chunk.text
    setRunView({ ...run })
  }), [])

  useEffect(() => Events.On('local-ai:image-progress', (event: { data: unknown }) => {
    const update = event.data as LocalAIImageProgress | undefined
    const run = imageRunRef.current
    if (!run || !update || update.requestId !== run.requestId) return
    run.stage = update.stage
    run.step = update.step
    run.totalSteps = update.totalSteps
    if (update.preview) run.preview = update.preview
    setImageRun({ ...run })
  }), [])

  useEffect(() => {
    setDraft(initialDraft)
    setAttachments([])
    setComposerError('')
  }, [initialDraft, initialDraftVersion])

  useEffect(() => {
    const textarea = composerRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft])

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

  // Runs after each complete reply. The server replaces only a title that still comes from the first user turn.
  function generateTitle(titleChatID: string) {
    void AppService.GenerateLocalAIChatTitle(titleChatID).then(() => onChatsChanged()).catch(() => undefined)
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
      generateTitle(runChatID)
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

  function stopImage() {
    const run = imageRunRef.current
    if (!run || run.stopping) return
    run.stopping = true
    setImageRun({ ...run })
    void AppService.AICancel(run.requestId).catch(() => undefined)
  }

  // Creates the chat for the first message. The new chat is reported through onChatCreated.
  async function ensureChatID() {
    const existing = chatIdRef.current
    if (existing) return existing
    const chat = await AppService.CreateLocalAIChat(agentId, newChatKind)
    chatIdRef.current = chat.id
    loadedChatIdRef.current = chat.id
    setMessages([])
    onChatCreated(chat)
    return chat.id
  }

  // Runs only from the image button. The draft is the prompt, and pending attachments stay for the next message.
  // A stopped or failed run restores the draft, because nothing was saved.
  async function generateImage() {
    const prompt = draft.trim()
    if (busy || prompt === '') return
    if (Array.from(prompt).length > LOCAL_AI_MESSAGE_CHARACTERS) {
      setComposerError(`Keep each message under ${LOCAL_AI_MESSAGE_CHARACTERS.toLocaleString()} characters.`)
      return
    }
    shouldFollowRef.current = true
    setComposerError('')
    setFailure(null)
    setDraft('')
    setSubmitting(true)
    let run: LocalAIImageRun | null = null
    try {
      const chatID = await ensureChatID()
      run = { chatId: chatID, requestId: createLocalAIRequestID(), stage: 'starting', step: 0, totalSteps: 0, preview: '', stopping: false }
      imageRunRef.current = run
      setImageRun({ ...run })
      const saved = await AppService.LocalAIChatGenerateImage(chatID, prompt, run.requestId)
      if (chatIdRef.current === chatID) {
        setMessages((current) => [...current, ...(saved ?? []).filter((item) => !current.some((existing) => existing.seq === item.seq))])
      }
    } catch (imageError) {
      setDraft((current) => (current === '' ? prompt : current))
      setComposerError(run?.stopping ? 'Image generation stopped.' : localAIErrorMessage(imageError, 'The image could not be generated.'))
    } finally {
      if (run && imageRunRef.current === run) imageRunRef.current = null
      setImageRun(null)
      setSubmitting(false)
      onChatsChanged()
    }
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
      const activeChatID = await ensureChatID()
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

  async function saveNewAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!agentDraft || savingAgent) return
    const name = agentDraft.name.trim()
    const instructions = agentDraft.instructions.trim()
    const problem = chatAgentDraftError(name, instructions)
    if (problem) {
      setAgentError(problem)
      return
    }
    if (agents.length >= MAX_CHAT_AGENTS) {
      setAgentError(`Keep up to ${MAX_CHAT_AGENTS} agents.`)
      return
    }
    const agent: ChatAgentProfile = { id: newChatAgentID(), name, instructions }
    setAgentError('')
    setSavingAgent(true)
    try {
      if (!(await onCreateAgent(agent))) {
        setAgentError('The agent could not be saved.')
        return
      }
      setAgentDraft(null)
      await changeAgent(agent.id)
    } catch (createError) {
      setAgentError(localAIErrorMessage(createError, 'The agent could not be saved.'))
    } finally {
      setSavingAgent(false)
    }
  }

  // Images paste as attachments. Text pastes fall through to the textarea unchanged.
  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (images.length === 0) return
    event.preventDefault()
    void attachFiles(images.map(namePastedImage))
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
        <button
          className="local-ai-new-agent"
          type="button"
          aria-label="New agent"
          title="Create an agent for chats"
          aria-expanded={agentDraft !== null}
          onClick={() => {
            setAgentError('')
            setAgentDraft(agentDraft ? null : { name: '', instructions: '' })
          }}
          disabled={busy || agents.length >= MAX_CHAT_AGENTS}
        >
          <Plus size={13} />
          <span>New agent</span>
        </button>
        <button className="icon-button" type="button" aria-label="Export local AI chat" title="Export chat" onClick={() => void exportCurrentChat()} disabled={messages.length === 0 || loading}>
          <Download size={15} />
        </button>
      </div>
      {agentDraft && (
        <form className="ai-settings-form local-ai-agent-create" aria-label="Create agent" onSubmit={(event) => void saveNewAgent(event)}>
          <label>
            <span>Name</span>
            <input
              aria-label="Agent name"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={agentDraft.name}
              maxLength={MAX_AGENT_NAME_LENGTH}
              autoFocus
              onChange={(event) => setAgentDraft({ ...agentDraft, name: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>Instructions</span>
            <textarea
              aria-label="Agent instructions"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={agentDraft.instructions}
              maxLength={MAX_AGENT_INSTRUCTIONS_LENGTH}
              rows={3}
              onChange={(event) => setAgentDraft({ ...agentDraft, instructions: event.currentTarget.value })}
            />
          </label>
          {agentError && <p className="local-ai-composer-error" role="alert">{agentError}</p>}
          <div className="ai-settings-actions">
            <button className="settings-command" type="button" onClick={() => setAgentDraft(null)}>Cancel</button>
            <button className="settings-command" type="submit" disabled={busy || savingAgent || agentDraft.name.trim() === '' || agentDraft.instructions.trim() === ''}>Save agent</button>
          </div>
        </form>
      )}
      <div className="local-ai-transcript" ref={transcriptRef} onScroll={handleTranscriptScroll} role="log" aria-label="Local AI conversation" aria-live="polite" aria-busy={runHere || imageHere}>
        {trimmed && <p className="local-ai-notice">Only the latest {LOCAL_AI_HISTORY_TURN_LIMIT} messages are sent to the model.</p>}
        {loading && messages.length === 0 && <p className="local-ai-status" role="status">Loading chat…</p>}
        {!loading && messages.length === 0 && !runHere && !imageHere && (
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
            imagePrompt={imagePromptSeqs.has(message.seq)}
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
        {imageHere && imageRun && (
          <article className="local-ai-message is-assistant local-ai-image-run">
            <span className="local-ai-message-label">Local AI</span>
            <p className="local-ai-status" role="status">{imageRunStatus(imageRun)}</p>
            {imageRun.totalSteps > 0 && <progress className="local-ai-image-progress" value={imageRun.step} max={imageRun.totalSteps} aria-label="Image generation progress" />}
            {imageRun.preview && <img className="local-ai-image-preview" src={`data:image/png;base64,${imageRun.preview}`} alt="Image generation preview" />}
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
        {composerError && <p className="local-ai-composer-error" role="alert">{composerError}</p>}
        {runElsewhere && <p className="local-ai-notice" role="status">Local AI is replying in another chat.</p>}
        {imageElsewhere && <p className="local-ai-notice" role="status">Image generation is running in another chat.</p>}
        <div className="local-ai-composer-row">
          {attachments.length > 0 && (
            <ul className="local-ai-attachment-list is-pending" aria-label="Pending attachments">
              {attachments.map((attachment, index) => (
                <li key={`${attachment.name}:${index}`}>
                  {attachment.kind === 'image' && attachment.data ? (
                    <img className="local-ai-attachment-thumb" src={localAIImageURL(attachment)} alt="" />
                  ) : (
                    <FileText size={12} />
                  )}
                  <span>{attachment.name}</span>
                  <button className="icon-button" type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(index)} disabled={busy}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={handleComposerKeyDown}
            onPaste={handleComposerPaste}
            placeholder="Message your local model"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Message local AI"
            rows={1}
            disabled={busy}
          />
          <div className="local-ai-composer-footer">
            <div className="local-ai-composer-tools">
              <button className="icon-button" type="button" aria-label="Attach files" title="Attach images or text files" onClick={() => fileInputRef.current?.click()} disabled={busy || attachments.length >= LOCAL_AI_ATTACHMENT_LIMIT}>
                <Paperclip size={16} />
              </button>
              <input ref={fileInputRef} type="file" multiple accept={LOCAL_AI_ATTACHMENT_ACCEPT} hidden onChange={handleFileInput} />
              <button className="icon-button" type="button" aria-label="Generate image" title="Generate an image from the message text" onClick={() => void generateImage()} disabled={busy || draft.trim() === ''}>
                <ImagePlus size={16} />
              </button>
            </div>
            {runHere || imageHere ? (
              <button className="local-ai-stop" type="button" aria-label="Stop generating" title="Stop generating" onClick={runHere ? stopRun : stopImage} disabled={runHere ? (runView?.stopping ?? false) : (imageRun?.stopping ?? false)}>
                <Square size={13} />
              </button>
            ) : (
              <button className="send-button" type="submit" aria-label="Send to local AI" disabled={!canSend}>
                <Send size={17} />
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  )
}