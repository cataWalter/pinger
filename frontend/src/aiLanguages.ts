import languageCatalog from '../../preferences/languages.json'

export interface LanguageEntry {
  code: string
  name: string
}

// BUILT_IN_LANGUAGES is preferences/languages.json, the same catalog the Go backend embeds.
export const BUILT_IN_LANGUAGES: readonly LanguageEntry[] = languageCatalog

export const CUSTOM_LANGUAGES_PREFERENCE = 'ai.custom_languages'

// Limits and the code pattern must match preferences/languages.go.
export const MAX_CUSTOM_LANGUAGES = 8

export const MAX_CUSTOM_LANGUAGE_NAME_LENGTH = 40

export const CUSTOM_LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/

export const TUTOR_LANGUAGE_PREFERENCE = 'ai.tutor_language'

export const DEFAULT_LANGUAGE_PREFERENCE = 'ai.default_language'

export const KNOWN_LANGUAGES_PREFERENCE = 'ai.known_languages'

// Fallbacks mirror tutorLanguagesFromPreferences in desktop/language_tutor_service.go.
export const DEFAULT_LANGUAGE = 'en'

export const LEARNING_LANGUAGE_FALLBACK = 'tr'

export const LEARNING_LANGUAGE_ALTERNATIVE = 'es'

export interface LanguageRoles {
  // learning is the language the user is studying.
  learning: string
  // defaultLanguage is the app language. Translations and tutor explanations use it unless another known language is chosen.
  defaultLanguage: string
  // known lists the languages the user can choose for explanations. It always includes defaultLanguage.
  known: string[]
  // languages lists every selectable language: the built-in catalog followed by the valid custom languages.
  languages: readonly LanguageEntry[]
  // custom lists the valid custom languages from ai.custom_languages.
  custom: LanguageEntry[]
}

// languageName returns the English name for a code, or the code itself when unknown.
export function languageName(code = '', languages: readonly LanguageEntry[] = BUILT_IN_LANGUAGES): string {
  return languages.find((language) => language.code === code)?.name ?? code
}

export function supportedLanguageCode(value: unknown, languages: readonly LanguageEntry[]): string {
  return typeof value === 'string' && languages.some((language) => language.code === value) ? value : ''
}

export function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 0x20 || (code >= 0x7f && code <= 0x9f)
  })
}

// customLanguageError explains why entry cannot join existing, or returns an empty string when it can.
// The name must already be trimmed. The rules mirror validateCustomLanguages in preferences/languages.go.
export function customLanguageError(entry: LanguageEntry, existing: readonly LanguageEntry[]): string {
  if (existing.length >= MAX_CUSTOM_LANGUAGES) return `You can add up to ${MAX_CUSTOM_LANGUAGES} custom languages.`
  if (!CUSTOM_LANGUAGE_CODE_PATTERN.test(entry.code)) return 'Use a basic language code such as pt-BR.'
  if (BUILT_IN_LANGUAGES.some((language) => language.code === entry.code)) return 'That language is already built in.'
  const folded = entry.code.toLowerCase()
  if (existing.some((language) => language.code.toLowerCase() === folded)) return 'That code is already a custom language.'
  if (entry.name === '') return 'Enter a name for the language.'
  if (entry.name !== entry.name.trim()) return 'Remove spaces around the name.'
  if ([...entry.name].length > MAX_CUSTOM_LANGUAGE_NAME_LENGTH) return `Names can be at most ${MAX_CUSTOM_LANGUAGE_NAME_LENGTH} characters.`
  if (hasControlCharacter(entry.name)) return 'Names cannot contain control characters.'
  return ''
}

export function isLanguageEntry(value: unknown): value is LanguageEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<LanguageEntry>
  return typeof entry.code === 'string' && typeof entry.name === 'string'
}

