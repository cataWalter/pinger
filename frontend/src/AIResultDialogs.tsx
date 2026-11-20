import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import { endsWithAssistantTurn } from './aiPrompts'
import { languageName, type LanguageEntry, type LanguageRoles } from './aiSettings'
import { primaryModifierLabel } from './dom'
import { DialogSurface } from './DialogSurface'
import { LanguageTutorAnalysisDetails, LanguageTutorDraftCorrection, type AIPanel, type LanguageTutorState } from './appShared'

export type AIResultDialogsProps = {
  aiPanel: AIPanel | null
  languageTutorState: LanguageTutorState | null
  hasEditTarget: boolean
  languageRoles: LanguageRoles
  onCloseAIResult: () => void
  onAcceptAIResult: () => void
  onStopAIRequest: () => void
  onRegenerateAIResult: () => void
  onFollowUpChange: (followUp: string) => void
  onSendFollowUp: (event: FormEvent<HTMLFormElement>) => void
  onCloseLanguageTutor: () => void
  onCheckLanguageTutorDraft: (text: string) => void
  onUseLanguageTutorDraft: (text: string) => void
}

// AIResultDialogs renders the AI result panel and the Language Tutor panel. It is lazy-loaded by App.
export function AIResultDialogs({
  aiPanel,
  languageTutorState,
  hasEditTarget,
  languageRoles,
  onCloseAIResult,
  onAcceptAIResult,
  onStopAIRequest,
  onRegenerateAIResult,
  onFollowUpChange,
  onSendFollowUp,
  onCloseLanguageTutor,
  onCheckLanguageTutorDraft,
  onUseLanguageTutorDraft,
}: AIResultDialogsProps) {
  return (
    <>
      {aiPanel && <div className="ai-result-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseAIResult() }}>
        <DialogSurface className="room-info-dialog ai-result-dialog" labelledBy="ai-result-title" onClose={onCloseAIResult} onClick={(event) => event.stopPropagation()}>
          <header className="room-info-header ai-result-header">
            <div><span className="eyebrow">AI RESULT</span><h2 id="ai-result-title">{aiPanel.title}</h2></div>
            <button className="icon-button" type="button" aria-label="Close AI result" title="Close AI result" onClick={onCloseAIResult}><X size={16} /></button>
          </header>
          <div className="ai-result-content" aria-live="polite" aria-busy={aiPanel.busy}>
            {aiPanel.busy && <p className="ai-result-loading" role="status"><span className="loading-mark" />{aiPanel.status || 'Waiting for the local model…'}</p>}
            {aiPanel.error && <p className="settings-error" role="alert">{aiPanel.error}</p>}
            {aiPanel.result && <div className="ai-result-text">{aiPanel.result}</div>}
            {aiPanel.stopped && !aiPanel.busy && <p className="settings-note ai-result-stopped" role="status">Generation stopped. The text above may be incomplete.</p>}
          </div>
          {!aiPanel.busy && endsWithAssistantTurn(aiPanel.conversation) && <form className="ai-result-followup" onSubmit={onSendFollowUp}>
            <textarea aria-label="Follow-up question" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={aiPanel.followUp} maxLength={2000} rows={2} placeholder="Ask a follow-up about this result" onChange={(event) => onFollowUpChange(event.target.value)} />
            <button className="settings-command" type="submit" disabled={!aiPanel.followUp.trim()}>Send follow-up</button>
          </form>}
          <aside className="ai-result-disclaimer">
            <ShieldCheck size={16} aria-hidden="true" />
            <p>No Matrix message is sent automatically. The selected text, included chat context, and, for custom agents, profile instructions are sent to the configured endpoint, which may be remote.</p>
          </aside>
          <footer className="room-info-footer ai-result-footer">
            {aiPanel.acceptAction.kind !== 'none' && <button className="settings-command ai-result-primary" type="button" title={aiPanel.acceptAction.kind === 'reply' ? 'Use the result as a reply draft' : aiPanel.acceptAction.kind === 'rewrite' ? 'Replace the composer draft with this result' : 'Use the result as a draft'} disabled={!aiPanel.result || aiPanel.busy || hasEditTarget} onClick={onAcceptAIResult}>
              {aiPanel.acceptAction.kind === 'reply' ? 'Use as reply draft' : aiPanel.acceptAction.kind === 'rewrite' ? 'Replace draft' : 'Use as draft'}
            </button>}
            {aiPanel.busy
              ? <button className="settings-command ai-result-stop" type="button" onClick={onStopAIRequest}>Stop</button>
              : <button className="settings-command" type="button" onClick={onRegenerateAIResult}>Regenerate</button>}
            <button className="settings-command" type="button" onClick={onCloseAIResult}>Close</button>
          </footer>
        </DialogSurface>
      </div>}
      {languageTutorState && <LanguageTutorDialog state={languageTutorState} hasEditTarget={hasEditTarget} languages={languageRoles.languages} onClose={onCloseLanguageTutor} onCheck={onCheckLanguageTutorDraft} onUseDraft={onUseLanguageTutorDraft} />}
    </>
  )
}

