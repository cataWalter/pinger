import type { FormEvent } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import { endsWithAssistantTurn } from './aiPrompts'
import { languageName, type LanguageRoles } from './aiSettings'
import { DialogSurface } from './DialogSurface'
import { LanguageTutorAnalysisDetails, type AIPanel, type LanguageTutorState } from './appShared'

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
  onAnalyzeWithLanguageTutor: (text: string, mode: LanguageTutorState['mode'], explanationLanguage?: string) => void | Promise<void>
  onUseLanguageTutorDraft: () => void
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
  onAnalyzeWithLanguageTutor,
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
      {languageTutorState && <div className="ai-result-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseLanguageTutor() }}>
        <DialogSurface className="room-info-dialog ai-result-dialog language-tutor-dialog" labelledBy="language-tutor-title" onClose={onCloseLanguageTutor} onClick={(event) => event.stopPropagation()}>
          <header className="room-info-header ai-result-header">
            <div><span className="eyebrow">LANGUAGE TUTOR</span><h2 id="language-tutor-title">{languageTutorState.mode === 'draft' ? 'Tutor this draft' : 'Analyze message'}</h2></div>
            <button className="icon-button" type="button" aria-label="Close Language Tutor" title="Close Language Tutor" onClick={onCloseLanguageTutor}><X size={16} /></button>
          </header>
          <div className="ai-result-content language-tutor-content" aria-live="polite" aria-busy={languageTutorState.busy}>
            <label className="language-tutor-explain-in"><span>Explain in</span><select aria-label="Explain in" value={languageTutorState.explanationLanguage} disabled={languageTutorState.busy} onChange={(event) => void onAnalyzeWithLanguageTutor(languageTutorState.originalText, languageTutorState.mode, event.target.value)}>
              {languageRoles.known.map((code) => <option key={code} value={code}>{languageName(code)}</option>)}
            </select></label>
            {languageTutorState.busy && <p className="ai-result-loading" role="status"><span className="loading-mark" />Analyzing with the local model…</p>}
            {languageTutorState.busy && languageTutorState.preview !== '' && <pre className="language-tutor-preview">{languageTutorState.preview}</pre>}
            {languageTutorState.error && <p className="settings-error" role="alert">{languageTutorState.error}</p>}
            {languageTutorState.analysis && <LanguageTutorAnalysisDetails analysis={languageTutorState.analysis} originalText={languageTutorState.originalText} />}
          </div>
          <aside className="ai-result-disclaimer">
            <ShieldCheck size={16} aria-hidden="true" />
            <p>Analysis uses the local AI endpoint configured in Settings. No Matrix message is sent.</p>
          </aside>
          <footer className="room-info-footer ai-result-footer">
            {languageTutorState.mode === 'draft' && <button className="settings-command ai-result-primary" type="button" disabled={!languageTutorState.analysis || languageTutorState.busy || hasEditTarget} onClick={onUseLanguageTutorDraft}>Replace draft with {languageName(languageTutorState.analysis?.target_language || languageRoles.learning)}</button>}
            <button className="settings-command" type="button" onClick={onCloseLanguageTutor}>Close</button>
          </footer>
        </DialogSurface>
      </div>}
    </>
  )
}
