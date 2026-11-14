import { memo } from 'react'
import { Copy, FileText, Pencil, RotateCw } from 'lucide-react'
import type { LocalAIChatMessage } from '../bindings/mychat/desktop/models.js'
import { isLocalAIImageTurn } from './localAIChats'
import LocalAIMarkdown from './LocalAIMarkdown'
import { localAIImageURL } from './localAIChatUtils'
import type { LocalAIMessageActions } from './localAIChatTypes'

type LocalAIMessageViewProps = {
  message: LocalAIChatMessage
  idle: boolean
  imagePrompt: boolean
  editContent: string | null
  actionsRef: { current: LocalAIMessageActions }
}

export default memo(function LocalAIMessageView({ message, idle, imagePrompt, editContent, actionsRef }: LocalAIMessageViewProps) {
  const isUser = message.role === 'user'
  const imageTurn = isLocalAIImageTurn(message)
  const attachments = message.attachments ?? []
  if (editContent !== null) {
    return (
      <article className="local-ai-message is-user is-editing">
        <span className="local-ai-message-label">You</span>
        <textarea className="local-ai-edit-input" aria-label="Edit message" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={editContent} onChange={(event) => actionsRef.current.editChange(event.currentTarget.value)} rows={3} />
        <div className="local-ai-edit-actions">
          <button type="button" onClick={() => actionsRef.current.cancelEdit()}>Cancel</button>
          <button type="button" onClick={() => actionsRef.current.saveEdit()} disabled={editContent.trim() === '' && attachments.length === 0}>Save and send</button>
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
        <LocalAIMarkdown body={message.content} />
      ))}
      <div className="local-ai-message-actions">
        {message.content && <button className="icon-button" type="button" aria-label="Copy message" title="Copy" onClick={() => actionsRef.current.copy(message)}><Copy size={13} /></button>}
        {idle && !isUser && !imageTurn && <button className="icon-button" type="button" aria-label="Regenerate response" title="Regenerate" onClick={() => actionsRef.current.regenerate(message)}><RotateCw size={13} /></button>}
        {idle && isUser && !imagePrompt && <button className="icon-button" type="button" aria-label="Edit message" title="Edit" onClick={() => actionsRef.current.startEdit(message)}><Pencil size={13} /></button>}
      </div>
    </article>
  )
})
