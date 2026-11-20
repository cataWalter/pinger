import { beforeEach, describe, expect, it } from 'vitest'
import { type TutorAnalysis } from '../bindings/mychat/desktop/models.js'
import { type ChatTranslationState } from './appTypes'
import { clearParkedChatTranslations, dropUnloadedChatTranslations, parkChatTranslation, takeParkedChatTranslation } from './chatTranslationStash'

function analysis(translation: string) {
  return { translation } as TutorAnalysis
}

function translationFor(roomID: string, analyses: Record<string, TutorAnalysis>, overrides: Partial<ChatTranslationState> = {}): ChatTranslationState {
  return {
    requestID: 1,
    roomID,
    targetLanguage: 'English',
    targetMessageIDs: Object.keys(analyses),
    analyses,
    busy: false,
    status: '',
    error: '',
    ...overrides,
  }
}

describe('chatTranslationStash', () => {
  beforeEach(() => {
    clearParkedChatTranslations()
  })

  it('restores parked analyses when the chat is reopened and removes them from RAM', () => {
    parkChatTranslation('acct', translationFor('!room:example', { m1: analysis('hola') }))

    const restored = takeParkedChatTranslation('acct', '!room:example')
    expect(restored?.analyses).toEqual({ m1: analysis('hola') })
    expect(takeParkedChatTranslation('acct', '!room:example')).toBeNull()
  })

  it('resets busy, status and error when parking interrupted work', () => {
    parkChatTranslation('acct', translationFor('!room:example', { m1: analysis('hola') }, { busy: true, status: 'Translating 40%…', error: 'stopped' }))

    const restored = takeParkedChatTranslation('acct', '!room:example')
    expect(restored).toMatchObject({ busy: false, status: '', error: '' })
  })

  it('parks nothing when there are no finished analyses', () => {
    parkChatTranslation('acct', translationFor('!room:example', {}, { busy: true }))

    expect(takeParkedChatTranslation('acct', '!room:example')).toBeNull()
  })

  it('keeps parked work separate per account and per room', () => {
    parkChatTranslation('acct-a', translationFor('!room:example', { m1: analysis('a') }))
    parkChatTranslation('acct-a', translationFor('!other:example', { m2: analysis('b') }))

    expect(takeParkedChatTranslation('acct-b', '!room:example')).toBeNull()
    expect(takeParkedChatTranslation('acct-a', '!room:example')?.analyses).toEqual({ m1: analysis('a') })
    expect(takeParkedChatTranslation('acct-a', '!other:example')?.analyses).toEqual({ m2: analysis('b') })
  })

  it('clears every parked translation', () => {
    parkChatTranslation('acct', translationFor('!room:example', { m1: analysis('hola') }))

    clearParkedChatTranslations()
    expect(takeParkedChatTranslation('acct', '!room:example')).toBeNull()
  })
})

describe('dropUnloadedChatTranslations', () => {
  it('discards only the analyses for unloaded messages in the same room', () => {
    const current = translationFor('!room:example', { m1: analysis('one'), m2: analysis('two'), m3: analysis('three') })

    const next = dropUnloadedChatTranslations(current, '!room:example', ['m1', 'm3'])
    expect(next?.analyses).toEqual({ m2: analysis('two') })
    expect(next?.targetMessageIDs).toEqual(['m1', 'm2', 'm3'])
    expect(current.analyses).toHaveProperty('m1')
  })

  it('leaves the translation alone when it belongs to another room', () => {
    const current = translationFor('!room:example', { m1: analysis('one') })

    expect(dropUnloadedChatTranslations(current, '!other:example', ['m1'])).toBe(current)
  })

  it('returns the same state when none of the messages has an analysis', () => {
    const current = translationFor('!room:example', { m1: analysis('one') })

    expect(dropUnloadedChatTranslations(current, '!room:example', ['m9'])).toBe(current)
    expect(dropUnloadedChatTranslations(null, '!room:example', ['m1'])).toBeNull()
  })
})
