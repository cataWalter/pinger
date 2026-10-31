import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles, X } from 'lucide-react'

export type SuggestedReplyOption = {
  tone: string
  text: string
}

export type SuggestedRepliesState = {
  roomId: string
  requestId: string
  status: 'loading' | 'ready' | 'error'
  suggestions: SuggestedReplyOption[]
  error: string
}

type SuggestedRepliesPickerProps = {
  state: SuggestedRepliesState
  hasDraft: boolean
  onUse: (text: string) => void
  onRegenerate: () => void
  onClose: () => void
}

// isEditableTarget reports whether a key press belongs to a text field, so typing a digit there never chooses a reply.
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

// SuggestedRepliesPicker lists AI reply options above the composer. Choosing one fills the draft and never sends it.
export function SuggestedRepliesPicker({ state, hasDraft, onUse, onRegenerate, onClose }: SuggestedRepliesPickerProps) {
  const [pending, setPending] = useState<string | null>(null)
  const loading = state.status === 'loading'
  const ready = state.status === 'ready'
  const options = state.suggestions
  const showOptions = pending === null && options.length > 0 && state.status !== 'error'

  const choose = useCallback((text: string) => {
    if (hasDraft) {
      setPending(text)
      return
    }
    onUse(text)
  }, [hasDraft, onUse])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (pending !== null) {
          setPending(null)
          return
        }
        onClose()
        return
      }
      if (!ready || pending !== null || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return
      const index = Number(event.key) - 1
      if (Number.isInteger(index) && index >= 0 && index < options.length) {
        event.preventDefault()
        choose(options[index].text)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pending, onClose, ready, options, choose])

  function regenerate() {
    setPending(null)
    onRegenerate()
  }

  return (
    <section className="suggested-replies" role="group" aria-label="Suggested replies">
      <div className="suggested-replies-header">
        <span className="suggested-replies-title"><Sparkles size={13} /><span>Suggested replies</span></span>
        <div className="suggested-replies-header-actions">
          <button type="button" className="icon-button" aria-label="Regenerate suggested replies" title="Regenerate" disabled={loading} onClick={regenerate}><RefreshCw size={14} /></button>
          <button type="button" className="icon-button" aria-label="Close suggested replies" onClick={onClose}><X size={14} /></button>
        </div>
      </div>
      {loading && (
        <div className="suggested-replies-body">
          <p className="suggested-replies-status" role="status">Reading the latest messages…</p>
          <button type="button" className="composer-assist-button" onClick={onClose}>Cancel</button>
        </div>
      )}
      {loading && options.length === 0 && (
        <ul className="suggested-replies-list suggested-replies-skeleton" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <li key={index}><span className="suggested-reply-skeleton-line" /></li>
          ))}
        </ul>
      )}
      {showOptions && (
        <ul className={loading ? 'suggested-replies-list is-stale' : 'suggested-replies-list'} aria-busy={loading}>
          {options.map((option, index) => (
            <li key={`${index}-${option.tone}`}>
              <button type="button" className="suggested-reply-option" disabled={loading} onClick={() => choose(option.text)}>
                <span className="suggested-reply-tone">{option.tone}</span>
                <span className="suggested-reply-text">{option.text}</span>
                <kbd className="suggested-reply-key" aria-hidden="true">{index + 1}</kbd>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.status === 'error' && (
        <div className="suggested-replies-body">
          <p className="suggested-replies-status" role="alert">{state.error}</p>
          <button type="button" className="composer-assist-button" onClick={regenerate}><RefreshCw size={12} /><span>Try again</span></button>
        </div>
      )}
      {ready && pending !== null && (
        <div className="suggested-replies-body">
          <p className="suggested-replies-status">Replace the current draft with this reply?</p>
          <div className="suggested-replies-actions">
            <button type="button" className="composer-assist-button" onClick={() => setPending(null)}>Keep draft</button>
            <button type="button" className="composer-assist-button" onClick={() => onUse(pending)}>Replace draft</button>
          </div>
        </div>
      )}
    </section>
  )
}
