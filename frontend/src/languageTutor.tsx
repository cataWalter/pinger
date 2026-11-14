import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { type TutorAnalysis } from '../bindings/mychat/desktop/models.js'
import { languageName, type LanguageEntry } from './aiSettings'

// LanguageTutorAnalysisDetails shows one analysis as result cards next to the original text.
export function LanguageTutorAnalysisDetails({ analysis, mode, originalText, learningCode, explanationCode, languages }: { analysis: TutorAnalysis; mode: 'draft' | 'message'; originalText: string; learningCode: string; explanationCode: string; languages: readonly LanguageEntry[] }) {
  const collapseSpaces = (value: string) => value.replace(/\s+/g, ' ').trim()
  const unchanged = mode === 'draft' && analysis.corrected_text !== '' && collapseSpaces(analysis.corrected_text) === collapseSpaces(originalText)
  const grammarNotes = analysis.grammar_notes ?? []
  const vocabulary = analysis.vocabulary ?? []
  return <>
    {analysis.corrected_text && <TutorResultSection label={`CORRECTED · ${languageName(learningCode, languages).toUpperCase()}`} lang={learningCode} text={analysis.corrected_text} primary>
      {unchanged && <p className="language-tutor-note">No changes needed. The text is already correct.</p>}
    </TutorResultSection>}
    {analysis.translation && <TutorResultSection label={`TRANSLATION · ${languageName(explanationCode, languages).toUpperCase()}`} lang={explanationCode} text={analysis.translation} primary />}
    {grammarNotes.length > 0 && <section className="language-tutor-learning-details" aria-label="Grammar notes">
      <span className="eyebrow">GRAMMAR</span>
      <ul>{grammarNotes.map((note, index) => <li key={`${index}-${note}`} lang={explanationCode}>{note}</li>)}</ul>
    </section>}
    {vocabulary.length > 0 && <section className="language-tutor-learning-details" aria-label="Vocabulary">
      <span className="eyebrow">VOCABULARY</span>
      <ul>{vocabulary.map((item, index) => <li key={`${index}-${item.term}`}>
        <strong lang={learningCode}>{item.term}</strong>
        <span lang={explanationCode}>{item.meaning}</span>
        <p lang={learningCode}>{item.example}</p>
      </li>)}</ul>
    </section>}
    {originalText && <TutorResultSection label={`${mode === 'draft' ? 'YOUR DRAFT' : 'ORIGINAL MESSAGE'} · ${languageName(analysis.detected_language, languages).toUpperCase()}`} lang={analysis.detected_language} text={originalText} />}
  </>
}

// TutorResultSection renders one labeled tutor text with a copy action.
export function TutorResultSection({ label, lang, text, primary = false, children }: { label: string; lang: string; text: string; primary?: boolean; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (!navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return <section className={`language-tutor-section ${primary ? 'is-primary' : 'is-source'}`}>
    <div className="language-tutor-section-head">
      <span className="eyebrow">{label}</span>
      <button className="icon-button language-tutor-copy" type="button" aria-label={`Copy ${label.toLowerCase()}`} title="Copy" onClick={() => void copy()}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
    <p lang={lang}>{text}</p>
    {children}
  </section>
}
