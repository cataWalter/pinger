import { type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { DEFAULT_ACCENT_NAME, accentPaletteFor, accentPresets, isAccentHex } from './accent'
import { SYSTEM_THEME_NAME, findThemeByName, themePaletteFor, themes as appearanceThemes } from './themes'
import { chatWallpapers, preferenceBoolean, preferenceNumber, preferenceString } from './appShared'
import { PreferenceRange, PreferenceToggle, SettingRow, SettingsGroup, SettingsSection, type PreferenceTabProps } from './SettingsControls'

export function AppearanceSettingsTab({ preferences, onPreferenceChange }: PreferenceTabProps) {
  const theme = preferenceString(preferences, 'appearance.theme', SYSTEM_THEME_NAME)
  const activeTheme = findThemeByName(theme)
  const themeDescription = activeTheme
    ? `${activeTheme.name} is a ${activeTheme.mode} theme.`
    : theme === SYSTEM_THEME_NAME
      ? 'System default follows your OS preference.'
      : ''
  const fontSize = preferenceString(preferences, 'appearance.font_size', 'Medium')
  const accentPreference = preferenceString(preferences, 'appearance.accent_color', DEFAULT_ACCENT_NAME)
  const activeAccentPalette = accentPaletteFor(accentPreference)
  const bubbleColor = preferenceString(preferences, 'appearance.bubble_color', activeAccentPalette.base)
  const activeWallpaper = chatWallpapers.find((wallpaper) => wallpaper.name === preferenceString(preferences, 'appearance.chat_wallpaper', 'None')) ?? chatWallpapers[0]
  const safeBubbleColor = /^#[0-9a-fA-F]{6}$/.test(bubbleColor) ? bubbleColor : activeAccentPalette.base

  return (
    <SettingsSection title="Appearance">
      <SettingsGroup title="Theme">
        <SettingRow label="Theme" hint={`Choose the conversation surface. ${themeDescription}`}>
          <select aria-label="Theme" value={theme} onChange={(event) => onPreferenceChange('appearance.theme', event.target.value)}>
            <option value={SYSTEM_THEME_NAME}>{SYSTEM_THEME_NAME}</option>
            {appearanceThemes.map((entry) => <option key={entry.id} value={entry.name}>{entry.name} ({entry.mode})</option>)}
          </select>
        </SettingRow>
        <div className="theme-previews" role="group" aria-label="Theme previews">
          {appearanceThemes.map((entry) => {
            const palette = themePaletteFor(entry.id)
            return <button key={entry.id} className={`theme-preview${theme === entry.name ? ' is-selected' : ''}`} type="button" aria-label={`${entry.name} theme`} aria-pressed={theme === entry.name} onClick={() => onPreferenceChange('appearance.theme', entry.name)}>
              <span className="theme-preview-art" aria-hidden="true" style={{ '--preview-canvas': palette.canvas, '--preview-sidebar': palette.sidebar, '--preview-surface': palette.surface, '--preview-border': palette.border, '--preview-bubble': entry.bubbleColor } as CSSProperties}>
                <span className="theme-preview-sidebar" /><span className="theme-preview-conversation" />
              </span>
              <span>{entry.name}</span>
            </button>
          })}
        </div>
        <SettingRow label="Font size" hint="Adjust room and message text.">
          <select aria-label="Font size" value={fontSize} onChange={(event) => onPreferenceChange('appearance.font_size', event.target.value)}>
            {['Small', 'Medium', 'Large'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </SettingRow>
        <SettingRow label="App zoom" hint="Scale the full interface.">
          <PreferenceRange label="App zoom" min={75} max={125} step={5} value={preferenceNumber(preferences, 'appearance.zoom', 100, 75, 125)} onChange={(value) => onPreferenceChange('appearance.zoom', value)} />
        </SettingRow>
        <PreferenceToggle label="Use pointer cursor on clickable controls" checked={preferenceBoolean(preferences, 'appearance.pointer_cursor', true)} onChange={(value) => onPreferenceChange('appearance.pointer_cursor', value)} />
      </SettingsGroup>

      <SettingsGroup title="Colors and backgrounds">
        <SettingRow label="Outgoing message color" hint="Choose a color for your messages.">
          <input className="color-input" type="color" value={safeBubbleColor} onChange={(event) => onPreferenceChange('appearance.bubble_color', event.target.value)} aria-label="Outgoing message color" />
        </SettingRow>
        <SettingRow label="Theme accent" hint="Choose an accent. Message color follows it until you pick one." className="accent-setting-row" interactive={false}>
          <div className="accent-palette" role="group" aria-label="Theme accent color">
            {accentPresets.map((palette) => <button key={palette.name} className="accent-swatch" type="button" aria-label={`${palette.name} accent color`} aria-pressed={activeAccentPalette.name === palette.name} title={palette.name} style={{ '--swatch': palette.base } as CSSProperties} onClick={() => onPreferenceChange('appearance.accent_color', palette.name)}>
              {activeAccentPalette.name === palette.name && <Check size={14} />}
            </button>)}
            <label className={`accent-swatch accent-swatch-custom${isAccentHex(accentPreference) ? ' is-selected' : ''}`} title="Custom color" style={{ '--swatch': activeAccentPalette.base } as CSSProperties}>
              <input type="color" value={activeAccentPalette.base} aria-label="Custom accent color" onChange={(event) => onPreferenceChange('appearance.accent_color', event.target.value)} />
              {isAccentHex(accentPreference) && <Check size={14} />}
            </label>
          </div>
        </SettingRow>
        <SettingRow label="Chat wallpaper" hint="Add a subtle background to conversations." className="accent-setting-row" interactive={false}>
          <div className="wallpaper-picker" role="group" aria-label="Chat wallpaper">
            {chatWallpapers.map((wallpaper) => <button key={wallpaper.name} className="wallpaper-swatch" type="button" aria-label={`${wallpaper.name} wallpaper`} aria-pressed={activeWallpaper.name === wallpaper.name} title={wallpaper.name} style={{ '--wallpaper-swatch': wallpaper.swatch } as CSSProperties} onClick={() => onPreferenceChange('appearance.chat_wallpaper', wallpaper.name)}>
              {activeWallpaper.name === wallpaper.name && <Check size={13} />}
            </button>)}
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Room list">
        <PreferenceToggle label="Show room previews" checked={preferenceBoolean(preferences, 'sidebar.show_previews', true)} onChange={(value) => onPreferenceChange('sidebar.show_previews', value)} />
        <PreferenceToggle label="Show unread counts" checked={preferenceBoolean(preferences, 'sidebar.show_unread_counts', true)} onChange={(value) => onPreferenceChange('sidebar.show_unread_counts', value)} />
        <PreferenceToggle label="Compact chat list" checked={preferenceBoolean(preferences, 'sidebar.compact_chat_list')} onChange={(value) => onPreferenceChange('sidebar.compact_chat_list', value)} />
        <PreferenceToggle label="Show network labels in the chat list" checked={preferenceBoolean(preferences, 'sidebar.network_icons')} onChange={(value) => onPreferenceChange('sidebar.network_icons', value)} />
        <SettingRow label="Favorite chats" hint="List favorite rooms first, or only mark them with a star.">
          <select aria-label="Favorite chats" value={preferenceString(preferences, 'sidebar.pinned_style', 'Top of list')} onChange={(event) => onPreferenceChange('sidebar.pinned_style', event.target.value)}>
            {['Top of list', 'Star only'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Messages">
        <PreferenceToggle label="Animate new messages" checked={preferenceBoolean(preferences, 'appearance.message_animations', true)} onChange={(value) => onPreferenceChange('appearance.message_animations', value)} />
        <PreferenceToggle label="Show message timestamps" checked={preferenceBoolean(preferences, 'appearance.show_timestamps', true)} onChange={(value) => onPreferenceChange('appearance.show_timestamps', value)} />
        <PreferenceToggle label="Hide images and videos" checked={preferenceBoolean(preferences, 'appearance.hide_images_and_videos')} onChange={(value) => onPreferenceChange('appearance.hide_images_and_videos', value)} />
        <PreferenceToggle label="Show link previews" checked={preferenceBoolean(preferences, 'messages.url_previews', true)} onChange={(value) => onPreferenceChange('messages.url_previews', value)} />
        <PreferenceToggle label="Show link previews in encrypted rooms" checked={preferenceBoolean(preferences, 'messages.url_previews_encrypted')} onChange={(value) => onPreferenceChange('messages.url_previews_encrypted', value)} />
        <PreferenceToggle label="Hide deleted messages" checked={preferenceBoolean(preferences, 'appearance.hide_deleted_messages')} onChange={(value) => onPreferenceChange('appearance.hide_deleted_messages', value)} />
        <PreferenceToggle label="Balance message line wrapping" checked={preferenceBoolean(preferences, 'appearance.balanced_text')} onChange={(value) => onPreferenceChange('appearance.balanced_text', value)} />
        <PreferenceToggle label="Use a 24-hour clock" checked={preferenceBoolean(preferences, 'appearance.time_24_hour')} onChange={(value) => onPreferenceChange('appearance.time_24_hour', value)} />
        <PreferenceToggle label="Use relative timestamps" checked={preferenceBoolean(preferences, 'appearance.relative_timestamps')} onChange={(value) => onPreferenceChange('appearance.relative_timestamps', value)} />
      </SettingsGroup>

      <SettingsGroup title="Performance">
        <PreferenceToggle label="Low-spec mode" checked={preferenceBoolean(preferences, 'appearance.low_spec_mode')} onChange={(value) => onPreferenceChange('appearance.low_spec_mode', value)} />
        <p className="settings-note">Turns off animations, transitions, shadows, and blur. Restart Pinger to also remove the macOS glass backdrop and, on Windows and Linux, turn off GPU rendering.</p>
      </SettingsGroup>
    </SettingsSection>
  )
}
