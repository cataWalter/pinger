import { useState } from 'react'
import {
  TUTOR_EXPLANATION_LANGUAGE_PREFERENCE,
  TUTOR_LANGUAGES,
  TUTOR_LANGUAGE_PREFERENCE,
  type TutorLanguagePair,
} from './aiSettings'

export function TutorLanguageSettings({ languages, onSave }: {
  languages: TutorLanguagePair
  onSave: (key: string, value: string) => Promise<boolean>
}) {
  const [targetDraft, setTargetDraft] = useState(languages.target)
  const [explanationDraft, setExplanationDraft] = useState(languages.explanation)
  const [status, setStatus] = useState('')

  async function chooseLanguage(key: string, code: string, draft: string, otherDraft: string, setDraft: (code: string) => void) {
    if (code === draft) return
    if (code === otherDraft) {
      setStatus('Choose two different languages.')
      return
    }
    setDraft(code)
    setStatus('')
    const saved = await onSave(key, code)
    if (saved) {
      setStatus('Language Tutor languages saved.')
      return
    }
    setDraft(draft)
    setStatus('Not saved.')
  }

  return (
    <section className="ai-settings-form tutor-language-settings">
      <h4>Language Tutor</h4>
      <p className="settings-note">Choose the language you are learning and the language its explanations are written in. Each choice saves when selected.</p>
      <label><span>Tutor language</span><select value={targetDraft} onChange={(event) => void chooseLanguage(TUTOR_LANGUAGE_PREFERENCE, event.target.value, targetDraft, explanationDraft, setTargetDraft)}>
        {TUTOR_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select></label>
      <label><span>Explanations in</span><select value={explanationDraft} onChange={(event) => void chooseLanguage(TUTOR_EXPLANATION_LANGUAGE_PREFERENCE, event.target.value, explanationDraft, targetDraft, setExplanationDraft)}>
        {TUTOR_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select></label>
      {status && <p className="settings-note" role="status">{status}</p>}
    </section>
  )
}
