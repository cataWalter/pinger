import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { type Room, type Snapshot } from '../bindings/mychat/desktop/models.js'
import { type PreferenceValues } from './appShared'
import { isTextEntryTarget } from './dom'
import { type Snippet } from './snippets'
import { SETTINGS_TABS, groupSettingsByTab, searchSettings, type SettingsEntry, type SettingsTab } from './settings'
import { SettingsAdvanced, SettingsAdvancedRevealContext } from './SettingsControls'
import { DialogSurface } from './DialogSurface'
import { SnippetSettingsModal } from './SnippetSettingsModal'
import { GeneralSettingsTab, HistorySettingsTab } from './SettingsGeneralTab'
import { AppearanceSettingsTab } from './SettingsAppearanceTab'
import { NotificationsSettingsTab } from './SettingsNotificationsTab'
import { KeyboardSettingsTab } from './SettingsKeyboardTab'
import { AccountSettingsTab, DevicesSettingsTab, SecuritySettingsTab } from './SettingsAccountTab'
import { StorageSettingsTab } from './SettingsStorageTab'
import { AISettingsTab } from './SettingsAITab'
import { AboutSettingsTab, HelpSettingsTab, IntegrationsSettingsTab } from './SettingsInfoTabs'

const SETTING_TARGET_SELECTORS = [
  '.setting-row strong',
  '.setting-toggle > span',
  '.help-item h4',
  '.security-field > span',
  '.ai-settings-form label > span',
  'button.settings-command',
  'a.settings-link',
]

function findSettingTarget(panel: HTMLElement, entry: SettingsEntry) {
  if (entry.anchor) {
    const anchored = panel.querySelector<HTMLElement>(entry.anchor)
    if (anchored) return anchored
  }
  const title = entry.title.trim().toLowerCase()
  for (const selector of SETTING_TARGET_SELECTORS) {
    for (const candidate of Array.from(panel.querySelectorAll<HTMLElement>(selector))) {
      if ((candidate.textContent ?? '').trim().toLowerCase() !== title) continue
      return candidate.closest<HTMLElement>('.setting-row, .setting-toggle, .help-item, .security-field, label, button, a') ?? candidate
    }
  }
  return null
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightMatches(text: string, query: string) {
  const terms = Array.from(new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean)))
    .sort((left, right) => right.length - left.length)
  if (terms.length === 0) return text
  // With a capture group, split() puts the matched terms at odd indexes.
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  return text.split(pattern).map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))
}

