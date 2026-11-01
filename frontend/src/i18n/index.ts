import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de'
import en from './en'
import es from './es'
import fr from './fr'
import it from './it'

const supportedLanguages = ['en', 'it', 'es', 'de', 'fr'] as const
export type SupportedLanguage = typeof supportedLanguages[number]

export const languageOptions = [
  { value: 'system', labelKey: 'settings.languageSystem' },
  { value: 'en', labelKey: 'settings.languageEnglish' },
  { value: 'it', labelKey: 'settings.languageItalian' },
  { value: 'es', labelKey: 'settings.languageSpanish' },
  { value: 'de', labelKey: 'settings.languageGerman' },
  { value: 'fr', labelKey: 'settings.languageFrench' },
] as const

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      it: { translation: it },
      es: { translation: es },
      de: { translation: de },
      fr: { translation: fr },
    },
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })

function systemLanguage(): SupportedLanguage {
  const candidate = typeof navigator === 'undefined'
    ? 'en'
    : (navigator.languages?.[0] || navigator.language || 'en').split('-')[0].toLowerCase()
  return supportedLanguages.includes(candidate as SupportedLanguage) ? candidate as SupportedLanguage : 'en'
}

export function resolveLanguage(preference: string): SupportedLanguage {
  if (preference === 'system') return systemLanguage()
  const candidate = preference.split('-')[0].toLowerCase()
  return supportedLanguages.includes(candidate as SupportedLanguage) ? candidate as SupportedLanguage : 'en'
}

export function applyLanguage(preference: string) {
  return i18n.changeLanguage(resolveLanguage(preference))
}

export function activeLocale() {
  return i18n.resolvedLanguage || 'en'
}

export { i18n }