type LanguageTutorDialogProps = {
  state: LanguageTutorState
  hasEditTarget: boolean
  languages: readonly LanguageEntry[]
  onClose: () => void
  onCheck: (text: string) => void
  onUseDraft: (text: string) => void
}

// LanguageTutorDialog keeps the draft in local state so typing does not re-render the app. It mounts only while a tutor session is open.
function LanguageTutorDialog({ state, hasEditTarget, languages, onClose, onCheck, onUseDraft }: LanguageTutorDialogProps) {
  const [draft, setDraft] = useState(state.originalText)
  const isDraft = state.mode === 'draft'
  const draftText = draft.trim()
  const learningName = languageName(state.learningLanguage, languages)
  // The result describes originalText, so an edited draft is marked stale until it is checked again.
  const stale = isDraft && draftText !== state.originalText
  const correctedText = state.analysis?.corrected_text.trim() ?? ''
  const keepDisabled = !draftText || hasEditTarget
  const replaceDisabled = !correctedText || state.busy || hasEditTarget

  // Shortcuts mirror the footer buttons and respect their disabled state, so Ctrl/⌘+2 cannot insert an empty correction.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || !isDraft) return
    if (event.key === 'Enter' && draftText) {
      event.preventDefault()
      onCheck(draft)
    } else if (event.key === '1' && !keepDisabled) {
      event.preventDefault()
      onUseDraft(draft)
    } else if (event.key === '2' && !replaceDisabled) {
      event.preventDefault()
      onUseDraft(correctedText)
    }
  }

  return (
    <div className="ai-result-scrim language-tutor-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} onKeyDown={handleKeyDown}>
      <DialogSurface className="room-info-dialog ai-result-dialog language-tutor-dialog" labelledBy="language-tutor-title" onClose={onClose} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header ai-result-header">
          <div><span className="eyebrow">LANGUAGE TUTOR</span><h2 id="language-tutor-title">{isDraft ? 'Tutor this draft' : 'Analyze message'}</h2></div>
          <button className="icon-button" type="button" aria-label="Close Language Tutor" title="Close Language Tutor" onClick={onClose}><X size={16} /></button>
        </header>
        {isDraft
          ? <div className="language-tutor-workspace">
            <section className="language-tutor-editor">
              <span className="eyebrow">YOUR TEXT · {learningName.toUpperCase()}</span>
              <textarea data-initial-focus aria-label="Your text" lang={state.learningLanguage} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <div className="language-tutor-editor-actions">
                {stale && <p className="language-tutor-stale">Changed since the last check. Press Check to update.</p>}
                <button className="settings-command" type="button" aria-keyshortcuts="Control+Enter Meta+Enter" title={`Check draft (${primaryModifierLabel()} + Enter)`} disabled={!draftText} onClick={() => onCheck(draft)}>
                  Check <kbd aria-hidden="true">{primaryModifierLabel()} Enter</kbd>
                </button>
              </div>
            </section>
            <div className="ai-result-content language-tutor-content" aria-live="polite" aria-busy={state.busy}>
              {state.error && <p className="settings-error" role="alert">{state.error}</p>}
              <LanguageTutorDraftCorrection analysis={state.analysis} busy={state.busy} preview={state.preview} originalText={state.originalText} learningCode={state.learningLanguage} languages={languages} />
            </div>
          </div>
          : <div className="ai-result-content language-tutor-content" aria-live="polite" aria-busy={state.busy}>
            <p className="language-tutor-explained-in">Explained in {languageName(state.explanationLanguage, languages)}</p>
            {state.busy && <p className="ai-result-loading" role="status"><span className="loading-mark" />Analyzing with the local model…</p>}
            {state.busy && state.preview !== '' && <pre className="language-tutor-preview">{state.preview}</pre>}
            {state.error && <p className="settings-error" role="alert">{state.error}</p>}
            {state.analysis && <LanguageTutorAnalysisDetails analysis={state.analysis} originalText={state.originalText} learningCode={state.learningLanguage} explanationCode={state.explanationLanguage} languages={languages} />}
          </div>}
        <footer className={isDraft ? 'room-info-footer ai-result-footer language-tutor-footer' : 'room-info-footer ai-result-footer'}>
          {isDraft
            ? <>
              <button className="settings-command" type="button" aria-keyshortcuts="Control+1 Meta+1" title={`Put your edited text in the composer (${primaryModifierLabel()} + 1)`} disabled={keepDisabled} onClick={() => onUseDraft(draft)}>
                Keep my draft <kbd aria-hidden="true">{primaryModifierLabel()} 1</kbd>
              </button>
              <button className="settings-command ai-result-primary" type="button" aria-keyshortcuts="Control+2 Meta+2" title={`Put the ${learningName} correction in the composer (${primaryModifierLabel()} + 2)`} disabled={replaceDisabled} onClick={() => onUseDraft(correctedText)}>
                Replace draft with {learningName} <kbd aria-hidden="true">{primaryModifierLabel()} 2</kbd>
              </button>
            </>
            : <button className="settings-command" type="button" onClick={onClose}>Close</button>}
        </footer>
      </DialogSurface>
    </div>
  )
}
