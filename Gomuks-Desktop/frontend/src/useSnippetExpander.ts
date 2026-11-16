import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { expandSnippetContent, findSnippetBoundaryMatch, findSnippetMatch, matchingSnippets, type SnippetMatch } from './snippetExpander'
import type { Snippet } from './snippets'

interface SnippetUndo {
  roomID: string
  originalText: string
  expandedText: string
  originalCaret: number
  expandedCaret: number
}

export interface UseSnippetExpanderOptions {
  value: string
  snippets: Snippet[]
  roomID: string
  inputRef: { current: HTMLTextAreaElement | null }
  setValue: (value: string) => void
  onExpanded?: () => void
  onUndo?: (value: string, caret: number) => void
}

export function useSnippetExpander(options: UseSnippetExpanderOptions) {
  const [match, setMatch] = useState<SnippetMatch | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [caret, setCaret] = useState<number | null>(null)
  const latestOptions = useRef(options)
  latestOptions.current = options
  const valueRef = useRef(options.value)
  valueRef.current = options.value
  const undoRef = useRef<SnippetUndo | null>(null)
  const expansionRequestRef = useRef(0)
  const caretPlacementRef = useRef<{ text: string; caret: number } | null>(null)
  const suggestions = match ? matchingSnippets(options.snippets, match) : []

  useLayoutEffect(() => {
    const placement = caretPlacementRef.current
    if (!placement) return
    if (options.value !== placement.text) {
      caretPlacementRef.current = null
      return
    }
    const input = options.inputRef.current
    if (!input) return
    caretPlacementRef.current = null
    input.focus()
    input.setSelectionRange(placement.caret, placement.caret)
  })

  useEffect(() => () => {
    expansionRequestRef.current++
  }, [])

  function updateMatch(value: string, selection: number) {
    setMatch(findSnippetMatch(value, selection, latestOptions.current.snippets))
    setCaret(selection)
    setActiveIndex(0)
  }

  function expandSnippet(snippet: Snippet, snippetMatch: SnippetMatch, delimiter = '') {
    const current = latestOptions.current
    const originalText = valueRef.current
    if (originalText.slice(snippetMatch.start, snippetMatch.end).toLocaleLowerCase() !== snippetMatch.shortcut.toLocaleLowerCase()) return
    const roomID = current.roomID
    const requestID = ++expansionRequestRef.current
    const applyExpansion = (clipboardText: string) => {
      const latest = latestOptions.current
      const input = latest.inputRef.current
      const expectedCaret = snippetMatch.end + delimiter.length
      if (requestID !== expansionRequestRef.current
        || valueRef.current !== originalText
        || latest.roomID !== roomID
        || (input && (input.selectionStart !== expectedCaret || input.selectionEnd !== expectedCaret))) return

      const expanded = expandSnippetContent(snippet.content, clipboardText)
      const nextText = originalText.slice(0, snippetMatch.start)
        + expanded.text
        + delimiter
        + originalText.slice(snippetMatch.end + delimiter.length)
      const nextCaret = snippetMatch.start + expanded.cursorPosition + (expanded.hasCursor ? 0 : delimiter.length)
      undoRef.current = {
        roomID,
        originalText,
        expandedText: nextText,
        originalCaret: snippetMatch.end,
        expandedCaret: nextCaret,
      }
      caretPlacementRef.current = { text: nextText, caret: nextCaret }
      valueRef.current = nextText
      latest.onExpanded?.()
      latest.setValue(nextText)
      setMatch(null)
      setCaret(nextCaret)
      setActiveIndex(0)
    }

    if (snippet.content.includes('{clipboard}') && navigator.clipboard?.readText) {
      try {
        void navigator.clipboard.readText().then(applyExpansion).catch(() => applyExpansion(''))
      } catch {
        applyExpansion('')
      }
    } else {
      applyExpansion('')
    }
  }

  function handleChange(value: string, selection: number) {
    expansionRequestRef.current++
    undoRef.current = null
    valueRef.current = value
    updateMatch(value, selection)
    const boundary = findSnippetBoundaryMatch(value, selection, latestOptions.current.snippets)
    if (boundary) expandSnippet(boundary.snippet, boundary.match, boundary.delimiter)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, allowSuggestions = true): boolean {
    expansionRequestRef.current++
    if (event.key !== 'Backspace') undoRef.current = null

    const pendingUndo = undoRef.current
    const input = event.currentTarget
    if (pendingUndo
      && event.key === 'Backspace'
      && pendingUndo.roomID === latestOptions.current.roomID
      && valueRef.current === pendingUndo.expandedText
      && input.selectionStart === input.selectionEnd
      && input.selectionStart === pendingUndo.expandedCaret) {
      event.preventDefault()
      undoRef.current = null
      caretPlacementRef.current = { text: pendingUndo.originalText, caret: pendingUndo.originalCaret }
      valueRef.current = pendingUndo.originalText
      latestOptions.current.setValue(pendingUndo.originalText)
      updateMatch(pendingUndo.originalText, pendingUndo.originalCaret)
      latestOptions.current.onUndo?.(pendingUndo.originalText, pendingUndo.originalCaret)
      return true
    }
    if (pendingUndo) undoRef.current = null

    if (!allowSuggestions || !match || suggestions.length === 0) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % suggestions.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
      return true
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault()
      expandSnippet(suggestions[activeIndex] ?? suggestions[0], match)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setMatch(null)
      return true
    }
    return false
  }

  return {
    match,
    caret,
    suggestions,
    activeIndex,
    visible: suggestions.length > 0,
    setActiveIndex,
    handleChange,
    handleClick: updateMatch,
    handleKeyDown,
    handleKeyUp: updateMatch,
    select: (snippet: Snippet) => {
      if (match) expandSnippet(snippet, match)
    },
  }
}