import { useState, type FormEvent, type RefObject } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { MAX_CHAT_AGENTS, chatAgentDraftError, newChatAgentID, type ChatAgentProfile } from './aiPrompts'
import { localAIErrorMessage } from './localAIChats'
import type { LocalAIAgentDraft, LocalAIChatProps } from './localAIChatTypes'

type LocalAIAgentsOptions = {
  agents: ChatAgentProfile[]
  chatIdRef: RefObject<string | null>
  onAgentChange: LocalAIChatProps['onAgentChange']
  onCreateAgent: LocalAIChatProps['onCreateAgent']
  onChatsChanged: () => void
  setComposerError: (message: string) => void
}

// Owns the new-agent form and the per-chat agent picker.
export function useLocalAIAgents({ agents, chatIdRef, onAgentChange, onCreateAgent, onChatsChanged, setComposerError }: LocalAIAgentsOptions) {
  const [agentDraft, setAgentDraft] = useState<LocalAIAgentDraft | null>(null)
  const [agentError, setAgentError] = useState('')
  const [savingAgent, setSavingAgent] = useState(false)

  function toggleAgentForm() {
    setAgentError('')
    setAgentDraft(agentDraft ? null : { name: '', instructions: '' })
  }

  function closeAgentForm() {
    setAgentDraft(null)
  }

  async function changeAgent(nextAgentID: string) {
    onAgentChange(nextAgentID)
    const currentChatID = chatIdRef.current
    if (!currentChatID) return
    try {
      await AppService.SetLocalAIChatAgent(currentChatID, nextAgentID)
      onChatsChanged()
    } catch (changeError) {
      setComposerError(localAIErrorMessage(changeError, 'The agent could not be changed.'))
    }
  }

  async function saveNewAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!agentDraft || savingAgent) return
    const name = agentDraft.name.trim()
    const instructions = agentDraft.instructions.trim()
    const problem = chatAgentDraftError(name, instructions)
    if (problem) {
      setAgentError(problem)
      return
    }
    if (agents.length >= MAX_CHAT_AGENTS) {
      setAgentError(`Keep up to ${MAX_CHAT_AGENTS} agents.`)
      return
    }
    const agent: ChatAgentProfile = { id: newChatAgentID(), name, instructions }
    setAgentError('')
    setSavingAgent(true)
    try {
      if (!(await onCreateAgent(agent))) {
        setAgentError('The agent could not be saved.')
        return
      }
      setAgentDraft(null)
      await changeAgent(agent.id)
    } catch (createError) {
      setAgentError(localAIErrorMessage(createError, 'The agent could not be saved.'))
    } finally {
      setSavingAgent(false)
    }
  }

  return { agentDraft, setAgentDraft, agentError, savingAgent, toggleAgentForm, closeAgentForm, saveNewAgent, changeAgent }
}
