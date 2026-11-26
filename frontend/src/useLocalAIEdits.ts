import type { Dispatch, SetStateAction } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import type { LocalAIChatMessage } from '../bindings/mychat/desktop/models.js'
import { LOCAL_AI_MESSAGE_CHARACTERS, localAIErrorMessage, localAIMessageLength, newLocalAIMessage } from './localAIChats'
import type { LocalAIEdit } from './localAIChatTypes'

type LocalAIEditsOptions = {
  messages: LocalAIChatMessage[]
  setMessages: Dispatch<SetStateAction<LocalAIChatMessage[]>>
  edit: LocalAIEdit | null
  setEdit: Dispatch<SetStateAction<LocalAIEdit | null>>
  chatIdRef: { current: string | null }
  busy: boolean
  agentId: string
  shouldFollowRef: { current: boolean }
  setComposerError: (message: string) => void
  setSubmitting: (submitting: boolean) => void
  onChatsChanged: () => void
  runModel: (runChatID: string, history: LocalAIChatMessage[], runAgentID: string) => Promise<void>
  confirmRun: () => Promise<boolean>
}

// Edits a sent message and regenerates a reply. Both remove the messages after the target before the model runs again.
export function useLocalAIEdits({
  messages,
  setMessages,
  edit,
  setEdit,
  chatIdRef,
  busy,
  agentId,
  shouldFollowRef,
  setComposerError,
  setSubmitting,
  onChatsChanged,
  runModel,
  confirmRun,
}: LocalAIEditsOptions) {
  async function regenerate(message: LocalAIChatMessage) {
    const currentChatID = chatIdRef.current
    const index = messages.findIndex((item) => item.seq === message.seq)
    const history = index > 0 ? messages.slice(0, index) : []
    if (busy || !currentChatID || history[history.length - 1]?.role !== 'user') return
    if (!(await confirmRun())) return
    shouldFollowRef.current = true
    setComposerError('')
    setSubmitting(true)
    try {
      await AppService.TruncateLocalAIChat(currentChatID, message.seq)
      setMessages(history)
      onChatsChanged()
      void runModel(currentChatID, history, agentId)
    } catch (regenerateError) {
      setComposerError(localAIErrorMessage(regenerateError, 'The response could not be regenerated.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function saveEdit() {
    const currentChatID = chatIdRef.current
    const target = edit ? messages.find((item) => item.seq === edit.seq) : undefined
    if (busy || !edit || !target || !currentChatID) return
    const content = edit.content.trim()
    const pending = target.attachments ?? []
    if (content === '' && pending.length === 0) return
    if (localAIMessageLength(content, pending) > LOCAL_AI_MESSAGE_CHARACTERS) {
      setComposerError(`Keep each message and its attached text under ${LOCAL_AI_MESSAGE_CHARACTERS.toLocaleString()} characters.`)
      return
    }
    const history = messages.slice(0, messages.indexOf(target))
    if (!(await confirmRun())) return
    shouldFollowRef.current = true
    setEdit(null)
    setComposerError('')
    setSubmitting(true)
    try {
      await AppService.TruncateLocalAIChat(currentChatID, target.seq)
      setMessages(history)
      const userTurn = await AppService.AppendLocalAIChatMessage(currentChatID, newLocalAIMessage('user', content, 'complete', pending))
      const next = [...history, userTurn]
      setMessages(next)
      onChatsChanged()
      void runModel(currentChatID, next, agentId)
    } catch (editError) {
      setComposerError(localAIErrorMessage(editError, 'The edited message could not be sent.'))
    } finally {
      setSubmitting(false)
    }
  }

  return { regenerate, saveEdit }
}
