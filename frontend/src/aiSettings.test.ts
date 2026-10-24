import { describe, expect, it } from 'vitest'
import {
  AI_FEATURE_SPECS,
  AI_MAX_TOKENS_LIMIT,
  aiFeatureDraftFromTuning,
  aiFeaturePreferenceEntries,
  aiFeatureResetEntries,
  aiFeatureSpec,
  buildAIFeatureSystemPrompt,
  parseAIMaxTokens,
  parseAITemperature,
  renderAITemplate,
  resolveAIFeatureTuning,
  tuningFromPreferences,
  validateAIFeatureDraft,
} from './aiSettings'

describe('AI feature settings', () => {
  it('has one spec per tunable feature with placeholders present in the default prompt', () => {
    expect(AI_FEATURE_SPECS).toHaveLength(12)
    expect(new Set(AI_FEATURE_SPECS.map((spec) => spec.id)).size).toBe(12)
    for (const spec of AI_FEATURE_SPECS) {
      expect(spec.prompt.trim()).not.toBe('')
      for (const placeholder of spec.placeholders) {
        expect(spec.prompt).toContain(placeholder)
      }
    }
  })

  it('resolves built-in defaults when no overrides are saved', () => {
    expect(resolveAIFeatureTuning({}, 'tone_guard')).toEqual({
      prompt: aiFeatureSpec('tone_guard').prompt,
      temperature: 0.1,
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
      temperature: 0.5,
      maxTokens: 0,
    })
  })

  it('keeps a temperature of zero instead of replacing it with the default', () => {
    expect(tuningFromPreferences({ 'ai.feature.x.temperature': '0' }, 'x', { prompt: 'p', temperature: 0.5, maxTokens: 0 }).temperature).toBe(0)
  })

  it('parses temperature and max tokens within the allowed ranges', () => {
    expect(parseAITemperature('')).toBeNull()
    expect(parseAITemperature('0')).toBe(0)
    expect(parseAITemperature('2')).toBe(2)
    expect(parseAITemperature('2.5')).toBeNull()
    expect(parseAITemperature('-0.1')).toBeNull()
    expect(parseAIMaxTokens('0')).toBe(0)
    expect(parseAIMaxTokens(String(AI_MAX_TOKENS_LIMIT))).toBe(AI_MAX_TOKENS_LIMIT)
    expect(parseAIMaxTokens('1.5')).toBeNull()
    expect(parseAIMaxTokens('-1')).toBeNull()
  })

  it('keeps the fixed rules after custom instructions', () => {
    const system = buildAIFeatureSystemPrompt('chat_translation', 'Translate into Turkish.')

    expect(system).toBe(`Translate into Turkish. ${aiFeatureSpec('chat_translation').fixedRules}`)
    expect(system).toContain('one valid JSON array of strings')
  })

  it('uses the default prompt when instructions are blank and fills the language placeholder', () => {
    const summarize = aiFeatureSpec('summarize')
    expect(buildAIFeatureSystemPrompt('summarize', '   ')).toBe(`${summarize.prompt} ${summarize.fixedRules}`)
    expect(buildAIFeatureSystemPrompt('translate', '', { language: 'French' })).toContain('Translate the user\'s message into French.')
  })

  it('fills placeholders without reading substituted values again', () => {
    expect(renderAITemplate('Hi {name}, {missing}', { name: '{instructions}' })).toBe('Hi {instructions}, {missing}')
  })

  it('validates draft limits and accepts blank optional numbers', () => {
    const valid = { prompt: 'Be brief.', temperature: '1.5', maxTokens: '512' }

    expect(validateAIFeatureDraft(valid)).toBe('')
    expect(validateAIFeatureDraft({ prompt: '', temperature: '', maxTokens: '' })).toBe('')
    expect(validateAIFeatureDraft({ ...valid, prompt: 'x'.repeat(8001) })).toContain('8000 characters')
    expect(validateAIFeatureDraft({ ...valid, temperature: '2.5' })).toContain('from 0 to 2')
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
})
