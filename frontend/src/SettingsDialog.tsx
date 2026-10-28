import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Archive, Bell, Check, FileText, RotateCcw, Search, Trash2, X, Download, HardDrive, LogOut, Plus, Upload } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { type AppBuildInfo, type Device, type MediaCacheUsage, type MediaCleanupResult, type Room, type RoomStorage, type Snapshot, type StorageUsage, type UpdateStatus } from '../bindings/mychat/desktop/models.js'
import { parseCustomEmoticonReplacements, type EmoticonReplacement } from './composerText'
import { DEFAULT_ACCENT_NAME, accentPaletteFor, accentPresets, isAccentHex } from './accent'
import { SYSTEM_THEME_NAME, findThemeByName, themes as appearanceThemes } from './themes'
import { SETTINGS_TABS, groupSettingsByTab, searchSettings, type SettingsEntry, type SettingsTab } from './settings'
import { type Snippet } from './snippets'
import { EMPTY_CHAT_AGENTS, parseChatAgents, serializeChatAgents, type ChatAgentCollection } from './aiPrompts'
import { resolveLanguageRoles } from './aiSettings'
import { LanguageSettings } from './LanguageSettings'
import { AIPromptSettings } from './AIPromptSettings'
import { DialogSurface } from './DialogSurface'
import { SnippetSettingsModal } from './SnippetSettingsModal'
import LocalAIAgentSettings from './LocalAIAgentSettings'
import { type PreferenceValues, describeError, Avatar, preferenceBoolean, preferenceString, preferenceNumber, parseTimeSuggestionMinutes, chatWallpapers, formatBytes, playNotificationSound, requestLocalAsset } from './appShared'

const storageMediaOptions: Array<{ value: string; label: string }> = [
  { value: '', label: 'All media' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'file', label: 'Files' },
  { value: 'other', label: 'Other' },
]

const storageAgeOptions: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any age' },
  { value: '30', label: 'Older than 30 days' },
  { value: '90', label: 'Older than 90 days' },
  { value: '365', label: 'Older than 1 year' },
]

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

