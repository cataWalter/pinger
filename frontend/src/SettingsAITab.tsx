import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Room } from '../bindings/mychat/desktop/models.js'
import { describeError, preferenceBoolean, preferenceString, type PreferenceValues } from './appShared'
import { EMPTY_CHAT_AGENTS, parseChatAgents, serializeChatAgents, type ChatAgentCollection } from './aiPrompts'
import { ONLINE_AI_DEFAULT_ENDPOINT, onlineAIConsented, onlineAIEndpointOf, resolveLanguageRoles, textAIConfigured, textAIProviderOf, validOnlineAIEndpoint } from './aiSettings'
import { LanguageSettings } from './LanguageSettings'
import { AIPromptSettings } from './AIPromptSettings'
import LocalAIAgentSettings from './LocalAIAgentSettings'
import { PreferenceToggle, SettingsAdvanced, SettingsSection } from './SettingsControls'

type AISettingsTabProps = {
  preferences: PreferenceValues
  rooms: Room[]
  onPreferenceChange: (key: string, value: boolean | string) => Promise<boolean>
  onPreferencesChange: (entries: Record<string, string>) => Promise<boolean>
}

export function AISettingsTab({ preferences, rooms, onPreferenceChange, onPreferencesChange }: AISettingsTabProps) {
  const localAIAgents = useMemo<ChatAgentCollection>(() => parseChatAgents(preferenceString(preferences, 'ai.local_agents', JSON.stringify(EMPTY_CHAT_AGENTS))), [preferences])
  const textProvider = textAIProviderOf(preferences)

  return (
    <SettingsSection title="AI" description="Choose where text AI runs, then configure the local endpoint and the instructions and tuning for each AI feature. AI replies are drafts and are never sent automatically.">
      <div className="integration-status" aria-label="AI status">
        <div className="account-details"><span>Text AI</span><strong>{textProvider === 'online' ? 'Online service' : 'Local model'}</strong></div>
        <div className="account-details"><span>Status</span><strong>{textAIConfigured(preferences) ? 'Ready' : 'Not set up'}</strong></div>
      </div>
      <div className="ai-settings-form ai-provider-settings">
        <h4>Text AI provider</h4>
        <p className="settings-note">Replies, the Language Tutor, and chat goals use this provider. Language detection, voice transcription, and image generation always stay on this computer.</p>
        <label><span>Provider</span><select aria-label="Text AI provider" value={textProvider} onChange={(event) => void onPreferenceChange('ai.provider', event.target.value)}>
          <option value="local">Local model on this computer</option>
          <option value="online">Online service (OpenRouter and compatible)</option>
        </select></label>
      </div>
      <LocalAISettings
        active={textProvider === 'local'}
        endpoint={preferenceString(preferences, 'ai.endpoint', '')}
        model={preferenceString(preferences, 'ai.model', '')}
        transcriptionModel={preferenceString(preferences, 'ai.transcription_model', '')}
        thinkingLevel={preferenceString(preferences, 'ai.thinking_level', 'none')}
        onSave={onPreferenceChange}
      />
      <OnlineAISettings
        active={textProvider === 'online'}
        endpoint={onlineAIEndpointOf(preferences)}
        model={preferenceString(preferences, 'ai.online.model', '')}
        consented={onlineAIConsented(preferences)}
        onSave={onPreferenceChange}
      />
      <SettingsAdvanced description="Local image generation: model paths, size, and sampling.">
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
      </SettingsAdvanced>
      <LocalAIAgentSettings agents={localAIAgents} onSave={(collection) => onPreferenceChange('ai.local_agents', serializeChatAgents(collection))} />
      <PreferenceToggle label="Detect the learning language of unarchived chats automatically (local model only)" checked={preferenceBoolean(preferences, 'ai.detect_chat_language')} onChange={(value) => onPreferenceChange('ai.detect_chat_language', value)} />
      <LanguageSettings roles={resolveLanguageRoles(preferences)} preferences={preferences} rooms={rooms} onPreferencesChange={onPreferencesChange} />
      <AIPromptSettings preferences={preferences} onSave={onPreferenceChange} />
    </SettingsSection>
  )
}

