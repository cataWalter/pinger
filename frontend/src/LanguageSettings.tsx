import { useState, type FormEvent } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import {
  BUILT_IN_LANGUAGES,
  CUSTOM_LANGUAGES_PREFERENCE,
  DEFAULT_LANGUAGE_PREFERENCE,
  KNOWN_LANGUAGES_PREFERENCE,
  MAX_CUSTOM_LANGUAGE_NAME_LENGTH,
  MAX_CUSTOM_LANGUAGES,
  TUTOR_LANGUAGE_PREFERENCE,
  customLanguageError,
  languageName,
  roomLearningLanguageKey,
  roomTutorLanguageKey,
  serializeCustomLanguages,
  serializeKnownLanguages,
  type LanguageEntry,
  type LanguageRoles,
} from './aiSettings'

export function LanguageSettings({ roles, preferences, rooms, onPreferencesChange }: {
  roles: LanguageRoles
  preferences: Readonly<Record<string, unknown>>
  rooms: readonly { id: string; name: string }[]
  // onPreferencesChange saves every entry in one request, so related preferences never end up half-saved.
  onPreferencesChange: (entries: Record<string, string>) => Promise<boolean>
}) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const supportedLanguageCodes = new Set(roles.languages.map((language) => language.code))
  const roomOverrides = rooms.flatMap((room) => {
    const learningValue = preferences[roomLearningLanguageKey(room.id)]
    const explanationValue = preferences[roomTutorLanguageKey(room.id)]
    const learning = typeof learningValue === 'string' && supportedLanguageCodes.has(learningValue) ? learningValue : ''
    const explanation = typeof explanationValue === 'string' && supportedLanguageCodes.has(explanationValue) ? explanationValue : ''
    return learning || explanation ? [{ room, learning, explanation }] : []
  })

  async function save(entries: Record<string, string>, savedMessage: string) {
    setBusy(true)
    setStatus('')
    const saved = await onPreferencesChange(entries)
    setBusy(false)
    setStatus(saved ? savedMessage : 'Not saved.')
    return saved
  }

  async function chooseLearningLanguage(code: string) {
    if (code === roles.learning) return
    if (code === roles.defaultLanguage) {
      setStatus('Choose two different languages.')
      return
    }
    await save({ [TUTOR_LANGUAGE_PREFERENCE]: code }, 'Language to learn saved.')
  }

  async function chooseDefaultLanguage(code: string) {
    if (code === roles.defaultLanguage) return
    if (code === roles.learning) {
      setStatus('Choose two different languages.')
      return
    }
    const entries: Record<string, string> = { [DEFAULT_LANGUAGE_PREFERENCE]: code }
    // The default language is always known, so store it with the known list in the same save.
    if (!roles.known.includes(code)) {
      entries[KNOWN_LANGUAGES_PREFERENCE] = serializeKnownLanguages([...roles.known, code], roles.languages)
    }
    await save(entries, 'Default language saved.')
  }

  async function toggleKnownLanguage(code: string, known: boolean) {
    const next = known ? [...roles.known, code] : roles.known.filter((candidate) => candidate !== code)
    if (!next.includes(roles.defaultLanguage)) return
    await save({ [KNOWN_LANGUAGES_PREFERENCE]: serializeKnownLanguages(next, roles.languages) }, 'Known languages saved.')
  }

  async function addCustomLanguage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entry: LanguageEntry = { code: newCode.trim(), name: newName.trim() }
    const error = customLanguageError(entry, roles.custom)
    if (error) {
      setStatus(error)
      return
    }
    const saved = await save({ [CUSTOM_LANGUAGES_PREFERENCE]: serializeCustomLanguages([...roles.custom, entry]) }, 'Custom language added.')
    if (saved) {
      setNewCode('')
      setNewName('')
    }
  }

  async function removeCustomLanguage(code: string) {
    if (code === roles.learning || code === roles.defaultLanguage) {
      setStatus('Choose another language to learn or default language before removing this one.')
      return
    }
    const overridingRooms = roomOverrides
      .filter(({ learning, explanation }) => learning === code || explanation === code)
      .map(({ room }) => room.name || room.id)
    if (overridingRooms.length > 0) {
      setStatus(`This language is used by chat-specific settings in ${overridingRooms.join(', ')}. Reset those chats to global defaults before removing it.`)
      return
    }
    const remaining = roles.custom.filter((language) => language.code !== code)
    const remainingLanguages = [...BUILT_IN_LANGUAGES, ...remaining]
    await save({
      [CUSTOM_LANGUAGES_PREFERENCE]: serializeCustomLanguages(remaining),
      [KNOWN_LANGUAGES_PREFERENCE]: serializeKnownLanguages(roles.known.filter((candidate) => candidate !== code), remainingLanguages),
    }, 'Custom language removed.')
  }

  async function resetRoomLanguages(roomID: string, roomName: string) {
    await save({
      [roomLearningLanguageKey(roomID)]: '',
      [roomTutorLanguageKey(roomID)]: '',
    }, `${roomName} now uses the global language defaults.`)
  }

  return (
    <section className="ai-settings-form language-settings">
      <h4>Languages</h4>
      <p className="settings-note">Set the global learning and translation defaults. Each chat can use different languages. Each change saves when you make it.</p>
      <label><span>Default learning language</span><select aria-label="Default learning language" value={roles.learning} disabled={busy} onChange={(event) => void chooseLearningLanguage(event.target.value)}>
        {roles.languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select></label>
      <label><span>Default for translations and explanations</span><select aria-label="Default for translations and explanations" value={roles.defaultLanguage} disabled={busy} onChange={(event) => void chooseDefaultLanguage(event.target.value)}>
        {roles.languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select></label>
      {roomOverrides.length > 0 && <fieldset className="language-room-overrides">
        <legend>Chat-specific languages</legend>
        <ul>
          {roomOverrides.map(({ room, learning, explanation }) => {
            const roomName = room.name || room.id
            const learningName = languageName(learning || roles.learning, roles.languages)
            const explanationName = languageName(explanation || roles.defaultLanguage, roles.languages)
            return <li key={room.id}>
              <div className="language-room-summary">
                <strong>{roomName}</strong>
                <p>Learning: {learningName}{learning ? '' : ' (default)'}</p>
                <p>Translations and explanations: {explanationName}{explanation ? '' : ' (default)'}</p>
              </div>
              <button type="button" className="settings-command" aria-label={`Reset languages for ${roomName}`} disabled={busy} onClick={() => void resetRoomLanguages(room.id, roomName)}>
                <RotateCcw size={13} aria-hidden="true" />
                <span>Use defaults</span>
              </button>
            </li>
          })}
        </ul>
      </fieldset>}
      <fieldset className="language-known-list" disabled={busy}>
        <legend>Languages you know</legend>
        {roles.languages.map((language) => {
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
      <fieldset className="language-custom-list" disabled={busy}>
        <legend>Custom languages</legend>
        <p className="settings-note">Add up to {MAX_CUSTOM_LANGUAGES} languages that are not built in. Use a basic code such as pt-BR and a name of up to {MAX_CUSTOM_LANGUAGE_NAME_LENGTH} characters.</p>
        {roles.custom.length === 0 && <p className="settings-note">No custom languages yet.</p>}
        {roles.custom.length > 0 && <ul className="language-custom-items">
          {roles.custom.map((language) => <li key={language.code}>
            <span>{language.name} ({language.code})</span>
            <button type="button" className="settings-command" aria-label={`Remove ${language.name}`} onClick={() => void removeCustomLanguage(language.code)}>
              <X size={13} aria-hidden="true" />
            </button>
          </li>)}
        </ul>}
        <form className="language-custom-form" onSubmit={(event) => void addCustomLanguage(event)}>
          <label><span>Code</span><input value={newCode} maxLength={20} placeholder="pt-BR" onChange={(event) => setNewCode(event.target.value)} /></label>
          <label><span>Name</span><input value={newName} maxLength={MAX_CUSTOM_LANGUAGE_NAME_LENGTH} placeholder="Brazilian Portuguese" onChange={(event) => setNewName(event.target.value)} /></label>
          <button type="submit" className="settings-command" disabled={busy || roles.custom.length >= MAX_CUSTOM_LANGUAGES}>
            <Plus size={13} aria-hidden="true" />
            <span>Add language</span>
          </button>
        </form>
      </fieldset>
      {status && <p className="settings-note" role="status">{status}</p>}
    </section>
  )
}