function ChatStorageSettings() {
  const [rows, setRows] = useState<RoomStorage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chatID, setChatID] = useState('')
  const [age, setAge] = useState('')
  const [mediaType, setMediaType] = useState('')
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

  async function clearMedia(target: { roomID: string; name: string }) {
    const typeLabel = storageMediaOptions.find((option) => option.value === mediaType)?.label.toLowerCase() ?? 'all media'
    const ageLabel = storageAgeOptions.find((option) => option.value === age)?.label.toLowerCase() ?? 'any age'
    const scope = target.roomID ? target.name : 'all chats'
    if (!window.confirm(`Remove cached media (${typeLabel}, ${scope}, ${ageLabel})? Messages stay. Media downloads again when opened.`)) return
    setBusy(true)
    setError('')
    setCleanupResult(null)
    try {
      setCleanupResult(await AppService.ClearCachedMedia({ roomId: target.roomID, olderThanDays: Number(age) || 0, mediaType }))
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
            {rows.map((row) => {
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
    </div>
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
          {update.latestVersion && <p className="settings-note">{`Latest release ${update.latestVersion}${Number.isNaN(published) ? '' : ` · published ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(published))}`}`}</p>}
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

function LocalAISettings({ endpoint, model, transcriptionModel, thinkingLevel, onSave }: {
  endpoint: string
  model: string
  transcriptionModel: string
  thinkingLevel: string
  onSave: (key: string, value: string) => Promise<boolean>
}) {
  const [endpointDraft, setEndpointDraft] = useState(endpoint)
  const [modelDraft, setModelDraft] = useState(model)
  const [transcriptionModelDraft, setTranscriptionModelDraft] = useState(transcriptionModel)
  const [thinkingLevelDraft, setThinkingLevelDraft] = useState(thinkingLevel)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const endpointUnsaved = endpointDraft.trim() !== endpoint

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setStatus('')
    let saved = await onSave('ai.endpoint', endpointDraft.trim())
    if (saved) saved = await onSave('ai.model', modelDraft.trim())
    if (saved) saved = await onSave('ai.thinking_level', thinkingLevelDraft)
    if (saved) saved = await onSave('ai.transcription_model', transcriptionModelDraft.trim())
    setStatus(saved ? 'AI settings saved.' : 'Not saved. The endpoint must be an http or https URL.')
    setBusy(false)
  }

  async function testEndpoint() {
    setBusy(true)
    setStatus('Checking the endpoint…')
    try {
      await AppService.TestAIEndpoint()
      setStatus('Model is loaded and ready.')
    } catch (testError) {
      setStatus(describeError(testError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ai-settings-form" onSubmit={(event) => void saveSettings(event)}>
      <h4>OpenAI-compatible AI</h4>
      <p className="settings-note">Configure an HTTP or HTTPS endpoint, including a llama-server you run yourself. Audio transcription requires support for <code>/v1/audio/transcriptions</code>; audio is uploaded only when you request a transcript. Requests and uploads go to this endpoint, which may be remote. Results are suggestions and no Matrix message is sent automatically.</p>
      <label><span>Endpoint</span><input type="url" value={endpointDraft} placeholder="http://localhost:8080" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setEndpointDraft(event.target.value)} /></label>
      <label><span>Model name (optional)</span><input type="text" value={modelDraft} placeholder="Uses the loaded model" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setModelDraft(event.target.value)} /></label>
      <label><span>Thinking level</span><select aria-label="Model thinking level" value={thinkingLevelDraft} onChange={(event) => setThinkingLevelDraft(event.target.value)}>
        <option value="none">None</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select></label>
      <p className="settings-note">Gemma 4 12B supports thinking on or off; Low, Medium, and High all enable its model-default thinking. Other chat templates may honor the selected level. Thinking uses the response token budget.</p>
      <label><span>Transcription model (optional)</span><input type="text" value={transcriptionModelDraft} placeholder="Uses the model above" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setTranscriptionModelDraft(event.target.value)} /></label>
      <div className="ai-settings-actions">
        <button className="settings-command" type="submit" disabled={busy}>Save</button>
        <button
          className="settings-command"
          type="button"
          disabled={busy || !endpoint || endpointUnsaved}
          title={endpointUnsaved ? 'Save the endpoint before testing' : undefined}
          onClick={() => void testEndpoint()}
        >Test endpoint</button>
      </div>
      {status && <p className="settings-note" role="status">{status}</p>}
    </form>
  )
}

const imageIdleMinuteOptions = ['1', '3', '5', '10', '30']
const imageSizeOptions = ['512x512', '512x768', '768x512', '768x768', '768x1024', '1024x768', '1024x1024']
// An empty value means the engine's own default, which is what Pinger sends when the preference is unset.
const imageStepOptions = ['', '4', '8', '12', '20', '30', '40']
const imageGuidanceOptions = ['', '1', '3', '5', '7', '9']
const imageSamplerOptions = ['', 'euler', 'euler_a', 'heun', 'dpm2', 'dpm++2m', 'lcm']

function ImageGenerationSettings({ binaryPath, modelPath, idleMinutes, size, steps, guidanceScale, sampler, negativePrompt, onSave }: {
  binaryPath: string
  modelPath: string
  idleMinutes: string
  size: string
  steps: string
  guidanceScale: string
  sampler: string
  negativePrompt: string
  onSave: (key: string, value: string) => Promise<boolean>
}) {
  const [binaryDraft, setBinaryDraft] = useState(binaryPath)
  const [modelDraft, setModelDraft] = useState(modelPath)
  const [idleDraft, setIdleDraft] = useState(idleMinutes || '3')
  const [sizeDraft, setSizeDraft] = useState(size || '512x512')
  const [stepsDraft, setStepsDraft] = useState(steps)
  const [guidanceDraft, setGuidanceDraft] = useState(guidanceScale)
  const [samplerDraft, setSamplerDraft] = useState(sampler)
  const [negativeDraft, setNegativeDraft] = useState(negativePrompt)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setStatus('')
    let saved = await onSave('ai.image.binary_path', binaryDraft.trim())
    if (saved) saved = await onSave('ai.image.model_path', modelDraft.trim())
    if (saved) saved = await onSave('ai.image.idle_minutes', idleDraft)
    if (saved) saved = await onSave('ai.image.size', sizeDraft)
    if (saved) saved = await onSave('ai.image.steps', stepsDraft)
    if (saved) saved = await onSave('ai.image.cfg_scale', guidanceDraft)
    if (saved) saved = await onSave('ai.image.sampler', samplerDraft)
    if (saved) saved = await onSave('ai.image.negative_prompt', negativeDraft.trim())
    setStatus(saved ? 'Image settings saved.' : 'Not saved. Check the values; paths must be absolute.')
    setBusy(false)
  }

  return (
    <form className="ai-settings-form" aria-label="Image generation settings" onSubmit={(event) => void saveSettings(event)}>
      <h4>Image generation</h4>
      <p className="settings-note">Generate images in the local AI chat with a stable-diffusion.cpp <code>sd-server</code> that you install yourself, along with its model checkpoint. Pinger starts the engine on 127.0.0.1 when you press Generate image, stops it after the idle timeout, and sends prompts only to that local process.</p>
      <label><span>Image engine binary</span><input type="text" value={binaryDraft} placeholder="/path/to/sd-server" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setBinaryDraft(event.target.value)} /></label>
      <label><span>Image model checkpoint</span><input type="text" value={modelDraft} placeholder="/path/to/model.safetensors" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setModelDraft(event.target.value)} /></label>
      <label><span>Stop after idle</span><select aria-label="Image engine idle timeout" value={idleDraft} onChange={(event) => setIdleDraft(event.target.value)}>
        {imageIdleMinuteOptions.map((minutes) => <option key={minutes} value={minutes}>{minutes === '1' ? '1 minute' : `${minutes} minutes`}</option>)}
      </select></label>
      <label><span>Image size</span><select aria-label="Image size" value={sizeDraft} onChange={(event) => setSizeDraft(event.target.value)}>
        {imageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select></label>
      <label><span>Sampling steps</span><select aria-label="Image steps" value={stepsDraft} onChange={(event) => setStepsDraft(event.target.value)}>
        {imageStepOptions.map((option) => <option key={option || 'default'} value={option}>{option === '' ? 'Default (20)' : `${option} steps`}</option>)}
      </select></label>
      <label><span>Guidance scale</span><select aria-label="Image guidance scale" value={guidanceDraft} onChange={(event) => setGuidanceDraft(event.target.value)}>
        {imageGuidanceOptions.map((option) => <option key={option || 'default'} value={option}>{option === '' ? 'Default' : option}</option>)}
      </select></label>
      <label><span>Sampler</span><select aria-label="Image sampler" value={samplerDraft} onChange={(event) => setSamplerDraft(event.target.value)}>
        {imageSamplerOptions.map((option) => <option key={option || 'default'} value={option}>{option === '' ? 'Model default' : option}</option>)}
      </select></label>
      <label><span>Default negative prompt</span><textarea rows={2} maxLength={1000} value={negativeDraft} placeholder="Things to avoid in every image" spellCheck={false} onChange={(event) => setNegativeDraft(event.target.value)} /></label>
      <div className="ai-settings-actions">
        <button className="settings-command" type="submit" disabled={busy}>Save image settings</button>
      </div>
      {status && <p className="settings-note" role="status">{status}</p>}
    </form>
  )
}

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
  onSnippetsChange: (snippets: Snippet[]) => void
}) {
  const tabs = SETTINGS_TABS
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
  const answeredShortcut = preferenceString(preferences, 'shortcuts.mark_answered', 'E').trim().toUpperCase() || 'E'
  const safeBubbleColor = /^#[0-9a-fA-F]{6}$/.test(bubbleColor) ? bubbleColor : activeAccentPalette.base
  const downloadFolder = preferenceString(preferences, 'downloads.folder', '')
  const localAIAgents = useMemo<ChatAgentCollection>(() => parseChatAgents(preferenceString(preferences, 'ai.local_agents', JSON.stringify(EMPTY_CHAT_AGENTS))), [preferences])
  const [downloadError, setDownloadError] = useState('')
  async function chooseDownloadFolder() {
    setDownloadError('')
    try {
      const folder = await AppService.ChooseDownloadFolder()
      if (folder) onPreferenceChange('downloads.folder', folder)
    } catch (folderError) {
      setDownloadError(describeError(folderError))
    }
  }
  const [devices, setDevices] = useState<Device[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState('')
  const [deviceRevokeID, setDeviceRevokeID] = useState('')
  const [deviceRevokePassword, setDeviceRevokePassword] = useState('')
  const [deviceRevokeBusy, setDeviceRevokeBusy] = useState(false)
  const [scheduleSuggestionsDraft, setScheduleSuggestionsDraft] = useState(preferenceString(preferences, 'schedule.suggestions_minutes', '5,15,60'))
  const [scheduleSuggestionsError, setScheduleSuggestionsError] = useState('')
  const [archiveAgeDraft, setArchiveAgeDraft] = useState(preferenceString(preferences, 'archive.older_than_days', '90'))
  const [archiveAgeError, setArchiveAgeError] = useState('')
  const [scheduleSendDelayDraft, setScheduleSendDelayDraft] = useState(preferenceString(preferences, 'schedule.default_send_minutes', '5'))
  const [scheduleReminderDelayDraft, setScheduleReminderDelayDraft] = useState(preferenceString(preferences, 'schedule.default_reminder_minutes', '60'))
  const [scheduleSendDelayError, setScheduleSendDelayError] = useState('')
  const [scheduleReminderDelayError, setScheduleReminderDelayError] = useState('')
  const [storage, setStorage] = useState<{ database: StorageUsage; media: MediaCacheUsage } | null>(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [storageAction, setStorageAction] = useState('')
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [backupConfirmation, setBackupConfirmation] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [keyStatus, setKeyStatus] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState('unsupported')
  const [searchQuery, setSearchQuery] = useState('')
  const [shortcutSearchQuery, setShortcutSearchQuery] = useState('')
  const [customEmoticonDraft, setCustomEmoticonDraft] = useState<EmoticonReplacement[]>(() => parseCustomEmoticonReplacements(preferenceString(preferences, 'emoji.emoticon_replacements', '')))
  const [customEmoticonStatus, setCustomEmoticonStatus] = useState('')
  const [searchTarget, setSearchTarget] = useState<{ entry: SettingsEntry; nonce: number } | null>(null)
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const settingsPanelRef = useRef<HTMLDivElement>(null)
  const searchNonceRef = useRef(0)

  const searchResults = useMemo(() => searchSettings(searchQuery), [searchQuery])
  const searchResultsByTab = useMemo(() => groupSettingsByTab(searchResults), [searchResults])
  const searchActive = searchQuery.trim().length > 0
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
    ['Ctrl / ⌘ + Alt + 1–9', 'Switch Matrix accounts'],
    ['Ctrl / ⌘ + + / -', 'Adjust app zoom'],
    ['Ctrl / ⌘ + 0', 'Reset app zoom'],
    ['Ctrl / ⌘ + Shift + P', 'Toggle content blur'],
    ['Ctrl / ⌘ + Shift + I', 'Toggle hiding images and videos'],
    ['Ctrl + Shift + T', 'Analyze draft with Language Tutor'],
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

  function revealSetting(entry: SettingsEntry) {
    searchNonceRef.current += 1
    setSearchQuery('')
    setSearchTarget({ entry, nonce: searchNonceRef.current })
    onTabChange(entry.tab)
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

  useEffect(() => {
    if (tab !== 'Devices') return
    let active = true
    setDevicesLoading(true)
    setDevicesError('')
    AppService.Devices()
      .then((result) => { if (active) setDevices(result ?? []) })
      .catch((loadError: unknown) => { if (active) setDevicesError(describeError(loadError)) })
      .finally(() => { if (active) setDevicesLoading(false) })
    return () => { active = false }
  }, [tab])

  useEffect(() => {
    if (tab !== 'Storage') return
    let active = true
    setStorageLoading(true)
    setStorageError('')
    Promise.all([AppService.StorageUsage(), AppService.MediaCacheUsage()])
      .then(([database, media]) => { if (active) setStorage({ database, media }) })
      .catch((loadError: unknown) => { if (active) setStorageError(describeError(loadError)) })
      .finally(() => { if (active) setStorageLoading(false) })
    return () => { active = false }
  }, [tab])

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

  async function runStorageAction(action: 'clear' | 'optimize') {
    setStorageAction(action)
    setStorageError('')
    try {
      if (action === 'clear') await AppService.ClearMediaCache()
      else await AppService.OptimizeDatabase()
      await refreshStorage()
    } catch (actionError) {
      setStorageError(describeError(actionError))
    } finally {
      setStorageAction('')
    }
  }

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

  async function importRoomKeys(event: React.ChangeEvent<HTMLInputElement>) {
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
    <>
      <div className="settings-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <DialogSurface className="settings-dialog" labelledBy="settings-title" onClose={onClose}>
          <header className="settings-header">
            <div><span className="eyebrow">PINGER</span><h2 id="settings-title">Settings</h2></div>
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
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                setSearchQuery('')
              }}
            />
            {searchQuery && (
              <button type="button" className="icon-button" aria-label="Clear settings search" title="Clear search" onClick={() => { setSearchQuery(''); searchInputRef.current?.focus() }}><X size={14} /></button>
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
                >{item}{searchActive && matches > 0 && <span className="settings-tab-count" aria-hidden="true">{matches}</span>}</button>
              )
            })}
          </nav>
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
                        <button key={entry.id} type="button" className="settings-search-result" onClick={() => revealSetting(entry)}>
                          <strong>{entry.title}</strong>
                          <small>{entry.description}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            {tab === 'General' && (
              <div className="settings-section">
                <h3>General</h3>
                <PreferenceToggle label="Launch Pinger at login" checked={preferenceBoolean(preferences, 'system.launch_at_startup')} onChange={(value) => onPreferenceChange('system.launch_at_startup', value)} />
                <PreferenceToggle label="Minimize to tray when closing the window" checked={preferenceBoolean(preferences, 'window.minimize_to_tray')} onChange={(value) => onPreferenceChange('window.minimize_to_tray', value)} />
                <PreferenceToggle label="Start minimized" checked={preferenceBoolean(preferences, 'window.start_minimized')} onChange={(value) => onPreferenceChange('window.start_minimized', value)} />
                <PreferenceToggle label="Quit Pinger when the window closes" checked={preferenceBoolean(preferences, 'window.quit_on_close')} onChange={(value) => onPreferenceChange('window.quit_on_close', value)} />
                <PreferenceToggle label="Show menu bar icon" checked={preferenceBoolean(preferences, 'window.menu_bar_icon', true)} onChange={(value) => onPreferenceChange('window.menu_bar_icon', value)} />
                <div className="setting-row"><span><strong>Download folder</strong><small>{downloadFolder || 'Downloads folder in your home directory'}</small></span>
                  <span>
                    <button type="button" className="settings-command" onClick={() => void chooseDownloadFolder()}>Choose…</button>
                    {downloadFolder && <button type="button" className="settings-command" onClick={() => onPreferenceChange('downloads.folder', '')}>Use default</button>}
                  </span>
                </div>
                {downloadError && <p className="settings-error" role="alert">{downloadError}</p>}
                <PreferenceToggle label="Ask where to save each download" checked={preferenceBoolean(preferences, 'downloads.ask_each_time')} onChange={(value) => onPreferenceChange('downloads.ask_each_time', value)} />
                <label className="setting-row"><span><strong>Double-click a message</strong><small>Choose what a double-click on a message does.</small></span>
                  <select aria-label="Double-click a message" value={preferenceString(preferences, 'messages.double_click', 'None')} onChange={(event) => onPreferenceChange('messages.double_click', event.target.value)}>
                    <option value="None">Nothing</option>
                    <option value="Reply">Reply</option>
                    <option value="React">Add reaction</option>
                  </select>
                </label>
                <PreferenceToggle label="Show quick reaction picker" checked={preferenceBoolean(preferences, 'reactions.quick_enabled', true)} onChange={(value) => onPreferenceChange('reactions.quick_enabled', value)} />
                <label className="setting-row"><span><strong>Default reaction</strong><small>Sent directly when the quick picker is turned off.</small></span>
                  <select aria-label="Default reaction" value={preferenceString(preferences, 'reactions.default_emoji', '👍')} onChange={(event) => onPreferenceChange('reactions.default_emoji', event.target.value)}>
                    {['👍', '❤️', '😂', '🎉', '👀', '🙏'].map((emoji) => <option key={emoji} value={emoji}>{emoji}</option>)}
                  </select>
                </label>
                <label className="setting-row"><span><strong>Quick reaction set</strong><small>Use the built-in frequent set or your own emoji.</small></span>
                  <select aria-label="Quick reaction set" value={preferenceString(preferences, 'reactions.quick_source', 'Frequent')} onChange={(event) => onPreferenceChange('reactions.quick_source', event.target.value)}>
                    <option value="Frequent">Frequent</option>
                    <option value="Custom">Custom</option>
                  </select>
                </label>
                <label className="setting-row"><span><strong>Custom quick reactions</strong><small>Up to 6 emoji, separated by spaces.</small></span>
                  <input type="text" aria-label="Custom quick reactions" spellCheck={false} autoCorrect="off" autoCapitalize="off" defaultValue={preferenceString(preferences, 'reactions.custom_emojis', '')} onBlur={(event) => onPreferenceChange('reactions.custom_emojis', event.target.value.trim())} />
                </label>
                <label className="setting-row"><span><strong>After changing a room's read state</strong><small>Choose where to go after marking a room read or unread.</small></span>
                  <select aria-label="After changing a room's read state" value={preferenceString(preferences, 'inbox.after_read', 'stay')} onChange={(event) => onPreferenceChange('inbox.after_read', event.target.value)}>
                    <option value="stay">Stay in the current room</option>
                    <option value="next_visible">Next visible room</option>
                    <option value="next_unread">Next unread room</option>
                    <option value="none">Clear selection</option>
                  </select>
                </label>
                <label className="setting-row"><span><strong>After archiving a room</strong><small>Choose what opens after the selected room is archived.</small></span>
                  <select aria-label="After archiving a room" value={preferenceString(preferences, 'archive.next_room', 'next_visible')} onChange={(event) => onPreferenceChange('archive.next_room', event.target.value)}>
                    <option value="next_visible">Next visible room</option>
                    <option value="next_unread">Next unread room</option>
                    <option value="none">Clear selection</option>
                  </select>
                </label>
                <PreferenceToggle label="Automatically archive inactive rooms" checked={preferenceBoolean(preferences, 'archive.automatic')} onChange={(value) => onPreferenceChange('archive.automatic', value)} />
                <label className="setting-row"><span><strong>Inactive room age</strong><small>Archive rooms without activity for this long.</small></span>
                  <input type="number" min="1" max="3650" step="1" value={archiveAgeDraft} aria-label="Inactive room age" aria-invalid={Boolean(archiveAgeError)} onChange={(event) => { setArchiveAgeDraft(event.target.value); setArchiveAgeError('') }} onBlur={() => saveArchiveAge(archiveAgeDraft)} />
                </label>
                {archiveAgeError && <p className="form-error" role="alert">{archiveAgeError}</p>}
                <button className="settings-command" type="button" onClick={() => void onArchiveInactiveRooms()}><Archive size={15} />Archive inactive rooms</button>
                <label className="setting-row"><span><strong>Voice-note microphone</strong><small>Choose the input used for recording.</small></span>
                  <select value={selectedAudioInputDeviceId} aria-label="Voice-note microphone" onChange={(event) => onPreferenceChange('audio.input_device', event.target.value)}>
                    <option value="">System default</option>
                    {audioInputDevices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
                  </select>
                </label>
                <PreferenceToggle label="Auto-play next voice note" checked={preferenceBoolean(preferences, 'voice.autoplay_next')} onChange={(value) => onPreferenceChange('voice.autoplay_next', value)} />
                <label className="setting-row"><span><strong>Default Send Later delay</strong><small>Initial scheduled-send time, in minutes (1–10080).</small></span>
                  <input type="number" min="1" max="10080" step="1" value={scheduleSendDelayDraft} aria-label="Default Send Later delay in minutes" aria-invalid={Boolean(scheduleSendDelayError)} onChange={(event) => { setScheduleSendDelayDraft(event.target.value); setScheduleSendDelayError('') }} onBlur={() => saveScheduleDefaultDelay('schedule.default_send_minutes', scheduleSendDelayDraft, setScheduleSendDelayDraft, setScheduleSendDelayError)} />
                </label>
                {scheduleSendDelayError && <p className="form-error" role="alert">{scheduleSendDelayError}</p>}
                <label className="setting-row"><span><strong>Default Remind Later delay</strong><small>Initial reminder time, in minutes (1–10080).</small></span>
                  <input type="number" min="1" max="10080" step="1" value={scheduleReminderDelayDraft} aria-label="Default Remind Later delay in minutes" aria-invalid={Boolean(scheduleReminderDelayError)} onChange={(event) => { setScheduleReminderDelayDraft(event.target.value); setScheduleReminderDelayError('') }} onBlur={() => saveScheduleDefaultDelay('schedule.default_reminder_minutes', scheduleReminderDelayDraft, setScheduleReminderDelayDraft, setScheduleReminderDelayError)} />
                </label>
                {scheduleReminderDelayError && <p className="form-error" role="alert">{scheduleReminderDelayError}</p>}
                <label className="setting-row"><span><strong>Schedule time suggestions</strong><small>Enter 1–6 comma-separated delays in minutes.</small></span>
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
                </label>
                {scheduleSuggestionsError && <p className="form-error" role="alert">{scheduleSuggestionsError}</p>}
              </div>
            )}
            {tab === 'Appearance' && (
              <div className="settings-section">
                <h3>Appearance</h3>
                <label className="setting-row"><span><strong>Theme</strong><small>Choose the conversation surface. {themeDescription}</small></span>
                  <select value={theme} onChange={(event) => onPreferenceChange('appearance.theme', event.target.value)}>
                    <option value={SYSTEM_THEME_NAME}>{SYSTEM_THEME_NAME}</option>
                    {appearanceThemes.map((entry) => <option key={entry.id} value={entry.name}>{entry.name} ({entry.mode})</option>)}
                  </select>
                </label>
                <label className="setting-row"><span><strong>Font size</strong><small>Adjust room and message text.</small></span>
                  <select value={fontSize} onChange={(event) => onPreferenceChange('appearance.font_size', event.target.value)}>
                    {['Small', 'Medium', 'Large'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="setting-row"><span><strong>App zoom</strong><small>Scale the full interface.</small></span>
                  <PreferenceRange label="App zoom" min={75} max={125} step={5} value={preferenceNumber(preferences, 'appearance.zoom', 100, 75, 125)} onChange={(value) => onPreferenceChange('appearance.zoom', value)} />
                </label>
                <label className="setting-row"><span><strong>Outgoing message color</strong><small>Choose a color for your messages.</small></span>
                  <input className="color-input" type="color" value={safeBubbleColor} onChange={(event) => onPreferenceChange('appearance.bubble_color', event.target.value)} aria-label="Outgoing message color" />
                </label>
                <div className="setting-row accent-setting-row"><span><strong>Theme accent</strong><small>Choose an accent. Message color follows it until you pick one.</small></span>
                  <div className="accent-palette" role="group" aria-label="Theme accent color">
                    {accentPresets.map((palette) => <button key={palette.name} className="accent-swatch" type="button" aria-label={`${palette.name} accent color`} aria-pressed={activeAccentPalette.name === palette.name} title={palette.name} style={{ '--swatch': palette.base } as React.CSSProperties} onClick={() => onPreferenceChange('appearance.accent_color', palette.name)}>
                      {activeAccentPalette.name === palette.name && <Check size={14} />}
                    </button>)}
                    <label className={`accent-swatch accent-swatch-custom${isAccentHex(accentPreference) ? ' is-selected' : ''}`} title="Custom color" style={{ '--swatch': activeAccentPalette.base } as React.CSSProperties}>
                      <input type="color" value={activeAccentPalette.base} aria-label="Custom accent color" onChange={(event) => onPreferenceChange('appearance.accent_color', event.target.value)} />
                      {isAccentHex(accentPreference) && <Check size={14} />}
                    </label>
                  </div>
                </div>
                <div className="setting-row accent-setting-row"><span><strong>Chat wallpaper</strong><small>Add a subtle background to conversations.</small></span>
                  <div className="wallpaper-picker" role="group" aria-label="Chat wallpaper">
                    {chatWallpapers.map((wallpaper) => <button key={wallpaper.name} className="wallpaper-swatch" type="button" aria-label={`${wallpaper.name} wallpaper`} aria-pressed={activeWallpaper.name === wallpaper.name} title={wallpaper.name} style={{ '--wallpaper-swatch': wallpaper.swatch } as React.CSSProperties} onClick={() => onPreferenceChange('appearance.chat_wallpaper', wallpaper.name)}>
                      {activeWallpaper.name === wallpaper.name && <Check size={13} />}
                    </button>)}
                  </div>
                </div>
                <PreferenceToggle label="Use pointer cursor on clickable controls" checked={preferenceBoolean(preferences, 'appearance.pointer_cursor', true)} onChange={(value) => onPreferenceChange('appearance.pointer_cursor', value)} />
                <PreferenceToggle label="Show room previews" checked={preferenceBoolean(preferences, 'sidebar.show_previews', true)} onChange={(value) => onPreferenceChange('sidebar.show_previews', value)} />
                <PreferenceToggle label="Show unread counts" checked={preferenceBoolean(preferences, 'sidebar.show_unread_counts', true)} onChange={(value) => onPreferenceChange('sidebar.show_unread_counts', value)} />
                <PreferenceToggle label="Compact chat list" checked={preferenceBoolean(preferences, 'sidebar.compact_chat_list')} onChange={(value) => onPreferenceChange('sidebar.compact_chat_list', value)} />
                <PreferenceToggle label="Show network labels in the chat list" checked={preferenceBoolean(preferences, 'sidebar.network_icons')} onChange={(value) => onPreferenceChange('sidebar.network_icons', value)} />
                <label className="setting-row"><span><strong>Favorite chats</strong><small>List favorite rooms first, or only mark them with a star.</small></span>
                  <select aria-label="Favorite chats" value={preferenceString(preferences, 'sidebar.pinned_style', 'Top of list')} onChange={(event) => onPreferenceChange('sidebar.pinned_style', event.target.value)}>
                    {['Top of list', 'Star only'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <PreferenceToggle label="Animate new messages" checked={preferenceBoolean(preferences, 'appearance.message_animations', true)} onChange={(value) => onPreferenceChange('appearance.message_animations', value)} />
                <PreferenceToggle label="Show message timestamps" checked={preferenceBoolean(preferences, 'appearance.show_timestamps', true)} onChange={(value) => onPreferenceChange('appearance.show_timestamps', value)} />
                <PreferenceToggle label="Hide images and videos" checked={preferenceBoolean(preferences, 'appearance.hide_images_and_videos')} onChange={(value) => onPreferenceChange('appearance.hide_images_and_videos', value)} />
                <PreferenceToggle label="Hide deleted messages" checked={preferenceBoolean(preferences, 'appearance.hide_deleted_messages')} onChange={(value) => onPreferenceChange('appearance.hide_deleted_messages', value)} />
                <PreferenceToggle label="Balance message line wrapping" checked={preferenceBoolean(preferences, 'appearance.balanced_text')} onChange={(value) => onPreferenceChange('appearance.balanced_text', value)} />
                <PreferenceToggle label="Use a 24-hour clock" checked={preferenceBoolean(preferences, 'appearance.time_24_hour')} onChange={(value) => onPreferenceChange('appearance.time_24_hour', value)} />
                <PreferenceToggle label="Use relative timestamps" checked={preferenceBoolean(preferences, 'appearance.relative_timestamps')} onChange={(value) => onPreferenceChange('appearance.relative_timestamps', value)} />
              </div>
            )}
            {tab === 'Notifications' && (
              <div className="settings-section">
                <h3>Notifications</h3>
                <p className="settings-note">Alerts use your operating system's native notification service. macOS requests permission; Windows and Linux follow system notification settings.</p>
                <div className="setting-row notification-permission"><span><strong>System permission</strong><small>{notificationPermission === 'granted' ? 'Allowed' : notificationPermission === 'denied' ? 'Blocked by the system. Open Notification Settings to allow alerts.' : notificationPermission === 'unsupported' ? 'Native notifications are unavailable. On macOS, launch the bundled Pinger.app; on Linux or Windows, use a desktop session with notifications enabled.' : 'Permission needed for desktop alerts.'}</small></span>
                  <button className="settings-command" type="button" disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported'} onClick={() => void enableSystemNotifications()}><Bell size={14} />{notificationPermission === 'granted' ? 'Allowed' : notificationPermission === 'denied' ? 'Open Settings' : notificationPermission === 'unsupported' ? 'Unavailable' : 'Enable'}</button>
                </div>
                <PreferenceToggle label="Enable notifications" checked={preferenceBoolean(preferences, 'notifications.enabled', true)} onChange={(value) => {
                  onPreferenceChange('notifications.enabled', value)
                  if (value) void enableSystemNotifications()
                }} />
                <PreferenceToggle label="Notify while Pinger is focused" checked={!preferenceBoolean(preferences, 'notifications.only_when_unfocused', true)} onChange={(value) => onPreferenceChange('notifications.only_when_unfocused', !value)} />
                <PreferenceToggle label="Play a notification sound" checked={preferenceBoolean(preferences, 'notifications.sound')} onChange={(value) => onPreferenceChange('notifications.sound', value)} />
                <label className="setting-row"><span><strong>Notification volume</strong><small>Adjust the alert tone level.</small></span>
                  <PreferenceRange label="Notification volume" min={0} max={100} step={5} value={preferenceNumber(preferences, 'notifications.volume', 50)} onChange={(value) => onPreferenceChange('notifications.volume', value)} />
                </label>
                <label className="setting-row"><span><strong>Notification content</strong><small>Control what appears outside the app.</small></span>
                  <select value={preferenceString(preferences, 'notifications.privacy', 'Sender and message preview')} onChange={(event) => onPreferenceChange('notifications.privacy', event.target.value)}>
                    {['Sender and message preview', 'Sender only', 'Hidden content'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <PreferenceToggle label="Direct message alerts" checked={preferenceBoolean(preferences, 'notifications.direct', true)} onChange={(value) => onPreferenceChange('notifications.direct', value)} />
                <PreferenceToggle label="Mention alerts" checked={preferenceBoolean(preferences, 'notifications.mentions', true)} onChange={(value) => onPreferenceChange('notifications.mentions', value)} />
                <PreferenceToggle label="Group message alerts" checked={preferenceBoolean(preferences, 'notifications.group')} onChange={(value) => onPreferenceChange('notifications.group', value)} />
                {[['Direct message tone', 'notifications.sound_direct'], ['Mention tone', 'notifications.sound_mention'], ['Group message tone', 'notifications.sound_group']].map(([label, key]) => (
                  <label key={key} className="setting-row"><span><strong>{label}</strong><small>Sound played for this kind of alert.</small></span>
                    <select aria-label={label} value={preferenceString(preferences, key, 'Chime')} onChange={(event) => {
                      const tone = event.currentTarget.value
                      void onPreferenceChange(key, tone)
                      playNotificationSound(preferenceNumber(preferences, 'notifications.volume', 50), tone)
                    }}>
                      {['Chime', 'Pulse', 'Soft', 'Silent'].map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                ))}
                <label className="setting-row"><span><strong>Batch new messages</strong><small>Combine messages from the same room into one alert.</small></span>
                  <select aria-label="Batch new messages" value={preferenceString(preferences, 'notifications.batch_seconds', '0')} onChange={(event) => onPreferenceChange('notifications.batch_seconds', event.target.value)}>
                    <option value="0">Off</option>
                    <option value="3">3 seconds</option>
                    <option value="10">10 seconds</option>
                    <option value="30">30 seconds</option>
                  </select>
                </label>
                <label className="setting-row"><span><strong>Repeat unread reminder</strong><small>Remind you once about a room that is still unread.</small></span>
                  <select aria-label="Repeat unread reminder" value={preferenceString(preferences, 'notifications.repeat_minutes', '0')} onChange={(event) => onPreferenceChange('notifications.repeat_minutes', event.target.value)}>
                    <option value="0">Off</option>
                    <option value="5">After 5 minutes</option>
                    <option value="15">After 15 minutes</option>
                    <option value="60">After 60 minutes</option>
                  </select>
                </label>
                <PreferenceToggle label="Notify one-time codes immediately" checked={preferenceBoolean(preferences, 'notifications.otp_immediate', true)} onChange={(value) => onPreferenceChange('notifications.otp_immediate', value)} />
                <PreferenceToggle label="Copy one-time codes automatically" checked={preferenceBoolean(preferences, 'notifications.otp_copy')} onChange={(value) => onPreferenceChange('notifications.otp_copy', value)} />
                <label className="setting-row"><span><strong>Sound effects</strong><small>Play a short sound when a message is sent.</small></span>
                  <select aria-label="Sound effects" value={preferenceString(preferences, 'sounds.effects', 'Off')} onChange={(event) => onPreferenceChange('sounds.effects', event.target.value)}>
                    <option value="Off">Off</option>
                    <option value="Sent messages">Sent messages</option>
                  </select>
                </label>
              </div>
            )}
            {tab === 'Keyboard' && (
              <div className="settings-section">
                <h3>Keyboard</h3>
                <PreferenceToggle label="Use Ctrl + Enter to send" checked={preferenceBoolean(preferences, 'composer.ctrl_enter')} onChange={(value) => onPreferenceChange('composer.ctrl_enter', value)} />
                <PreferenceToggle label="Show formatting toolbar" checked={preferenceBoolean(preferences, 'composer.formatting_toolbar')} onChange={(value) => onPreferenceChange('composer.formatting_toolbar', value)} />
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
                <PreferenceToggle label="Include timestamps when copying messages" checked={preferenceBoolean(preferences, 'clipboard.copy_timestamp')} onChange={(value) => onPreferenceChange('clipboard.copy_timestamp', value)} />
                <PreferenceToggle label="Use Up to focus the message list when the composer is empty" checked={preferenceBoolean(preferences, 'composer.arrow_up_focus_timeline')} onChange={(value) => onPreferenceChange('composer.arrow_up_focus_timeline', value)} />
                <PreferenceToggle label="Enable single-key shortcuts (N, U, A, F, R, J, K and the answered key)" checked={preferenceBoolean(preferences, 'shortcuts.single_keys', true)} onChange={(value) => onPreferenceChange('shortcuts.single_keys', value)} />
                {!preferenceBoolean(preferences, 'shortcuts.single_keys', true) && <p className="settings-note" role="status">Single-key shortcuts are off. Use the message and room menus instead. Ctrl / ⌘ shortcuts still work.</p>}
                <label className="setting-row"><span><strong>Mark answered shortcut</strong><small>Use one letter to mark the selected room answered.</small></span>
                  <input className="shortcut-input" type="text" maxLength={1} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={preferenceString(preferences, 'shortcuts.mark_answered', 'E')} aria-label="Mark answered shortcut" onChange={(event) => { const value = event.target.value.toUpperCase(); if (value) onPreferenceChange('shortcuts.mark_answered', value) }} />
                </label>
                <button className="settings-command" type="button" onClick={() => setSnippetManagerOpen(true)}><FileText size={15} />Manage text snippets</button>
                <p className="settings-note">Expand personal shortcuts while composing. Snippets are stored on this device.</p>
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
              </div>
            )}
            {tab === 'History' && (
              <div className="settings-section">
                <h3>Message history</h3>
                <label className="setting-row"><span><strong>Messages to load</strong><small>Load this many recent messages when opening a room.</small></span>
                  <select value={preferenceString(preferences, 'history.initial_messages', '100')} onChange={(event) => onPreferenceChange('history.initial_messages', event.target.value)}>
                    {['25', '50', '100', '250', '500', '1000'].map((value) => <option key={value} value={value}>{Number(value).toLocaleString()}</option>)}
                  </select>
                </label>
              </div>
            )}
            {tab === 'Account' && (
              <div className="settings-section">
                <h3>Account</h3>
                <div className="account-summary"><Avatar uri={profile.avatarUri} label={profile.displayName || profile.userId} className="profile-avatar" /><div><strong>{profile.displayName || profile.userId}</strong><span>{profile.userId}</span></div></div>
                <div className="account-details"><span>Homeserver</span><strong>{profile.homeserver}</strong><span>This device</span><strong>{profile.deviceId}</strong><span>Encryption</span><strong>{profile.verified ? 'Verified' : 'Needs verification'}</strong></div>
                <PreferenceToggle label="Send typing indicators" checked={preferenceBoolean(preferences, 'privacy.send_typing', true)} onChange={(value) => onPreferenceChange('privacy.send_typing', value)} />
                <PreferenceToggle label="Content blur" checked={preferenceBoolean(preferences, 'privacy.incognito')} onChange={(value) => onPreferenceChange('privacy.incognito', value)} />
                {preferenceBoolean(preferences, 'privacy.incognito') && <p className="settings-note" role="status">Content blur is active. Message text, names, and room images are blurred until hovered or focused. Read receipts are still sent when you open a room.</p>}
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
              </div>
            )}
            {tab === 'Devices' && (
              <div className="settings-section">
                <h3>Active devices</h3>
                {devicesLoading && <p className="settings-note">Loading devices…</p>}
                {devicesError && <p className="settings-error" role="alert">{devicesError}</p>}
                {!devicesLoading && !devicesError && devices.length === 0 && <p className="settings-note">No devices were returned by the homeserver.</p>}
                {devices.map((device) => (
                  <article className="device-row" key={device.id}>
                    <div><strong>{device.displayName || '(unnamed device)'}</strong><span>{device.id}{device.current ? ' · this device' : ''}</span><small>{device.lastSeenAt > 0 ? `Last active ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(device.lastSeenAt))}` : device.lastSeenIp || 'Last active time unavailable'}</small></div>
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
              </div>
            )}
            {tab === 'Storage' && (
              <div className="settings-section">
                <h3>Local storage</h3>
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
                <ChatStorageSettings />
              </div>
            )}
            {tab === 'Security' && (
              <div className="settings-section">
                <h3>Encryption and room keys</h3>
                <p className="settings-note">Device verification: {profile.verified ? 'Verified' : 'This device needs verification.'}</p>
                <label className="security-field"><span>Backup passphrase</span><input type="password" autoComplete="new-password" value={backupPassphrase} onChange={(event) => setBackupPassphrase(event.target.value)} /></label>
                <label className="security-field"><span>Confirm passphrase</span><input type="password" autoComplete="new-password" value={backupConfirmation} onChange={(event) => setBackupConfirmation(event.target.value)} /></label>
                <button className="settings-command" type="button" disabled={keyBusy || !backupPassphrase || backupPassphrase !== backupConfirmation} onClick={() => void exportRoomKeys()}><Download size={15} />{keyBusy ? 'Working…' : 'Export room keys'}</button>
                <label className="security-field"><span>Import passphrase</span><input type="password" autoComplete="off" value={importPassphrase} onChange={(event) => setImportPassphrase(event.target.value)} /></label>
                <label className="settings-command file-command"><Upload size={15} />Import room key file<input type="file" accept=".txt,.json,application/octet-stream" disabled={keyBusy || !importPassphrase} onChange={(event) => void importRoomKeys(event)} /></label>
                {keyStatus && <p className="settings-note" role="status">{keyStatus}</p>}
              </div>
            )}
            {tab === 'AI' && (
              <div className="settings-section">
                <h3>AI</h3>
                <p className="settings-note">Configure the local AI endpoint and the instructions and tuning for each AI feature. AI replies are drafts and are never sent automatically.</p>
                <div className="integration-status" aria-label="AI status">
                  <div className="account-details"><span>Endpoint</span><strong>{preferenceString(preferences, 'ai.endpoint', '').trim() ? 'Set' : 'Not set'}</strong></div>
                </div>
                <LocalAISettings
                  endpoint={preferenceString(preferences, 'ai.endpoint', '')}
                  model={preferenceString(preferences, 'ai.model', '')}
                  transcriptionModel={preferenceString(preferences, 'ai.transcription_model', '')}
                  thinkingLevel={preferenceString(preferences, 'ai.thinking_level', 'none')}
                  onSave={onPreferenceChange}
                />
                <ImageGenerationSettings
                  binaryPath={preferenceString(preferences, 'ai.image.binary_path', '')}
                  modelPath={preferenceString(preferences, 'ai.image.model_path', '')}
                  idleMinutes={preferenceString(preferences, 'ai.image.idle_minutes', '3')}
                  size={preferenceString(preferences, 'ai.image.size', '512x512')}
                  steps={preferenceString(preferences, 'ai.image.steps', '')}
                  guidanceScale={preferenceString(preferences, 'ai.image.cfg_scale', '')}
                  sampler={preferenceString(preferences, 'ai.image.sampler', '')}
                  negativePrompt={preferenceString(preferences, 'ai.image.negative_prompt', '')}
                  onSave={onPreferenceChange}
                />
                <LocalAIAgentSettings agents={localAIAgents} onSave={(collection) => onPreferenceChange('ai.local_agents', serializeChatAgents(collection))} />
                <LanguageSettings roles={resolveLanguageRoles(preferences)} onSave={onPreferenceChange} />
                <AIPromptSettings preferences={preferences} onSave={onPreferenceChange} />
              </div>
            )}
            {tab === 'Integrations' && (
              <div className="settings-section">
                <h3>Integrations</h3>
                <p className="settings-note">Chat networks are detected from the active account's chats, using room names and DM users. This is a best-effort view. Connecting a network requires a bridge set up on your homeserver; Pinger cannot create bridge logins.</p>
                <div className="integration-status" aria-label="Detected chat networks">
                  {chatNetworks.map(({ code, name }) => {
                    const count = rooms.filter((room) => room.bridge === code).length
                    return (
                      <div key={code} className="account-details"><span>{name}</span><strong>{count > 0 ? `${count.toLocaleString()} ${count === 1 ? 'chat' : 'chats'} detected` : 'No chats detected'}</strong></div>
                    )
                  })}
                </div>
              </div>
            )}
            {tab === 'Help' && (
              <div className="settings-section">
                <h3>Help center</h3>
                <p className="settings-note">Answers to common questions about Pinger.</p>
                <article className="help-item"><h4>Keyboard shortcuts</h4><p>The Keyboard tab lists every shortcut. Single-key shortcuts can be turned off there.</p><button className="settings-command" type="button" onClick={() => onTabChange('Keyboard')}>Open keyboard shortcuts</button></article>
                <article className="help-item"><h4>Storage and media</h4><p>Clearing media removes cached files only. Messages and encryption keys stay, and media downloads again when you open it.</p><button className="settings-command" type="button" onClick={() => onTabChange('Storage')}>Open storage</button></article>
                <article className="help-item"><h4>Local AI</h4><p>Pinger connects to a llama-server you run yourself. Set its address in AI settings. AI replies are drafts and are never sent automatically.</p></article>
                <article className="help-item"><h4>Chat networks</h4><p>WhatsApp, Telegram and other networks appear when your homeserver has bridges set up. Pinger cannot create bridge logins.</p></article>
                <article className="help-item"><h4>Encryption and room keys</h4><p>Export room keys from Security and protect the file with a passphrase. Keep the backup somewhere safe.</p></article>
                <a className="settings-link" href="https://github.com/cataWalter/pinger/issues" target="_blank" rel="noreferrer">Report an issue</a>
              </div>
            )}
            {tab === 'About' && (
              <div className="settings-section">
                <h3>Pinger</h3>
                <AboutPinger />
              </div>
            )}
          </div>
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

function PreferenceRange({ label, min, max, step, value, onChange }: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: string) => Promise<boolean>
}) {
  const [draftValue, setDraftValue] = useState(value)
  const latestValue = useRef(value)
  const committedValue = useRef(value)

  useEffect(() => {
    latestValue.current = value
    committedValue.current = value
    setDraftValue(value)
  }, [value])

  function commitValue() {
    const nextValue = latestValue.current
    if (nextValue === committedValue.current) return
    committedValue.current = nextValue
    void onChange(String(nextValue)).then((saved) => {
      if (saved) return
      latestValue.current = value
      committedValue.current = value
      setDraftValue(value)
    })
  }

  return (
    <div className="setting-range">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draftValue}
        aria-label={label}
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value)
          latestValue.current = nextValue
          setDraftValue(nextValue)
        }}
        onPointerUp={commitValue}
        onPointerCancel={commitValue}
        onKeyUp={commitValue}
        onBlur={commitValue}
      />
      <output>{draftValue}%</output>
    </div>
  )
}

function PreferenceToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
