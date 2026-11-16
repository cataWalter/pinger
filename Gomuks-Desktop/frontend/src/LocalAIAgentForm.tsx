import type { FormEvent } from 'react'
import { MAX_AGENT_INSTRUCTIONS_LENGTH, MAX_AGENT_NAME_LENGTH } from './aiPrompts'
import type { LocalAIAgentDraft } from './localAIChatTypes'

type LocalAIAgentFormProps = {
  agentDraft: LocalAIAgentDraft
  agentError: string
  busy: boolean
  savingAgent: boolean
  onChange: (draft: LocalAIAgentDraft) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export default function LocalAIAgentForm({ agentDraft, agentError, busy, savingAgent, onChange, onCancel, onSubmit }: LocalAIAgentFormProps) {
  return (
    <form className="ai-settings-form local-ai-agent-create" aria-label="Create agent" onSubmit={onSubmit}>
      <label>
        <span>Name</span>
        <input
          aria-label="Agent name"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={agentDraft.name}
          maxLength={MAX_AGENT_NAME_LENGTH}
          autoFocus
          onChange={(event) => onChange({ ...agentDraft, name: event.currentTarget.value })}
        />
      </label>
      <label>
        <span>Instructions</span>
        <textarea
          aria-label="Agent instructions"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={agentDraft.instructions}
          maxLength={MAX_AGENT_INSTRUCTIONS_LENGTH}
          rows={3}
          onChange={(event) => onChange({ ...agentDraft, instructions: event.currentTarget.value })}
        />
      </label>
      {agentError && <p className="local-ai-composer-error" role="alert">{agentError}</p>}
      <div className="ai-settings-actions">
        <button className="settings-command" type="button" onClick={onCancel}>Cancel</button>
        <button className="settings-command" type="submit" disabled={busy || savingAgent || agentDraft.name.trim() === '' || agentDraft.instructions.trim() === ''}>Save agent</button>
      </div>
    </form>
  )
}
