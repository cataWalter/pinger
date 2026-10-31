// Pure helpers for composer ghost text: the faint continuation of the draft that the local AI suggests.

// GHOST_TEXT_DEBOUNCE_MS waits for a short pause in typing before asking the model.
export const GHOST_TEXT_DEBOUNCE_MS = 450

// GHOST_TEXT_MIN_CHARACTERS skips requests for drafts too short to continue meaningfully.
export const GHOST_TEXT_MIN_CHARACTERS = 3

// ghostTextDraftReady reports whether draft is worth a model request. Slash commands and very short drafts are skipped.
export function ghostTextDraftReady(draft: string) {
  const trimmed = draft.trim()
  return [...trimmed].length >= GHOST_TEXT_MIN_CHARACTERS && !trimmed.startsWith('/')
}

// remainingGhostText returns the part of suggestion that is still ahead of the caret in text. anchor is the draft the
// suggestion was requested for. Typing the start of the suggestion keeps the rest visible. Any other edit hides it.
export function remainingGhostText(anchor: string, suggestion: string, text: string) {
  if (!suggestion || !text.startsWith(anchor)) return ''
  const typed = text.slice(anchor.length)
  if (!suggestion.startsWith(typed)) return ''
  return suggestion.slice(typed.length)
}
