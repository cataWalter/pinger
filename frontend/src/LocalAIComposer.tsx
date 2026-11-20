import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, RefObject } from 'react'
import { FileText, ImagePlus, Paperclip, Send, Square, X } from 'lucide-react'
import type { LocalAIChatAttachment } from '../bindings/mychat/desktop/models.js'
import { LOCAL_AI_ATTACHMENT_LIMIT, LOCAL_AI_ATTACHMENT_ACCEPT } from './localAIChats'
import { localAIImageURL } from './localAIChatUtils'

type LocalAIComposerProps = {
  composerRef: RefObject<HTMLTextAreaElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  draft: string
  onDraftChange: (value: string) => void
  attachments: LocalAIChatAttachment[]
  onRemoveAttachment: (index: number) => void
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onGenerateImage: () => void
  generating: boolean
  stopping: boolean
  onStop: () => void
  canSend: boolean
  busy: boolean
  loading: boolean
  composerError: string
  runElsewhere: boolean
  imageElsewhere: boolean
}

export default function LocalAIComposer({
  composerRef,
  fileInputRef,
  draft,
  onDraftChange,
  attachments,
  onRemoveAttachment,
  onFileInput,
  onKeyDown,
  onPaste,
  onSubmit,
  onGenerateImage,
  generating,
  stopping,
  onStop,
  canSend,
  busy,
  loading,
  composerError,
  runElsewhere,
  imageElsewhere,
}: LocalAIComposerProps) {
  return (
    <form className="local-ai-composer" onSubmit={onSubmit}>
      {composerError && <p className="local-ai-composer-error" role="alert">{composerError}</p>}
      {runElsewhere && <p className="local-ai-notice" role="status">AI is replying in another chat.</p>}
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
                <button className="icon-button" type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onRemoveAttachment(index)} disabled={busy}><X size={12} /></button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Message your AI"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="Message AI"
          rows={1}
          disabled={loading}
        />
        <div className="local-ai-composer-footer">
          <div className="local-ai-composer-tools">
            <button className="icon-button" type="button" aria-label="Attach files" title="Attach images or text files" onClick={() => fileInputRef.current?.click()} disabled={busy || attachments.length >= LOCAL_AI_ATTACHMENT_LIMIT}>
              <Paperclip size={16} />
            </button>
            <input ref={fileInputRef} type="file" multiple accept={LOCAL_AI_ATTACHMENT_ACCEPT} hidden onChange={onFileInput} />
            <button className="icon-button" type="button" aria-label="Generate image" title="Generate an image from the message text" onClick={onGenerateImage} disabled={busy || draft.trim() === ''}>
              <ImagePlus size={16} />
            </button>
          </div>
          {generating ? (
            <button className="local-ai-stop" type="button" aria-label="Stop generating" title="Stop generating" onClick={onStop} disabled={stopping}>
              <Square size={13} />
            </button>
          ) : (
            <button className="send-button" type="submit" aria-label="Send to AI" disabled={!canSend}>
              <Send size={17} />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
