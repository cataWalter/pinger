import { useEffect, useState } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type AppBuildInfo, type Room, type UpdateStatus } from '../bindings/mychat/desktop/models.js'
import { activeLocale } from './i18n'
import { describeError } from './appShared'
import { SettingsSection } from './SettingsControls'
import { type SettingsTab } from './settings'

const chatNetworks: Array<{ code: string; name: string }> = [
  { code: 'WA', name: 'WhatsApp' },
  { code: 'TG', name: 'Telegram' },
  { code: 'IG', name: 'Instagram' },
  { code: 'SG', name: 'Signal' },
  { code: 'iM', name: 'iMessage' },
  { code: 'DC', name: 'Discord' },
  { code: 'SL', name: 'Slack' },
  { code: 'SMS', name: 'SMS' },
  { code: 'BR', name: 'Other bridged chats' },
]

export function AboutSettingsTab() {
  return (
    <SettingsSection title="Pinger">
      <AboutPinger />
    </SettingsSection>
  )
}

export function IntegrationsSettingsTab({ rooms }: { rooms: Room[] }) {
  return (
    <SettingsSection title="Integrations" description="Chat networks are detected from the active account's chats, using room names and DM users. This is a best-effort view. Connecting a network requires a bridge set up on your homeserver; Pinger cannot create bridge logins. Beeper users must connect new networks in the official Beeper app first.">
      <div className="integration-status" aria-label="Detected chat networks">
        {chatNetworks.map(({ code, name }) => {
          const count = rooms.filter((room) => room.bridge === code).length
          return (
            <div key={code} className="account-details"><span>{name}</span><strong>{count > 0 ? `${count.toLocaleString()} ${count === 1 ? 'chat' : 'chats'} detected` : 'No chats detected'}</strong></div>
          )
        })}
      </div>
    </SettingsSection>
  )
}

export function HelpSettingsTab({ onTabChange }: { onTabChange: (tab: SettingsTab) => void }) {
  return (
    <SettingsSection title="Help center" description="Answers to common questions about Pinger.">
      <article className="help-item"><h4>Keyboard shortcuts</h4><p>The Keyboard tab lists every shortcut. Single-key shortcuts can be turned off there.</p><button className="settings-command" type="button" onClick={() => onTabChange('Keyboard')}>Open keyboard shortcuts</button></article>
      <article className="help-item"><h4>Storage and media</h4><p>Clearing media removes cached files only. Messages and encryption keys stay, and media downloads again when you open it.</p><button className="settings-command" type="button" onClick={() => onTabChange('Storage')}>Open storage</button></article>
      <article className="help-item"><h4>Local AI</h4><p>Pinger connects to a llama-server you run yourself. Set its address in AI settings. AI replies are drafts and are never sent automatically.</p></article>
      <article className="help-item"><h4>Chat networks</h4><p>WhatsApp, Telegram, Signal and iMessage chats are managed through bridges on your homeserver. For Beeper, create your account and connect new networks in the official Beeper app first. Pinger cannot register Beeper accounts or create bridge logins.</p></article>
      <article className="help-item"><h4>Encryption and room keys</h4><p>Export room keys from Security and protect the file with a passphrase. Keep the backup somewhere safe.</p></article>
      <a className="settings-link" href="https://github.com/cataWalter/pinger/issues" target="_blank" rel="noreferrer">Report an issue</a>
    </SettingsSection>
  )
}

function AboutPinger() {
  const [version, setVersion] = useState('')
  const [buildInfo, setBuildInfo] = useState<AppBuildInfo | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateError, setUpdateError] = useState('')

  useEffect(() => {
    let active = true
    AppService.AppVersion()
      .then((value) => { if (active) setVersion(value) })
      .catch(() => { if (active) setVersion('unknown') })
    AppService.AppBuildInfo()
      .then((value) => { if (active) setBuildInfo(value) })
      .catch(() => { if (active) setBuildInfo({ commit: 'unknown', buildDate: 'unknown' }) })
    return () => { active = false }
  }, [])

  async function checkForUpdates() {
    setChecking(true)
    setUpdateError('')
    try {
      setUpdate(await AppService.CheckForUpdates())
    } catch (checkError) {
      setUpdate(null)
      setUpdateError(describeError(checkError))
    } finally {
      setChecking(false)
    }
  }

  const published = update?.publishedAt ? Date.parse(update.publishedAt) : NaN
  const commit = buildInfo?.commit
    ? buildInfo.commit === 'unknown' ? 'unknown' : buildInfo.commit.slice(0, 7)
    : 'Loading…'
  return (
    <>
      <div className="account-details"><span>Application</span><strong>Pinger</strong><span>Version</span><strong>{version || 'Loading…'}</strong><span>Commit</span><strong>{commit}</strong><span>Build date</span><strong>{buildInfo?.buildDate || 'Loading…'}</strong><span>Matrix engine</span><strong>gomuks</strong><span>License</span><strong>AGPL-3.0-or-later</strong></div>
      <button className="settings-command" type="button" disabled={checking} onClick={() => void checkForUpdates()}>{checking ? 'Checking…' : 'Check for updates'}</button>
      {updateError && <p className="settings-error" role="alert">{updateError}</p>}
      {update && (
        <div className="update-status" role="status">
          <p>{update.message}</p>
          {update.latestVersion && <p className="settings-note">{`Latest release ${update.latestVersion}${Number.isNaN(published) ? '' : ` · published ${new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'medium' }).format(new Date(published))}`}`}</p>}
          {update.updateAvailable && <p className="settings-note">Pinger does not install updates itself. Download the new version from the release page.</p>}
          {update.releaseNotes && <details><summary>Release notes</summary><pre className="release-notes">{update.releaseNotes}</pre></details>}
          <a className="settings-link" href={update.releaseUrl} target="_blank" rel="noreferrer">View release</a>
        </div>
      )}
      <a className="settings-link" href="https://github.com/cataWalter/pinger" target="_blank" rel="noreferrer">Project repository</a>
      <a className="settings-link" href="https://github.com/cataWalter/pinger/issues" target="_blank" rel="noreferrer">Send feedback or report an issue</a>
      <a className="settings-link" href="https://github.com/cataWalter/pinger/blob/main/LICENSE" target="_blank" rel="noreferrer">License (AGPL-3.0-or-later)</a>
    </>
  )
}