// parseCustomLanguages reads ai.custom_languages. Like the backend lookup, an invalid list is ignored as a whole.
export function parseCustomLanguages(value: unknown): LanguageEntry[] {
  if (typeof value !== 'string' || value.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const entries: LanguageEntry[] = []
  for (const item of parsed) {
    if (!isLanguageEntry(item) || customLanguageError(item, entries) !== '') return []
    entries.push({ code: item.code, name: item.name })
  }
  return entries
}

// serializeCustomLanguages writes ai.custom_languages in the order given.
export function serializeCustomLanguages(entries: readonly LanguageEntry[]): string {
  return JSON.stringify(entries.map((entry) => ({ code: entry.code, name: entry.name })))
}

// parseKnownLanguages reads ai.known_languages, a JSON array of codes. Unsupported and repeated codes are dropped.
export function parseKnownLanguages(value: unknown, languages: readonly LanguageEntry[] = BUILT_IN_LANGUAGES): string[] {
  if (typeof value !== 'string') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const codes = parsed.filter((code): code is string => typeof code === 'string')
  return codes.filter((code, index) => supportedLanguageCode(code, languages) !== '' && codes.indexOf(code) === index)
}

// serializeKnownLanguages writes codes in the order of languages, so the stored value is stable.
export function serializeKnownLanguages(codes: readonly string[], languages: readonly LanguageEntry[] = BUILT_IN_LANGUAGES): string {
  return JSON.stringify(languages.map((language) => language.code).filter((code) => codes.includes(code)))
}

// resolveLanguageRoles mirrors tutorLanguagesFromPreferences in desktop/language_tutor_service.go.
export function resolveLanguageRoles(preferences: Readonly<Record<string, unknown>>): LanguageRoles {
  const custom = parseCustomLanguages(preferences[CUSTOM_LANGUAGES_PREFERENCE])
  const languages: LanguageEntry[] = [...BUILT_IN_LANGUAGES, ...custom]
  const defaultLanguage = supportedLanguageCode(preferences[DEFAULT_LANGUAGE_PREFERENCE], languages) || DEFAULT_LANGUAGE
  let learning = supportedLanguageCode(preferences[TUTOR_LANGUAGE_PREFERENCE], languages)
  if (!learning || learning === defaultLanguage) {
    learning = defaultLanguage === LEARNING_LANGUAGE_FALLBACK ? LEARNING_LANGUAGE_ALTERNATIVE : LEARNING_LANGUAGE_FALLBACK
  }
  const known = parseKnownLanguages(preferences[KNOWN_LANGUAGES_PREFERENCE], languages)
  if (!known.includes(defaultLanguage)) known.push(defaultLanguage)
  return { learning, defaultLanguage, known, languages, custom }
}

// roomTutorLanguageKey is the account preference that stores one chat's tutor language. An empty value means the default.
export function roomTutorLanguageKey(roomID: string): string {
  return `room.tutor_language.${roomID}`
}

// roomLearningLanguageKey stores the per-chat learning language. An empty value means use the global learning language.
export function roomLearningLanguageKey(roomID: string): string {
  return `room.learning_language.${roomID}`
}

// detectedChatLanguageKey stores the language detected automatically for a chat the last time it was written to roomLearningLanguageKey.
export function detectedChatLanguageKey(roomID: string): string {
  return `room.detected_language.${roomID}`
}

// chatLanguageChange decides whether an automatic detection should replace a chat's learning language. It returns null when
// nothing should change. A learning language the user chose, which differs from the last automatic value, is never replaced.
// A chat written in the default language has no learning language, so the automatic value is cleared.
export function chatLanguageChange(state: { current: string; detectedBefore: string; detected: string; defaultLanguage: string }): { learning: string; detected: string } | null {
  if (!state.detected) return null
  if (state.current !== '' && state.current !== state.detectedBefore) return null
  const learning = state.detected === state.defaultLanguage ? '' : state.detected
  if (state.current === learning && state.detectedBefore === learning) return null
  return { learning, detected: learning }
}

// roomTutorLanguageChoice returns the language a chat chose for its tutor, or an empty string for the default.
export function roomTutorLanguageChoice(preferences: Readonly<Record<string, unknown>>, roomID: string): string {
  const roles = resolveLanguageRoles(preferences)
  const chosen = roomID ? preferences[roomTutorLanguageKey(roomID)] : undefined
  return supportedLanguageCode(chosen, roles.languages)
}

// resolveChatTutorLanguage returns the tutor language for one chat, falling back to the default language.
export function resolveChatTutorLanguage(preferences: Readonly<Record<string, unknown>>, roomID: string): string {
  return roomTutorLanguageChoice(preferences, roomID) || resolveLanguageRoles(preferences).defaultLanguage
}

// roomLearningLanguageChoice returns the language a chat chose to learn, or an empty string for the global default.
export function roomLearningLanguageChoice(preferences: Readonly<Record<string, unknown>>, roomID: string): string {
  const roles = resolveLanguageRoles(preferences)
  const chosen = roomID ? preferences[roomLearningLanguageKey(roomID)] : undefined
  return supportedLanguageCode(chosen, roles.languages)
}

// resolveChatLearningLanguage returns the learning language for one chat, falling back to the global learning language.
export function resolveChatLearningLanguage(preferences: Readonly<Record<string, unknown>>, roomID: string): string {
  return roomLearningLanguageChoice(preferences, roomID) || resolveLanguageRoles(preferences).learning
}
