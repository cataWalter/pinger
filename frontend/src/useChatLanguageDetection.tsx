import { useEffect, useRef } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Room } from '../bindings/mychat/desktop/models.js'
import { chatLanguageChange, detectedChatLanguageKey, resolveLanguageRoles, roomLearningLanguageKey } from './aiLanguages'
import { preferenceBoolean, preferenceString } from './appShared'
import { useWorkspaceEffects } from './useWorkspaceEffects'

export const CHAT_LANGUAGE_DETECTION_PREFERENCE = 'ai.detect_chat_language'

// useChatLanguageDetection sets the learning language of each unarchived chat from its latest messages, one chat at a
// time in the background. It needs the setting on and an AI endpoint, and it leaves archived chats alone.
export function useChatLanguageDetection(app: ReturnType<typeof useWorkspaceEffects>) {
  const { activeAccountID, archivedPreferenceKey, newAIRequestID, preferences, preferencesRef, rooms, roomsRef, setPreferences } = app
  const accountIDRef = useRef(activeAccountID)
  accountIDRef.current = activeAccountID
  const detectingRef = useRef(false)
  const checkedEventsRef = useRef(new Map<string, string>())
  const enabled = preferenceBoolean(preferences, CHAT_LANGUAGE_DETECTION_PREFERENCE) && preferenceString(preferences, 'ai.endpoint', '').trim() !== ''

  function detectionActive() {
    const current = preferencesRef.current
    return preferenceBoolean(current, CHAT_LANGUAGE_DETECTION_PREFERENCE) && preferenceString(current, 'ai.endpoint', '').trim() !== ''
  }

  function isArchived(room: Room) {
    return preferenceBoolean(preferencesRef.current, archivedPreferenceKey(room.id, room.accountId))
  }

  // A chat needs detection when it is unarchived and has a newer latest event than the one last checked this session.
  function needsDetection(room: Room, accountID: string) {
    if (!room.id || !room.lastEventId || isArchived(room)) return false
    return checkedEventsRef.current.get(`${accountID}:${room.id}`) !== room.lastEventId
  }

  async function detectChat(room: Room, accountID: string) {
    let detected: string
    try {
      detected = await AppService.AIDetectChatLanguage(room.id, newAIRequestID())
    } catch {
      // Background detection stays quiet. The chat is retried when its latest event changes.
      return
    }
    // Read the preferences after the await, so a choice the user made meanwhile is respected.
    if (!detected || accountIDRef.current !== accountID || isArchived(room) || !detectionActive()) return
    const current = preferencesRef.current
    const change = chatLanguageChange({
      current: preferenceString(current, roomLearningLanguageKey(room.id), ''),
      detectedBefore: preferenceString(current, detectedChatLanguageKey(room.id), ''),
      detected,
      defaultLanguage: resolveLanguageRoles(current).defaultLanguage,
    })
    if (!change) return
    await setPreferences({ [roomLearningLanguageKey(room.id)]: change.learning, [detectedChatLanguageKey(room.id)]: change.detected })
  }

  async function detectPendingChats() {
    if (detectingRef.current) return
    detectingRef.current = true
    try {
      for (;;) {
        const accountID = accountIDRef.current
        if (!detectionActive()) return
        const room = roomsRef.current.find((candidate) => needsDetection(candidate, accountID))
        if (!room) return
        checkedEventsRef.current.set(`${accountID}:${room.id}`, room.lastEventId)
        await detectChat(room, accountID)
      }
    } finally {
      detectingRef.current = false
    }
  }

  const detectPendingChatsRef = useRef(detectPendingChats)
  detectPendingChatsRef.current = detectPendingChats

  useEffect(() => {
    if (!enabled) return
    void detectPendingChatsRef.current()
  }, [enabled, rooms, activeAccountID])

  return { ...app }
}
