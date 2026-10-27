import { useState, type FormEvent } from 'react'
import { Bot, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import {
    MAX_AGENT_INSTRUCTIONS_LENGTH,
    MAX_AGENT_NAME_LENGTH,
    MAX_CHAT_AGENTS,
    type ChatAgentCollection,
    type ChatAgentProfile,
} from './aiPrompts'
import { localAIErrorMessage } from './localAIChats'

type AgentDraft = {
    id: string
    name: string
    instructions: string
}

export type LocalAIAgentSettingsProps = {
    agents: ChatAgentCollection
    onSave: (collection: ChatAgentCollection) => Promise<boolean>
}

function createAgentID() {
    return globalThis.crypto?.randomUUID?.() ?? `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function LocalAIAgentSettings({ agents, onSave }: LocalAIAgentSettingsProps) {
    const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null)
    const [confirming, setConfirming] = useState('')
    const [status, setStatus] = useState('')
    const [busy, setBusy] = useState(false)

    async function persistAgents(collection: ChatAgentCollection) {
        setStatus('')
        setBusy(true)
        try {
            const saved = await onSave(collection)
            if (!saved) setStatus('Agents could not be saved.')
            return saved
        } catch (saveError) {
            setStatus(localAIErrorMessage(saveError, 'Agents could not be saved.'))
            return false
        } finally {
            setBusy(false)
        }
    }

    async function saveAgentDraft(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!agentDraft) return
        const name = agentDraft.name.trim()
        const instructions = agentDraft.instructions.trim()
        if (!name || Array.from(name).length > MAX_AGENT_NAME_LENGTH) {
            setStatus(`Agent names must be 1-${MAX_AGENT_NAME_LENGTH} characters.`)
            return
        }
        if (!instructions || Array.from(instructions).length > MAX_AGENT_INSTRUCTIONS_LENGTH) {
            setStatus(`Agent instructions must be 1-${MAX_AGENT_INSTRUCTIONS_LENGTH} characters.`)
            return
        }
        const isNew = agentDraft.id === ''
        if (isNew && agents.agents.length >= MAX_CHAT_AGENTS) {
            setStatus(`Keep up to ${MAX_CHAT_AGENTS} agents.`)
            return
        }
        const id = isNew ? createAgentID() : agentDraft.id
        const nextAgents = isNew
            ? [...agents.agents, { id, name, instructions }]
            : agents.agents.map((agent) => (agent.id === id ? { id, name, instructions } : agent))
        if (await persistAgents({ ...agents, agents: nextAgents })) setAgentDraft(null)
    }

    async function deleteAgent(agent: ChatAgentProfile) {
        const key = `agent:${agent.id}`
        if (confirming !== key) {
            setConfirming(key)
            return
        }
        setConfirming('')
        await persistAgents({
            ...agents,
            agents: agents.agents.filter((item) => item.id !== agent.id),
            defaultAgentId: agents.defaultAgentId === agent.id ? '' : agents.defaultAgentId,
        })
    }

    return (
        <section className="local-ai-agent-settings" aria-labelledby="local-ai-agents-heading">
            <div className="local-ai-agent-heading">
                <h4 id="local-ai-agents-heading">Chat agents</h4>
                <button
                    className="settings-command"
                    type="button"
                    disabled={busy || agents.agents.length >= MAX_CHAT_AGENTS}
                    onClick={() => {
                        setStatus('')
                        setAgentDraft({ id: '', name: '', instructions: '' })
                    }}
                >
                    <Plus size={13} />
                    <span>Add agent</span>
                </button>
            </div>
            <p className="settings-note">Agents give a private model chat a role. Each agent's instructions are sent with its chats. Choose an agent when you start a chat, or set a default for new chats.</p>
            {status && <p className="settings-note" role="alert">{status}</p>}
            <label className="local-ai-default-agent">
                <span>Default agent for new chats</span>
                <select
                    value={agents.defaultAgentId}
                    disabled={busy || agents.agents.length === 0}
                    onChange={(event) => void persistAgents({ ...agents, defaultAgentId: event.currentTarget.value })}
                >
                    <option value="">No default</option>
                    {agents.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
            </label>
            {agentDraft && (
                <form className="ai-settings-form local-ai-agent-form" aria-label={agentDraft.id ? 'Edit agent' : 'New agent'} onSubmit={(event) => void saveAgentDraft(event)}>
                    <label>
                        <span>Name</span>
                        <input
                            aria-label="Agent name"
                            value={agentDraft.name}
                            maxLength={MAX_AGENT_NAME_LENGTH}
                            autoFocus
                            onChange={(event) => setAgentDraft({ ...agentDraft, name: event.currentTarget.value })}
                        />
                    </label>
                    <label>
                        <span>Instructions</span>
                        <textarea
                            aria-label="Agent instructions"
                            value={agentDraft.instructions}
                            maxLength={MAX_AGENT_INSTRUCTIONS_LENGTH}
                            rows={4}
                            onChange={(event) => setAgentDraft({ ...agentDraft, instructions: event.currentTarget.value })}
                        />
                    </label>
                    <div className="ai-settings-actions">
                        <button className="settings-command" type="button" onClick={() => setAgentDraft(null)}>Cancel</button>
                        <button className="settings-command" type="submit" disabled={busy || agentDraft.name.trim() === '' || agentDraft.instructions.trim() === ''}>Save agent</button>
                    </div>
                </form>
            )}
            {agents.agents.length === 0 && !agentDraft && <p className="settings-note">No agents yet. Add one to give chats a role.</p>}
            <ul className="local-ai-agent-list" aria-label="Agents">
                {agents.agents.map((agent) => {
                    const confirmingDelete = confirming === `agent:${agent.id}`
                    return (
                        <li key={agent.id} className="local-ai-agent-row">
                            <Bot size={14} />
                            <span className="local-ai-agent-name">{agent.name}</span>
                            {agent.id === agents.defaultAgentId && <span className="local-ai-agent-default">Default</span>}
                            <div className="local-ai-agent-actions">
                                <button type="button" aria-label={`Edit agent ${agent.name}`} title="Edit agent" disabled={busy} onClick={() => {
                                    setStatus('')
                                    setAgentDraft({ id: agent.id, name: agent.name, instructions: agent.instructions })
                                }}>
                                    <Pencil size={12} />
                                </button>
                                <button
                                    type="button"
                                    className={confirmingDelete ? 'is-confirming' : undefined}
                                    aria-label={confirmingDelete ? `Confirm delete agent ${agent.name}` : `Delete agent ${agent.name}`}
                                    title={confirmingDelete ? 'Confirm delete' : 'Delete agent'}
                                    disabled={busy}
                                    onClick={() => void deleteAgent(agent)}
                                >
                                    {confirmingDelete ? <Check size={12} /> : <Trash2 size={12} />}
                                </button>
                            </div>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
