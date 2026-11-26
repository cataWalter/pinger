import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsTab } from './settings'

type SettingsState = {
  settingsOpen: boolean
  settingsTab: SettingsTab
}

export type SettingsStore = {
  getSnapshot: () => SettingsState
  setSettingsOpen: (open: boolean | ((current: boolean) => boolean)) => void
  setSettingsTab: (tab: SettingsTab | ((current: SettingsTab) => SettingsTab)) => void
  subscribe: (listener: () => void) => () => void
}

function createSettingsStore(): SettingsStore {
  let state: SettingsState = { settingsOpen: false, settingsTab: 'General' }
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    setSettingsOpen: (open) => {
      const next = typeof open === 'function' ? open(state.settingsOpen) : open
      if (Object.is(state.settingsOpen, next)) return
      state = { ...state, settingsOpen: next }
      emit()
    },
    setSettingsTab: (tab) => {
      const next = typeof tab === 'function' ? tab(state.settingsTab) : tab
      if (Object.is(state.settingsTab, next)) return
      state = { ...state, settingsTab: next }
      emit()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const SettingsContext = createContext<SettingsStore | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createSettingsStore(), [])
  return <SettingsContext.Provider value={store}>{children}</SettingsContext.Provider>
}

export function useSettingsStore(): SettingsStore {
  const store = useContext(SettingsContext)
  if (!store) throw new Error('useSettings must be used inside SettingsProvider')
  return store
}

export function useSettings() {
  const store = useSettingsStore()
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(() => ({
    settingsOpen: state.settingsOpen,
    setSettingsOpen: store.setSettingsOpen,
    settingsTab: state.settingsTab,
    setSettingsTab: store.setSettingsTab,
  }), [state.settingsOpen, state.settingsTab, store])
}
