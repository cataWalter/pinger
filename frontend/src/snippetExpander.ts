import type { Snippet } from './snippets'

export interface SnippetMatch {
  start: number
  end: number
  prefix: string
  query: string
  shortcut: string
}

export interface ExpandedSnippet {
  text: string
  cursorPosition: number
  hasCursor: boolean
}

export interface SnippetBoundaryMatch {
  match: SnippetMatch
  snippet: Snippet
  delimiter: string
}

export function findSnippetMatch(value: string, caret: number, snippets: Snippet[]): SnippetMatch | null {
  const beforeCaret = value.slice(0, caret)
  const prefixes = [...new Set(snippets.map((snippet) => snippet.prefix).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
  let bestMatch: SnippetMatch | null = null

  for (const prefix of prefixes) {
    const start = beforeCaret.lastIndexOf(prefix)
    if (start < 0) continue
    const previousCharacter = beforeCaret[start - 1]
    if (previousCharacter && !/\s/.test(previousCharacter)) continue
    const query = beforeCaret.slice(start + prefix.length)
    if (/\s/.test(query)) continue
    const match = { start, end: caret, prefix, query, shortcut: `${prefix}${query}` }
    if (!bestMatch || match.start > bestMatch.start || (match.start === bestMatch.start && prefix.length > bestMatch.prefix.length)) {
      bestMatch = match
    }
  }

  return bestMatch
}

export function findSnippetBoundaryMatch(value: string, caret: number, snippets: Snippet[]): SnippetBoundaryMatch | null {
  const previousCharacter = value[caret - 1] ?? ''
  const delimiter = /[\s.,!?;:)}\]]/.test(previousCharacter) ? previousCharacter : ''
  const match = findSnippetMatch(value, caret - delimiter.length, snippets)
  if (!match || match.end !== caret - delimiter.length) return null
  const snippet = matchingSnippets(snippets, match).find((candidate) =>
    candidate.trigger.toLocaleLowerCase() === match.query.toLocaleLowerCase(),
  )
  return snippet ? { match, snippet, delimiter } : null
}

export function matchingSnippets(snippets: Snippet[], match: SnippetMatch): Snippet[] {
  const query = match.query.toLocaleLowerCase()
  return snippets.filter((snippet) =>
    snippet.prefix.toLocaleLowerCase() === match.prefix.toLocaleLowerCase()
    && snippet.trigger.toLocaleLowerCase().startsWith(query),
  )
}

export function expandSnippetContent(content: string, clipboardText = '', now = new Date()): ExpandedSnippet {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  let output = ''
  let cursorPosition: number | null = null
  let offset = 0

  for (const match of content.matchAll(/\{(date|time|clipboard|cursor)\}/g)) {
    const index = match.index ?? 0
    output += content.slice(offset, index)
    if (match[1] === 'cursor') {
      if (cursorPosition === null) cursorPosition = output.length
    } else if (match[1] === 'date') {
      output += date
    } else if (match[1] === 'time') {
      output += time
    } else {
      output += clipboardText
    }
    offset = index + match[0].length
  }
  output += content.slice(offset)

  return {
    text: output,
    cursorPosition: cursorPosition ?? output.length,
    hasCursor: cursorPosition !== null,
  }
}