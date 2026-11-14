import { describe, expect, it } from 'vitest'
import { appendAIDraft, deleteVolatileAIDraft, getVolatileAIDraft, setVolatileAIDraft, updateVolatileAIDraft, type VolatileAIDraftStore } from './volatileAIDrafts'

describe('volatile AI reply drafts', () => {
  it('keeps drafts isolated by account and room and preserves the manual base', () => {
    let drafts: VolatileAIDraftStore = new Map()
    drafts = setVolatileAIDraft(drafts, 'account-a', '!room:a', { baseText: 'My note', text: 'My note\n\nAI reply' })

    expect(getVolatileAIDraft(drafts, 'account-a', '!room:a')).toEqual({ baseText: 'My note', text: 'My note\n\nAI reply' })
    expect(getVolatileAIDraft(drafts, 'account-b', '!room:a')).toBeUndefined()
    expect(getVolatileAIDraft(drafts, 'account-a', '!room:b')).toBeUndefined()
  })

  it('updates the volatile text without changing its base and restores it on discard', () => {
    const original: VolatileAIDraftStore = new Map()
    const withDraft = setVolatileAIDraft(original, 'account-a', '!room:a', { baseText: 'My note', text: 'My note\n\nAI reply' })
    const edited = updateVolatileAIDraft(withDraft, 'account-a', '!room:a', 'My edited note\n\nEdited reply')

    expect(getVolatileAIDraft(edited, 'account-a', '!room:a')).toEqual({ baseText: 'My note', text: 'My edited note\n\nEdited reply' })
    expect(getVolatileAIDraft(deleteVolatileAIDraft(edited, 'account-a', '!room:a'), 'account-a', '!room:a')).toBeUndefined()
    expect(getVolatileAIDraft(original, 'account-a', '!room:a')).toBeUndefined()
  })

  it('appends a generated reply without losing existing composer text', () => {
    expect(appendAIDraft('Existing message  \n', 'AI reply')).toBe('Existing message\n\nAI reply')
    expect(appendAIDraft('', 'AI reply')).toBe('AI reply')
  })
})