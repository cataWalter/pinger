import type { LocalAIChatAttachment, LocalAIChatMessage, LocalAIChatSummary } from '../bindings/mychat/desktop/models.js'
import type { ChatAgentProfile } from './aiPrompts'
import type { LocalAIChatKind } from './localAIChats'

export type LocalAIChatStreamChunk = {
  requestId: string
  text: string
}

export type LocalAIRun = {
  chatId: string
  requestId: string
  text: string
  stopping: boolean
}

export type LocalAIImageRun = {
  chatId: string
  requestId: string
  stage: string
  step: number
  totalSteps: number
  preview: string
  stopping: boolean
}

export type LocalAIImageProgress = {
  requestId: string
  stage: string
  step: number
  totalSteps: number
  preview?: string
}

export type LocalAIFailure = {
  chatId: string
  message: string
  history: LocalAIChatMessage[]
  agentId: string
}

export type LocalAIEdit = {
  seq: number
  content: string
}

export type LocalAIAgentDraft = {
  name: string
  instructions: string
}

export type LocalAIComposerDraft = {
  draft: string
  attachments: LocalAIChatAttachment[]
}

export type LocalAIComposerSlot = {
  key: string
  initialDraft: string
  version: number
}

export type LocalAIComposerTicket = {
  key: string
  generation: number
}

export type LocalAIMessageActions = {
  startEdit: (message: LocalAIChatMessage) => void
  editChange: (content: string) => void
  cancelEdit: () => void
  saveEdit: () => void
  copy: (message: LocalAIChatMessage) => void
  regenerate: (message: LocalAIChatMessage) => void
}

export type LocalAIChatProps = {
  chatId: string | null
  chatTitle: string
  agentId: string
  agents: ChatAgentProfile[]
  hidden: boolean
  initialDraft?: string
  initialDraftVersion?: number
  onAgentChange: (agentId: string) => void
  onCreateAgent: (agent: ChatAgentProfile) => Promise<boolean>
  onChatCreated: (chat: LocalAIChatSummary) => void
  onChatsChanged: () => void
  newChatKind?: LocalAIChatKind
  continueInstructions?: string
}
