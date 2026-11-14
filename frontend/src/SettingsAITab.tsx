import { useMemo, useState, type FormEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Room } from '../bindings/mychat/desktop/models.js'
import { describeError, preferenceString, type PreferenceValues } from './appShared'
import { EMPTY_CHAT_AGENTS, parseChatAgents, serializeChatAgents, type ChatAgentCollection } from './aiPrompts'
import { resolveLanguageRoles } from './aiSettings'
import { LanguageSettings } from './LanguageSettings'
import { AIPromptSettings } from './AIPromptSettings'
import LocalAIAgentSettings from './LocalAIAgentSettings'
import { SettingsSection } from './SettingsControls'

type AISettingsTabProps = {
  preferences: PreferenceValues
  rooms: Room[]
  onPreferenceChange: (key: string, value: boolean | string) => Promise<boolean>
  onPreferencesChange: (entries: Record<string, string>) => Promise<boolean>
}

export function AISettingsTab({ preferences, rooms, onPreferenceChange, onPreferencesChange }: AISettingsTabProps) {
  const localAIAgents = useMemo<ChatAgentCollection>(() => parseChatAgents(preferenceString(preferences, 'ai.local_agents', JSON.stringify(EMPTY_CHAT_AGENTS))), [preferences])

  return (
    <SettingsSection title="AI" description="Configure the local AI endpoint and the instructions and tuning for each AI feature. AI replies are drafts and are never sent automatically.">
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
      <LanguageSettings roles={resolveLanguageRoles(preferences)} preferences={preferences} rooms={rooms} onPreferencesChange={onPreferencesChange} />
      <AIPromptSettings preferences={preferences} onSave={onPreferenceChange} />
    </SettingsSection>
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
