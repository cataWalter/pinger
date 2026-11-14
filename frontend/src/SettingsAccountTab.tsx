import { useEffect, useState, type ChangeEvent } from 'react'
import { Download, LogOut, ShieldCheck, Upload } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { type Device, type Snapshot } from '../bindings/mychat/desktop/models.js'
import { describeError, preferenceBoolean, requestLocalAsset, Avatar, type PreferenceValues } from './appShared'
import { activeLocale } from './i18n'
import { PreferenceToggle, SettingsGroup, SettingsSection } from './SettingsControls'

type AccountSettingsTabProps = {
  profile: Snapshot['profile']
  preferences: PreferenceValues
  onPreferenceChange: (key: string, value: boolean | string) => Promise<boolean>
  onLogout: () => Promise<void>
}

export function AccountSettingsTab({ profile, preferences, onPreferenceChange, onLogout }: AccountSettingsTabProps) {
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)

  async function confirmLogout() {
    setLogoutBusy(true)
    try {
      await onLogout()
    } catch {
      setLogoutBusy(false)
      setLogoutConfirm(false)
    }
  }

  return (
    <SettingsSection title="Account">
      <div className="account-summary"><Avatar uri={profile.avatarUri} label={profile.displayName || profile.userId} className="profile-avatar" /><div><strong>{profile.displayName || profile.userId}</strong><span>{profile.userId}</span></div></div>
      <div className="account-details"><span>Homeserver</span><strong>{profile.homeserver}</strong><span>This device</span><strong>{profile.deviceId}</strong><span>Encryption</span><strong>{profile.verified ? 'Verified' : 'Needs verification'}</strong></div>
      <SettingsGroup title="Privacy">
        <PreferenceToggle label="Send typing indicators" checked={preferenceBoolean(preferences, 'privacy.send_typing', true)} onChange={(value) => onPreferenceChange('privacy.send_typing', value)} />
        <PreferenceToggle label="Content blur" checked={preferenceBoolean(preferences, 'privacy.incognito')} onChange={(value) => onPreferenceChange('privacy.incognito', value)} />
        {preferenceBoolean(preferences, 'privacy.incognito') && <p className="settings-note" role="status">Content blur is active. Message text, names, and room images are blurred until hovered or focused. Read receipts are still sent when you open a room.</p>}
      </SettingsGroup>
      <p className="settings-note">Session data and encryption keys are stored locally on this device.</p>
      {!logoutConfirm ? (
        <button className="settings-command is-danger" type="button" onClick={() => setLogoutConfirm(true)}><LogOut size={15} />Log out</button>
      ) : (
        <div className="logout-confirm" role="group" aria-label="Confirm logout">
          <span>Log out and clear local session data?</span>
          <button type="button" onClick={() => setLogoutConfirm(false)}>Cancel</button>
          <button className="is-danger" type="button" disabled={logoutBusy} onClick={() => void confirmLogout()}>{logoutBusy ? 'Logging out…' : 'Log out'}</button>
        </div>
      )}
    </SettingsSection>
  )
}

