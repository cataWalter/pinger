// Pure helpers for composer text transforms: emoticon replacement, emoji
// shortcode autocomplete, and Markdown wrapping for the formatting toolbar.

export const defaultEmoticonReplacements: ReadonlyArray<readonly [string, string]> = [
  [':)', '🙂'],
  [':-)', '🙂'],
  [':(', '🙁'],
  [':-(', '🙁'],
  [';)', '😉'],
  [';-)', '😉'],
  [':D', '😀'],
  [':-D', '😀'],
  [':P', '😛'],
  [':-P', '😛'],
  [':p', '😛'],
  [':o', '😮'],
  [':O', '😮'],
  ['<3', '❤️'],
  ['xD', '😆'],
  ['XD', '😆'],
]

export type EmoticonReplacement = readonly [string, string]

export function parseCustomEmoticonReplacements(serialized: string): EmoticonReplacement[] {
  if (!serialized.trim()) return []
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is [string, string] =>
      Array.isArray(entry)
      && entry.length === 2
      && typeof entry[0] === 'string'
      && typeof entry[1] === 'string'
      && isValidEmoticonReplacement(entry[0], entry[1]))
  } catch {
    return []
  }
}

function isValidEmoticonReplacement(symbol: string, emoji: string) {
  return symbol.trim() === symbol
    && emoji.trim() === emoji
    && !/\s/.test(symbol)
    && !/\s/.test(emoji)
    && [...symbol].length > 0
    && [...symbol].length <= 16
    && [...emoji].length > 0
    && [...emoji].length <= 16
}

function emoticonReplacementMap(customReplacements: ReadonlyArray<EmoticonReplacement>) {
  const replacements = new Map(defaultEmoticonReplacements)
  for (const [symbol, emoji] of customReplacements) {
    if (isValidEmoticonReplacement(symbol, emoji)) replacements.set(symbol, emoji)
  }
  return replacements
}

// Replaces whole-word emoticons outside of inline code spans. Matching is
// token-based so text such as URLs is left alone.
function replaceEmoticonsInSegment(segment: string, replacements: ReadonlyMap<string, string>) {
  return segment
    .split(/(\s+)/)
    .map((token) => replacements.get(token) ?? token)
    .join('')
}

export function replaceEmoticons(text: string, customReplacements: ReadonlyArray<EmoticonReplacement> = []): string {
  const replacements = emoticonReplacementMap(customReplacements)
  return text
    .split(/(`[^`]*`)/)
    .map((segment, index) => index % 2 === 1 ? segment : replaceEmoticonsInSegment(segment, replacements))
    .join('')
}

export function replaceEmoticonsAtCursor(text: string, cursor: number, customReplacements: ReadonlyArray<EmoticonReplacement> = []) {
  const replacements = emoticonReplacementMap(customReplacements)
  const position = Math.max(0, Math.min(cursor, text.length))
  const segments = text.split(/(`[^`]*`)/)
  let sourceOffset = 0
  let output = ''
  let outputCursor = position
  for (const [index, segment] of segments.entries()) {
    const end = sourceOffset + segment.length
    if (index % 2 === 1) {
      if (position >= sourceOffset && position <= end) outputCursor = output.length + position - sourceOffset
      output += segment
    } else {
      if (position >= sourceOffset && position <= end) {
        outputCursor = output.length + replaceEmoticonsInSegment(segment.slice(0, position - sourceOffset), replacements).length
      }
      output += replaceEmoticonsInSegment(segment, replacements)
    }
    sourceOffset = end
  }
  return { text: output, cursor: outputCursor }
}

const emojiShortcodes: ReadonlyArray<readonly [string, string]> = [
  ['smile', '😄'],
  ['grinning', '😀'],
  ['joy', '😂'],
  ['sweat_smile', '😅'],
  ['laughing', '😆'],
  ['wink', '😉'],
  ['sunglasses', '😎'],
  ['thinking', '🤔'],
  ['pensive', '😔'],
  ['sob', '😭'],
  ['heart', '❤️'],
  ['thumbsup', '👍'],
  ['thumbsdown', '👎'],
  ['clap', '👏'],
  ['raised_hands', '🙌'],
  ['ok_hand', '👌'],
  ['wave', '👋'],
  ['pray', '🙏'],
  ['eyes', '👀'],
  ['fire', '🔥'],
  ['tada', '🎉'],
  ['rocket', '🚀'],
  ['star', '⭐'],
  ['100', '💯'],
  ['white_check_mark', '✅'],
  ['x', '❌'],
  ['warning', '⚠️'],
  ['coffee', '☕'],
]

