import { useCallback, useEffect, useRef, useState } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { GHOST_TEXT_DEBOUNCE_MS, ghostTextDraftReady, remainingGhostText } from './ghostText'

type GhostSuggestion = {
  accountID: string
  roomID: string
  anchor: string
  completion: string
}

export type ComposerGhostText = {
  // suffix is the faint text to show after the draft, or an empty string.
  suffix: string
  dismiss: () => void
}

function newGhostRequestID() {
  return globalThis.crypto?.randomUUID?.() ?? `ghost-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// useComposerGhostText asks the local AI for a continuation of the draft after the user pauses typing. Each new edit
// cancels the pending request. A suggestion is only shown for the room and draft it was requested for.
export function useComposerGhostText({ enabled, accountID, roomID, text, caretAtEnd }: {
  enabled: boolean
  accountID: string
  roomID: string
  text: string
  caretAtEnd: boolean
}): ComposerGhostText {
  const [suggestion, setSuggestion] = useState<GhostSuggestion | null>(null)
  const requestRef = useRef('')

  useEffect(() => setSuggestion(null), [accountID, roomID])

  useEffect(() => {
    if (!enabled || !roomID || !caretAtEnd || !ghostTextDraftReady(text)) return
    const timer = window.setTimeout(() => {
      const requestID = newGhostRequestID()
      requestRef.current = requestID
      Promise.resolve(AppService.AIGhostText(roomID, text, requestID))
        .then((completion) => {
          if (requestRef.current !== requestID) return
          requestRef.current = ''
          setSuggestion(completion ? { accountID, roomID, anchor: text, completion } : null)
        })
        .catch(() => {
          if (requestRef.current !== requestID) return
          requestRef.current = ''
          setSuggestion(null)
        })
    }, GHOST_TEXT_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      const pending = requestRef.current
      requestRef.current = ''
      if (pending) void Promise.resolve(AppService.AICancel(pending)).catch(() => false)
    }
  }, [enabled, accountID, roomID, text, caretAtEnd])

  const dismiss = useCallback(() => setSuggestion(null), [])
  const suffix = enabled && caretAtEnd && suggestion && suggestion.accountID === accountID && suggestion.roomID === roomID
    ? remainingGhostText(suggestion.anchor, suggestion.completion, text)
    : ''
  return { suffix, dismiss }
}
