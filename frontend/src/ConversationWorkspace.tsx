import LocalAIChat from './LocalAIChat'
import type { AppState } from './appState'
import { ConversationMessages } from './ConversationMessages'
import { ConversationComposer } from './ConversationComposer'

export function ConversationWorkspace({ app }: { app: AppState }) {
  const { createLocalAIAgent, localAIActiveChat, localAIAgentId, localAIAgents, localAIChatId, localAIChatList, localAIChatOpen, localAIInitialDraft, localAINewChatKind, setLocalAIChatId, setLocalAINewChatAgentId } = app
  return (
    <div className="conversation-workspace">
      <LocalAIChat
        hidden={!localAIChatOpen}
        chatId={localAIChatId}
        chatTitle={localAIActiveChat?.title ?? ''}
        agentId={localAIAgentId}
        agents={localAIAgents.agents}
        initialDraft={localAIInitialDraft.content}
        initialDraftVersion={localAIInitialDraft.version}
        onAgentChange={setLocalAINewChatAgentId}
        onCreateAgent={createLocalAIAgent}
        onChatCreated={(chat) => {
          setLocalAIChatId(chat.id)
          setLocalAINewChatAgentId(chat.agentId)
          localAIChatList.reload()
        }}
        onChatsChanged={localAIChatList.reload}
        newChatKind={localAINewChatKind}
        continueInstructions={app.aiInstructions('continue_conversation')}
      />
      {localAIChatOpen ? null : <>
        <div className="conversation-thread">
          <ConversationMessages app={app} />
          <ConversationComposer app={app} />
        </div>
      </>}
    </div>
  )
}
