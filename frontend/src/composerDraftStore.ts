import { useSyncExternalStore } from 'react'

export interface ComposerDraftStore {
  getText: () => string
  setText: (next: string) => void
  subscribe: (listener: () => void) => () => void
}

export function createComposerDraftStore(initial = ''): ComposerDraftStore {
  let text = initial
  const listeners = new Set<() => void>()
  return {
    getText: () => text,
    setText: (next: string) => {
      if (Object.is(text, next)) return
      text = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useComposeText(store: ComposerDraftStore): string {
  return useSyncExternalStore(store.subscribe, store.getText)
}