export function SettingsDialog({
  tab,
  profile,
  preferences,
  snippets,
  rooms,
  audioInputDevices,
  selectedAudioInputDeviceId,
  onArchiveInactiveRooms,
  onTabChange,
  onClose,
  onLogout,
  onPreferenceChange,
  onPreferencesChange,
  onSnippetsChange,
}: {
  tab: SettingsTab
  profile: Snapshot['profile']
  preferences: PreferenceValues
  snippets: Snippet[]
  rooms: Room[]
  audioInputDevices: MediaDeviceInfo[]
  selectedAudioInputDeviceId: string
  onArchiveInactiveRooms: () => Promise<void>
  onTabChange: (tab: SettingsTab) => void
  onClose: () => void
  onLogout: () => Promise<void>
  onPreferenceChange: (key: string, value: boolean | string) => Promise<boolean>
  onPreferencesChange: (entries: Record<string, string>) => Promise<boolean>
  onSnippetsChange: (snippets: Snippet[]) => void
}) {
  const { t } = useTranslation()
  const tabs = SETTINGS_TABS
  const [searchQuery, setSearchQuery] = useState('')
  const [searchTarget, setSearchTarget] = useState<{ entry: SettingsEntry; nonce: number } | null>(null)
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const settingsPanelRef = useRef<HTMLDivElement>(null)
  const searchNonceRef = useRef(0)

  const searchResults = useMemo(() => searchSettings(searchQuery), [searchQuery])
  const searchResultsByTab = useMemo(() => groupSettingsByTab(searchResults), [searchResults])
  const searchActive = searchQuery.trim().length > 0
  const bestMatch = searchResults[0]

  function revealSetting(entry: SettingsEntry) {
    searchNonceRef.current += 1
    setSearchQuery('')
    setSearchTarget({ entry, nonce: searchNonceRef.current })
    onTabChange(entry.tab)
  }

  function moveBetweenSearchResults(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = Array.from(settingsPanelRef.current?.querySelectorAll<HTMLButtonElement>('.settings-search-result') ?? [])
    const index = buttons.indexOf(event.currentTarget)
    if (event.key === 'ArrowUp' && index <= 0) {
      searchInputRef.current?.focus()
      return
    }
    const next = Math.min(index + (event.key === 'ArrowDown' ? 1 : -1), buttons.length - 1)
    buttons[next]?.focus()
  }

  function closeSnippetManager() {
    setSnippetManagerOpen(false)
  }

  useEffect(() => {
    if (!searchTarget) return
    const panel = settingsPanelRef.current
    if (!panel) return
    const target = findSettingTarget(panel, searchTarget.entry)
    if (!target) return
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' })
    target.classList.add('is-search-hit')
    const timer = window.setTimeout(() => target.classList.remove('is-search-hit'), 1800)
    return () => {
      window.clearTimeout(timer)
      target.classList.remove('is-search-hit')
    }
  }, [searchTarget])

  return (
    <>
      <div
        className="settings-scrim"
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
        onKeyDown={(event) => {
          // The global "/" shortcut is disabled while a dialog is open, so the dialog handles it here.
          if (event.key !== '/' || event.altKey || event.metaKey || event.ctrlKey || isTextEntryTarget(event.target)) return
          event.preventDefault()
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        }}
      >
        <DialogSurface className="settings-dialog" labelledBy="settings-title" onClose={onClose}>
          <header className="settings-header">
            <div><span className="eyebrow">PINGER</span><h2 id="settings-title">{t('settings.title')}</h2></div>
            <button className="icon-button" type="button" aria-label="Close settings" title="Close settings" onClick={onClose}><X size={17} /></button>
          </header>
          <div className="settings-search">
            <Search size={15} />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              placeholder="Search settings"
              aria-label="Search settings"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setSearchQuery('')
                } else if (event.key === 'Enter' && bestMatch) {
                  event.preventDefault()
                  revealSetting(bestMatch)
                } else if (event.key === 'ArrowDown' && searchActive) {
                  event.preventDefault()
                  settingsPanelRef.current?.querySelector<HTMLButtonElement>('.settings-search-result.is-best-match')?.focus()
                }
              }}
            />
            {searchQuery ? (
              <button type="button" className="icon-button" aria-label="Clear settings search" title="Clear search" onClick={() => { setSearchQuery(''); searchInputRef.current?.focus() }}><X size={14} /></button>
            ) : (
              <kbd className="settings-search-key" aria-hidden="true" title="Press / to search settings">/</kbd>
            )}
          </div>
          <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
            {tabs.map((item) => {
              const matches = searchResultsByTab.get(item)?.length ?? 0
              return (
                <button
                  key={item}
                  id={`settings-tab-${item.toLowerCase().replace(/\s+/g, '-')}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === item}
                  aria-controls="settings-panel"
                  tabIndex={tab === item ? 0 : -1}
                  className={`${tab === item ? 'is-active' : ''} ${searchActive && matches > 0 ? 'has-matches' : ''}`}
                  onClick={() => {
                    const firstMatch = searchResultsByTab.get(item)?.[0]
                    if (searchActive && firstMatch) {
                      revealSetting(firstMatch)
                      return
                    }
                    if (searchActive) setSearchQuery('')
                    onTabChange(item)
                  }}
                  onKeyDown={(event) => {
                    const currentIndex = tabs.indexOf(item)
                    let nextIndex: number
                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length
                    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
                    else if (event.key === 'Home') nextIndex = 0
                    else if (event.key === 'End') nextIndex = tabs.length - 1
                    else return
                    event.preventDefault()
                    onTabChange(tabs[nextIndex])
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
                  }}
                >{t(`settings.tabs.${item.toLowerCase()}`)}{searchActive && matches > 0 && <span className="settings-tab-count" aria-hidden="true">{matches}</span>}</button>
              )
            })}
          </nav>
          <SettingsAdvancedRevealContext.Provider value={searchActive || searchTarget?.entry.tab === tab}>
          <div id="settings-panel" className={`settings-content ${searchActive ? 'is-searching' : ''}`} role="tabpanel" aria-labelledby={`settings-tab-${tab.toLowerCase().replace(/\s+/g, '-')}`} tabIndex={0} ref={settingsPanelRef}>
            {searchActive && (
              <div className="settings-search-results" role="region" aria-label="Settings search results">
                <p className="settings-note" role="status">
                  {searchResults.length === 0
                    ? `No settings match “${searchQuery.trim()}”.`
                    : `${searchResults.length} ${searchResults.length === 1 ? 'setting matches' : 'settings match'} “${searchQuery.trim()}”.`}
                </p>
                {Array.from(searchResultsByTab.entries()).map(([group, entries]) => (
                  <section className="settings-search-group" key={group}>
                    <h3>{group}</h3>
                    <div className="settings-search-list">
                      {entries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className={`settings-search-result ${entry.id === bestMatch?.id ? 'is-best-match' : ''}`}
                          onClick={() => revealSetting(entry)}
                          onKeyDown={moveBetweenSearchResults}
                        >
                          <strong>{highlightMatches(entry.title, searchQuery)}</strong>
                          <small>{highlightMatches(entry.description, searchQuery)}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            {tab === 'General' && (
              <GeneralSettingsTab
                preferences={preferences}
                onPreferenceChange={onPreferenceChange}
                audioInputDevices={audioInputDevices}
                selectedAudioInputDeviceId={selectedAudioInputDeviceId}
                onArchiveInactiveRooms={onArchiveInactiveRooms}
              />
            )}
            {tab === 'Appearance' && <AppearanceSettingsTab preferences={preferences} onPreferenceChange={onPreferenceChange} />}
            {tab === 'Notifications' && <NotificationsSettingsTab preferences={preferences} onPreferenceChange={onPreferenceChange} />}
            {tab === 'Keyboard' && (
              <KeyboardSettingsTab
                preferences={preferences}
                onPreferenceChange={onPreferenceChange}
                onManageSnippets={() => setSnippetManagerOpen(true)}
              />
            )}
            {tab === 'Account' && (
              <>
                <AccountSettingsTab profile={profile} preferences={preferences} onPreferenceChange={onPreferenceChange} onLogout={onLogout} />
                <SettingsAdvanced description="Active devices, encryption keys, and chat networks">
                  <DevicesSettingsTab profile={profile} onClose={onClose} />
                  <SecuritySettingsTab profile={profile} />
                  <IntegrationsSettingsTab rooms={rooms} />
                </SettingsAdvanced>
              </>
            )}
            {tab === 'Storage' && (
              <>
                <HistorySettingsTab preferences={preferences} onPreferenceChange={onPreferenceChange} />
                <StorageSettingsTab />
              </>
            )}
            {tab === 'AI' && (
              <AISettingsTab
                preferences={preferences}
                rooms={rooms}
                onPreferenceChange={onPreferenceChange}
                onPreferencesChange={onPreferencesChange}
              />
            )}
            {tab === 'Help' && (
              <>
                <HelpSettingsTab onTabChange={onTabChange} />
                <AboutSettingsTab />
              </>
            )}
          </div>
          </SettingsAdvancedRevealContext.Provider>
        </DialogSurface>
      </div>
      {snippetManagerOpen && <SnippetSettingsModal
        open
        snippets={snippets}
        onSnippetsChange={onSnippetsChange}
        onClose={closeSnippetManager}
      />}
    </>
  )
}
