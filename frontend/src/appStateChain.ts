// Hook stages for the app shell. Each stage takes the previous stage's state and returns its merged result.
// Hooks run in a fixed order on every render, so do not reorder calls within or between stages.
import { useAccountWorkspace } from './useAccountWorkspace'
import { useAIRequests } from './useAIRequests'
import { useApplicationKeys } from './useApplicationKeys'
import { useAuthFormState } from './useAuthFormState'
import { useChatLanguageDetection } from './useChatLanguageDetection'
import { useComposerActions } from './useComposerActions'
import { useComposerKeys } from './useComposerKeys'
import { useComposerSnippets } from './useComposerSnippets'
import { useImproveDraft } from './useImproveDraft'
import { useInboxState } from './useInboxState'
import { useLocalAIChats } from './useLocalAIChats'
import { useMediaGalleryState } from './useMediaGalleryState'
import { useMenuActions } from './useMenuActions'
import { useMessageAIActions } from './useMessageAIActions'
import { useMessageDispatch } from './useMessageDispatch'
import { useMessageReactions } from './useMessageReactions'
import { useMessageSearch } from './useMessageSearch'
import { useNotificationDelivery } from './useNotificationDelivery'
import { useRoomActions } from './useRoomActions'
import { useRoomChatExport } from './useRoomChatExport'
import { useSessionActions } from './useSessionActions'
import { useShellState } from './useShellState'
import { useTimelineHistory } from './useTimelineHistory'
import { useTimelineScroll } from './useTimelineScroll'
import { useVolatileAIDraftState } from './volatileAIDrafts'
import { useWorkspaceEffects } from './useWorkspaceEffects'

// Shell, auth form, timeline, inbox, media, search, and local AI chat state.
export function useAppBaseState() {
  const draftState = useVolatileAIDraftState(useShellState())
  const authState = useAuthFormState(draftState)
  const historyState = useTimelineHistory(authState)
  const inboxState = useInboxState(historyState)
  const scrollState = useTimelineScroll(inboxState)
  const galleryState = useMediaGalleryState(scrollState)
  const searchState = useMessageSearch(galleryState)
  return useLocalAIChats(searchState)
}

// Room, session, message dispatch, composer, reaction, and AI request actions.
export function useRoomAndMessageState(input: ReturnType<typeof useAppBaseState>) {
  const roomState = useRoomActions(input)
  const sessionState = useSessionActions(roomState)
  const dispatchState = useMessageDispatch(sessionState)
  const composerState = useComposerActions(dispatchState)
  const reactionState = useMessageReactions(composerState)
  return useAIRequests(reactionState)
}

// Account workspace, notifications, workspace effects, and chat language detection.
export function useWorkspaceState(input: ReturnType<typeof useRoomAndMessageState>) {
  const accountState = useAccountWorkspace(input)
  const notificationState = useNotificationDelivery(accountState)
  const effectsState = useWorkspaceEffects(notificationState)
  return useChatLanguageDetection(effectsState)
}

// Menu, message AI, composer snippet, draft improvement, and chat export actions.
export function useComposerCommandState(input: ReturnType<typeof useWorkspaceState>) {
  const menuState = useMenuActions(input)
  const messageAIState = useMessageAIActions(menuState)
  const snippetState = useComposerSnippets(messageAIState)
  const improveState = useImproveDraft(snippetState)
  return useRoomChatExport(improveState)
}

// Application-wide and composer keyboard shortcuts.
export function useKeyboardState(input: ReturnType<typeof useComposerCommandState>) {
  const applicationKeyState = useApplicationKeys(input)
  return useComposerKeys(applicationKeyState)
}

// Runs every stage in order and returns the state the app shell renders from.
export function useAppStateChain() {
  const baseState = useAppBaseState()
  const roomState = useRoomAndMessageState(baseState)
  const workspaceState = useWorkspaceState(roomState)
  const commandState = useComposerCommandState(workspaceState)
  return useKeyboardState(commandState)
}
