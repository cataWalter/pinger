import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { playNotificationSound, preferenceBoolean, preferenceNumber, preferenceString } from './appShared'
import { PreferenceRange, PreferenceToggle, SettingRow, SettingsGroup, SettingsSection, type PreferenceTabProps } from './SettingsControls'

const toneKeys: Array<[string, string]> = [
  ['Direct message tone', 'notifications.sound_direct'],
  ['Mention tone', 'notifications.sound_mention'],
  ['Group message tone', 'notifications.sound_group'],
]

export function NotificationsSettingsTab({ preferences, onPreferenceChange }: PreferenceTabProps) {
  const [notificationPermission, setNotificationPermission] = useState('unsupported')

  useEffect(() => {
    let active = true
    async function refreshNotificationPermission() {
      try {
        const supported = await AppService.NativeNotificationsSupported()
        const permission = supported ? await AppService.NotificationPermission() : 'unsupported'
        if (active) {
          setNotificationPermission((current) => current === 'denied' && permission === 'default' ? current : permission)
        }
      } catch {
        if (active) setNotificationPermission('unsupported')
      }
    }

    void refreshNotificationPermission()
    window.addEventListener('focus', refreshNotificationPermission)
    return () => {
      active = false
      window.removeEventListener('focus', refreshNotificationPermission)
    }
  }, [])

  async function openNotificationSettings() {
    try {
      await AppService.OpenNotificationSettings()
    } catch {
      setNotificationPermission('denied')
    }
  }

  async function enableSystemNotifications() {
    try {
      if (!await AppService.NativeNotificationsSupported()) {
        setNotificationPermission('unsupported')
        return
      }
      if (notificationPermission === 'denied') {
        await openNotificationSettings()
        return
      }
      const permission = await AppService.RequestNotificationPermission()
      setNotificationPermission(permission)
      if (permission === 'denied') await openNotificationSettings()
    } catch {
      setNotificationPermission('unsupported')
    }
  }

  const permissionText = notificationPermission === 'granted'
    ? 'Allowed'
    : notificationPermission === 'denied'
      ? 'Blocked by the system. Open Notification Settings to allow alerts.'
      : notificationPermission === 'unsupported'
        ? 'Native notifications are unavailable. On macOS, launch the bundled Pinger.app; on Linux or Windows, use a desktop session with notifications enabled.'
        : 'Permission needed for desktop alerts.'
  const permissionAction = notificationPermission === 'granted'
    ? 'Allowed'
    : notificationPermission === 'denied'
      ? 'Open Settings'
      : notificationPermission === 'unsupported'
        ? 'Unavailable'
        : 'Enable'

  return (
    <SettingsSection title="Notifications" description="Alerts use your operating system's native notification service. macOS requests permission; Windows and Linux follow system notification settings.">
      <SettingsGroup title="System">
        <SettingRow label="System permission" hint={permissionText} className="notification-permission" interactive={false}>
          <button className="settings-command" type="button" disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported'} onClick={() => void enableSystemNotifications()}><Bell size={14} />{permissionAction}</button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Alerts">
        <PreferenceToggle label="Enable notifications" checked={preferenceBoolean(preferences, 'notifications.enabled', true)} onChange={(value) => {
          onPreferenceChange('notifications.enabled', value)
          if (value) void enableSystemNotifications()
        }} />
        <PreferenceToggle label="Notify while Pinger is focused" checked={!preferenceBoolean(preferences, 'notifications.only_when_unfocused', true)} onChange={(value) => onPreferenceChange('notifications.only_when_unfocused', !value)} />
        <PreferenceToggle label="Direct message alerts" checked={preferenceBoolean(preferences, 'notifications.direct', true)} onChange={(value) => onPreferenceChange('notifications.direct', value)} />
        <PreferenceToggle label="Mention alerts" checked={preferenceBoolean(preferences, 'notifications.mentions', true)} onChange={(value) => onPreferenceChange('notifications.mentions', value)} />
        <PreferenceToggle label="Group message alerts" checked={preferenceBoolean(preferences, 'notifications.group')} onChange={(value) => onPreferenceChange('notifications.group', value)} />
        <SettingRow label="Notification content" hint="Control what appears outside the app.">
          <select aria-label="Notification content" value={preferenceString(preferences, 'notifications.privacy', 'Sender and message preview')} onChange={(event) => onPreferenceChange('notifications.privacy', event.target.value)}>
            {['Sender and message preview', 'Sender only', 'Hidden content'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Sound">
        <PreferenceToggle label="Play a notification sound" checked={preferenceBoolean(preferences, 'notifications.sound')} onChange={(value) => onPreferenceChange('notifications.sound', value)} />
        <SettingRow label="Notification and message volume" hint="Adjust notification and chat sound levels.">
          <PreferenceRange label="Notification and message volume" min={0} max={100} step={5} value={preferenceNumber(preferences, 'notifications.volume', 50)} onChange={(value) => onPreferenceChange('notifications.volume', value)} />
        </SettingRow>
        {toneKeys.map(([label, key]) => (
          <SettingRow key={key} label={label} hint="Sound played for this kind of alert.">
            <select aria-label={label} value={preferenceString(preferences, key, 'Chime')} onChange={(event) => {
              const tone = event.currentTarget.value
              void onPreferenceChange(key, tone)
              playNotificationSound(preferenceNumber(preferences, 'notifications.volume', 50), tone)
            }}>
              {['Chime', 'Pulse', 'Soft', 'Silent'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </SettingRow>
        ))}
        <SettingRow label="Sound effects" hint="Chat sounds play while Pinger is focused.">
          <select aria-label="Sound effects" value={preferenceString(preferences, 'sounds.effects', 'Off')} onChange={(event) => onPreferenceChange('sounds.effects', event.target.value)}>
            <option value="Off">Off</option>
            <option value="Sent messages">Sent messages</option>
            <option value="Incoming and sent messages">Incoming and sent messages</option>
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Timing">
        <SettingRow label="Batch new messages" hint="Combine messages from the same room into one alert.">
          <select aria-label="Batch new messages" value={preferenceString(preferences, 'notifications.batch_seconds', '0')} onChange={(event) => onPreferenceChange('notifications.batch_seconds', event.target.value)}>
            <option value="0">Off</option>
            <option value="3">3 seconds</option>
            <option value="10">10 seconds</option>
            <option value="30">30 seconds</option>
          </select>
        </SettingRow>
        <SettingRow label="Repeat unread reminder" hint="Remind you once about a room that is still unread.">
          <select aria-label="Repeat unread reminder" value={preferenceString(preferences, 'notifications.repeat_minutes', '0')} onChange={(event) => onPreferenceChange('notifications.repeat_minutes', event.target.value)}>
            <option value="0">Off</option>
            <option value="5">After 5 minutes</option>
            <option value="15">After 15 minutes</option>
            <option value="60">After 60 minutes</option>
          </select>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="One-time codes">
        <PreferenceToggle label="Notify one-time codes immediately" checked={preferenceBoolean(preferences, 'notifications.otp_immediate', true)} onChange={(value) => onPreferenceChange('notifications.otp_immediate', value)} />
        <PreferenceToggle label="Copy one-time codes automatically" checked={preferenceBoolean(preferences, 'notifications.otp_copy')} onChange={(value) => onPreferenceChange('notifications.otp_copy', value)} />
      </SettingsGroup>
    </SettingsSection>
  )
}
