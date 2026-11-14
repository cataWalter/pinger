import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowDown } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import {
  LOCAL_AI_HISTORY_TURN_LIMIT,
  LOCAL_AI_MESSAGE_CHARACTERS,
  exportLocalAIChat,
  localAIErrorMessage,
  localAIMessageLength,
  newLocalAIMessage,
} from './localAIChats'
import { createLocalAIRequestID, localAIImagePromptSeqs } from './localAIChatUtils'
import type { LocalAIChatProps, LocalAIEdit, LocalAIFailure, LocalAIImageRun, LocalAIMessageActions, LocalAIRun } from './localAIChatTypes'
import { useLocalAIAgents } from './useLocalAIAgents'
import { useLocalAIChatLoader } from './useLocalAIChatLoader'
import { useLocalAIComposer } from './useLocalAIComposer'
import { useLocalAIEdits } from './useLocalAIEdits'
import { useLocalAIRuns } from './useLocalAIRuns'
import { useLocalAIScroll } from './useLocalAIScroll'
import { useLocalAIStreamEvents } from './useLocalAIStreamEvents'
import LocalAIAgentForm from './LocalAIAgentForm'
import LocalAIComposer from './LocalAIComposer'
import LocalAITranscript from './LocalAITranscript'
import LocalAIToolbar from './LocalAIToolbar'

export type { LocalAIChatProps } from './localAIChatTypes'

