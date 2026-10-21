import { describe, expect, it } from 'vitest'
import { countDraftWords, hasHighTensionCue, isOffHours, parseToneAssessment, shouldCheckToneGuard } from './toneGuard'

describe('Tone Guard helpers', () => {
  it('checks long drafts and exempts greetings and single emoji messages', () => {
    const afternoon = new Date(2026, 9, 21, 14)
    expect(countDraftWords('hello 🙂')).toBe(2)
    expect(shouldCheckToneGuard('Hello, Alex!', true, new Date(2026, 9, 21, 23), ['You never listen.'])).toBe(false)
    expect(shouldCheckToneGuard('🙂', true, new Date(2026, 9, 21, 23), ['You never listen.'])).toBe(false)
    expect(shouldCheckToneGuard('A short and otherwise harmless message.', false, afternoon, [])).toBe(false)
    expect(shouldCheckToneGuard('This is a longer message with enough words to cross the minimum threshold.', true, afternoon, [])).toBe(true)
    expect(shouldCheckToneGuard('This is a longer message with enough words to cross the minimum threshold.', false, afternoon, [])).toBe(true)
  })

  it('checks off-hours and after tense incoming language even for shorter drafts', () => {
    const late = new Date(2026, 9, 21, 23)
    const afternoon = new Date(2026, 9, 21, 14)
    expect(isOffHours(late)).toBe(true)
    expect(isOffHours(afternoon)).toBe(false)
    expect(hasHighTensionCue('You never listen when I explain the issue.')).toBe(true)
    expect(shouldCheckToneGuard('I disagree.', false, late, [])).toBe(true)
    expect(shouldCheckToneGuard('I disagree.', false, afternoon, ['You never listen when I explain the issue.'])).toBe(true)
  })

  it('parses strict classifier JSON and rejects incomplete unsafe results', () => {
    const valid = parseToneAssessment('```json\n{"is_hostile_or_unprofessional":true,"severity":"HIGH","tone_tags":["accusatory"],"calmer_alternative":"Can we review this together?"}\n```')
    expect(valid?.severity).toBe('HIGH')
    expect(valid?.calmer_alternative).toBe('Can we review this together?')
    expect(parseToneAssessment('{not json}')).toBeNull()
    expect(parseToneAssessment('{"is_hostile_or_unprofessional":true,"severity":"HIGH","tone_tags":[],"calmer_alternative":""}')).toBeNull()
  })
})