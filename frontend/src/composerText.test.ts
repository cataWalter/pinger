import { describe, expect, it } from 'vitest'
import { emojiQueryAt, formatComposerText, insertEmoji, parseCustomEmoticonReplacements, replaceEmoticons, replaceEmoticonsAtCursor, suggestEmoji, wrapSelection } from './composerText'

describe('replaceEmoticons', () => {
  it('replaces whole-word emoticons', () => {
    expect(replaceEmoticons('hi :) see you ;-)')).toBe('hi 🙂 see you 😉')
  })

  it('leaves words that merely contain an emoticon alone', () => {
    expect(replaceEmoticons('https://example.com/a:D')).toBe('https://example.com/a:D')
    expect(replaceEmoticons('constructor')).toBe('constructor')
  })

  it('skips inline code spans', () => {
    expect(replaceEmoticons('use `:)` but not :)')).toBe('use `:)` but not 🙂')
  })

  it('supports custom mappings that override built-in emoticons', () => {
    const custom = [[':)', '😎'], [':shrug:', '🤷']] as const
    expect(replaceEmoticons(':) :shrug:', custom)).toBe('😎 🤷')
  })
})

describe('replaceEmoticonsAtCursor', () => {
  it('converts a completed emoticon before the caret and preserves the caret position', () => {
    expect(replaceEmoticonsAtCursor('hi ;-)', 6)).toEqual({ text: 'hi 😉', cursor: 5 })
  })

  it('leaves an unfinished emoticon alone while typing', () => {
    expect(replaceEmoticonsAtCursor('hi :', 4)).toEqual({ text: 'hi :', cursor: 4 })
  })

  it('does not convert emoticons inside inline code', () => {
    expect(replaceEmoticonsAtCursor('use `:)`', 8)).toEqual({ text: 'use `:)`', cursor: 8 })
  })

  it('converts a custom mapping at the caret', () => {
    expect(replaceEmoticonsAtCursor(':shrug:', 7, [[':shrug:', '🤷']])).toEqual({ text: '🤷', cursor: 2 })
  })
})

describe('parseCustomEmoticonReplacements', () => {
  it('parses valid pairs and ignores malformed mappings', () => {
    expect(parseCustomEmoticonReplacements('[["<3","😍"],[" ","🙂"],["bad",""]]')).toEqual([['<3', '😍']])
  })
})

describe('emojiQueryAt', () => {
  it('detects a shortcode at the caret after whitespace or at the start', () => {
    expect(emojiQueryAt('hello :sm', 9)).toEqual({ start: 6, end: 9, query: 'sm' })
    expect(emojiQueryAt(':fi', 3)).toEqual({ start: 0, end: 3, query: 'fi' })
  })

  it('ignores colons inside words and single characters', () => {
    expect(emojiQueryAt('meet at 10:30', 13)).toBeNull()
    expect(emojiQueryAt('hi :s', 5)).toBeNull()
  })
})

describe('suggestEmoji', () => {
  it('returns prefix matches', () => {
    expect(suggestEmoji('thu')).toEqual([['thumbsup', '👍'], ['thumbsdown', '👎']])
    expect(suggestEmoji('zzz')).toEqual([])
  })
})

describe('insertEmoji', () => {
  it('replaces the shortcode and places the caret after the emoji', () => {
    const result = insertEmoji('hello :fi', 6, 9, '🔥')
    expect(result.text).toBe('hello 🔥')
    expect(result.caret).toBe('hello 🔥'.length)
  })
})

describe('wrapSelection', () => {
  it('wraps the selected text and keeps it selected', () => {
    expect(wrapSelection('say hi now', 4, 6, '**')).toEqual({ text: 'say **hi** now', selectionStart: 6, selectionEnd: 8 })
  })

  it('inserts paired markers at a collapsed caret', () => {
    expect(wrapSelection('ab', 1, 1, '`')).toEqual({ text: 'a``b', selectionStart: 2, selectionEnd: 2 })
  })
})

describe('formatComposerText', () => {
  it('wraps inline formatting and creates an editable link', () => {
    expect(formatComposerText('say hi', 4, 6, 'bold')).toEqual({ text: 'say **hi**', selectionStart: 6, selectionEnd: 8 })
    expect(formatComposerText('visit', 0, 5, 'link')).toEqual({ text: '[visit](url)', selectionStart: 1, selectionEnd: 6 })
  })

  it('inserts a link placeholder when no text is selected', () => {
    expect(formatComposerText('hello ', 6, 6, 'link')).toEqual({ text: 'hello [link text](url)', selectionStart: 7, selectionEnd: 16 })
  })

  it('formats all touched lines as lists and quotes', () => {
    expect(formatComposerText('alpha\nbeta\nomega', 0, 10, 'bulletList').text).toBe('- alpha\n- beta\nomega')
    expect(formatComposerText('alpha\nbeta', 0, 10, 'numberedList').text).toBe('1. alpha\n2. beta')
    expect(formatComposerText('alpha\nbeta', 0, 10, 'quote').text).toBe('> alpha\n> beta')
  })

  it('adds a heading to the first touched line and fences selected code lines', () => {
    expect(formatComposerText('alpha\nbeta', 0, 10, 'heading').text).toBe('## alpha\nbeta')
    expect(formatComposerText('before\nalpha\nbeta\nafter', 7, 17, 'codeBlock').text).toBe('before\n```\nalpha\nbeta\n```\nafter')
  })
})
