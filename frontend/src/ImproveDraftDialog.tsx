import { ShieldCheck, X } from 'lucide-react'
import { MAX_CHAT_GOAL_LENGTH } from './aiPrompts'
import { DialogScrim, DialogSurface } from './DialogSurface'
import type { ImproveDraftSession } from './useImproveDraft'

export type ImproveDraftDialogProps = {
  session: ImproveDraftSession
  onGoalChange: (goal: string) => void
  onRun: () => void
  onStop: () => void
  onUse: (text: string) => void
  onClose: () => void
}

// ImproveDraftDialog shows the draft goal, the improved versions, and the open questions. Choosing a version only fills the composer; nothing is sent. It is lazy-loaded by App.
export function ImproveDraftDialog({ session, onGoalChange, onRun, onStop, onUse, onClose }: ImproveDraftDialogProps) {
  const busy = session.goalLoading || session.reviewing
  const hasVariants = session.variants.length > 0
  return (
    <DialogScrim variant="modal" onDismiss={onClose}>
      <DialogSurface className="dialog-modal-card improve-draft-dialog" labelledBy="improve-draft-title" onClose={onClose}>
        <header className="room-info-header ai-result-header">
          <div><span className="eyebrow">IMPROVE DRAFT</span><h2 id="improve-draft-title">Improve draft</h2></div>
          <button className="icon-button" type="button" aria-label="Close Improve draft" title="Close Improve draft" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="ai-result-content improve-draft-content" aria-live="polite" aria-busy={busy}>
          <section className="improve-draft-section">
            <span className="eyebrow">YOUR DRAFT</span>
            <div className="improve-draft-original">{session.original}</div>
          </section>
          <section className="improve-draft-section">
            <span className="eyebrow">DRAFT GOAL</span>
            <textarea aria-label="Draft goal" maxLength={MAX_CHAT_GOAL_LENGTH} rows={3} spellCheck={false} disabled={session.goalLoading} placeholder="What should this message achieve? Leave empty to let the AI decide." value={session.goal} onChange={(event) => onGoalChange(event.target.value)} />
            {session.goalLoading && <p className="improve-draft-status" role="status"><span className="loading-mark" />Inferring the goal…</p>}
          </section>
          {session.reviewing && <p className="improve-draft-status" role="status"><span className="loading-mark" />Reviewing the draft…</p>}
          {session.error && <p className="settings-error" role="alert">{session.error}</p>}
          {session.openQuestions.length > 0 && <section className="improve-draft-section">
            <span className="eyebrow">OPEN QUESTIONS</span>
            <ul className="improve-draft-questions">
              {session.openQuestions.map((question, index) => <li key={index}>{question}</li>)}
            </ul>
          </section>}
          {hasVariants && <section className="improve-draft-section">
            <span className="eyebrow">VERSIONS</span>
            <ol className="improve-draft-variants">
              {session.variants.map((variant, index) => (
                <li key={index} className="improve-draft-variant">
                  <div className="improve-draft-variant-text">{variant.text}</div>
                  {variant.rationale && <p className="improve-draft-rationale">{variant.rationale}</p>}
                  <button className="settings-command" type="button" disabled={session.reviewing} onClick={() => onUse(variant.text)}>Use this version</button>
                </li>
              ))}
            </ol>
          </section>}
        </div>
        <aside className="ai-result-disclaimer">
          <ShieldCheck size={16} aria-hidden="true" />
          <p>No Matrix message is sent automatically. The draft, the included chat context, and the goal are sent to the AI provider set in Settings &gt; AI, which may be an online service.</p>
        </aside>
        <footer className="room-info-footer ai-result-footer">
          {session.reviewing
            ? <button className="settings-command ai-result-stop" type="button" onClick={onStop}>Stop</button>
            : <button className="settings-command ai-result-primary" type="button" disabled={busy || !session.original.trim()} onClick={onRun}>{hasVariants ? 'Improve again' : 'Improve draft'}</button>}
          <button className="settings-command" type="button" onClick={onClose}>Close</button>
        </footer>
      </DialogSurface>
    </DialogScrim>
  )
}
