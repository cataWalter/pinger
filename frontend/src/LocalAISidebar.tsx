import { useState, type FormEvent } from 'react'
import { ArrowLeft, Bot, Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { LocalAIChatSummary } from '../bindings/mychat/desktop/models.js'
import {
  MAX_AGENT_INSTRUCTIONS_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_CHAT_AGENTS,
  type ChatAgentCollection,
  type ChatAgentProfile,
} from './aiPrompts'
import { groupLocalAIChats, localAIErrorMessage } from './localAIChats'

const MAX_CHAT_TITLE_CHARACTERS = 120

type AgentDraft = {
  id: string
  name: string
  instructions: string
}

type ChatRename = {
  id: string
  title: string
}

export type LocalAISidebarProps = {
  chats: LocalAIChatSummary[]
  chatsError: string
  agents: ChatAgentCollection
  activeChatId: string | null
  onNewChat: (agentId?: string) => void
  onSelectChat: (chatId: string) => void
  onRenameChat: (chatId: string, title: string) => Promise<void>
  onDeleteChat: (chatId: string) => Promise<void>
  onSaveAgents: (collection: ChatAgentCollection) => Promise<boolean>
  onReturnToMatrix: () => void
}

function createAgentID() {
  return globalThis.crypto?.randomUUID?.() ?? `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function LocalAISidebar({
  chats,
  chatsError,
  agents,
  activeChatId,
  onNewChat,
  onSelectChat,
  onRenameChat,
  onDeleteChat,
  onSaveAgents,
  onReturnToMatrix,
}: LocalAISidebarProps) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState('')
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null)
  const [renaming, setRenaming] = useState<ChatRename | null>(null)

  const normalizedQuery = query.trim().toLowerCase()
  const visibleChats = normalizedQuery
    ? chats.filter((chat) => (chat.title || 'Untitled chat').toLowerCase().includes(normalizedQuery))
    : chats
  const groups = groupLocalAIChats(visibleChats)

  async function persistAgents(collection: ChatAgentCollection) {
    setError('')
    try {
      const saved = await onSaveAgents(collection)
      if (!saved) setError('Agents could not be saved.')
      return saved
    } catch (saveError) {
      setError(localAIErrorMessage(saveError, 'Agents could not be saved.'))
      return false
    }
  }

  async function saveAgentDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!agentDraft) return
    const name = agentDraft.name.trim()
    const instructions = agentDraft.instructions.trim()
    if (!name || Array.from(name).length > MAX_AGENT_NAME_LENGTH) {
      setError(`Agent names must be 1-${MAX_AGENT_NAME_LENGTH} characters.`)
      return
    }
    if (!instructions || Array.from(instructions).length > MAX_AGENT_INSTRUCTIONS_LENGTH) {
      setError(`Agent instructions must be 1-${MAX_AGENT_INSTRUCTIONS_LENGTH} characters.`)
      return
    }
    const isNew = agentDraft.id === ''
    if (isNew && agents.agents.length >= MAX_CHAT_AGENTS) {
      setError(`Keep up to ${MAX_CHAT_AGENTS} agents.`)
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

  async function renameChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renaming) return
    const title = renaming.title.trim()
    if (!title) {
      setError('Chat names cannot be empty.')
      return
    }
    setError('')
    try {
      await onRenameChat(renaming.id, title)
      setRenaming(null)
    } catch (renameError) {
      setError(localAIErrorMessage(renameError, 'The chat could not be renamed.'))
    }
  }

  async function deleteChat(chat: LocalAIChatSummary) {
    const key = `chat:${chat.id}`
    if (confirming !== key) {
      setConfirming(key)
      return
    }
    setConfirming('')
    setError('')
    try {
      await onDeleteChat(chat.id)
    } catch (deleteError) {
      setError(localAIErrorMessage(deleteError, 'The chat could not be deleted.'))
    }
  }

  function renderChatRow(chat: LocalAIChatSummary) {
    const title = chat.title || 'Untitled chat'
    if (renaming?.id === chat.id) {
      return (
        <li key={chat.id} className="local-ai-row is-renaming">
          <form className="local-ai-rename" onSubmit={(event) => void renameChat(event)}>
            <input
              aria-label="Chat title"
              value={renaming.title}
              maxLength={MAX_CHAT_TITLE_CHARACTERS}
              autoFocus
              onChange={(event) => setRenaming({ id: chat.id, title: event.currentTarget.value })}
            />
            <button type="submit" aria-label="Save chat title" title="Save"><Check size={12} /></button>
            <button type="button" aria-label="Cancel rename" title="Cancel" onClick={() => setRenaming(null)}><X size={12} /></button>
          </form>
        </li>
      )
    }
    const active = chat.id === activeChatId
    const confirmingDelete = confirming === `chat:${chat.id}`
    return (
      <li key={chat.id} className={`local-ai-row${active ? ' is-active' : ''}`}>
        <button
          className="local-ai-row-main"
          type="button"
          aria-current={active ? 'true' : undefined}
          onClick={() => {
            setConfirming('')
            onSelectChat(chat.id)
          }}
        >
          <span className="local-ai-row-title">{title}</span>
        </button>
        <div className="local-ai-row-actions">
          <button type="button" aria-label={`Rename ${title}`} title="Rename" onClick={() => setRenaming({ id: chat.id, title: chat.title })}>
            <Pencil size={12} />
          </button>
          <button
            type="button"
            className={confirmingDelete ? 'is-confirming' : undefined}
            aria-label={confirmingDelete ? `Confirm delete ${title}` : `Delete ${title}`}
            title={confirmingDelete ? 'Confirm delete' : 'Delete'}
            onClick={() => void deleteChat(chat)}
          >
            {confirmingDelete ? <Check size={12} /> : <Trash2 size={12} />}
          </button>
        </div>
      </li>
    )
  }

  return (
    <div className="local-ai-sidebar">
      <button className="local-ai-back" type="button" onClick={onReturnToMatrix}>
        <ArrowLeft size={14} />
        <span>Matrix</span>
      </button>
      {error && <p className="local-ai-sidebar-error" role="alert">{error}</p>}

      <div className="room-section-label">
        <span>AGENTS</span>
        <button
          className="local-ai-section-action"
          type="button"
          aria-label="Add agent"
          title="Add agent"
          disabled={agents.agents.length >= MAX_CHAT_AGENTS}
          onClick={() => {
            setError('')
            setAgentDraft({ id: '', name: '', instructions: '' })
          }}
        >
          <Plus size={13} />
        </button>
      </div>
      {agentDraft && (
        <form className="local-ai-agent-form" aria-label={agentDraft.id ? 'Edit agent' : 'New agent'} onSubmit={(event) => void saveAgentDraft(event)}>
          <input
            aria-label="Agent name"
            placeholder="Name"
            value={agentDraft.name}
            maxLength={MAX_AGENT_NAME_LENGTH}
            autoFocus
            onChange={(event) => setAgentDraft({ ...agentDraft, name: event.currentTarget.value })}
          />
          <textarea
            aria-label="Agent instructions"
            placeholder="Instructions"
            value={agentDraft.instructions}
            maxLength={MAX_AGENT_INSTRUCTIONS_LENGTH}
            rows={4}
            onChange={(event) => setAgentDraft({ ...agentDraft, instructions: event.currentTarget.value })}
          />
          <div className="local-ai-form-actions">
            <button type="button" onClick={() => setAgentDraft(null)}>Cancel</button>
            <button type="submit" disabled={agentDraft.name.trim() === '' || agentDraft.instructions.trim() === ''}>Save agent</button>
          </div>
        </form>
      )}
      <ul className="local-ai-list" aria-label="Agents">
        {agents.agents.map((agent) => {
          const confirmingDelete = confirming === `agent:${agent.id}`
          return (
            <li key={agent.id} className="local-ai-row">
              <button className="local-ai-row-main" type="button" title={`Start a chat with ${agent.name}`} onClick={() => onNewChat(agent.id)}>
                <Bot size={14} />
                <span className="local-ai-row-title">{agent.name}</span>
              </button>
              <div className="local-ai-row-actions">
                <button type="button" aria-label={`Edit agent ${agent.name}`} title="Edit agent" onClick={() => {
                  setError('')
                  setAgentDraft({ id: agent.id, name: agent.name, instructions: agent.instructions })
                }}>
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className={confirmingDelete ? 'is-confirming' : undefined}
                  aria-label={confirmingDelete ? `Confirm delete agent ${agent.name}` : `Delete agent ${agent.name}`}
                  title={confirmingDelete ? 'Confirm delete' : 'Delete agent'}
                  onClick={() => void deleteAgent(agent)}
                >
                  {confirmingDelete ? <Check size={12} /> : <Trash2 size={12} />}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {agents.agents.length === 0 && !agentDraft && <p className="local-ai-empty-list">Add an agent to give chats a role.</p>}

      <div className="room-section-label">
        <span>CHATS</span>
      </div>
      <button className="local-ai-new-chat" type="button" onClick={() => onNewChat()}>
        <Plus size={14} />
        <span>New chat</span>
      </button>
      <label className="local-ai-search">
        <Search size={14} />
        <input
          type="search"
          aria-label="Search local AI chats"
          placeholder="Search chats"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      {chatsError && <p className="local-ai-sidebar-error" role="alert">{chatsError}</p>}
      {groups.map((group) => (
        <section key={group.label} className="local-ai-group" aria-label={group.label}>
          <h3>{group.label}</h3>
          <ul className="local-ai-list">
            {group.chats.map((chat) => renderChatRow(chat))}
          </ul>
        </section>
      ))}
      {!chatsError && groups.length === 0 && <p className="local-ai-empty-list">{normalizedQuery ? 'No chats match.' : 'No chats yet.'}</p>}
    </div>
  )
}