export function DevicesSettingsTab({ profile, onClose }: { profile: Snapshot['profile']; onClose: () => void }) {
  const [devices, setDevices] = useState<Device[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState('')
  const [verificationStarting, setVerificationStarting] = useState(false)
  const [deviceRevokeID, setDeviceRevokeID] = useState('')
  const [deviceRevokePassword, setDeviceRevokePassword] = useState('')
  const [deviceRevokeBusy, setDeviceRevokeBusy] = useState(false)

  useEffect(() => {
    let active = true
    setDevicesLoading(true)
    setDevicesError('')
    AppService.Devices()
      .then((result) => { if (active) setDevices(result ?? []) })
      .catch((loadError: unknown) => { if (active) setDevicesError(describeError(loadError)) })
      .finally(() => { if (active) setDevicesLoading(false) })
    return () => { active = false }
  }, [])

  async function revokeDevice(device: Device) {
    setDeviceRevokeBusy(true)
    setDevicesError('')
    try {
      await AppService.RevokeDevice(device.id, deviceRevokePassword)
      setDevices((current) => current.filter((item) => item.id !== device.id))
      setDeviceRevokeID('')
    } catch (revokeError) {
      setDevicesError(describeError(revokeError))
    } finally {
      setDeviceRevokePassword('')
      setDeviceRevokeBusy(false)
    }
  }

  function cancelDeviceRevoke() {
    setDeviceRevokeID('')
    setDeviceRevokePassword('')
    setDevicesError('')
  }

  async function startSessionVerification() {
    setVerificationStarting(true)
    setDevicesError('')
    let started = false
    try {
      await AppService.StartSessionVerification()
      started = true
    } catch (startError) {
      setDevicesError(describeError(startError))
    } finally {
      setVerificationStarting(false)
    }
    if (started) onClose()
  }

  return (
    <SettingsSection title="Active devices">
      {profile.verified && <button className="settings-command" type="button" disabled={verificationStarting} onClick={() => void startSessionVerification()}><ShieldCheck size={15} />{verificationStarting ? 'Starting verification…' : 'Verify another session'}</button>}
      {devicesLoading && <p className="settings-note">Loading devices…</p>}
      {devicesError && <p className="settings-error" role="alert">{devicesError}</p>}
      {!devicesLoading && !devicesError && devices.length === 0 && <p className="settings-note">No devices were returned by the homeserver.</p>}
      {devices.map((device) => (
        <article className="device-row" key={device.id}>
          <div><strong>{device.displayName || '(unnamed device)'}</strong><span>{device.id}{device.current ? ' · this device' : ''}</span><small>{device.lastSeenAt > 0 ? `Last active ${new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'medium' }).format(new Date(device.lastSeenAt))}` : device.lastSeenIp || 'Last active time unavailable'}</small></div>
          {!device.current && (deviceRevokeID === device.id ? (
            <form className="logout-confirm device-revoke-confirm" aria-label={`Confirm revoking ${device.displayName || device.id}`} onSubmit={(event) => { event.preventDefault(); void revokeDevice(device) }}>
              <span>Enter your Matrix account password to revoke this device.</span>
              <label className="security-field"><span>Account password</span><input aria-label="Account password" type="password" autoComplete="current-password" required value={deviceRevokePassword} onChange={(event) => setDeviceRevokePassword(event.target.value)} /></label>
              <button type="button" disabled={deviceRevokeBusy} onClick={cancelDeviceRevoke}>Cancel</button>
              <button className="is-danger" type="submit" disabled={deviceRevokeBusy}>{deviceRevokeBusy ? 'Revoking…' : 'Revoke device'}</button>
            </form>
          ) : <button className="settings-command is-danger" type="button" onClick={() => { setDevicesError(''); setDeviceRevokePassword(''); setDeviceRevokeID(device.id) }}>Revoke</button>)}
        </article>
      ))}
    </SettingsSection>
  )
}

export function SecuritySettingsTab({ profile }: { profile: Snapshot['profile'] }) {
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [backupConfirmation, setBackupConfirmation] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [keyStatus, setKeyStatus] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)

  async function exportRoomKeys() {
    if (!backupPassphrase || backupPassphrase !== backupConfirmation) {
      setKeyStatus('Enter and confirm the same non-empty passphrase.')
      return
    }
    setKeyBusy(true)
    setKeyStatus('')
    try {
      const response = await requestLocalAsset('/media/ipc/room-keys/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: backupPassphrase }),
      })
      const backup = await response.blob()
      if (backup.size === 0) throw new Error('The homeserver returned an empty room key backup.')
      const objectURL = URL.createObjectURL(backup)
      const link = document.createElement('a')
      link.href = objectURL
      link.download = 'matrix-room-keys.txt'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
      setKeyStatus('Encrypted room key backup exported.')
      setBackupPassphrase('')
      setBackupConfirmation('')
    } catch (exportError) {
      setKeyStatus(describeError(exportError))
    } finally {
      setKeyBusy(false)
    }
  }

  async function importRoomKeys(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!importPassphrase) {
      setKeyStatus('Enter the backup passphrase before choosing a file.')
      return
    }
    if (file.size > 100 * 1024 * 1024) {
      setKeyStatus('Room key backup exceeds 100 MiB.')
      return
    }
    setKeyBusy(true)
    setKeyStatus('')
    try {
      const response = await requestLocalAsset('/media/ipc/room-keys/import', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Matrix-Backup-Passphrase': importPassphrase,
        },
        body: file,
      })
      const result = await response.json() as { imported: number; total: number }
      setKeyStatus(`Imported ${result.imported} of ${result.total} room keys.`)
      setImportPassphrase('')
    } catch (importError) {
      setKeyStatus(describeError(importError))
    } finally {
      setKeyBusy(false)
    }
  }

  return (
    <SettingsSection title="Encryption and room keys">
      <p className="settings-note">Device verification: {profile.verified ? 'Verified' : 'This device needs verification.'}</p>
      <SettingsGroup title="Export">
        <label className="security-field"><span>Backup passphrase</span><input type="password" autoComplete="new-password" value={backupPassphrase} onChange={(event) => setBackupPassphrase(event.target.value)} /></label>
        <label className="security-field"><span>Confirm passphrase</span><input type="password" autoComplete="new-password" value={backupConfirmation} onChange={(event) => setBackupConfirmation(event.target.value)} /></label>
        <button className="settings-command" type="button" disabled={keyBusy || !backupPassphrase || backupPassphrase !== backupConfirmation} onClick={() => void exportRoomKeys()}><Download size={15} />{keyBusy ? 'Working…' : 'Export room keys'}</button>
      </SettingsGroup>
      <SettingsGroup title="Import">
        <label className="security-field"><span>Import passphrase</span><input type="password" autoComplete="off" value={importPassphrase} onChange={(event) => setImportPassphrase(event.target.value)} /></label>
        <label className="settings-command file-command"><Upload size={15} />Import room key file<input type="file" accept=".txt,.json,application/octet-stream" disabled={keyBusy || !importPassphrase} onChange={(event) => void importRoomKeys(event)} /></label>
      </SettingsGroup>
      {keyStatus && <p className="settings-note" role="status">{keyStatus}</p>}
    </SettingsSection>
  )
}
