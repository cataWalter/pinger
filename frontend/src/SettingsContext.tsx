import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { SettingsTab } from './settings'

type SettingsContextValue = {
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  settingsTab: SettingsTab
  setSettingsTab: (tab: SettingsTab) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('General')
  const value = useMemo(() => ({ settingsOpen, setSettingsOpen, settingsTab, setSettingsTab }), [settingsOpen, settingsTab])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside SettingsProvider')
  return value
}
