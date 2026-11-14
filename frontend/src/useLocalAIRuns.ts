import type { Dispatch, RefObject, SetStateAction } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import type { LocalAIChatMessage } from '../bindings/mychat/desktop/models.js'
import type { ChatAgentProfile } from './aiPrompts'
import { buildLocalAIModelMessages, localAIErrorMessage, newLocalAIMessage } from './localAIChats'
import { createLocalAIRequestID } from './localAIChatUtils'
import type { LocalAIFailure, LocalAIImageRun, LocalAIRun } from './localAIChatTypes'

type LocalAIRunsOptions = {
  agents: ChatAgentProfile[]
  chatIdRef: RefObject<string | null>
  runRef: { current: LocalAIRun | null }
  imageRunRef: { current: LocalAIImageRun | null }
  shouldFollowRef: { current: boolean }
  setMessages: Dispatch<SetStateAction<LocalAIChatMessage[]>>
  setRunView: Dispatch<SetStateAction<LocalAIRun | null>>
  setImageRun: Dispatch<SetStateAction<LocalAIImageRun | null>>
  setFailure: Dispatch<SetStateAction<LocalAIFailure | null>>
  setShowJump: Dispatch<SetStateAction<boolean>>
  onChatsChanged: () => void
}

// Runs the model for one chat turn and handles stopping it. The run is saved only when it finishes or is stopped.
export function useLocalAIRuns({
  agents,
  chatIdRef,
  runRef,
  imageRunRef,
  shouldFollowRef,
  setMessages,
  setRunView,
  setImageRun,
  setFailure,
  setShowJump,
  onChatsChanged,
}: LocalAIRunsOptions) {
  async function saveAssistantTurn(chatID: string, content: string, status: string) {
    const saved = await AppService.AppendLocalAIChatMessage(chatID, newLocalAIMessage('assistant', content, status, []))
    if (chatIdRef.current === chatID) setMessages((current) => (current.some((item) => item.seq === saved.seq) ? current : [...current, saved]))
  }

  // Runs after each complete reply. The server replaces only a title that still comes from the first user turn.
  function generateTitle(titleChatID: string) {
    void AppService.GenerateLocalAIChatTitle(titleChatID).then(() => onChatsChanged()).catch(() => undefined)
  }

  async function runModel(runChatID: string, history: LocalAIChatMessage[], runAgentID: string) {
    const run: LocalAIRun = { chatId: runChatID, requestId: createLocalAIRequestID(), text: '', stopping: false }
    const agentInstructions = agents.find((agent) => agent.id === runAgentID)?.instructions ?? ''
    runRef.current = run
    shouldFollowRef.current = true
    setShowJump(false)
    setFailure(null)
    setRunView({ ...run })
    try {
      const reply = await AppService.LocalAIChat({ messages: buildLocalAIModelMessages(history), requestId: run.requestId, agentInstructions })
      if (!reply.trim()) throw new Error('The local model returned an empty reply.')
      await saveAssistantTurn(runChatID, reply, 'complete')
      generateTitle(runChatID)
    } catch (runError) {
      if (!run.stopping) {
        setFailure({ chatId: runChatID, message: localAIErrorMessage(runError, 'The local model could not complete this message.'), history, agentId: runAgentID })
      } else if (run.text.trim()) {
        await saveAssistantTurn(runChatID, run.text, 'stopped').catch((saveError: unknown) => {
          setFailure({ chatId: runChatID, message: localAIErrorMessage(saveError, 'The partial reply could not be saved.'), history, agentId: runAgentID })
        })
      } else {
        setFailure({ chatId: runChatID, message: 'Generation stopped before a reply arrived.', history, agentId: runAgentID })
      }
    } finally {
      if (runRef.current === run) runRef.current = null
      setRunView(null)
      onChatsChanged()
    }
  }

  function stopRun() {
    const run = runRef.current
    if (!run || run.stopping) return
    run.stopping = true
    setRunView({ ...run })
    void AppService.AICancel(run.requestId).catch(() => undefined)
  }

  function stopImage() {
    const run = imageRunRef.current
    if (!run || run.stopping) return
    run.stopping = true
    setImageRun({ ...run })
    void AppService.AICancel(run.requestId).catch(() => undefined)
  }

  return { runModel, stopRun, stopImage }
}
