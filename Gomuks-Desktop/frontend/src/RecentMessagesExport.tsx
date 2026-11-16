import { useEffect, useState } from 'react'
import { Download, HardDrive } from 'lucide-react'
import { Events } from '@wailsio/runtime'
import { AppService } from '../bindings/mychat/desktop'
import { type BulkChatExportResult } from '../bindings/mychat/desktop/models.js'
import { describeError } from './appShared'
import { PreferenceToggle } from './SettingsControls'
import { type BulkChatExportProgressEvent, recentExportMaxMessages, type RecentExportOptions, defaultRecentExportOptions } from './storageSettingsConstants'

export function RecentMessagesExport() {
  const [limitDraft, setLimitDraft] = useState('100')
  const [options, setOptions] = useState<RecentExportOptions>(defaultRecentExportOptions)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [progress, setProgress] = useState<BulkChatExportProgressEvent | null>(null)
  const [result, setResult] = useState<BulkChatExportResult | null>(null)
  const [error, setError] = useState('')
  const running = phase === 'running'

  useEffect(() => {
    if (!running) return
    return Events.On('bulk-chat-export:progress', (event: { data: unknown }) => {
      setProgress(event.data as BulkChatExportProgressEvent)
    })
  }, [running])

  function setRecentExportOption(key: keyof RecentExportOptions, value: boolean) {
    setOptions((current) => ({ ...current, [key]: value }))
  }

  async function startExport() {
    const limit = Number(limitDraft.trim())
    if (!Number.isInteger(limit) || limit < 1 || limit > recentExportMaxMessages) {
      setError(`Enter a whole number from 1 to ${recentExportMaxMessages.toLocaleString()}.`)
      return
    }
    if (!options.privateChats && !options.groupChats) {
      setError('Choose private chats, group chats, or both.')
      return
    }
    if (!options.myMessages && !options.theirMessages) {
      setError('Choose your messages, their messages, or both.')
      return
    }
    setError('')
    let folder: string
    try {
      folder = await AppService.ChooseDownloadFolder()
    } catch (folderError) {
      setError(describeError(folderError))
      return
    }
    if (!folder) return
    setPhase('running')
    setProgress(null)
    setResult(null)
    try {
      const exported = await AppService.ExportRecentMessagesForAllChats(folder, limit, options)
      setResult(exported)
      setPhase('done')
    } catch (exportError) {
      setError(describeError(exportError))
      setPhase('failed')
    }
  }

  async function cancelExport() {
    try {
      await AppService.CancelChatExport()
    } catch (cancelError) {
      setError(describeError(cancelError))
    }
  }

  async function revealExport(path: string) {
    try {
      await AppService.RevealFile(path)
    } catch (revealError) {
      setError(describeError(revealError))
    }
  }

  return (
    <div className="chat-storage recent-export">
      <h4>Export recent messages</h4>
      <p className="settings-note">Saves the newest selected messages of the selected chats into one .txt file. The messages per chat limit is applied before the message filters. Messages with media are skipped. With many chats this can take a long time. You can cancel at any point and keep the chats already saved.</p>
      <label className="security-field"><span>Messages per chat</span><input type="number" inputMode="numeric" min={1} max={recentExportMaxMessages} step={1} value={limitDraft} disabled={running} onChange={(event) => setLimitDraft(event.target.value)} /></label>
      <fieldset className="recent-export-options" disabled={running}>
        <legend>Chats</legend>
        <PreferenceToggle label="Private chats" checked={options.privateChats} onChange={(value) => setRecentExportOption('privateChats', value)} />
        <PreferenceToggle label="Group chats" checked={options.groupChats} onChange={(value) => setRecentExportOption('groupChats', value)} />
      </fieldset>
      <fieldset className="recent-export-options" disabled={running}>
        <legend>Messages</legend>
        <PreferenceToggle label="My messages" checked={options.myMessages} onChange={(value) => setRecentExportOption('myMessages', value)} />
        <PreferenceToggle label="Their messages" checked={options.theirMessages} onChange={(value) => setRecentExportOption('theirMessages', value)} />
        <PreferenceToggle label="Deleted messages" checked={options.deletedMessages} onChange={(value) => setRecentExportOption('deletedMessages', value)} />
      </fieldset>
      {running
        ? <button className="settings-command is-danger" type="button" onClick={() => void cancelExport()}>Cancel export</button>
        : <button className="settings-command" type="button" onClick={() => void startExport()}><Download size={15} />Export all chats</button>}
      {running && <p className="settings-note" role="status">{progress
        ? `Saved ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} chats${progress.failed > 0 ? `, ${progress.failed.toLocaleString()} failed` : ''}.`
        : 'Starting export…'}</p>}
      {phase === 'done' && result && (
        <>
          <p className="settings-note" role="status">{result.cancelled ? 'Export cancelled. Chats saved so far were kept.' : 'Export finished.'}</p>
          <div className="storage-summary">
            <div><HardDrive size={16} /><span>Chats saved</span><strong>{result.chats.toLocaleString()}</strong></div>
            <div><HardDrive size={16} /><span>Messages saved</span><strong>{result.messages.toLocaleString()}</strong></div>
            <div><HardDrive size={16} /><span>Failed chats</span><strong>{result.failed.toLocaleString()}</strong></div>
          </div>
          <p className="settings-note">Saved to {result.path}</p>
          <button className="settings-command" type="button" onClick={() => void revealExport(result.path)}>Show file</button>
        </>
      )}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </div>
  )
}
