import { useCallback, useEffect, useMemo } from 'react'
import { Events } from '@wailsio/runtime'
import { type Room } from '../bindings/mychat/desktop/models.js'
import { DEFAULT_ACCENT_NAME, accentPaletteFor } from './accent'
import { SYSTEM_THEME_NAME, themeIdForPreference } from './themes'
import { isLocalAIRoomID, localAIChatIDFromRoomID, localAIChatToRoom, localAIFavoritePreference, localAIIncludeInAllPreference, localAIChatIcon, localAIRoomID } from './localAIChats'
import { type ChatExportProgressEvent, preferenceBoolean, preferenceString, isUnansweredRoom, isNeedsReplyRoom, compareRoomActivity, rankQuickSwitcherRooms } from './appShared'
import type { useTimelineHistory } from './useTimelineHistory'

export function useInboxState(app: ReturnType<typeof useTimelineHistory>) {
  const { activeAccountID, chatExport, editTarget, editTargetRef, imageSendRun, localAIChatId, localAIChatList, localAIChatOpen, localAIFolderFilter, mentionQuery, mentionStart, preferences, quickSwitcherQuery, replyTarget, roomContextMenu, roomMembers, roomRefinements, roomScope, roomSelectionAnchorRef, rooms, scheduledJobs, search, selectedRoom, selectedRoomID, selectedRoomIDs, setAudioInputDevices, setChatExport, setImageSendRun, setSelectedAudioInputDeviceId, setSelectedRoomIDs, setSystemPrefersDark, systemPrefersDark } = app
  // Progress is only listened to while an image from the composer is generating.
  const imageRunRequestID = imageSendRun?.requestID ?? ''
  useEffect(() => {
    if (!imageRunRequestID) return
    return Events.On('local-ai:image-progress', (event: { data: unknown }) => {
      const update = event.data as { requestId?: string; stage?: string; step?: number; totalSteps?: number } | undefined
      if (update?.requestId !== imageRunRequestID) return
      setImageSendRun((current) => current?.requestID === imageRunRequestID
        ? { ...current, stage: update.stage ?? current.stage, step: update.step ?? current.step, totalSteps: update.totalSteps ?? current.totalSteps }
        : current)
    })
  }, [imageRunRequestID, setImageSendRun])
  // Export progress is only listened to while a room export is running.
  const runningChatExportRoomID = chatExport?.phase === 'running' ? chatExport.roomID : ''
  const chatExportForSelectedRoom = chatExport && chatExport.roomID === selectedRoom?.id ? chatExport : null
  useEffect(() => {
    if (!runningChatExportRoomID) return
    return Events.On('chat-export:progress', (event: { data: unknown }) => {
      const update = event.data as ChatExportProgressEvent | undefined
      if (update?.roomId !== runningChatExportRoomID) return
      setChatExport((current) => current?.phase === 'running' && current.roomID === runningChatExportRoomID
        ? { ...current, stage: update.stage }
        : current)
    })
  }, [runningChatExportRoomID, setChatExport])

  const audioInputDevicePreference = preferenceString(preferences, 'audio.input_device', '')
  useEffect(() => {
    setSelectedAudioInputDeviceId(audioInputDevicePreference)
  }, [audioInputDevicePreference, setSelectedAudioInputDeviceId])

  useEffect(() => {
    let active = true
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.enumerateDevices) return

    const refreshAudioInputDevices = () => {
      void mediaDevices.enumerateDevices().then((devices) => {
        if (active) setAudioInputDevices(devices.filter((device) => device.kind === 'audioinput'))
      }).catch(() => { })
    }
    refreshAudioInputDevices()
    mediaDevices.addEventListener?.('devicechange', refreshAudioInputDevices)
    return () => {
      active = false
      mediaDevices.removeEventListener?.('devicechange', refreshAudioInputDevices)
    }
  }, [setAudioInputDevices])
  editTargetRef.current = editTarget
  const archivedPreferenceKey = useCallback((roomID: string, accountID = '') => `room.archived.${accountID || activeAccountID || 'primary'}.${roomID}`, [activeAccountID])
  const localAIRooms = useMemo(() => localAIChatList.chats.map((chat) => localAIChatToRoom(chat, preferenceBoolean(preferences, localAIFavoritePreference(chat.id)))), [localAIChatList.chats, preferences])
  // Private model chats belong to no Matrix account, so they join the All list only when included.
  const localAIRoomsForList = useMemo(() => roomScope === 'local-ai' ? localAIRooms : localAIRooms.filter((room) => {
    const chatID = localAIChatIDFromRoomID(room.id)
    return chatID !== null && preferenceBoolean(preferences, localAIIncludeInAllPreference(chatID))
  }), [localAIRooms, preferences, roomScope])
  const localAIIconByRoomID = useMemo(() => new Map(localAIChatList.chats.map((chat) => [localAIRoomID(chat.id), localAIChatIcon(chat)] as const)), [localAIChatList.chats])
  const localAIFolderIDByRoomID = useMemo(() => new Map(localAIChatList.chats.map((chat) => [localAIRoomID(chat.id), chat.folderId] as const)), [localAIChatList.chats])
  const localAIActiveFolder = localAIFolderFilter ? localAIChatList.folders.find((folder) => folder.id === localAIFolderFilter) ?? null : null
  const listRooms = useMemo(() => [...rooms, ...localAIRoomsForList], [rooms, localAIRoomsForList])
  const filteredRooms = useMemo(() => {
    const query = search.trim().toLowerCase()
    const today = Date.now()
    const pinFavorites = preferenceString(preferences, 'sidebar.pinned_style', 'Top of list') === 'Top of list'
    return listRooms.filter((room) => {
      const matchesQuery = !query || `${room.name} ${room.id} ${room.preview}`.toLowerCase().includes(query)
      const localAI = isLocalAIRoomID(room.id)
      const archived = !localAI && preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId))
      const matchesArchive = roomScope === 'local-ai' ? localAI : roomScope === 'archived' ? archived : !archived || Boolean(query)
      const matchesRefinements = (!roomRefinements.unanswered || (!localAI && isUnansweredRoom(room)))
        && (!roomRefinements.needsReply || isNeedsReplyRoom(room))
        && (!roomRefinements.favorite || room.favorite)
      const matchesFolder = roomScope !== 'local-ai' || localAIFolderFilter === null || (localAIFolderIDByRoomID.get(room.id) ?? '') === localAIFolderFilter
      return matchesQuery && matchesArchive && matchesRefinements && matchesFolder
    }).sort((left, right) => {
      const favoriteOrder = pinFavorites
        ? Number(right.favorite) - Number(left.favorite)
        : 0
      return favoriteOrder || compareRoomActivity(left, right, today)
    })
  }, [listRooms, search, preferences, roomScope, roomRefinements, localAIFolderFilter, localAIFolderIDByRoomID, archivedPreferenceKey])
  // The open private chat takes the highlight, because the Matrix selection is cleared while it is open.
  const activeListRoomID = localAIChatOpen ? (localAIChatId ? localAIRoomID(localAIChatId) : '') : selectedRoomID
  const quickSwitcherRooms = useMemo(() => rankQuickSwitcherRooms(rooms, quickSwitcherQuery), [rooms, quickSwitcherQuery])
  const needsReplyCount = useMemo(() => rooms.filter((room) => isNeedsReplyRoom(room) && !preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId))).length, [rooms, preferences, archivedPreferenceKey])
  const contextMenuRooms = roomContextMenu
    ? (selectedRoomIDs.includes(roomContextMenu.roomID) ? selectedRoomIDs : [roomContextMenu.roomID])
      .map((roomID) => rooms.find((room) => room.id === roomID))
      .filter((room): room is Room => Boolean(room))
    : []
  const contextMenuNeedsReplyAddRooms = contextMenuRooms.filter((room) => isUnansweredRoom(room) && !isNeedsReplyRoom(room))
  const contextMenuNeedsReplyAddCount = contextMenuNeedsReplyAddRooms.length
  const contextMenuIsBulk = contextMenuRooms.length > 1
  const contextMenuHasUnread = contextMenuRooms.some((room) => room.unread > 0 || room.markedUnread)
  const contextMenuNeedsArchive = contextMenuRooms.some((room) => !preferenceBoolean(preferences, archivedPreferenceKey(room.id, room.accountId)))
  const contextMenuNeedsFavorite = contextMenuRooms.some((room) => !room.favorite)
  const contextMenuNeedsMute = contextMenuRooms.some((room) => !room.muted)
  const contextMenuChatID = roomContextMenu ? localAIChatIDFromRoomID(roomContextMenu.roomID) : null
  const contextMenuLocalAIRoom = contextMenuChatID === null ? null : localAIRooms.find((room) => room.id === roomContextMenu?.roomID) ?? null
  const contextMenuLocalAIInAll = contextMenuChatID !== null && preferenceBoolean(preferences, localAIIncludeInAllPreference(contextMenuChatID))
  const contextMenuLocalAIFolderID = contextMenuChatID === null ? '' : localAIChatList.chats.find((chat) => chat.id === contextMenuChatID)?.folderId ?? ''
  const scheduledJobCount = scheduledJobs.length

  useEffect(() => {
    setSelectedRoomIDs([])
    roomSelectionAnchorRef.current = ''
  }, [roomScope, roomRefinements.unanswered, roomRefinements.needsReply, roomRefinements.favorite, search, roomSelectionAnchorRef, setSelectedRoomIDs])
  const mentionOptions = mentionStart < 0 ? [] : roomMembers.filter((member) => {
    const query = mentionQuery.toLowerCase()
    return `${member.displayName} ${member.id}`.toLowerCase().includes(query)
  }).slice(0, 8)
  const themePreference = preferenceString(preferences, 'appearance.theme', SYSTEM_THEME_NAME)
  const themeChoice = themeIdForPreference(themePreference, systemPrefersDark)
  const accentPalette = accentPaletteFor(preferenceString(preferences, 'appearance.accent_color', DEFAULT_ACCENT_NAME))
  const bubbleColor = preferenceString(preferences, 'appearance.bubble_color', accentPalette.base)
  const safeBubbleColor = /^#[0-9a-fA-F]{6}$/.test(bubbleColor) ? bubbleColor : accentPalette.base
  const composerContextMessage = editTarget ?? replyTarget

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    setSystemPrefersDark(mediaQuery.matches)
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [setSystemPrefersDark])

  function defaultScheduleDelayMinutes(key: string, fallback: number) {
    const minutes = Number(preferenceString(preferences, key, String(fallback)))
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 10080 ? minutes : fallback
  }
  return { ...app, imageRunRequestID, runningChatExportRoomID, chatExportForSelectedRoom, audioInputDevicePreference, archivedPreferenceKey, localAIRooms, localAIRoomsForList, localAIIconByRoomID, localAIFolderIDByRoomID, localAIActiveFolder, listRooms, filteredRooms, activeListRoomID, quickSwitcherRooms, needsReplyCount, contextMenuRooms, contextMenuNeedsReplyAddRooms, contextMenuNeedsReplyAddCount, contextMenuIsBulk, contextMenuHasUnread, contextMenuNeedsArchive, contextMenuNeedsFavorite, contextMenuNeedsMute, contextMenuChatID, contextMenuLocalAIRoom, contextMenuLocalAIInAll, contextMenuLocalAIFolderID, scheduledJobCount, mentionOptions, themePreference, themeChoice, accentPalette, bubbleColor, safeBubbleColor, composerContextMessage, defaultScheduleDelayMinutes }
}
