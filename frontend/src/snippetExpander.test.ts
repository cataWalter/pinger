import { describe, expect, it } from 'vitest'
import { expandSnippetContent, findSnippetBoundaryMatch, findSnippetMatch, matchingSnippets } from './snippetExpander'
import { createDefaultSnippets, type Snippet } from './snippets'

describe('snippet expansion', () => {
  it('detects a prefix query at the caret and filters matching triggers', () => {
    const snippets = createDefaultSnippets()
    const value = 'Hello\n;me'
    const match = findSnippetMatch(value, value.length, snippets)
    expect(match).toMatchObject({ start: 6, end: 9, prefix: ';', query: 'me', shortcut: ';me' })
    expect(matchingSnippets(snippets, match!)).toHaveLength(1)
    expect(findSnippetMatch('email;meet', 10, snippets)).toBeNull()
  })

  it('uses a longer custom prefix and supports a caret in the middle of text', () => {
    const snippets: Snippet[] = [{
      ...createDefaultSnippets()[0], prefix: ';;', trigger: 'meeting',
    }]
    const value = ';;meet tail'
    expect(findSnippetMatch(value, 6, snippets)).toMatchObject({ start: 0, end: 6, prefix: ';;', query: 'meet' })
  })

  it('recognizes an exact trigger before a typed delimiter', () => {
    const snippets = createDefaultSnippets()
    const value = 'Hi ;meet, and more'
    const caret = value.indexOf(',') + 1
    expect(findSnippetBoundaryMatch(value, caret, snippets)).toMatchObject({
      match: { start: 3, end: caret - 1, shortcut: ';meet' },
      snippet: { trigger: 'meet' },
      delimiter: ',',
    })
    expect(findSnippetBoundaryMatch(';meet ', 6, snippets)).toMatchObject({
      match: { start: 0, end: 5, shortcut: ';meet' },
      delimiter: ' ',
    })
    expect(findSnippetBoundaryMatch(';meet', 5, snippets)).toBeNull()
    expect(findSnippetBoundaryMatch(';mee ', 6, snippets)).toBeNull()
  })

  it('expands local date, time, clipboard and cursor variables', () => {
    const now = new Date(2026, 9, 21, 8, 4)
    expect(expandSnippetContent('On {date} at {time}: {cursor}{clipboard}', 'clipboard text', now)).toEqual({
      text: 'On 2026-10-21 at 08:04: clipboard text',
      cursorPosition: 'On 2026-10-21 at 08:04: '.length,
      hasCursor: true,
    })
  })

  it('places the caret at the first marker and removes additional markers', () => {
    expect(expandSnippetContent('a{cursor}b{cursor}c')).toEqual({ text: 'abc', cursorPosition: 1, hasCursor: true })
  })
})