import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { sameInviteList } from './RoomMembership'
import { AppService } from '../bindings/mychat/desktop'
import { type ScheduledJob, type Snapshot } from '../bindings/mychat/desktop/models.js'
import { type MatrixUpdate, newestPersistentMessage, describeError, preferenceBoolean, preferenceString, preferenceNumber, reconcileRoomSnapshots, playNotificationSound } from './appShared'
import type { useNotificationDelivery } from './useNotificationDelivery'
import { sameVerificationState, base64ToBytes } from './appHelpers'

export function useWorkspaceEffects(app: ReturnType<typeof useNotificationDelivery>) {
  const { historyRoomIDRef, matrixUpdateHandlerRef, matrixUpdateHandlersRef, menuActionRef, messagesRef, nativeNotificationsRef, preferencesRef, refreshScheduledJobs, roomsRef, selectedRoomRef, setError, setHistoryRevision, setOtherAccountRooms, setPreferenceRef, setScheduledJobsError, setScheduledJobsOpen, setSearchOpen, setSelectedRoomID, setSettingsOpen, setSettingsTab, setSnapshot, setTypingUsers, showScheduledNotice, stageDroppedFilesRef } = app

  useEffect(() => {
    let active = true
    const applyMatrixUpdate = (update: MatrixUpdate) => {
      if (!active) return
      const soundPreferences = update.notificationPreferences ?? preferencesRef.current
      if (document.hasFocus()
        && preferenceString(soundPreferences, 'sounds.effects', 'Off') === 'Incoming and sent messages'
        && update.newIncomingMessage) {
        playNotificationSound(preferenceNumber(soundPreferences, 'notifications.volume', 50), 'Chime')
      }
      matrixUpdateHandlersRef.current.deliverMatrixNotifications(update)
      if (update.accountId && update.accountId !== matrixUpdateHandlersRef.current.activeAccountID) {
        setOtherAccountRooms((current) => [...current.filter((room) => room.accountId !== update.accountId), ...(update.rooms ?? [])])
        return
      }
      const previousRooms = roomsRef.current
      const nextTypingUsers = update.typingUsers?.[selectedRoomRef.current] ?? []
      setSnapshot((current) => {
        if (!current) return current
        const rooms = reconcileRoomSnapshots(current.rooms, update.rooms ?? [])
        const currentInvites = current.invites ?? []
        const invites = update.invites === undefined || sameInviteList(currentInvites, update.invites ?? []) ? current.invites : update.invites ?? []
        const slidingSyncListCounts = update.slidingSyncListCounts ?? current.slidingSyncListCounts
        const currentListCounts = current.slidingSyncListCounts ?? {}
        const nextListCounts = slidingSyncListCounts ?? {}
        const listCountsChanged = Object.keys(currentListCounts).length !== Object.keys(nextListCounts).length
          || Object.entries(nextListCounts).some(([listKey, count]) => currentListCounts[listKey] !== count)
        const syncReady = current.syncReady || update.initialSyncComplete
        const needsVerification = update.needsVerification
        const verification = update.verification === undefined || sameVerificationState(current.verification, update.verification)
          ? current.verification
          : update.verification
        const connectionState = update.connectionState || current.connectionState
        const profile = current.profile.verified === !needsVerification
          ? current.profile
          : { ...current.profile, verified: !needsVerification }
        if (
          rooms === current.rooms
          && invites === current.invites
          && !listCountsChanged
          && syncReady === current.syncReady
          && needsVerification === current.needsVerification
          && verification === current.verification
          && profile === current.profile
          && connectionState === current.connectionState
        ) return current
        return { ...current, rooms, invites, slidingSyncListCounts, syncReady, needsVerification, verification, profile, connectionState }
      })
      setTypingUsers((current) => current.length === nextTypingUsers.length && current.every((user, index) => user === nextTypingUsers[index])
        ? current
        : nextTypingUsers)
      for (const roomID of update.timelineChangedRoomId ?? []) {
        const updatedRoom = (update.rooms ?? []).find((room) => room.id === roomID)
        const previousRoom = previousRooms.find((room) => room.id === roomID)
        if (!updatedRoom?.lastEventId || !previousRoom || updatedRoom.lastEventId === previousRoom.lastEventId) continue
        const key = matrixUpdateHandlersRef.current.archivedPreferenceKey(roomID, updatedRoom.accountId)
        if (preferenceBoolean(preferencesRef.current, key)) void setPreferenceRef.current(key, false)
      }
      // Background sync errors are not shown as banners.
      // Belt-and-braces: if the selected room's sidebar preview moved past the
      // loaded timeline (e.g. a coalesced/dropped timeline signal), force a
      // history refresh so left room list and right message pane stay in sync.
      const selectedID = selectedRoomRef.current
      const timelineTouched = (update.timelineChangedRoomId ?? []).includes(selectedID)
      if (timelineTouched) {
        setHistoryRevision((revision) => revision + 1)
      } else if (selectedID) {
        const selected = (update.rooms ?? []).find((room) => room.id === selectedID)
        const newestLoaded = newestPersistentMessage(messagesRef.current)
        if (selected && newestLoaded && selected.lastEventId && selected.lastEventId !== newestLoaded.id) {
          const newestTimestamp = newestLoaded.timestamp ?? 0
          if (selected.lastSeen > newestTimestamp || (selected.lastSeen === newestTimestamp && selected.lastEventAt >= newestTimestamp)) {
            setHistoryRevision((revision) => revision + 1)
          }
        }
      }
    }
    matrixUpdateHandlerRef.current = applyMatrixUpdate
    const unsubscribe = Events.On('matrix:update', (event: { data: unknown }) => {
      applyMatrixUpdate(event.data as MatrixUpdate)
    })
    const unsubscribePreferences = Events.On('preferences:update', (event: { data: unknown }) => {
      if (!active) return
      const state = event.data as Snapshot | undefined
      if (!state) return
      setSnapshot(state)
      setSelectedRoomID((current) => {
        if (current && (state.rooms ?? []).some((room) => room.id === current)) return current
        return (state.rooms ?? [])[0]?.id || ''
      })
    })
    const unsubscribeHostError = Events.On('matrix:host-error', (event: { data: unknown }) => {
      const message = (event.data as { error?: string } | undefined)?.error
      if (active && message) setError(message)
    })
    const unsubscribeMenuAbout = Events.On('application-menu:about', () => {
      if (!active) return
      setSettingsTab('About')
      setSettingsOpen(true)
    })
    const unsubscribeMenuSettings = Events.On('application-menu:settings', () => {
      if (!active) return
      setSettingsTab('General')
      setSettingsOpen(true)
    })
    const unsubscribeMenuSearch = Events.On('application-menu:search', () => {
      if (active) setSearchOpen(true)
    })
    const unsubscribeMenuAction = Events.On('application-menu:action', (event: { data: unknown }) => {
      if (active) menuActionRef.current(String(event.data))
    })
    const unsubscribeNotificationOpenRoom = Events.On('notification:open-room', (event: { data: unknown }) => {
      const target = typeof event.data === 'string' ? { roomId: event.data, accountId: '' } : event.data as { roomId?: string; accountId?: string } | undefined
      if (active && target?.roomId) {
        window.focus()
        matrixUpdateHandlersRef.current.openNotificationRoom(target.accountId ?? '', target.roomId)
      }
    })
    const unsubscribeFilesDropped = Events.On('matrix:files-dropped', (event: { data: unknown }) => {
      const dropped = (event.data as { files?: { name: string; type: string; data: string }[] } | undefined)?.files ?? []
      if (active && dropped.length > 0) {
        stageDroppedFilesRef.current(dropped.map((item) => new File([base64ToBytes(item.data)], item.name, { type: item.type })))
      }
    })
    const unsubscribeScheduledReminder = Events.On('scheduler:reminder', (event: { data: unknown }) => {
      if (!active) return
      const reminder = event.data as ScheduledJob
      const roomName = roomsRef.current.find((room) => room.id === reminder.roomId)?.name || reminder.roomId
      const body = reminder.text.trim() || `You set a reminder for ${roomName}.`
      showScheduledNotice(`${roomName}: ${body}`)
      void refreshScheduledJobs()
      if (nativeNotificationsRef.current) {
        void AppService.SendNotification({ title: `Reminder · ${roomName}`, subtitle: '', body, roomId: reminder.roomId, accountId: reminder.accountId, senderAvatar: '' }).catch((notificationError: unknown) => setScheduledJobsError(describeError(notificationError)))
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const notification = new Notification(`Reminder · ${roomName}`, { body })
          notification.onclick = () => {
            window.focus()
            matrixUpdateHandlersRef.current.openNotificationRoom(reminder.accountId, reminder.roomId)
            setScheduledJobsOpen(true)
          }
        } catch (notificationError) {
          setScheduledJobsError(describeError(notificationError))
        }
      }
    })

    void refreshScheduledJobs()
    AppService.Snapshot()
      .then((state) => {
        if (!active) return
        setSnapshot(state)
        setSelectedRoomID((current) => current || (state.rooms ?? [])[0]?.id || '')
      })
      .catch((snapshotError: unknown) => {
        if (active) setError(describeError(snapshotError))
      })

    return () => {
      active = false
      matrixUpdateHandlerRef.current = null
      unsubscribe()
      unsubscribePreferences()
      unsubscribeHostError()
      unsubscribeMenuAbout()
      unsubscribeMenuSettings()
      unsubscribeMenuSearch()
      unsubscribeMenuAction()
      unsubscribeNotificationOpenRoom()
      unsubscribeFilesDropped()
      unsubscribeScheduledReminder()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showScheduledNotice is recreated each render; this subscription should not re-register on each render
  }, [historyRoomIDRef, refreshScheduledJobs, setHistoryRevision, setScheduledJobsError, setScheduledJobsOpen, setSettingsOpen, setSettingsTab, matrixUpdateHandlerRef, matrixUpdateHandlersRef, menuActionRef, messagesRef, nativeNotificationsRef, preferencesRef, roomsRef, selectedRoomRef, setError, setOtherAccountRooms, setPreferenceRef, setSearchOpen, setSelectedRoomID, setSnapshot, setTypingUsers, stageDroppedFilesRef])
  return { ...app }
}
