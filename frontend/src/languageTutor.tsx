import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { type TutorAnalysis } from '../bindings/mychat/desktop/models.js'
import { languageName, type LanguageEntry } from './aiSettings'

const collapseSpaces = (value: string) => value.replace(/\s+/g, ' ').trim()

// LanguageTutorAnalysisDetails shows one message analysis as result cards next to the original text.
export function LanguageTutorAnalysisDetails({ analysis, originalText, learningCode, explanationCode, languages }: { analysis: TutorAnalysis; originalText: string; learningCode: string; explanationCode: string; languages: readonly LanguageEntry[] }) {
  const grammarNotes = analysis.grammar_notes ?? []
  const vocabulary = analysis.vocabulary ?? []
  return <>
    {analysis.corrected_text && <TutorResultSection label={`CORRECTED · ${languageName(learningCode, languages).toUpperCase()}`} lang={learningCode} text={analysis.corrected_text} primary />}
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
    {originalText && <TutorResultSection label={`ORIGINAL MESSAGE · ${languageName(analysis.detected_language, languages).toUpperCase()}`} lang={analysis.detected_language} text={originalText} />}
  </>
}

const jsonEscapes = new Map([['"', '"'], ['\\', '\\'], ['/', '/'], ['b', '\b'], ['f', '\f'], ['n', '\n'], ['r', '\r'], ['t', '\t']])

// streamedJSONString decodes one string field from a partial JSON stream, so draft results can appear before the check finishes.
export function streamedJSONString(preview: string, field: string): string {
  const start = new RegExp(`"${field}"\\s*:\\s*"`).exec(preview)
  if (!start) return ''
  let text = ''
  for (let index = start.index + start[0].length; index < preview.length; index++) {
    const char = preview[index]
    if (char === '"') break
    if (char !== '\\') {
      text += char
      continue
    }
    const escape = preview[index + 1] ?? ''
    if (escape === 'u') {
      const code = preview.slice(index + 2, index + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(code)) break
      text += String.fromCharCode(Number.parseInt(code, 16))
      index += 5
      continue
    }
    const decoded = jsonEscapes.get(escape)
    if (decoded === undefined) break
    text += decoded
    index += 1
  }
  return text
}

// LanguageTutorDraftCorrection shows the corrected draft and its meaning while they stream and after the check completes.
export function LanguageTutorDraftCorrection({ analysis, busy, preview, originalText, learningCode, explanationCode, languages }: { analysis: TutorAnalysis | null; busy: boolean; preview: string; originalText: string; learningCode: string; explanationCode: string; languages: readonly LanguageEntry[] }) {
  const label = `CORRECTED · ${languageName(learningCode, languages).toUpperCase()}`
  const translationLabel = `TRANSLATION · ${languageName(explanationCode, languages).toUpperCase()}`
  if (analysis) {
    if (!analysis.corrected_text) return null
    const unchanged = collapseSpaces(analysis.corrected_text) === collapseSpaces(originalText)
    return <>
      <TutorResultSection label={label} lang={learningCode} text={analysis.corrected_text} primary>
        {unchanged && <p className="language-tutor-note">No changes needed. The text is already correct.</p>}
      </TutorResultSection>
      {analysis.translation && <TutorResultSection label={translationLabel} lang={explanationCode} text={analysis.translation} primary />}
    </>
  }
  if (!busy) return null
  const streamed = streamedJSONString(preview, 'corrected_text')
  if (!streamed) return <p className="ai-result-loading" role="status"><span className="loading-mark" />Analyzing with AI…</p>
  const streamedTranslation = streamedJSONString(preview, 'translation')
  return <>
    <TutorResultSection label={label} lang={learningCode} text={streamed} primary copyable={false} />
    {streamedTranslation && <TutorResultSection label={translationLabel} lang={explanationCode} text={streamedTranslation} primary copyable={false} />}
  </>
}

// TutorResultSection renders one labeled tutor text with an optional copy action.
export function TutorResultSection({ label, lang, text, primary = false, copyable = true, children }: { label: string; lang: string; text: string; primary?: boolean; copyable?: boolean; children?: ReactNode }) {
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
      {copyable && <button className="icon-button language-tutor-copy" type="button" aria-label={`Copy ${label.toLowerCase()}`} title="Copy" onClick={() => void copy()}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>}
    </div>
    <p lang={lang}>{text}</p>
    {children}
  </section>
}
