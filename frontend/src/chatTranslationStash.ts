import { type ChatTranslationState } from './appTypes'

// Finished message translations are kept in RAM only. Leaving a chat parks its
// analyses here and reopening that chat takes them back. Nothing is written to disk.
// Taking an entry removes it, so a translation lives in one place at a time.
const parkedTranslations = new Map<string, ChatTranslationState>()

function parkKey(accountID: string, roomID: string) {
  return JSON.stringify([accountID, roomID])
}

// parkChatTranslation stores the finished analyses of a translation whose chat is being left.
// Work still in flight is stopped by the caller, so busy, status and error are reset.
export function parkChatTranslation(accountID: string, translation: ChatTranslationState | null) {
  if (!translation || Object.keys(translation.analyses).length === 0) return
  parkedTranslations.set(parkKey(accountID, translation.roomID), { ...translation, busy: false, status: '', error: '' })
}

// takeParkedChatTranslation returns the parked translation for a chat being reopened and removes it from RAM.
export function takeParkedChatTranslation(accountID: string, roomID: string): ChatTranslationState | null {
  const key = parkKey(accountID, roomID)
  const translation = parkedTranslations.get(key) ?? null
  parkedTranslations.delete(key)
  return translation
}

export function clearParkedChatTranslations() {
  parkedTranslations.clear()
}

// dropUnloadedChatTranslations removes analyses for messages that virtual loading has unloaded from the roomID timeline.
export function dropUnloadedChatTranslations(current: ChatTranslationState | null, roomID: string, messageIDs: string[]): ChatTranslationState | null {
  if (!current || current.roomID !== roomID) return current
  if (!messageIDs.some((messageID) => messageID in current.analyses)) return current
  const analyses = { ...current.analyses }
  for (const messageID of messageIDs) delete analyses[messageID]
  return { ...current, analyses }
}
