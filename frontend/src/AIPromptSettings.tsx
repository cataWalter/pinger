import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import type { AIFeatureDefault } from '../bindings/mychat/desktop/models.js'
import {
  AI_FEATURE_SPECS,
  AI_MAX_TOKENS_LIMIT,
  AI_PROMPT_MAX_CHARACTERS,
  AI_TEMPERATURE_MAX,
  AI_TEMPERATURE_MIN,
  aiFeatureDraftFromTuning,
  aiFeaturePreferenceEntries,
  aiFeatureResetEntries,
  tuningFromPreferences,
  validateAIFeatureDraft,
  type AIFeatureDraft,
  type AIFeatureTuning,
} from './aiSettings'

type PromptCard = {
  id: string
  label: string
  description: string
  placeholders: string[]
  fixedRules: string
  defaults: AIFeatureTuning
}

type PromptGroup = {
  title: string
  cards: PromptCard[]
}

// Feature ids listed here appear under their group title; any other feature appears under Other.
const PROMPT_GROUPS: { title: string, ids: string[] }[] = [
  { title: 'Writing and assistants', ids: ['ask_ai', 'local_chat', 'agent', 'draft_reply', 'ghostwriter', 'rewrite', 'shorten'] },
  { title: 'Translation and understanding', ids: ['chat_translation', 'explain', 'summarize', 'topics', 'conversation_analysis', 'language_tutor'] },
  { title: 'Checks and background tasks', ids: ['tone_guard', 'contact_dossier'] },
]

function groupPromptCards(cards: PromptCard[]): PromptGroup[] {
  const byID = new Map(cards.map((card) => [card.id, card]))
  const placed = new Set<string>()
  const groups = PROMPT_GROUPS.map((group) => ({
    title: group.title,
    cards: group.ids.flatMap((id) => {
      const card = byID.get(id)
      if (!card) return []
      placed.add(id)
      return [card]
    }),
  }))
  groups.push({ title: 'Other', cards: cards.filter((card) => !placed.has(card.id)) })
  return groups.filter((group) => group.cards.length > 0)
}

type SaveSetting = (key: string, value: boolean | string) => Promise<boolean>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function AIPromptCard({ card, tuning, onSave }: {
  card: PromptCard
  tuning: AIFeatureTuning
  onSave: SaveSetting
}) {
  const { prompt: savedPrompt, temperature: savedTemperature, maxTokens: savedMaxTokens } = tuning
  const [draft, setDraft] = useState<AIFeatureDraft>(() => aiFeatureDraftFromTuning(tuning))
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const customized = tuning.prompt !== card.defaults.prompt.trim()
    || tuning.temperature !== card.defaults.temperature
    || tuning.maxTokens !== card.defaults.maxTokens

  // Reset the draft only when the saved values change, so unrelated re-renders keep unsaved edits.
  useEffect(() => {
    setDraft(aiFeatureDraftFromTuning({ prompt: savedPrompt, temperature: savedTemperature, maxTokens: savedMaxTokens }))
  }, [savedPrompt, savedTemperature, savedMaxTokens])

  function updateDraft(field: keyof AIFeatureDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setStatus('')
  }

  async function saveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = validateAIFeatureDraft(draft)
    if (problem) {
      setError(problem)
      setStatus('')
      return
    }
    setError('')
    setBusy(true)
    let saved = true
    for (const [key, value] of aiFeaturePreferenceEntries(card.id, draft, card.defaults)) {
      saved = await onSave(key, value)
      if (!saved) break
    }
    setBusy(false)
    setStatus(saved ? 'Saved. New requests use these settings.' : 'Not saved. Check the value and try again.')
  }

  async function resetCard() {
    setError('')
    setBusy(true)
    let saved = true
    for (const [key, value] of aiFeatureResetEntries(card.id)) {
      saved = await onSave(key, value)
      if (!saved) break
    }
    setBusy(false)
    setDraft(aiFeatureDraftFromTuning(card.defaults))
    setStatus(saved ? 'Restored the default.' : 'Not restored. Try again.')
  }

  return (
    <details className="ai-prompt-card" data-ai-feature={card.id}>
      <summary>
        <span className="ai-prompt-card-title">{card.label}</span>
        {customized && <span className="ai-prompt-card-badge">Customized</span>}
      </summary>
      <form className="ai-prompt-card-body" noValidate onSubmit={(event) => void saveCard(event)}>
        <p className="settings-note">{card.description}</p>
        {card.placeholders.length > 0 && <p className="settings-note">Placeholders: {card.placeholders.join(', ')}</p>}
        <label>
          <span>Instructions</span>
          <textarea
            rows={5}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            maxLength={AI_PROMPT_MAX_CHARACTERS}
            value={draft.prompt}
            placeholder={card.defaults.prompt}
            onChange={(event) => updateDraft('prompt', event.target.value)}
          />
        </label>
        <div className="ai-prompt-card-numbers">
          <label>
            <span>Temperature</span>
            <input
              type="number"
              min={AI_TEMPERATURE_MIN}
              max={AI_TEMPERATURE_MAX}
              step={0.05}
              value={draft.temperature}
              placeholder={`Default ${card.defaults.temperature}`}
              onChange={(event) => updateDraft('temperature', event.target.value)}
            />
          </label>
          <label>
            <span>Max tokens</span>
            <input
              type="number"
              min={0}
              max={AI_MAX_TOKENS_LIMIT}
              step={1}
              value={draft.maxTokens}
              placeholder={card.defaults.maxTokens > 0 ? `Default ${card.defaults.maxTokens}` : 'No limit'}
              onChange={(event) => updateDraft('maxTokens', event.target.value)}
            />
          </label>
        </div>
        <p className="settings-note">Blank restores the default for that field. Temperature ranges from {AI_TEMPERATURE_MIN} to {AI_TEMPERATURE_MAX}; max tokens up to {AI_MAX_TOKENS_LIMIT}.</p>
        {card.fixedRules && <p className="settings-note ai-prompt-fixed-rules">Always added and not editable: {card.fixedRules}</p>}
        {error && <p className="settings-note" role="alert">{error}</p>}
        <div className="ai-settings-actions">
          <button className="settings-command" type="submit" disabled={busy}>Save</button>
          <button className="settings-command" type="button" disabled={busy} onClick={() => void resetCard()}>Reset to default</button>
        </div>
        {status && <p className="settings-note" role="status">{status}</p>}
      </form>
    </details>
  )
}

