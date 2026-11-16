import { describe, expect, it } from 'vitest'
import { chatLanguageChange } from './aiLanguages'

describe('chatLanguageChange', () => {
  it('sets the learning language and remembers it as automatic', () => {
    expect(chatLanguageChange({ current: '', detectedBefore: '', detected: 'es', defaultLanguage: 'en' })).toEqual({ learning: 'es', detected: 'es' })
  })

  it('replaces an earlier automatic value when the chat changes language', () => {
    expect(chatLanguageChange({ current: 'es', detectedBefore: 'es', detected: 'it', defaultLanguage: 'en' })).toEqual({ learning: 'it', detected: 'it' })
  })

  it('keeps a learning language the user chose', () => {
    expect(chatLanguageChange({ current: 'fr', detectedBefore: 'es', detected: 'it', defaultLanguage: 'en' })).toBeNull()
    expect(chatLanguageChange({ current: 'fr', detectedBefore: '', detected: 'it', defaultLanguage: 'en' })).toBeNull()
  })

  it('clears the automatic value when the chat is in the default language', () => {
    expect(chatLanguageChange({ current: 'it', detectedBefore: 'it', detected: 'en', defaultLanguage: 'en' })).toEqual({ learning: '', detected: '' })
  })

  it('does nothing when the stored values already match', () => {
    expect(chatLanguageChange({ current: 'es', detectedBefore: 'es', detected: 'es', defaultLanguage: 'en' })).toBeNull()
    expect(chatLanguageChange({ current: '', detectedBefore: '', detected: 'en', defaultLanguage: 'en' })).toBeNull()
  })

  it('ignores an empty detection', () => {
    expect(chatLanguageChange({ current: 'it', detectedBefore: 'it', detected: '', defaultLanguage: 'en' })).toBeNull()
  })
})