export type EmojiQuery = { start: number; end: number; query: string }

// Detects an in-progress `:shortcode` typed at the caret. The colon must start
// the text or follow whitespace so times and URLs do not trigger suggestions.
export function emojiQueryAt(value: string, cursor: number): EmojiQuery | null {
  const match = /(^|\s):([a-z0-9_]{2,})$/i.exec(value.slice(0, cursor))
  if (!match) return null
  return { start: cursor - match[0].length + match[1].length, end: cursor, query: match[2].toLowerCase() }
}

export function suggestEmoji(query: string): Array<[string, string]> {
  return emojiShortcodes.filter(([name]) => name.startsWith(query)).slice(0, 6).map(([name, emoji]) => [name, emoji])
}

export function insertEmoji(value: string, start: number, end: number, emoji: string) {
  const suffix = value.slice(end)
  const separator = suffix.startsWith(' ') || suffix.length === 0 ? '' : ' '
  const insertion = emoji + separator
  return { text: value.slice(0, start) + insertion + suffix, caret: start + insertion.length }
}

export function wrapSelection(value: string, start: number, end: number, marker: string) {
  const before = value.slice(0, start)
  const selected = value.slice(start, end)
  const after = value.slice(end)
  return {
    text: before + marker + selected + marker + after,
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
  }
}

export type ComposerFormat = 'bold' | 'italic' | 'strikethrough' | 'inlineCode' | 'link' | 'heading' | 'bulletList' | 'numberedList' | 'quote' | 'codeBlock'

function composerLineRange(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const contentEnd = end > start && value[end - 1] === '\n' ? end - 1 : end
  const nextBreak = value.indexOf('\n', contentEnd)
  return { lineStart, lineEnd: nextBreak < 0 ? value.length : nextBreak }
}

export function formatComposerText(value: string, start: number, end: number, format: ComposerFormat) {
  const safeStart = Math.max(0, Math.min(start, value.length))
  const safeEnd = Math.max(safeStart, Math.min(end, value.length))
  const selected = value.slice(safeStart, safeEnd)

  if (format === 'bold') return wrapSelection(value, safeStart, safeEnd, '**')
  if (format === 'italic') return wrapSelection(value, safeStart, safeEnd, '_')
  if (format === 'strikethrough') return wrapSelection(value, safeStart, safeEnd, '~~')
  if (format === 'inlineCode' && !selected.includes('\n')) return wrapSelection(value, safeStart, safeEnd, '`')
  if (format === 'link') {
    const label = selected || 'link text'
    const replacement = `[${label}](url)`
    return {
      text: value.slice(0, safeStart) + replacement + value.slice(safeEnd),
      selectionStart: safeStart + 1,
      selectionEnd: safeStart + 1 + label.length,
    }
  }

  const { lineStart, lineEnd } = composerLineRange(value, safeStart, safeEnd)
  const lines = value.slice(lineStart, lineEnd)
  if (format === 'codeBlock' || format === 'inlineCode') {
    const replacement = `\`\`\`\n${lines}\n\`\`\``
    return {
      text: value.slice(0, lineStart) + replacement + value.slice(lineEnd),
      selectionStart: lineStart + 4,
      selectionEnd: lineStart + 4 + lines.length,
    }
  }

  const formattedLines = lines.split('\n').map((line, index) => {
    if (format === 'heading') return `${index === 0 ? '## ' : ''}${line}`
    if (format === 'bulletList') return `- ${line}`
    if (format === 'numberedList') return `${index + 1}. ${line}`
    return `> ${line}`
  }).join('\n')
  return {
    text: value.slice(0, lineStart) + formattedLines + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + formattedLines.length,
  }
}