export function AIPromptSettings({ preferences, onSave }: {
  preferences: Readonly<Record<string, unknown>>
  onSave: SaveSetting
}) {
  const [backendDefaults, setBackendDefaults] = useState<AIFeatureDefault[] | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    // Promise.resolve keeps a synchronous failure inside the same error path.
    Promise.resolve()
      .then(() => AppService.AIFeatureDefaults())
      .then((defaults) => {
        if (active) setBackendDefaults(defaults ?? [])
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error))
      })
    return () => {
      active = false
    }
  }, [])

  const cards = useMemo<PromptCard[]>(() => [
    ...AI_FEATURE_SPECS.map((spec) => ({
      id: spec.id,
      label: spec.label,
      description: spec.description,
      placeholders: spec.placeholders,
      fixedRules: spec.fixedRules,
      defaults: { prompt: spec.prompt, temperature: spec.temperature, maxTokens: spec.maxTokens },
    })),
    ...(backendDefaults ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      placeholders: [],
      fixedRules: '',
      defaults: { prompt: item.prompt, temperature: item.temperature, maxTokens: item.maxTokens },
    })),
  ], [backendDefaults])

  const groups = useMemo(() => groupPromptCards(cards), [cards])

  return (
    <section className="ai-prompts-settings" aria-label="AI prompts and tuning">
      <h4>AI prompts and tuning</h4>
      <p className="settings-note">Change the instructions, temperature, and token limit for each AI feature. Changes apply to the next request. Fixed rules are always added, so output formats and protection for untrusted chat text stay in place.</p>
      {backendDefaults === null && !loadError && <p className="settings-note" role="status">Loading local assistant features…</p>}
      {loadError && <p className="settings-note" role="status">Local assistant features could not be loaded: {loadError}</p>}
      {groups.map((group) => (
        <div className="ai-prompt-group" key={group.title}>
          <h5>{group.title}</h5>
          {group.cards.map((card) => (
            <AIPromptCard
              key={card.id}
              card={card}
              tuning={tuningFromPreferences(preferences, card.id, card.defaults)}
              onSave={onSave}
            />
          ))}
        </div>
      ))}
    </section>
  )
}
