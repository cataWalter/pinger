import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { HardDrive } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { type MediaCacheUsage, type MediaCleanupResult, type RoomStorage, type StorageUsage } from '../bindings/mychat/desktop/models.js'
import { ConfirmDialog } from './ConfirmDialog'
import { describeError, formatBytes, preferenceString } from './appShared'
import { SettingRow, SettingsAdvanced, SettingsSection } from './SettingsControls'
import { storageMediaOptions, storageAgeOptions, storageChatLimit } from './storageSettingsConstants'
import { RecentMessagesExport } from './RecentMessagesExport'

export function StorageSettingsTab({ preferences = {}, onPreferenceChange }: {
  preferences?: Record<string, unknown>
  onPreferenceChange?: (key: string, value: string) => void
} = {}) {
  const maxCacheSize = preferenceString(preferences, 'storage.media_max_size_mb', '')
  const maxCacheAge = preferenceString(preferences, 'storage.media_max_age_days', '')
  const [storage, setStorage] = useState<{ database: StorageUsage; media: MediaCacheUsage } | null>(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [storageAction, setStorageAction] = useState('')
  const [cleanupPending, setCleanupPending] = useState(false)
  const [cleanupStatus, setCleanupStatus] = useState('')

  useEffect(() => {
    let active = true
    async function readCleanupStatus() {
      try {
        const pending = await AppService.AccountCleanupPending()
        if (active) setCleanupPending(pending)
      } catch {
        if (active) setCleanupStatus('Could not check previous account cleanup.')
      }
    }
    void readCleanupStatus()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setStorageLoading(true)
    setStorageError('')
    Promise.all([AppService.StorageUsage(), AppService.MediaCacheUsage()])
      .then(([database, media]) => { if (active) setStorage({ database, media }) })
      .catch((loadError: unknown) => { if (active) setStorageError(describeError(loadError)) })
      .finally(() => { if (active) setStorageLoading(false) })
    return () => { active = false }
  }, [])

  async function refreshStorage() {
    setStorageLoading(true)
    setStorageError('')
    try {
      const [database, media] = await Promise.all([AppService.StorageUsage(), AppService.MediaCacheUsage()])
      setStorage({ database, media })
    } catch (loadError) {
      setStorageError(describeError(loadError))
    } finally {
      setStorageLoading(false)
    }
  }

  async function runStorageAction(action: 'clear' | 'optimize' | 'account-cleanup') {
    setStorageAction(action)
    setStorageError('')
    try {
      if (action === 'account-cleanup') {
        setCleanupStatus('')
        const pending = await AppService.RetryAccountCleanup()
        setCleanupPending(pending)
        setCleanupStatus(pending ? 'Cleanup is still pending. Try again after checking access to local storage.' : 'Previous account data was cleaned up.')
      } else if (action === 'clear') await AppService.ClearMediaCache()
      else await AppService.OptimizeDatabase()
      await refreshStorage()
    } catch (actionError) {
      setStorageError(describeError(actionError))
    } finally {
      setStorageAction('')
    }
  }

  return (
    <SettingsSection title="Local storage">
      {cleanupPending && <>
        <p className="settings-note">Some local data from previous accounts could not be removed. Your active account is unaffected.</p>
        <button className="settings-command" type="button" disabled={storageAction !== ''} onClick={() => void runStorageAction('account-cleanup')}>
          <HardDrive size={15} />{storageAction === 'account-cleanup' ? 'Retrying cleanup...' : 'Retry previous account cleanup'}
        </button>
      </>}
      {cleanupStatus && <p className="settings-note" role="status">{cleanupStatus}</p>}
      {storageLoading && <p className="settings-note">Reading storage usage…</p>}
      {storageError && <p className="settings-error" role="alert">{storageError}</p>}
      {storage && <div className="storage-summary">
        <div><HardDrive size={16} /><span>Matrix database</span><strong>{formatBytes(storage.database.databaseBytes)}</strong></div>
        <div><HardDrive size={16} /><span>Database WAL</span><strong>{formatBytes(storage.database.walBytes)}</strong></div>
        <div><HardDrive size={16} /><span>Media cache</span><strong>{formatBytes(storage.media.bytes)} · {storage.media.files} files</strong></div>
      </div>}
      <button className="settings-command" type="button" disabled={storageLoading || storageAction !== ''} onClick={() => void runStorageAction('clear')}><HardDrive size={15} />{storageAction === 'clear' ? 'Clearing cache…' : 'Clear media cache'}</button>
      <button className="settings-command" type="button" disabled={storageLoading || storageAction !== ''} onClick={() => void runStorageAction('optimize')}><HardDrive size={15} />{storageAction === 'optimize' ? 'Optimizing database…' : 'Optimize database'}</button>
      <p className="settings-note">Clearing the media cache does not remove messages or encryption keys.</p>
      {onPreferenceChange && <>
        <SettingRow label="Media cache size limit" hint="Automatically trim oldest cached media files when total size exceeds this limit.">
          <select aria-label="Media cache size limit" value={maxCacheSize} onChange={(event) => onPreferenceChange('storage.media_max_size_mb', event.currentTarget.value)}>
            <option value="">Unlimited</option>
            <option value="256">256 MB</option>
            <option value="512">512 MB</option>
            <option value="1024">1 GB</option>
            <option value="2048">2 GB</option>
            <option value="4096">4 GB</option>
          </select>
        </SettingRow>
        <SettingRow label="Delete cached media older than" hint="Automatically remove cached media files older than this age.">
          <select aria-label="Delete cached media older than" value={maxCacheAge} onChange={(event) => onPreferenceChange('storage.media_max_age_days', event.currentTarget.value)}>
            <option value="">Never</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </SettingRow>
      </>}
      <SettingsAdvanced description="Per-chat storage cleanup and exporting recent messages.">
        <ChatStorageSettings />
        <RecentMessagesExport />
      </SettingsAdvanced>
    </SettingsSection>
  )
}

export function ChatStorageSettings() {
  const [rows, setRows] = useState<RoomStorage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chatID, setChatID] = useState('')
  const [age, setAge] = useState('')
  const [mediaType, setMediaType] = useState('')
  const [pendingClear, setPendingClear] = useState<{ roomID: string; typeLabel: string; scope: string; ageLabel: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<MediaCleanupResult | null>(null)

  useEffect(() => {
    let active = true
    AppService.RoomStorageUsage()
      .then((usage) => { if (active) setRows(usage ?? []) })
      .catch((loadError: unknown) => { if (active) setError(describeError(loadError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function reloadRows() {
    setLoading(true)
    try {
      setRows((await AppService.RoomStorageUsage()) ?? [])
    } catch (loadError) {
      setError(describeError(loadError))
    } finally {
      setLoading(false)
    }
  }
  function clearMedia(target: { roomID: string; name: string }) {
    const typeLabel = storageMediaOptions.find((option) => option.value === mediaType)?.label.toLowerCase() ?? 'all media'
    const ageLabel = storageAgeOptions.find((option) => option.value === age)?.label.toLowerCase() ?? 'any age'
    const scope = target.roomID ? target.name : 'all chats'
    setPendingClear({ roomID: target.roomID, typeLabel, scope, ageLabel })
  }

  async function executeClearMedia(roomID: string) {
    setBusy(true)
    setError('')
    setCleanupResult(null)
    try {
      setCleanupResult(await AppService.ClearCachedMedia({ roomId: roomID, olderThanDays: Number(age) || 0, mediaType }))
      await reloadRows()
    } catch (cleanupError) {
      setError(describeError(cleanupError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat-storage">
      <h4>Storage by chat</h4>
      <p className="settings-note">Text sizes are approximate. Cleanup removes cached media files only; messages are not removed.</p>
      {loading && <p className="settings-note">Reading chat storage…</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="settings-note">No chats have stored messages on this device yet.</p>}
      {rows.length > 0 && (
        <table className="storage-table" aria-label="Storage used by each chat">
          <thead>
            <tr><th scope="col">Chat</th><th scope="col">Messages</th><th scope="col">Text</th><th scope="col">Media</th><th scope="col">Files</th><th scope="col">Cleanup</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, storageChatLimit).map((row) => {
              const name = row.name || row.roomId
              return (
                <tr key={row.roomId}>
                  <th scope="row">{name}</th>
                  <td>{row.messages.toLocaleString()}</td>
                  <td>{formatBytes(row.textBytes)}</td>
                  <td>{formatBytes(row.mediaBytes)}</td>
                  <td>{row.mediaFiles.toLocaleString()}</td>
                  <td><button className="settings-command" type="button" disabled={busy || row.mediaFiles === 0} aria-label={`Clear media in ${name}`} onClick={() => void clearMedia({ roomID: row.roomId, name })}>Clear media</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <form className="storage-cleanup" aria-label="Clear cached media" onSubmit={(event) => {
        event.preventDefault()
        void clearMedia({ roomID: chatID, name: rows.find((row) => row.roomId === chatID)?.name || chatID })
      }}>
        <label><span>Chat</span><select aria-label="Cleanup chat" value={chatID} onChange={(event) => setChatID(event.target.value)}>
          <option value="">All chats</option>
          {rows.map((row) => <option key={row.roomId} value={row.roomId}>{row.name || row.roomId}</option>)}
        </select></label>
        <label><span>Age</span><select aria-label="Cleanup age" value={age} onChange={(event) => setAge(event.target.value)}>
          {storageAgeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <label><span>Media type</span><select aria-label="Cleanup media type" value={mediaType} onChange={(event) => setMediaType(event.target.value)}>
          {storageMediaOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <button className="settings-command is-danger" type="submit" disabled={busy || loading}>{busy ? 'Clearing…' : 'Clear matching media'}</button>
      </form>
      {cleanupResult && <p className="settings-note" role="status">{`Removed ${cleanupResult.files.toLocaleString()} cached files (${formatBytes(cleanupResult.bytes)}).`}</p>}
      {pendingClear && createPortal(
        <ConfirmDialog
          title="Remove cached media?"
          message={`Remove cached media (${pendingClear.typeLabel}, ${pendingClear.scope}, ${pendingClear.ageLabel})? Messages stay. Media downloads again when opened.`}
          confirmLabel="Remove media"
          danger
          onCancel={() => setPendingClear(null)}
          onConfirm={() => {
            const roomID = pendingClear.roomID
            setPendingClear(null)
            void executeClearMedia(roomID)
          }}
        />,
        document.querySelector('.app-shell') ?? document.body,
      )}
    </div>
  )
}
