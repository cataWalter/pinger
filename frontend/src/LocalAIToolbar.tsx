import { Download, Plus } from 'lucide-react'
import { MAX_CHAT_AGENTS, type ChatAgentProfile } from './aiPrompts'

type LocalAIToolbarProps = {
  agents: ChatAgentProfile[]
  agentId: string
  busy: boolean
  loading: boolean
  hasMessages: boolean
  agentFormOpen: boolean
  onChangeAgent: (agentId: string) => void
  onToggleAgentForm: () => void
  onExport: () => void
}

export default function LocalAIToolbar({ agents, agentId, busy, loading, hasMessages, agentFormOpen, onChangeAgent, onToggleAgentForm, onExport }: LocalAIToolbarProps) {
  return (
    <div className="local-ai-chat-toolbar">
      {agents.length > 0 && (
        <label className="local-ai-agent-picker">
          <span>Agent</span>
          <select value={agentId} onChange={(event) => onChangeAgent(event.currentTarget.value)} disabled={busy} aria-label="Agent for this chat">
            <option value="">No agent</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
      )}
      <button
        className="local-ai-new-agent"
        type="button"
        aria-label="New agent"
        title="Create an agent for chats"
        aria-expanded={agentFormOpen}
        onClick={onToggleAgentForm}
        disabled={busy || agents.length >= MAX_CHAT_AGENTS}
      >
        <Plus size={13} />
        <span>New agent</span>
      </button>
      <button className="icon-button" type="button" aria-label="Export local AI chat" title="Export chat" onClick={onExport} disabled={!hasMessages || loading}>
        <Download size={15} />
      </button>
    </div>
  )
}
