import { useLayoutEffect, useState } from 'react'
import { expandSnippetContent } from './snippetExpander'
import type { Snippet } from './snippets'

interface SnippetPopoverProps {
  inputRef: { current: HTMLTextAreaElement | null }
  value: string
  caret: number | null
  snippets: Snippet[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onSelect: (snippet: Snippet) => void
}

interface PopoverPosition {
  left: number
  top: number
  above: boolean
}

function textareaCaretPoint(textarea: HTMLTextAreaElement, position: number) {
  const bounds = textarea.getBoundingClientRect()
  const computed = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const properties = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'letter-spacing', 'word-spacing',
    'line-height', 'text-transform', 'text-indent', 'padding-top', 'padding-right', 'padding-bottom',
    'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'tab-size', 'direction',
  ]
  mirror.style.position = 'fixed'
  mirror.style.left = `${bounds.left - textarea.scrollLeft}px`
  mirror.style.top = `${bounds.top - textarea.scrollTop}px`
  mirror.style.width = `${bounds.width}px`
  mirror.style.boxSizing = 'border-box'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.visibility = 'hidden'
  mirror.style.overflow = 'hidden'
  for (const property of properties) mirror.style.setProperty(property, computed.getPropertyValue(property))
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.append(document.createTextNode(textarea.value.slice(0, position)), marker)
  document.body.append(mirror)
  const markerBounds = marker.getBoundingClientRect()
  const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.55 || 20
  mirror.remove()
  return { left: markerBounds.left, top: markerBounds.top, lineHeight }
}

export function SnippetPopover({ inputRef, value, caret, snippets, activeIndex, onActiveIndexChange, onSelect }: SnippetPopoverProps) {
  const [position, setPosition] = useState<PopoverPosition | null>(null)

  useLayoutEffect(() => {
    const textarea = inputRef.current
    if (!textarea || snippets.length === 0) return
    const point = textareaCaretPoint(textarea, caret ?? textarea.selectionStart)
    const panelWidth = Math.min(360, Math.max(0, window.innerWidth - 16))
    const left = Math.max(8, Math.min(point.left, window.innerWidth - panelWidth - 8))
    const menuHeight = Math.min(250, 42 + snippets.length * 52)
    const below = point.top + point.lineHeight + menuHeight + 4 <= window.innerHeight - 8
    setPosition({
      left,
      top: below ? point.top + point.lineHeight + 4 : Math.max(8, point.top - 8),
      above: !below,
    })
  }, [caret, inputRef, snippets.length, value])

  return <div
    id="snippet-suggestions"
    className={`snippet-menu${position?.above ? ' is-above' : ''}`}
    role="listbox"
    aria-label="Text snippet suggestions"
    style={position ? { left: position.left, top: position.top } : undefined}
  >
    <div className="snippet-menu-heading">Text snippets</div>
    {snippets.map((snippet, index) => <button
      key={snippet.id}
      id={`snippet-option-${index}`}
      className={`snippet-option${index === activeIndex ? ' is-active' : ''}`}
      type="button"
      role="option"
      aria-selected={index === activeIndex}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onActiveIndexChange(index)}
      onClick={() => onSelect(snippet)}
    >
      <span className="snippet-option-title"><strong>{snippet.title}</strong><code>{snippet.prefix}{snippet.trigger}</code></span>
      <small>{snippet.category || 'Uncategorized'}</small>
      <span className="snippet-option-preview">{expandSnippetContent(snippet.content).text}</span>
    </button>)}
  </div>
}
