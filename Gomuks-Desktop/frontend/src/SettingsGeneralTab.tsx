import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { languageOptions } from './i18n'
import { builtInQuickReactions } from './appConstants'
import { customQuickReactionsError } from './preferences'
import { describeError, parseTimeSuggestionMinutes, preferenceBoolean, preferenceString } from './appShared'
import { PreferenceToggle, SettingRow, SettingsGroup, SettingsSection, type PreferenceTabProps } from './SettingsControls'

function defaultReactionChoices(saved: string) {
  return builtInQuickReactions.includes(saved) ? builtInQuickReactions : [saved, ...builtInQuickReactions]
}

function CustomQuickReactionsRow({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  return (
    <SettingRow label="Custom quick reactions" hint={error ? <span className="settings-error" role="alert">{error}</span> : 'Up to 6 emoji, separated by spaces.'}>
      <input
        type="text"
        aria-label="Custom quick reactions"
        aria-invalid={Boolean(error)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(customQuickReactionsError(event.target.value))
        }}
        onBlur={() => {
          const message = customQuickReactionsError(draft)
          setError(message)
          const normalized = draft.trim().split(/\s+/).filter(Boolean).join(' ')
          if (!message && normalized !== value) onCommit(normalized)
        }}
      />
    </SettingRow>
  )
}

type GeneralSettingsTabProps = PreferenceTabProps & {
  audioInputDevices: MediaDeviceInfo[]
  selectedAudioInputDeviceId: string
  onArchiveInactiveRooms: () => Promise<void>
}

