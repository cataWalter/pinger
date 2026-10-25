import { useState } from 'react'
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  KNOWN_LANGUAGES_PREFERENCE,
  LANGUAGE_OPTIONS,
  TUTOR_LANGUAGE_PREFERENCE,
  serializeKnownLanguages,
  type LanguageRoles,
} from './aiSettings'

export function LanguageSettings({ roles, onSave }: {
  roles: LanguageRoles
  onSave: (key: string, value: string) => Promise<boolean>
}) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function chooseLearningLanguage(code: string) {
    if (code === roles.learning) return
    if (code === roles.defaultLanguage) {
      setStatus('Choose two different languages.')
      return
    }
    setBusy(true)
    setStatus('')
    const saved = await onSave(TUTOR_LANGUAGE_PREFERENCE, code)
    setBusy(false)
    setStatus(saved ? 'Language to learn saved.' : 'Not saved.')
  }

  async function chooseDefaultLanguage(code: string) {
    if (code === roles.defaultLanguage) return
    if (code === roles.learning) {
      setStatus('Choose two different languages.')
      return
    }
    setBusy(true)
    setStatus('')
    let saved = await onSave(DEFAULT_LANGUAGE_PREFERENCE, code)
    // The default language is always known, so store it with the known list as well.
    if (saved && !roles.known.includes(code)) {
      saved = await onSave(KNOWN_LANGUAGES_PREFERENCE, serializeKnownLanguages([...roles.known, code]))
    }
    setBusy(false)
    setStatus(saved ? 'Default language saved.' : 'Not saved.')
  }

  async function toggleKnownLanguage(code: string, known: boolean) {
    const next = known ? [...roles.known, code] : roles.known.filter((candidate) => candidate !== code)
    if (!next.includes(roles.defaultLanguage)) return
    setBusy(true)
    setStatus('')
    const saved = await onSave(KNOWN_LANGUAGES_PREFERENCE, serializeKnownLanguages(next))
    setBusy(false)
    setStatus(saved ? 'Known languages saved.' : 'Not saved.')
  }

  return (
    <section className="ai-settings-form language-settings">
      <h4>Languages</h4>
      <p className="settings-note">Choose the language you are learning, the default language for translations and explanations, and the languages you know. Each change saves when you make it.</p>
      <label><span>Language to learn</span><select aria-label="Language to learn" value={roles.learning} disabled={busy} onChange={(event) => void chooseLearningLanguage(event.target.value)}>
        {LANGUAGE_OPTIONS.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select></label>
      <label><span>Default language</span><select aria-label="Default language" value={roles.defaultLanguage} disabled={busy} onChange={(event) => void chooseDefaultLanguage(event.target.value)}>
        {LANGUAGE_OPTIONS.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select></label>
      <fieldset className="language-known-list" disabled={busy}>
        <legend>Languages you know</legend>
        {LANGUAGE_OPTIONS.map((language) => {
          const isDefault = language.code === roles.defaultLanguage
          return <label key={language.code} title={isDefault ? 'The default language is always known.' : undefined}>
            <input
              type="checkbox"
              checked={roles.known.includes(language.code)}
              disabled={isDefault}
              onChange={(event) => void toggleKnownLanguage(language.code, event.target.checked)}
            />
            <span>{language.name}</span>
          </label>
        })}
      </fieldset>
      {status && <p className="settings-note" role="status">{status}</p>}
    </section>
  )
}
