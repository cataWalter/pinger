import { AppService } from '../bindings/mychat/desktop'
import { type Message } from '../bindings/mychat/desktop/models.js'
import { hasOpenDialog } from './DialogSurface'
import { SETTINGS_TABS } from './settings'
import { buildSummaryChatDraft } from './aiPrompts'
import { localAIIncludeInAllPreference } from './localAIChats'
import { describeError, isTextEntryTarget, preferenceBoolean, mergeTimelineMessages } from './appShared'
import type { useWorkspaceEffects } from './useWorkspaceEffects'

export function useMenuActions(app: ReturnType<typeof useWorkspaceEffects>) {
  const { aiEnabled, aiInstructions, analyzeWithLanguageTutor, applyBulkRoomAction, applyMenuFilter, busy, composeDraftStore, editTarget, hasOlder, jumpToLatest, loadingOlderRef, localAIChatId, localAIChatOpen, markRoomAnswered, menuActionRef, menuRoom, menuRoomArchived, menuRoomFavorite, menuRoomNeedsReply, menuRoomUnread, messages, olderCursor, preferences, promptMessages, roomSearchInputRef, roomsRef, selectRoomByOffset, selectedRoomID, selectedRoomRef, setError, setLoadingOlder, setPreference, setQuickSwitcherIndex, setQuickSwitcherOpen, setQuickSwitcherQuery, setSettingsOpen, setSettingsTab, setSummaryStatus, startLocalAIChat, summaryLoadingRef, undoAnswered, undoRoomID, workspaceGenerationRef } = app

  function runMenuAction(action: string) {
    if (hasOpenDialog()) return
    if (action.startsWith('settings:')) {
      const tab = SETTINGS_TABS.find((candidate) => candidate === action.slice('settings:'.length))
      if (tab) setSettingsTab(tab)
      setSettingsOpen(true)
      return
    }
    if (action.startsWith('filter:')) {
      applyMenuFilter(action.slice('filter:'.length))
      return
    }
    switch (action) {
      case 'quick-switch':
        if (roomsRef.current.length > 0) {
          setQuickSwitcherQuery('')
          setQuickSwitcherIndex(0)
          setQuickSwitcherOpen(true)
        }
        return
      case 'room-search':
        roomSearchInputRef.current?.focus()
        return
      case 'jump-latest':
        jumpToLatest()
        return
      case 'private-chat-new':
        startLocalAIChat()
        return
      case 'private-chat-all': {
        if (localAIChatOpen && localAIChatId) {
          const preferenceKey = localAIIncludeInAllPreference(localAIChatId)
          void setPreference(preferenceKey, !preferenceBoolean(preferences, preferenceKey))
        }
        return
      }
      case 'tutor-draft': {
        const draft = composeDraftStore.getText()
        if (Boolean(selectedRoomRef.current) && draft.trim() !== '' && !busy && aiEnabled && !editTarget) {
          void analyzeWithLanguageTutor(draft, 'draft')
        }
        return
      }
      case 'undo':
        if (!isTextEntryTarget(document.activeElement) && undoRoomID) void undoAnswered()
        return
      case 'room-next':
        selectRoomByOffset(1)
        return
      case 'room-previous':
        selectRoomByOffset(-1)
        return
      case 'needs-reply-next':
        selectRoomByOffset(1, true)
        return
      case 'needs-reply-previous':
        selectRoomByOffset(-1, true)
        return
      case 'room-read':
        if (menuRoom) void applyBulkRoomAction(menuRoomUnread ? 'read' : 'unread', [menuRoom])
        return
      case 'room-answered':
        if (menuRoom && menuRoomNeedsReply) void markRoomAnswered(menuRoom.id)
        return
      case 'room-needs-reply':
        if (menuRoom && !menuRoomNeedsReply) void applyBulkRoomAction('needs-reply', [menuRoom])
        return
      case 'room-archive':
        if (menuRoom) void applyBulkRoomAction(menuRoomArchived ? 'restore' : 'archive', [menuRoom])
        return
      case 'room-favorite':
        if (menuRoom) void applyBulkRoomAction(menuRoomFavorite ? 'unfavorite' : 'favorite', [menuRoom])
        return
    }
  }
  menuActionRef.current = runMenuAction

  // Prepare a Local AI chat with the full room transcript and an editable summary request.
  async function summarizeRoom() {
    if (!selectedRoomID || !aiEnabled || summaryLoadingRef.current) return
    if (loadingOlderRef.current) {
      setError('Wait for older messages to finish loading.')
      return
    }
    const roomID = selectedRoomID
    const generation = workspaceGenerationRef.current
    let fetched: Message[] = []
    let cursor = olderCursor
    let moreHistory = hasOlder
    const loadedMessages = () => mergeTimelineMessages(messages, fetched)
    const pagingHistory = moreHistory
    summaryLoadingRef.current = true
    if (pagingHistory) {
      loadingOlderRef.current = true
      setLoadingOlder(true)
    }
    setSummaryStatus(pagingHistory ? 'Loading older messages…' : 'Preparing AI chat…')

    try {
      while (moreHistory) {
        if (selectedRoomRef.current !== roomID || workspaceGenerationRef.current !== generation) return
        const page = await AppService.History(roomID, cursor)
        if (selectedRoomRef.current !== roomID || workspaceGenerationRef.current !== generation) return
        if (page.before === cursor && page.hasMore) throw new Error('Could not continue loading the rest of this chat history.')
        fetched = mergeTimelineMessages(fetched, page.messages ?? [])
        cursor = page.before
        moreHistory = page.hasMore
        setSummaryStatus(`Loading older messages… (${loadedMessages().length.toLocaleString()} loaded)`)
      }

      if (selectedRoomRef.current !== roomID || workspaceGenerationRef.current !== generation) return
      const context = promptMessages(loadedMessages())
      if (!context.some((message) => message.body.trim() && !message.redacted)) {
        setError('There are no messages to summarize yet.')
        return
      }
      startLocalAIChat(buildSummaryChatDraft(context, aiInstructions('summarize')), 'summary')
    } catch (summaryError) {
      if (selectedRoomRef.current === roomID && workspaceGenerationRef.current === generation) setError(describeError(summaryError))
    } finally {
      if (workspaceGenerationRef.current === generation) {
        summaryLoadingRef.current = false
        setSummaryStatus('')
        if (pagingHistory) {
          loadingOlderRef.current = false
          setLoadingOlder(false)
        }
      }
    }
  }
  return { ...app, runMenuAction, summarizeRoom }
}
