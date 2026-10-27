import { describe, expect, it } from 'vitest'
import {
  AI_FEATURE_SPECS,
  AI_MAX_TOKENS_LIMIT,
  AI_TEMPERATURE_MAX,
  AI_TEMPERATURE_MIN,
  LANGUAGE_OPTIONS,
  aiFeatureDraftFromTuning,
  aiFeaturePreferenceEntries,
  aiFeatureResetEntries,
  aiFeatureSpec,
  buildAIFeatureSystemPrompt,
  languageName,
  parseAIMaxTokens,
  parseAITemperature,
  parseKnownLanguages,
  renderAITemplate,
  resolveAIFeatureTuning,
  resolveLanguageRoles,
  serializeKnownLanguages,
  tuningFromPreferences,
  validateAIFeatureDraft,
} from './aiSettings'

describe('AI feature settings', () => {
  it('has one spec per tunable feature with placeholders present in the default prompt', () => {
    expect(AI_FEATURE_SPECS).toHaveLength(10)
    expect(new Set(AI_FEATURE_SPECS.map((spec) => spec.id)).size).toBe(10)
    for (const spec of AI_FEATURE_SPECS) {
      expect(spec.prompt.trim()).not.toBe('')
      for (const placeholder of spec.placeholders) {
        expect(spec.prompt).toContain(placeholder)
      }
    }
  })

  it('keeps every built-in temperature between the minimum and maximum', () => {
    expect(AI_TEMPERATURE_MIN).toBe(0.6)
    for (const spec of AI_FEATURE_SPECS) {
      expect(spec.temperature).toBeGreaterThanOrEqual(AI_TEMPERATURE_MIN)
      expect(spec.temperature).toBeLessThanOrEqual(AI_TEMPERATURE_MAX)
    }
  })

  it('resolves built-in defaults when no overrides are saved', () => {
    expect(resolveAIFeatureTuning({}, 'tone_guard')).toEqual({
      prompt: aiFeatureSpec('tone_guard').prompt,
      temperature: 0.6,
      maxTokens: 192,
    })
    expect(resolveAIFeatureTuning({}, 'summarize').maxTokens).toBe(0)
  })

  it('uses saved overrides and falls back to defaults for blank or invalid values', () => {
    const preferences = {
      'ai.feature.explain.prompt': '  Explain like a teacher.  ',
      'ai.feature.explain.temperature': '0.9',
      'ai.feature.explain.max_tokens': '300',
      'ai.feature.summarize.temperature': 'hot',
      'ai.feature.summarize.max_tokens': '0',
    }

    expect(resolveAIFeatureTuning(preferences, 'explain')).toEqual({ prompt: 'Explain like a teacher.', temperature: 0.9, maxTokens: 300 })
    expect(resolveAIFeatureTuning(preferences, 'summarize')).toEqual({
      prompt: aiFeatureSpec('summarize').prompt,
      temperature: 0.6,
      maxTokens: 0,
    })
  })

  it('falls back to the default for a saved temperature below the minimum', () => {
    const defaults = { prompt: 'p', temperature: 0.8, maxTokens: 0 }

    expect(tuningFromPreferences({ 'ai.feature.x.temperature': '0.2' }, 'x', defaults).temperature).toBe(0.8)
    expect(tuningFromPreferences({ 'ai.feature.x.temperature': '0.6' }, 'x', defaults).temperature).toBe(0.6)
  })

  it('parses temperature and max tokens within the allowed ranges', () => {
    expect(parseAITemperature('')).toBeNull()
    expect(parseAITemperature('0')).toBeNull()
    expect(parseAITemperature('0.5')).toBeNull()
    expect(parseAITemperature('0.6')).toBe(0.6)
    expect(parseAITemperature('2')).toBe(2)
    expect(parseAITemperature('2.5')).toBeNull()
    expect(parseAITemperature('-0.1')).toBeNull()
    expect(parseAIMaxTokens('0')).toBe(0)
    expect(parseAIMaxTokens(String(AI_MAX_TOKENS_LIMIT))).toBe(AI_MAX_TOKENS_LIMIT)
    expect(parseAIMaxTokens('1.5')).toBeNull()
    expect(parseAIMaxTokens('-1')).toBeNull()
  })

  it('keeps the fixed rules after custom instructions', () => {
    const system = buildAIFeatureSystemPrompt('summarize', 'Use short bullets.')

    expect(system).toBe(`Use short bullets. ${aiFeatureSpec('summarize').fixedRules}`)
  })

  it('uses the default prompt when instructions are blank', () => {
    const summarize = aiFeatureSpec('summarize')
    expect(buildAIFeatureSystemPrompt('summarize', '   ')).toBe(`${summarize.prompt} ${summarize.fixedRules}`)
  })

  it('fills placeholders without reading substituted values again', () => {
    expect(renderAITemplate('Hi {name}, {missing}', { name: '{instructions}' })).toBe('Hi {instructions}, {missing}')
  })

  it('validates draft limits and accepts blank optional numbers', () => {
    const valid = { prompt: 'Be brief.', temperature: '1.5', maxTokens: '512' }

    expect(validateAIFeatureDraft(valid)).toBe('')
    expect(validateAIFeatureDraft({ prompt: '', temperature: '', maxTokens: '' })).toBe('')
    expect(validateAIFeatureDraft({ ...valid, prompt: 'x'.repeat(8001) })).toContain('8000 characters')
    expect(validateAIFeatureDraft({ ...valid, temperature: '0.3' })).toBe('Temperature must be a number from 0.6 to 2.')
    expect(validateAIFeatureDraft({ ...valid, temperature: '2.5' })).toContain('from 0.6 to 2')
    expect(validateAIFeatureDraft({ ...valid, maxTokens: '1.5' })).toContain('whole number')
    expect(validateAIFeatureDraft({ ...valid, maxTokens: '9000' })).toContain(String(AI_MAX_TOKENS_LIMIT))
  })

  it('stores only real overrides and clears values that match the default', () => {
    const defaults = { prompt: 'Default text.', temperature: 0.5, maxTokens: 0 }

    expect(aiFeaturePreferenceEntries('explain', { prompt: 'Default text.', temperature: '0.5', maxTokens: '' }, defaults)).toEqual([
      ['ai.feature.explain.prompt', ''],
      ['ai.feature.explain.temperature', ''],
      ['ai.feature.explain.max_tokens', ''],
    ])
    expect(aiFeaturePreferenceEntries('explain', { prompt: '  Custom.  ', temperature: '0.8', maxTokens: '400' }, defaults)).toEqual([
      ['ai.feature.explain.prompt', 'Custom.'],
      ['ai.feature.explain.temperature', '0.8'],
      ['ai.feature.explain.max_tokens', '400'],
    ])
  })

  it('resets every field to blank and converts tuning into draft strings', () => {
    expect(aiFeatureResetEntries('explain')).toEqual([
      ['ai.feature.explain.prompt', ''],
      ['ai.feature.explain.temperature', ''],
      ['ai.feature.explain.max_tokens', ''],
    ])
    expect(aiFeatureDraftFromTuning({ prompt: 'p', temperature: 0.2, maxTokens: 0 })).toEqual({ prompt: 'p', temperature: '0.2', maxTokens: '' })
  })

  it('lists every supported language once', () => {
    const codes = LANGUAGE_OPTIONS.map((language) => language.code)

    expect(codes).toHaveLength(16)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toContain('en')
    expect(codes).toContain('tr')
  })

  it('names languages and returns unknown codes unchanged', () => {
    expect(languageName('es')).toBe('Spanish')
    expect(languageName('xx')).toBe('xx')
    expect(languageName()).toBe('')
  })

  it('resolves the learning, default, and known languages with the backend fallbacks', () => {
    expect(resolveLanguageRoles({})).toEqual({ learning: 'tr', defaultLanguage: 'en', known: ['en'] })
    expect(resolveLanguageRoles({
      'ai.tutor_language': 'de',
      'ai.default_language': 'fr',
      'ai.known_languages': '["en","fr"]',
    })).toEqual({ learning: 'de', defaultLanguage: 'fr', known: ['en', 'fr'] })
    expect(resolveLanguageRoles({ 'ai.default_language': 'fr', 'ai.known_languages': '["en"]' }).known).toEqual(['en', 'fr'])
    expect(resolveLanguageRoles({ 'ai.tutor_language': 'xx', 'ai.default_language': 'tr' })).toEqual({ learning: 'es', defaultLanguage: 'tr', known: ['tr'] })
    expect(resolveLanguageRoles({ 'ai.tutor_language': true, 'ai.default_language': 'de' })).toEqual({ learning: 'tr', defaultLanguage: 'de', known: ['de'] })
  })

  it('chooses a different learning language when the learning and default languages match', () => {
    expect(resolveLanguageRoles({ 'ai.tutor_language': 'es', 'ai.default_language': 'es' })).toEqual({ learning: 'tr', defaultLanguage: 'es', known: ['es'] })
    expect(resolveLanguageRoles({ 'ai.tutor_language': 'tr', 'ai.default_language': 'tr' })).toEqual({ learning: 'es', defaultLanguage: 'tr', known: ['tr'] })
  })

  it('parses known languages and drops unsupported or repeated codes', () => {
    expect(parseKnownLanguages('["tr","xx","tr","de",3]')).toEqual(['tr', 'de'])
    expect(parseKnownLanguages('not json')).toEqual([])
    expect(parseKnownLanguages('{"tr":true}')).toEqual([])
    expect(parseKnownLanguages(undefined)).toEqual([])
  })

  it('serializes known languages in a stable order without unsupported codes', () => {
    expect(serializeKnownLanguages(['tr', 'en', 'xx'])).toBe('["en","tr"]')
    expect(serializeKnownLanguages([])).toBe('[]')
  })
})
