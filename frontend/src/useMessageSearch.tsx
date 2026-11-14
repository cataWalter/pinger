/* eslint-disable react-hooks/exhaustive-deps -- deps mirror the original component closure; setters and refs come from other hooks */
import { useEffect, type FormEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type MessageSearchRequest } from '../bindings/mychat/desktop/models.js'
import { MAX_AGENT_COLLECTION_LENGTH, serializeChatAgents, type ChatAgentProfile } from './aiPrompts'
import { runWithViewTransition } from './viewTransition'
import { newestPersistentMessage, firstUnreadMessageID, describeError } from './appShared'
import type { useMediaGalleryState } from './useMediaGalleryState'

export function useMessageSearch(app: ReturnType<typeof useMediaGalleryState>) {
  const { activeAccountID, activeUnreadMarker, currentUserIDRef, historyRoomIDRef, lastReadEventByRoom, loadingHistory, localAIAgents, messageSearch, messages, roomSelectionAnchorRef, searchFrom, searchNextBatch, searchResults, searchRoomID, searchSender, searchTo, searching, selectedRoom, selectedRoomID, setError, setHistoryPageRevision, setPreferenceRef, setSearchNextBatch, setSearchOpen, setSearchResults, setSearchStatus, setSearching, setSelectedRoomIDs, setSnapshot, setUnreadMarker, snapshot, timelineRef, unreadMarkerID, unreadMarkerSeen, unreadObserverRef, visibleMessages, workspaceGenerationRef } = app

  useEffect(() => {
    if (!selectedRoomID || loadingHistory || historyRoomIDRef.current !== selectedRoomID) return
    const generation = workspaceGenerationRef.current
    const eventID = selectedRoom?.lastEventId || newestPersistentMessage(messages)?.id
    if (!eventID || lastReadEventByRoom.current.get(selectedRoomID) === eventID) return
    lastReadEventByRoom.current.set(selectedRoomID, eventID)
    void AppService.MarkRead(selectedRoomID, eventID)
      .then(() => setSnapshot((current) => {
        if (!current || workspaceGenerationRef.current !== generation) return current
        const room = (current.rooms ?? []).find((candidate) => candidate.id === selectedRoomID)
        if (!room || (room.lastEventId && room.lastEventId !== eventID)) return current
        return {
          ...current,
          rooms: (current.rooms ?? []).map((candidate) => candidate.id === selectedRoomID
            ? { ...candidate, unread: 0, markedUnread: false, mentions: 0 }
            : candidate),
        }
      }))
      .catch((readError: unknown) => {
        if (workspaceGenerationRef.current !== generation) return
        if (lastReadEventByRoom.current.get(selectedRoomID) === eventID) lastReadEventByRoom.current.delete(selectedRoomID)
        setError(describeError(readError))
      })
  }, [activeAccountID, historyRoomIDRef, loadingHistory, messages, selectedRoom?.lastEventId, selectedRoom?.mentions, selectedRoom?.unread, selectedRoomID])

  useEffect(() => {
    if (!activeUnreadMarker || activeUnreadMarker.messageID) return
    if (loadingHistory || historyRoomIDRef.current !== selectedRoomID || visibleMessages.length === 0) return
    const messageID = firstUnreadMessageID(visibleMessages, activeUnreadMarker.count, currentUserIDRef.current)
    setUnreadMarker(messageID ? { ...activeUnreadMarker, messageID } : null)
  }, [activeUnreadMarker, historyRoomIDRef, loadingHistory, selectedRoomID, visibleMessages])

  // The jump pill shows only while the divider is out of view; seeing it once hides the pill for good.
  useEffect(() => {
    if (!unreadMarkerID || unreadMarkerSeen || typeof IntersectionObserver === 'undefined') return
    const update = (visible: boolean) => setUnreadMarker((current) => current?.messageID === unreadMarkerID
      ? { ...current, seen: current.seen || visible, offscreen: !visible }
      : current)
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1]
      if (latest) update(latest.isIntersecting)
    }, { root: timelineRef.current })
    unreadObserverRef.current = observer
    const divider = timelineRef.current?.querySelector('.unread-divider')
    if (divider) observer.observe(divider)
    else update(false)
    return () => {
      observer.disconnect()
      unreadObserverRef.current = null
    }
  }, [unreadMarkerID, unreadMarkerSeen])

  function messageSearchRequest(nextBatch = ''): MessageSearchRequest | null {
    const query = messageSearch.trim()
    if (!query) return null
    if (searchFrom && searchTo && searchFrom > searchTo) {
      setSearchStatus('The start date must be before the end date.')
      return null
    }
    const minTimestamp = searchFrom ? new Date(`${searchFrom}T00:00:00`).getTime() : 0
    const maxTimestamp = searchTo ? new Date(`${searchTo}T23:59:59.999`).getTime() : 0
    return {
      query,
      roomID: searchRoomID,
      sender: searchSender.trim(),
      minTimestamp,
      maxTimestamp,
      limit: 50,
      nextBatch,
    }
  }

  async function submitMessageSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const request = messageSearchRequest()
    if (!request || searching) return
    setSearching(true)
    setSearchStatus('')
    setSearchResults([])
    setSearchNextBatch('')
    try {
      const found = await AppService.SearchMessages(request)
      const results = found.results ?? []
      setSearchResults(results)
      setSearchNextBatch(found.nextBatch)
      setSearchStatus(results.length === 0 ? 'No matching messages in local history.' : `${results.length} results shown`)
    } catch (searchError) {
      setSearchResults([])
      setSearchStatus(describeError(searchError))
    } finally {
      setSearching(false)
    }
  }

  async function loadMoreSearchResults() {
    const request = messageSearchRequest(searchNextBatch)
    if (!request || !searchNextBatch || searching) return
    setSearching(true)
    setSearchStatus('')
    try {
      const page = await AppService.SearchMessages(request)
      const nextResults = page.results ?? []
      setSearchResults((current) => [...current, ...nextResults])
      setSearchNextBatch(page.nextBatch)
      setSearchStatus(`${searchResults.length + nextResults.length} results shown`)
    } catch (searchError) {
      setSearchStatus(describeError(searchError))
    } finally {
      setSearching(false)
    }
  }

  function closeMessageSearch() {
    setSearchOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Search messages"]')?.focus())
  }

  async function setPreference(key: string, value: boolean | string) {
    const previous = snapshot?.preferences?.[key]
    const roomPreference = /^room\.(favorite|muted)\.(.+)$/.exec(key)
    setSnapshot((current) => {
      if (!current) return current
      const rooms = roomPreference && typeof value === 'boolean'
        ? (current.rooms ?? []).map((room) => room.id === roomPreference[2] ? { ...room, [roomPreference[1]]: value } : room)
        : current.rooms
      return { ...current, preferences: { ...current.preferences, [key]: value }, rooms }
    })
    try {
      if (typeof value === 'boolean') {
        await AppService.SetBooleanPreference(key, value)
      } else {
        await AppService.SetStringPreference(key, value)
      }
      if (key === 'history.initial_messages') setHistoryPageRevision((revision) => revision + 1)
      return true
    } catch (preferenceError) {
      setSnapshot((current) => {
        if (!current) return current
        const nextPreferences = { ...current.preferences }
        if (previous === undefined) delete nextPreferences[key]
        else nextPreferences[key] = previous
        const rooms = roomPreference && (previous === undefined || typeof previous === 'boolean')
          ? (current.rooms ?? []).map((room) => room.id === roomPreference[2] ? { ...room, [roomPreference[1]]: previous === true } : room)
          : current.rooms
        return { ...current, preferences: nextPreferences, rooms }
      })
      setError(describeError(preferenceError))
      return false
    }
  }

  // Saves a chat agent to the shared list. The size check matters: an oversized list is dropped on read.
  async function createLocalAIAgent(agent: ChatAgentProfile) {
    const serialized = serializeChatAgents({ ...localAIAgents, agents: [...localAIAgents.agents, agent] })
    if (new TextEncoder().encode(serialized).byteLength > MAX_AGENT_COLLECTION_LENGTH) return false
    return setPreference('ai.local_agents', serialized)
  }

  // setPreferences saves several preferences in one backend transaction and restores them all if the save fails.
  async function setPreferences(entries: Record<string, string>) {
    const keys = Object.keys(entries)
    if (keys.length === 0) return true
    const previous = Object.fromEntries(keys.map((key) => [key, snapshot?.preferences?.[key]]))
    setSnapshot((current) => {
      if (!current) return current
      return { ...current, preferences: { ...current.preferences, ...entries } }
    })
    try {
      await AppService.SetStringPreferences(entries)
      return true
    } catch (preferenceError) {
      setSnapshot((current) => {
        if (!current) return current
        const nextPreferences = { ...current.preferences }
        for (const key of keys) {
          if (previous[key] === undefined) delete nextPreferences[key]
          else nextPreferences[key] = previous[key]
        }
        return { ...current, preferences: nextPreferences }
      })
      setError(describeError(preferenceError))
      return false
    }
  }

  setPreferenceRef.current = setPreference

  // Theme and accent changes cross-fade through a View Transition. Other preferences update immediately.
  function setPreferenceWithTransition(key: string, value: boolean | string) {
    if (key !== 'appearance.theme' && key !== 'appearance.accent_color') return setPreference(key, value)
    let saved: Promise<boolean> = Promise.resolve(false)
    runWithViewTransition(() => {
      saved = setPreference(key, value)
    })
    return saved
  }

  function clearRoomSelection() {
    setSelectedRoomIDs([])
    roomSelectionAnchorRef.current = ''
  }
  return { ...app, createLocalAIAgent, messageSearchRequest, submitMessageSearch, loadMoreSearchResults, closeMessageSearch, setPreference, setPreferences, setPreferenceWithTransition, clearRoomSelection }
}