function LocalAISettings({ active, endpoint, model, transcriptionModel, thinkingLevel, onSave }: {
  active: boolean
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
    setStatus(saved ? 'AI settings saved.' : 'Not saved. Use a localhost HTTP URL without a path, such as http://localhost:8080.')
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
    <form className="ai-settings-form ai-local-settings" onSubmit={(event) => void saveSettings(event)}>
      <h4>Local model</h4>
      <p className="settings-note">Use a llama-server or other OpenAI-compatible server on this computer, such as <code>http://localhost:8080</code>. Pinger accepts only localhost or loopback addresses here. Voice transcription (<code>/v1/audio/transcriptions</code>) uses this endpoint too, so audio stays on this computer. Results are suggestions and no Matrix message is sent automatically.</p>
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
        {active && (
          <button
            className="settings-command"
            type="button"
            disabled={busy || !endpoint || endpointUnsaved}
            title={endpointUnsaved ? 'Save the endpoint before testing' : undefined}
            onClick={() => void testEndpoint()}
          >Test endpoint</button>
        )}
      </div>
      {status && <p className="settings-note" role="status">{status}</p>}
    </form>
  )
}

type OnlineKeyState = 'checking' | 'saved' | 'none'

function OnlineAISettings({ active, endpoint, model, consented, onSave }: {
  active: boolean
  endpoint: string
  model: string
  consented: boolean
  onSave: (key: string, value: string) => Promise<boolean>
}) {
  const [endpointDraft, setEndpointDraft] = useState(endpoint)
  const [modelDraft, setModelDraft] = useState(model)
  const [keyDraft, setKeyDraft] = useState('')
  // The keychain entry belongs to the saved endpoint's host, so the result is tied to the endpoint it was read for.
  const [keyCheck, setKeyCheck] = useState<{ endpoint: string; stored: boolean } | null>(null)
  const [connectionStatus, setConnectionStatus] = useState('')
  const [keyStatus, setKeyStatus] = useState('')
  const [consentStatus, setConsentStatus] = useState('')
  const [testStatus, setTestStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const keyState: OnlineKeyState = keyCheck?.endpoint === endpoint ? (keyCheck.stored ? 'saved' : 'none') : 'checking'
  const draftEndpoint = endpointDraft.trim() || ONLINE_AI_DEFAULT_ENDPOINT
  const endpointUnsaved = draftEndpoint !== endpoint
  const modelMissing = model.trim() === ''

  useEffect(() => {
    let current = true
    void (async () => {
      let stored: boolean
      try {
        stored = Boolean(await AppService.OnlineAIKeyStored())
      } catch {
        stored = false
      }
      if (current) setKeyCheck({ endpoint, stored })
    })()
    return () => {
      current = false
    }
  }, [endpoint])

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setConnectionStatus('')
    if (!validOnlineAIEndpoint(draftEndpoint)) {
      setConnectionStatus('Not saved. Use an HTTPS endpoint without a username, password, query, or fragment, such as https://openrouter.ai/api/v1.')
      return
    }
    setBusy(true)
    let saved = await onSave('ai.online.endpoint', endpointDraft.trim())
    // Clearing consent on an endpoint change also stops it from returning if the endpoint is switched back.
    if (saved && draftEndpoint !== endpoint) saved = await onSave('ai.online.consent_endpoint', '')
    if (saved) saved = await onSave('ai.online.model', modelDraft.trim())
    setConnectionStatus(saved ? 'Online connection saved.' : 'Not saved. Check the endpoint and model and try again.')
    setBusy(false)
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setKeyStatus('')
    try {
      await AppService.SetOnlineAIKey(keyDraft.trim())
      setKeyDraft('')
      setKeyCheck({ endpoint, stored: true })
      setKeyStatus('Key saved in the OS keychain.')
    } catch (keyError) {
      setKeyStatus(`Not saved. ${describeError(keyError)}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeKey() {
    setBusy(true)
    setKeyStatus('')
    try {
      await AppService.ClearOnlineAIKey()
      setKeyCheck({ endpoint, stored: false })
      setKeyStatus('Key removed from the OS keychain.')
    } catch (keyError) {
      setKeyStatus(`Not removed. ${describeError(keyError)}`)
    } finally {
      setBusy(false)
    }
  }

  async function changeConsent(granted: boolean) {
    setBusy(true)
    setConsentStatus('')
    const saved = await onSave('ai.online.consent_endpoint', granted ? endpoint : '')
    if (!saved) setConsentStatus('Not saved. Try again.')
    setBusy(false)
  }

  async function testConnection() {
    setBusy(true)
    setTestStatus('Checking the connection…')
    try {
      await AppService.TestAIEndpoint()
      setTestStatus('Connection checked. The service accepted the request.')
    } catch (testError) {
      setTestStatus(describeError(testError))
    } finally {
      setBusy(false)
    }
  }

  const consentLocked = busy || (!consented && (endpointUnsaved || modelMissing))
  const testBlockedReason = !active ? 'Select the online service as the text AI provider first.'
    : endpointUnsaved ? 'Save the connection first.'
    : !consented ? 'Allow sending chat content to this service first.'
    : keyState !== 'saved' ? 'Save an API key first.'
    : modelMissing ? 'Save a model first.'
    : undefined

  return (
    <section className="ai-online-settings">
      <form className="ai-settings-form" aria-label="Online connection settings" onSubmit={(event) => void saveConnection(event)}>
        <h4>Online service</h4>
        <p className="settings-note">Use OpenRouter or another OpenAI-compatible service over HTTPS. Requests go to the online service, not to this computer.</p>
        <label><span>Online endpoint</span><input type="url" value={endpointDraft} placeholder={ONLINE_AI_DEFAULT_ENDPOINT} spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setEndpointDraft(event.target.value)} /></label>
        <label><span>Online model</span><input type="text" value={modelDraft} placeholder="Model ID, for example provider/model-name" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setModelDraft(event.target.value)} /></label>
        <div className="ai-settings-actions">
          <button className="settings-command" type="submit" disabled={busy}>Save connection</button>
        </div>
        {connectionStatus && <p className="settings-note" role="status">{connectionStatus}</p>}
      </form>
      <form className="ai-settings-form" aria-label="Online API key" onSubmit={(event) => void saveKey(event)}>
        <h4>API key</h4>
        <p className="settings-note">{keyState === 'checking' ? 'Checking the keychain…' : keyState === 'saved' ? 'A key is saved for this endpoint in the OS keychain. It is never shown here.' : 'No key is saved for this endpoint yet.'}</p>
        <label><span>API key</span><input type="password" value={keyDraft} placeholder="Paste a new key" autoComplete="off" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setKeyDraft(event.target.value)} /></label>
        <div className="ai-settings-actions">
          <button
            className="settings-command"
            type="submit"
            disabled={busy || endpointUnsaved || keyDraft.trim() === ''}
            title={endpointUnsaved ? 'Save the connection first. The key is stored for the saved endpoint.' : undefined}
          >Save key</button>
          <button className="settings-command" type="button" disabled={busy || endpointUnsaved || keyState !== 'saved'} onClick={() => void removeKey()}>Remove key</button>
        </div>
        {keyStatus && <p className="settings-note" role="status">{keyStatus}</p>}
      </form>
      <div className="ai-settings-form ai-online-consent">
        <h4>Sending chat content</h4>
        <p className="settings-note">When this is on, Pinger sends content to the online service for suggested replies, Language Tutor requests, chat goals, and private AI chats. Language detection always runs on your local model and never sends chat content online. Pinger never falls back to a local model when the online service fails. Voice transcription and image generation stay on this computer. The API key stays in the OS keychain and is sent only to the endpoint host over HTTPS.</p>
        <label className="ai-consent-option">
          <input type="checkbox" checked={consented} disabled={consentLocked} onChange={(event) => void changeConsent(event.target.checked)} />
          <span>Allow Pinger to send chat content to this online service</span>
        </label>
        {consentStatus && <p className="settings-note" role="status">{consentStatus}</p>}
        <div className="ai-settings-actions">
          <button className="settings-command" type="button" disabled={busy || testBlockedReason !== undefined} title={testBlockedReason} onClick={() => void testConnection()}>Test connection</button>
        </div>
        {testStatus && <p className="settings-note" role="status">{testStatus}</p>}
      </div>
    </section>
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