export function GeneralSettingsTab({ preferences, onPreferenceChange, audioInputDevices, selectedAudioInputDeviceId, onArchiveInactiveRooms }: GeneralSettingsTabProps) {
  const { t } = useTranslation()
  const downloadFolder = preferenceString(preferences, 'downloads.folder', '')
  const [downloadError, setDownloadError] = useState('')
  const [archiveAgeDraft, setArchiveAgeDraft] = useState(preferenceString(preferences, 'archive.older_than_days', '90'))
  const [archiveAgeError, setArchiveAgeError] = useState('')
  const [scheduleSendDelayDraft, setScheduleSendDelayDraft] = useState(preferenceString(preferences, 'schedule.default_send_minutes', '5'))
  const [scheduleSendDelayError, setScheduleSendDelayError] = useState('')
  const [scheduleReminderDelayDraft, setScheduleReminderDelayDraft] = useState(preferenceString(preferences, 'schedule.default_reminder_minutes', '60'))
  const [scheduleReminderDelayError, setScheduleReminderDelayError] = useState('')
  const [scheduleSuggestionsDraft, setScheduleSuggestionsDraft] = useState(preferenceString(preferences, 'schedule.suggestions_minutes', '5,15,60'))
  const [scheduleSuggestionsError, setScheduleSuggestionsError] = useState('')

  async function chooseDownloadFolder() {
    setDownloadError('')
    try {
      const folder = await AppService.ChooseDownloadFolder()
      if (folder) onPreferenceChange('downloads.folder', folder)
    } catch (folderError) {
      setDownloadError(describeError(folderError))
    }
  }

  function saveScheduleDefaultDelay(key: string, draft: string, setDraft: (value: string) => void, setError: (value: string) => void) {
    const minutes = Number(draft)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      setError('Use a whole number from 1 to 10080 minutes.')
      return
    }
    const value = String(minutes)
    setDraft(value)
    setError('')
    void onPreferenceChange(key, value)
  }

  function saveArchiveAge(draft: string) {
    const days = Number(draft)
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setArchiveAgeError('Use a whole number from 1 to 3650 days.')
      return
    }
    const value = String(days)
    setArchiveAgeDraft(value)
    setArchiveAgeError('')
    void onPreferenceChange('archive.older_than_days', value)
  }

  return (
    <SettingsSection title={t('settings.general')}>
      <SettingsGroup title="Language">
        <SettingRow label={t('settings.language')} hint={t('settings.languageHint')}>
          <select aria-label={t('settings.language')} value={preferenceString(preferences, 'general.language', 'system')} onChange={(event) => onPreferenceChange('general.language', event.target.value)}>
            {languageOptions.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
          </select>
        </SettingRow>
        <p className="settings-note" role="note">{t('settings.translationNotice')}</p>
      </SettingsGroup>

      <SettingsGroup title="Window">
        <PreferenceToggle label="Launch Pinger at login" checked={preferenceBoolean(preferences, 'system.launch_at_startup')} onChange={(value) => onPreferenceChange('system.launch_at_startup', value)} />
        <PreferenceToggle label="Minimize to tray when closing the window" checked={preferenceBoolean(preferences, 'window.minimize_to_tray')} onChange={(value) => onPreferenceChange('window.minimize_to_tray', value)} />
        <PreferenceToggle label="Start minimized" checked={preferenceBoolean(preferences, 'window.start_minimized')} onChange={(value) => onPreferenceChange('window.start_minimized', value)} />
        <PreferenceToggle label="Quit Pinger when the window closes" checked={preferenceBoolean(preferences, 'window.quit_on_close')} onChange={(value) => onPreferenceChange('window.quit_on_close', value)} />
        <PreferenceToggle label="Show menu bar icon" checked={preferenceBoolean(preferences, 'window.menu_bar_icon', true)} onChange={(value) => onPreferenceChange('window.menu_bar_icon', value)} />
      </SettingsGroup>

      <SettingsGroup title="Downloads">
        <SettingRow label="Download folder" hint={downloadFolder || 'Downloads folder in your home directory'} interactive={false}>
          <span>
            <button type="button" className="settings-command" onClick={() => void chooseDownloadFolder()}>Choose…</button>
            {downloadFolder && <button type="button" className="settings-command" onClick={() => onPreferenceChange('downloads.folder', '')}>Use default</button>}
          </span>
        </SettingRow>
        {downloadError && <p className="settings-error" role="alert">{downloadError}</p>}
        <PreferenceToggle label="Ask where to save each download" checked={preferenceBoolean(preferences, 'downloads.ask_each_time')} onChange={(value) => onPreferenceChange('downloads.ask_each_time', value)} />
      </SettingsGroup>

      <SettingsGroup title="Messages and reactions">
        <SettingRow label="Double-click a message" hint="Choose what a double-click on a message does.">
          <select aria-label="Double-click a message" value={preferenceString(preferences, 'messages.double_click', 'None')} onChange={(event) => onPreferenceChange('messages.double_click', event.target.value)}>
            <option value="None">Nothing</option>
            <option value="Reply">Reply</option>
            <option value="React">Add reaction</option>
          </select>
        </SettingRow>
        <PreferenceToggle label="Show quick reaction picker" checked={preferenceBoolean(preferences, 'reactions.quick_enabled', true)} onChange={(value) => onPreferenceChange('reactions.quick_enabled', value)} />
        <SettingRow label="Default reaction" hint="Sent directly when the quick picker is turned off.">
          <select aria-label="Default reaction" value={preferenceString(preferences, 'reactions.default_emoji', '👍')} onChange={(event) => onPreferenceChange('reactions.default_emoji', event.target.value)}>
            {defaultReactionChoices(preferenceString(preferences, 'reactions.default_emoji', '👍')).map((emoji) => <option key={emoji} value={emoji}>{emoji}</option>)}
          </select>
        </SettingRow>
        <SettingRow label="Quick reaction set" hint="Use the built-in frequent set or your own emoji.">
          <select aria-label="Quick reaction set" value={preferenceString(preferences, 'reactions.quick_source', 'Frequent')} onChange={(event) => onPreferenceChange('reactions.quick_source', event.target.value)}>
            <option value="Frequent">Frequent</option>
            <option value="Custom">Custom</option>
          </select>
        </SettingRow>
        <CustomQuickReactionsRow value={preferenceString(preferences, 'reactions.custom_emojis', '')} onCommit={(value) => onPreferenceChange('reactions.custom_emojis', value)} />
      </SettingsGroup>

      <SettingsGroup title="Inbox">
        <SettingRow label="After changing a room's read state" hint="Choose where to go after marking a room read or unread.">
          <select aria-label="After changing a room's read state" value={preferenceString(preferences, 'inbox.after_read', 'stay')} onChange={(event) => onPreferenceChange('inbox.after_read', event.target.value)}>
            <option value="stay">Stay in the current room</option>
            <option value="next_visible">Next visible room</option>
            <option value="next_unread">Next unread room</option>
            <option value="none">Clear selection</option>
          </select>
        </SettingRow>
        <SettingRow label="After archiving a room" hint="Choose what opens after the selected room is archived.">
          <select aria-label="After archiving a room" value={preferenceString(preferences, 'archive.next_room', 'next_visible')} onChange={(event) => onPreferenceChange('archive.next_room', event.target.value)}>
            <option value="next_visible">Next visible room</option>
            <option value="next_unread">Next unread room</option>
            <option value="none">Clear selection</option>
          </select>
        </SettingRow>
        <PreferenceToggle label="Automatically archive inactive rooms" checked={preferenceBoolean(preferences, 'archive.automatic')} onChange={(value) => onPreferenceChange('archive.automatic', value)} />
        <SettingRow label="Inactive room age" hint="Archive rooms without activity for this long.">
          <input type="number" min="1" max="3650" step="1" value={archiveAgeDraft} aria-label="Inactive room age" aria-invalid={Boolean(archiveAgeError)} onChange={(event) => { setArchiveAgeDraft(event.target.value); setArchiveAgeError('') }} onBlur={() => saveArchiveAge(archiveAgeDraft)} />
        </SettingRow>
        {archiveAgeError && <p className="form-error" role="alert">{archiveAgeError}</p>}
        <button className="settings-command" type="button" onClick={() => void onArchiveInactiveRooms()}><Archive size={15} />Archive inactive rooms</button>
      </SettingsGroup>

      <SettingsGroup title="Voice and scheduling">
        <SettingRow label="Voice-note microphone" hint="Choose the input used for recording.">
          <select value={selectedAudioInputDeviceId} aria-label="Voice-note microphone" onChange={(event) => onPreferenceChange('audio.input_device', event.target.value)}>
            <option value="">System default</option>
            {audioInputDevices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
          </select>
        </SettingRow>
        <PreferenceToggle label="Auto-play next voice note" checked={preferenceBoolean(preferences, 'voice.autoplay_next')} onChange={(value) => onPreferenceChange('voice.autoplay_next', value)} />
        <SettingRow label="Default Send Later delay" hint="Initial scheduled-send time, in minutes (1–10080).">
          <input type="number" min="1" max="10080" step="1" value={scheduleSendDelayDraft} aria-label="Default Send Later delay in minutes" aria-invalid={Boolean(scheduleSendDelayError)} onChange={(event) => { setScheduleSendDelayDraft(event.target.value); setScheduleSendDelayError('') }} onBlur={() => saveScheduleDefaultDelay('schedule.default_send_minutes', scheduleSendDelayDraft, setScheduleSendDelayDraft, setScheduleSendDelayError)} />
        </SettingRow>
        {scheduleSendDelayError && <p className="form-error" role="alert">{scheduleSendDelayError}</p>}
        <SettingRow label="Default Remind Later delay" hint="Initial reminder time, in minutes (1–10080).">
          <input type="number" min="1" max="10080" step="1" value={scheduleReminderDelayDraft} aria-label="Default Remind Later delay in minutes" aria-invalid={Boolean(scheduleReminderDelayError)} onChange={(event) => { setScheduleReminderDelayDraft(event.target.value); setScheduleReminderDelayError('') }} onBlur={() => saveScheduleDefaultDelay('schedule.default_reminder_minutes', scheduleReminderDelayDraft, setScheduleReminderDelayDraft, setScheduleReminderDelayError)} />
        </SettingRow>
        {scheduleReminderDelayError && <p className="form-error" role="alert">{scheduleReminderDelayError}</p>}
        <SettingRow label="Schedule time suggestions" hint="Enter 1–6 comma-separated delays in minutes.">
          <input className="schedule-suggestions-input" type="text" inputMode="numeric" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={scheduleSuggestionsDraft} aria-label="Schedule time suggestions" aria-invalid={Boolean(scheduleSuggestionsError)} onChange={(event) => { setScheduleSuggestionsDraft(event.target.value); setScheduleSuggestionsError('') }} onBlur={() => {
            const minutes = parseTimeSuggestionMinutes(scheduleSuggestionsDraft)
            if (minutes.length === 0) {
              setScheduleSuggestionsError('Use 1–6 unique values from 1 to 10080.')
              return
            }
            const value = minutes.join(',')
            setScheduleSuggestionsDraft(value)
            setScheduleSuggestionsError('')
            onPreferenceChange('schedule.suggestions_minutes', value)
          }} />
        </SettingRow>
        {scheduleSuggestionsError && <p className="form-error" role="alert">{scheduleSuggestionsError}</p>}
      </SettingsGroup>
    </SettingsSection>
  )
}

export function HistorySettingsTab({ preferences, onPreferenceChange }: PreferenceTabProps) {
  return (
    <SettingsSection title="Message history">
      <SettingsGroup title="Loading">
        <SettingRow label="Messages to load" hint="Load this many recent messages when opening a room.">
          <select aria-label="Messages to load" value={preferenceString(preferences, 'history.initial_messages', '100')} onChange={(event) => onPreferenceChange('history.initial_messages', event.target.value)}>
            {['25', '50', '100', '250', '500', '1000'].map((value) => <option key={value} value={value}>{Number(value).toLocaleString()}</option>)}
          </select>
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  )
}
