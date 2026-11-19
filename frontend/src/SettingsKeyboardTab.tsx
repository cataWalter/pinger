import { useState } from 'react'
import { Check, FileText, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { parseCustomEmoticonReplacements, type EmoticonReplacement } from './composerText'
import { AI_ACTION_SHORTCUTS } from './aiSettings'
import { preferenceBoolean, preferenceString } from './appShared'
import { PreferenceToggle, SettingRow, SettingsAdvanced, SettingsGroup, SettingsSection, type PreferenceTabProps } from './SettingsControls'

type KeyboardSettingsTabProps = PreferenceTabProps & {
  onManageSnippets: () => void
}

export function KeyboardSettingsTab({ preferences, onPreferenceChange, onManageSnippets }: KeyboardSettingsTabProps) {
  const [customEmoticonDraft, setCustomEmoticonDraft] = useState<EmoticonReplacement[]>(() => parseCustomEmoticonReplacements(preferenceString(preferences, 'emoji.emoticon_replacements', '')))
  const [customEmoticonStatus, setCustomEmoticonStatus] = useState('')
  const [shortcutSearchQuery, setShortcutSearchQuery] = useState('')
  const answeredShortcut = preferenceString(preferences, 'shortcuts.mark_answered', 'E').trim().toUpperCase() || 'E'
  const singleKeysEnabled = preferenceBoolean(preferences, 'shortcuts.single_keys', true)
  const keyboardShortcuts: [string, string][] = [
    ['Ctrl / ⌘ + K', 'Quick switch rooms'],
    ['Ctrl / ⌘ + F', 'Search messages'],
    ['Ctrl / ⌘ + ,', 'Open settings'],
    ['/ or Ctrl / ⌘ + Shift + S', 'Focus room search'],
    ['Alt + ↑ / ↓', 'Switch rooms'],
    ['Ctrl / ⌘ + Shift + ↑ / ↓', 'Switch needs-reply rooms'],
    ['Ctrl / ⌘ + Shift + H', 'Show archived rooms'],
    ['Ctrl / ⌘ + Shift + R', 'Show unanswered rooms'],
    ['Ctrl / ⌘ + Shift + F', 'Show favorite rooms'],
    ['Ctrl / ⌘ + 1–9', 'Switch to a visible room'],
    ['Ctrl / ⌘ + + / -', 'Adjust app zoom'],
    ['Ctrl / ⌘ + 0', 'Reset app zoom'],
    ['Ctrl / ⌘ + Shift + P', 'Toggle content blur'],
    ['Ctrl / ⌘ + Shift + I', 'Toggle hiding images and videos'],
    ...Object.values(AI_ACTION_SHORTCUTS).map<[string, string]>(({ key, description }) => [`Ctrl / ⌘ + Shift + ${key}`, description]),
    ['Ctrl / ⌘ + Shift + A', 'Show all rooms'],
    ['Ctrl / ⌘ + Shift + U', 'Show needs-reply rooms'],
    ['Ctrl / ⌘ + Shift + M', 'Start a private model chat'],
    ['Ctrl / ⌘ + Shift + G', 'Add or remove private chat from All rooms'],
    ['Ctrl / ⌘ + Shift + L', 'Jump to latest messages'],
    ['↑ / ↓ / Home / End', 'Navigate the room list'],
    ['Shift + F10', 'Open room actions'],
    ['↑ / ↓ or J / K', 'Navigate the focused timeline'],
    ['Home / End', 'Focus first / latest message'],
    ['N', 'Add room to Needs reply'],
    ['U', 'Toggle room unread'],
    ['A', 'Archive or restore room'],
    ['F', 'Toggle room favorite'],
    ['R', 'Reply to the focused message'],
    [answeredShortcut, 'Mark room answered'],
    ['Ctrl / ⌘ + Z', 'Undo mark answered'],
    ['Escape', 'Close search or dialog'],
    ['?', 'Open keyboard shortcuts'],
    ['Tab / Shift + Tab', 'Move between controls'],
    [preferenceBoolean(preferences, 'composer.ctrl_enter') ? 'Ctrl + Enter' : 'Enter', 'Send message'],
    ['Shift + Enter', 'Add a line in the composer'],
  ]
  const normalizedShortcutSearch = shortcutSearchQuery.trim().toLocaleLowerCase()
  const filteredKeyboardShortcuts = keyboardShortcuts.filter(([keys, description]) =>
    `${keys} ${description}`.toLocaleLowerCase().includes(normalizedShortcutSearch))

  function updateCustomEmoticon(index: number, part: 0 | 1, value: string) {
    setCustomEmoticonDraft((current) => current.map((pair, pairIndex) => {
      if (pairIndex !== index) return pair
      const updated: [string, string] = [pair[0], pair[1]]
      updated[part] = value
      return updated
    }))
    setCustomEmoticonStatus('')
  }

  async function saveCustomEmoticons() {
    const replacements = customEmoticonDraft.map(([symbol, emoji]) => [symbol.trim(), emoji.trim()] as EmoticonReplacement)
    const symbols = replacements.map(([symbol]) => symbol)
    const invalid = replacements.some(([symbol, emoji]) =>
      !symbol || !emoji || /\s/.test(symbol) || /\s/.test(emoji) || [...symbol].length > 16 || [...emoji].length > 16)
    if (invalid || replacements.length > 64 || new Set(symbols).size !== symbols.length) {
      setCustomEmoticonStatus('Use unique symbols and one non-empty emoji per row, with no spaces.')
      return
    }
    const saved = await onPreferenceChange('emoji.emoticon_replacements', JSON.stringify(replacements))
    setCustomEmoticonStatus(saved ? 'Custom emoji replacements saved.' : 'Could not save custom emoji replacements.')
  }

  async function resetCustomEmoticons() {
    const saved = await onPreferenceChange('emoji.emoticon_replacements', '[]')
    if (!saved) {
      setCustomEmoticonStatus('Could not restore built-in emoji replacements.')
      return
    }
    setCustomEmoticonDraft([])
    setCustomEmoticonStatus('Built-in emoji replacements restored.')
  }

  return (
    <SettingsSection title="Keyboard" description="Composer behavior, emoji replacement, and the full shortcut reference.">
      <SettingsGroup title="Single-key shortcuts">
        <PreferenceToggle label="Enable single-key shortcuts (N, U, A, F, R, J, K and the answered key)" checked={singleKeysEnabled} onChange={(value) => onPreferenceChange('shortcuts.single_keys', value)} />
        {!singleKeysEnabled && <p className="settings-note" role="status">Single-key shortcuts are off. Use the message and room menus instead. Ctrl / ⌘ shortcuts still work.</p>}
        <SettingRow label="Mark answered shortcut" hint="Use one letter to mark the selected room answered.">
          <input className="shortcut-input" type="text" maxLength={1} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={preferenceString(preferences, 'shortcuts.mark_answered', 'E')} aria-label="Mark answered shortcut" onChange={(event) => { const value = event.target.value.toUpperCase(); if (value) onPreferenceChange('shortcuts.mark_answered', value) }} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Composer">
        <PreferenceToggle label="Use Ctrl + Enter to send" checked={preferenceBoolean(preferences, 'composer.ctrl_enter')} onChange={(value) => onPreferenceChange('composer.ctrl_enter', value)} />
        <PreferenceToggle label="Show formatting toolbar" checked={preferenceBoolean(preferences, 'composer.formatting_toolbar')} onChange={(value) => onPreferenceChange('composer.formatting_toolbar', value)} />
        <PreferenceToggle label="Keep unsent drafts after restarting" checked={preferenceBoolean(preferences, 'composer.keep_drafts', true)} onChange={(value) => onPreferenceChange('composer.keep_drafts', value)} />
        <PreferenceToggle label="Use Up to focus the message list when the composer is empty" checked={preferenceBoolean(preferences, 'composer.arrow_up_focus_timeline')} onChange={(value) => onPreferenceChange('composer.arrow_up_focus_timeline', value)} />
        <PreferenceToggle label="Include timestamps when copying messages" checked={preferenceBoolean(preferences, 'clipboard.copy_timestamp')} onChange={(value) => onPreferenceChange('clipboard.copy_timestamp', value)} />
      </SettingsGroup>

      <SettingsGroup title="Emoji and text">
        <PreferenceToggle label="Suggest emoji for :shortcodes:" checked={preferenceBoolean(preferences, 'emoji.autocomplete')} onChange={(value) => onPreferenceChange('emoji.autocomplete', value)} />
        <PreferenceToggle label="Replace emoticons as you type" checked={preferenceBoolean(preferences, 'emoji.replace_emoticons', true)} onChange={(value) => onPreferenceChange('emoji.replace_emoticons', value)} />
        <div className="emoticon-replacement-editor" id="emoticon-replacement-editor">
          <div>
            <strong>Custom emoji replacements</strong>
            <p className="settings-note">Add a symbol and emoji pair. Custom pairs override built-in faces such as `:)`.</p>
          </div>
          {customEmoticonDraft.length === 0 && <p className="settings-note">No custom replacements.</p>}
          {customEmoticonDraft.map(([symbol, emoji], index) => (
            <div className="emoticon-replacement-row" key={index}>
              <label><span>Symbol</span><input type="text" maxLength={16} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={symbol} aria-label={`Symbol for replacement ${index + 1}`} onChange={(event) => updateCustomEmoticon(index, 0, event.target.value)} /></label>
              <span className="emoticon-replacement-arrow" aria-hidden="true">→</span>
              <label><span>Emoji</span><input type="text" maxLength={16} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={emoji} aria-label={`Emoji for replacement ${index + 1}`} onChange={(event) => updateCustomEmoticon(index, 1, event.target.value)} /></label>
              <button type="button" className="icon-button" aria-label={`Remove replacement ${index + 1}`} title="Remove replacement" onClick={() => { setCustomEmoticonDraft((current) => current.filter((_, pairIndex) => pairIndex !== index)); setCustomEmoticonStatus('') }}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="emoticon-replacement-actions">
            <button className="settings-command" type="button" disabled={customEmoticonDraft.length >= 64} onClick={() => { setCustomEmoticonDraft((current) => [...current, ['', '']]); setCustomEmoticonStatus('') }}><Plus size={14} />Add mapping</button>
            <button className="settings-command" type="button" onClick={() => void saveCustomEmoticons()}><Check size={14} />Save mappings</button>
            <button className="settings-command" type="button" onClick={() => void resetCustomEmoticons()}><RotateCcw size={14} />Reset built-ins</button>
          </div>
          {customEmoticonStatus && <p className="settings-note" role="status">{customEmoticonStatus}</p>}
        </div>
        <button className="settings-command" type="button" onClick={onManageSnippets}><FileText size={15} />Manage text snippets</button>
        <p className="settings-note">Expand personal shortcuts while composing. Snippets are stored on this device.</p>
      </SettingsGroup>

      <SettingsAdvanced description="Search every keyboard shortcut.">
        <div className="settings-search shortcut-search">
          <Search size={15} />
          <input
            type="search"
            value={shortcutSearchQuery}
            placeholder="Find a shortcut"
            aria-label="Search keyboard shortcuts"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setShortcutSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !shortcutSearchQuery) return
              event.preventDefault()
              event.stopPropagation()
              setShortcutSearchQuery('')
            }}
          />
          {shortcutSearchQuery && (
            <button type="button" className="icon-button" aria-label="Clear shortcut search" title="Clear search" onClick={() => setShortcutSearchQuery('')}><X size={14} /></button>
          )}
        </div>
        <dl className="keyboard-shortcut-list" aria-label="Keyboard shortcuts">
          {filteredKeyboardShortcuts.map(([keys, description]) => (
            <div className="keyboard-shortcut-row" key={description}>
              <dt>{description}</dt>
              <dd><kbd>{keys}</kbd></dd>
            </div>
          ))}
        </dl>
        {normalizedShortcutSearch && filteredKeyboardShortcuts.length === 0 && <p className="settings-note" role="status">No shortcuts match “{shortcutSearchQuery.trim()}”.</p>}
      </SettingsAdvanced>
    </SettingsSection>
  )
}