export default function LocalAIChat({ chatId, chatTitle, agentId, agents, hidden, initialDraft = '', initialDraftVersion = 0, onAgentChange, onCreateAgent, onChatCreated, onChatsChanged, newChatKind = 'chat' }: LocalAIChatProps) {
  const [submitting, setSubmitting] = useState(false)
  const [runView, setRunView] = useState<LocalAIRun | null>(null)
  const [failure, setFailure] = useState<LocalAIFailure | null>(null)
  const [edit, setEdit] = useState<LocalAIEdit | null>(null)
  const [imageRun, setImageRun] = useState<LocalAIImageRun | null>(null)
  const runRef = useRef<LocalAIRun | null>(null)
  const imageRunRef = useRef<LocalAIImageRun | null>(null)
  const shouldFollowRef = useRef(true)
  const messageActionsRef = useRef<LocalAIMessageActions>({
    startEdit: () => undefined,
    editChange: () => undefined,
    cancelEdit: () => undefined,
    saveEdit: () => undefined,
    copy: () => undefined,
    regenerate: () => undefined,
  })
  useLocalAIStreamEvents({ runRef, imageRunRef, setRunView, setImageRun })
  const {
    draft,
    setDraft,
    attachments,
    setAttachments,
    composerError,
    setComposerError,
    composerRef,
    fileInputRef,
    createdChatIdRef,
    composerTicket,
    restoreUnsentComposer,
    handleComposerPaste,
    handleFileInput,
    removeAttachment,
    insertStarter,
    copyMessage,
  } = useLocalAIComposer({ chatId, initialDraft, initialDraftVersion })
  const { messages, setMessages, loading, chatIdRef, loadedChatIdRef } = useLocalAIChatLoader({ chatId, setEdit, setComposerError, shouldFollowRef })
  const busy = submitting || loading || runView !== null || imageRun !== null
  const runHere = runView !== null && runView.chatId === chatId
  const runElsewhere = runView !== null && !runHere
  const imageHere = imageRun !== null && imageRun.chatId === chatId
  const imageElsewhere = imageRun !== null && !imageHere
  const activeRun = runHere ? runView : null
  const activeImage = imageHere ? imageRun : null
  const visibleFailure = failure && failure.chatId === chatId ? failure : null
  const imagePromptSeqs = localAIImagePromptSeqs(messages)
  const canSend = !busy && (draft.trim() !== '' || attachments.length > 0)
  const trimmed = messages.length > LOCAL_AI_HISTORY_TURN_LIMIT
  const { transcriptRef, showJump, setShowJump, handleTranscriptScroll, jumpToLatest } = useLocalAIScroll({ shouldFollowRef, messages, runView })
  const { agentDraft, setAgentDraft, agentError, savingAgent, toggleAgentForm, closeAgentForm, saveNewAgent, changeAgent } = useLocalAIAgents({
    agents,
    chatIdRef,
    onAgentChange,
    onCreateAgent,
    onChatsChanged,
    setComposerError,
  })
  const { runModel, stopRun, stopImage } = useLocalAIRuns({
    agents,
    chatIdRef,
    runRef,
    imageRunRef,
    shouldFollowRef,
    setMessages,
    setRunView,
    setImageRun,
    setFailure,
    setShowJump,
    onChatsChanged,
  })
  const { regenerate, saveEdit } = useLocalAIEdits({
    messages,
    setMessages,
    edit,
    setEdit,
    chatIdRef,
    busy,
    agentId,
    shouldFollowRef,
    setComposerError,
    setSubmitting,
    onChatsChanged,
    runModel,
  })
  messageActionsRef.current = {
    startEdit: (message) => setEdit({ seq: message.seq, content: message.content }),
    editChange: (content) => setEdit((current) => (current ? { ...current, content } : current)),
    cancelEdit: () => setEdit(null),
    saveEdit: () => void saveEdit(),
    copy: (message) => copyMessage(message.content),
    regenerate: (message) => void regenerate(message),
  }

  // Creates the chat for the first message. The new chat is reported through onChatCreated.
  async function ensureChatID() {
    const existing = chatIdRef.current
    if (existing) return existing
    const chat = await AppService.CreateLocalAIChat(agentId, newChatKind)
    chatIdRef.current = chat.id
    loadedChatIdRef.current = chat.id
    createdChatIdRef.current = chat.id
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
    let ticket = composerTicket()
    try {
      const chatID = await ensureChatID()
      ticket = { ...ticket, key: chatID }
      run = { chatId: chatID, requestId: createLocalAIRequestID(), stage: 'starting', step: 0, totalSteps: 0, preview: '', stopping: false }
      imageRunRef.current = run
      setImageRun({ ...run })
      const saved = await AppService.LocalAIChatGenerateImage(chatID, prompt, run.requestId)
      if (chatIdRef.current === chatID) {
        setMessages((current) => [...current, ...(saved ?? []).filter((item) => !current.some((existing) => existing.seq === item.seq))])
      }
    } catch (imageError) {
      restoreUnsentComposer(ticket, prompt, [], run?.stopping ? 'Image generation stopped.' : localAIErrorMessage(imageError, 'The image could not be generated.'))
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
    let ticket = composerTicket()
    try {
      const activeChatID = await ensureChatID()
      ticket = { ...ticket, key: activeChatID }
      const userTurn = await AppService.AppendLocalAIChatMessage(activeChatID, newLocalAIMessage('user', content, 'complete', pending))
      const history = [...messages, userTurn]
      setMessages(history)
      onChatsChanged()
      void runModel(activeChatID, history, agentId)
    } catch (sendError) {
      restoreUnsentComposer(ticket, content, pending, localAIErrorMessage(sendError, 'The message could not be saved.'))
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
      <LocalAIToolbar
        agents={agents}
        agentId={agentId}
        busy={busy}
        loading={loading}
        hasMessages={messages.length > 0}
        agentFormOpen={agentDraft !== null}
        onChangeAgent={(nextAgentID) => void changeAgent(nextAgentID)}
        onToggleAgentForm={toggleAgentForm}
        onExport={() => void exportCurrentChat()}
      />
      {agentDraft && (
        <LocalAIAgentForm
          agentDraft={agentDraft}
          agentError={agentError}
          busy={busy}
          savingAgent={savingAgent}
          onChange={setAgentDraft}
          onCancel={closeAgentForm}
          onSubmit={(event) => void saveNewAgent(event)}
        />
      )}
      <LocalAITranscript
        transcriptRef={transcriptRef}
        onScroll={handleTranscriptScroll}
        trimmed={trimmed}
        loading={loading}
        messages={messages}
        busy={busy}
        imagePromptSeqs={imagePromptSeqs}
        edit={edit}
        messageActionsRef={messageActionsRef}
        activeRun={activeRun}
        activeImage={activeImage}
        failure={visibleFailure}
        onStarter={insertStarter}
        onRetry={retryRun}
      />
      {showJump && <button className="local-ai-jump" type="button" aria-label="Scroll to latest message" onClick={jumpToLatest}><ArrowDown size={14} />Latest</button>}
      <LocalAIComposer
        composerRef={composerRef}
        fileInputRef={fileInputRef}
        draft={draft}
        onDraftChange={setDraft}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        onFileInput={handleFileInput}
        onKeyDown={handleComposerKeyDown}
        onPaste={handleComposerPaste}
        onSubmit={handleSubmit}
        onGenerateImage={() => void generateImage()}
        generating={runHere || imageHere}
        stopping={runHere ? (runView?.stopping ?? false) : (imageRun?.stopping ?? false)}
        onStop={runHere ? stopRun : stopImage}
        canSend={canSend}
        busy={busy}
        loading={loading}
        composerError={composerError}
        runElsewhere={runElsewhere}
        imageElsewhere={imageElsewhere}
      />
    </section>
  )
}
