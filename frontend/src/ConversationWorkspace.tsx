import { memo } from 'react'
import LocalAIChat from './LocalAIChat'
import { useSessionRooms } from './AppDomainContexts'
import { ConversationMessages } from './ConversationMessages'
import { ConversationComposer } from './ConversationComposer'
import { onlineAIEndpointOf, textAIProviderOf } from './aiSettings'

export const ConversationWorkspace = memo(function ConversationWorkspace() {
  const { aiInstructions, createLocalAIAgent, localAIActiveChat, localAIAgentId, localAIAgents, localAIChatId, localAIChatList, localAIChatOpen, localAIInitialDraft, localAINewChatKind, preferences, setLocalAIChatId, setLocalAINewChatAgentId } = useSessionRooms()
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
        continueInstructions={aiInstructions('continue_conversation')}
        onlineEndpoint={textAIProviderOf(preferences) === 'online' ? onlineAIEndpointOf(preferences) : undefined}
      />
      {localAIChatOpen ? null : <>
        <div className="conversation-thread">
          <ConversationMessages />
          <ConversationComposer />
        </div>
      </>}
    </div>
  )
})
