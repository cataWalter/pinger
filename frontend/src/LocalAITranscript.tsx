import type { RefObject } from 'react'
import { CircleAlert, RotateCcw, Sparkles } from 'lucide-react'
import type { LocalAIChatMessage } from '../bindings/mychat/desktop/models.js'
import { LOCAL_AI_HISTORY_TURN_LIMIT, LOCAL_AI_STARTER_PROMPTS } from './localAIChats'
import LocalAIMarkdown from './LocalAIMarkdown'
import LocalAIMessageView from './LocalAIMessageView'
import { imageRunStatus } from './localAIChatUtils'
import type { LocalAIEdit, LocalAIFailure, LocalAIImageRun, LocalAIMessageActions, LocalAIRun } from './localAIChatTypes'

type LocalAITranscriptProps = {
  transcriptRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  trimmed: boolean
  loading: boolean
  messages: LocalAIChatMessage[]
  busy: boolean
  imagePromptSeqs: Set<number>
  edit: LocalAIEdit | null
  messageActionsRef: { current: LocalAIMessageActions }
  activeRun: LocalAIRun | null
  activeImage: LocalAIImageRun | null
  failure: LocalAIFailure | null
  onStarter: (prompt: string) => void
  onRetry: () => void
}

export default function LocalAITranscript({
  transcriptRef,
  onScroll,
  trimmed,
  loading,
  messages,
  busy,
  imagePromptSeqs,
  edit,
  messageActionsRef,
  activeRun,
  activeImage,
  failure,
  onStarter,
  onRetry,
}: LocalAITranscriptProps) {
  return (
    <div className="local-ai-transcript" ref={transcriptRef} onScroll={onScroll} role="log" aria-label="Local AI conversation" aria-live="polite" aria-busy={activeRun !== null || activeImage !== null}>
      {trimmed && <p className="local-ai-notice">Only the latest {LOCAL_AI_HISTORY_TURN_LIMIT} messages are sent to the model.</p>}
      {loading && messages.length === 0 && <p className="local-ai-status" role="status">Loading chat…</p>}
      {!loading && messages.length === 0 && !activeRun && !activeImage && (
        <div className="local-ai-empty">
          <Sparkles size={24} />
          <p>Start a conversation</p>
          <div className="local-ai-starters">
            {LOCAL_AI_STARTER_PROMPTS.map((starter) => (
              <button key={starter.label} type="button" onClick={() => onStarter(starter.prompt)}>{starter.label}</button>
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
          actionsRef={messageActionsRef}
        />
      ))}
      {activeRun && (
        <article className="local-ai-message is-assistant">
          <span className="local-ai-message-label">Local AI</span>
          {activeRun.text ? (
            <LocalAIMarkdown body={activeRun.text} />
          ) : (
            <p className="local-ai-status" role="status">{activeRun.stopping ? 'Stopping…' : 'Waiting for the local model…'}</p>
          )}
        </article>
      )}
      {activeImage && (
        <article className="local-ai-message is-assistant local-ai-image-run">
          <span className="local-ai-message-label">Local AI</span>
          <p className="local-ai-status" role="status">{imageRunStatus(activeImage)}</p>
          {activeImage.totalSteps > 0 && <progress className="local-ai-image-progress" value={activeImage.step} max={activeImage.totalSteps} aria-label="Image generation progress" />}
          {activeImage.preview && <img className="local-ai-image-preview" src={`data:image/png;base64,${activeImage.preview}`} alt="Image generation preview" />}
        </article>
      )}
      {failure && (
        <div className="local-ai-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <div className="local-ai-error-body">
            <p className="local-ai-error-title">Local AI could not reply</p>
            <p className="local-ai-error-message">{failure.message}</p>
          </div>
          <button className="local-ai-retry" type="button" onClick={onRetry} disabled={busy}><RotateCcw size={14} />Retry</button>
        </div>
      )}
    </div>
  )
}
