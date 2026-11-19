import { useRef } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type MatrixUpdate, type MatrixNotification, type PreferenceValues, describeError, preferenceBoolean, preferenceString, preferenceNumber, notificationAllowed, notificationText, detectOneTimeCode, type NotificationText } from './appShared'
import type { useAccountWorkspace } from './useAccountWorkspace'

export function useNotificationDelivery(app: ReturnType<typeof useAccountWorkspace>) {
  const { activeAccountID, archivedPreferenceKey, nativeNotificationsRef, notificationBatchesRef, notificationKey, notificationRoomName, playNotificationAlert, preferencesRef, repeatRemindersRef, roomsRef, selectedRoomRef, setError, showRoom } = app
  // Subscription handlers read these through a ref so the event listeners are attached once.
  const matrixUpdateHandlersRef = useRef({ archivedPreferenceKey, deliverNotification, queueNotificationBatch, showRoom, deliverMatrixNotifications, activeAccountID })

  function notificationPreferences(notification: MatrixNotification) {
    return notification.accountId && notification.accountId !== matrixUpdateHandlersRef.current.activeAccountID
      ? notification.preferences ?? preferencesRef.current
      : preferencesRef.current
  }

  function notificationRoomIsSelected(notification: MatrixNotification) {
    return (!notification.accountId || notification.accountId === matrixUpdateHandlersRef.current.activeAccountID) && notification.roomId === selectedRoomRef.current
  }

  function deliverMatrixNotifications(update: MatrixUpdate) {
    for (const item of update.notifications ?? []) {
      const notification = { ...item, accountId: item.accountId ?? update.accountId, preferences: update.notificationPreferences }
      const currentPreferences = notificationPreferences(notification)
      if (!notificationAllowed(currentPreferences, notification.roomId, notification.category) || notificationRoomIsSelected(notification)) continue
      if (preferenceBoolean(currentPreferences, 'notifications.only_when_unfocused', true) && document.hasFocus()) continue
      const oneTimeCode = detectOneTimeCode(notification.body)
      if (oneTimeCode && preferenceBoolean(currentPreferences, 'notifications.otp_copy')) {
        void navigator.clipboard?.writeText(oneTimeCode).catch(() => undefined)
      }
      const batchSeconds = preferenceNumber(currentPreferences, 'notifications.batch_seconds', 0, 0, 30)
      const immediate = Boolean(oneTimeCode) && preferenceBoolean(currentPreferences, 'notifications.otp_immediate', true)
      if (batchSeconds > 0 && !immediate) {
        queueNotificationBatch(notification, batchSeconds)
        continue
      }
      deliverNotification(currentPreferences, notification, notificationText(currentPreferences, notification, notificationRoomName(notification)))
    }
  }

  function deliverNotification(preferences: PreferenceValues, notification: MatrixNotification, text: NotificationText, scheduleRepeat = true) {
    if (nativeNotificationsRef.current) {
      void AppService.SendNotification({
        title: text.title,
        subtitle: text.subtitle,
        body: text.body,
        roomId: notification.roomId,
        accountId: notification.accountId ?? '',
        senderAvatar: preferenceString(preferences, 'notifications.privacy', 'Sender and message preview') === 'Hidden content' ? '' : notification.senderAvatar ?? '',
      })
        .then((delivered) => {
          if (delivered) playNotificationAlert(preferences, notification.category)
        })
        .catch((notificationError: unknown) => setError(describeError(notificationError)))
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const systemNotification = new Notification(text.title, { body: text.subtitle ? `${text.subtitle}: ${text.body}` : text.body })
        systemNotification.onclick = () => {
          window.focus()
          matrixUpdateHandlersRef.current.showRoom(notification.roomId)
        }
        playNotificationAlert(preferences, notification.category)
      } catch (notificationError) {
        setError(describeError(notificationError))
      }
    }
    if (scheduleRepeat) scheduleRepeatReminder(preferences, notification)
  }

  function queueNotificationBatch(notification: MatrixNotification, batchSeconds: number) {
    const batches = notificationBatchesRef.current
    const key = notificationKey(notification)
    const existing = batches.get(key)
    if (existing) {
      existing.notifications.push(notification)
      return
    }
    const timer = window.setTimeout(() => flushNotificationBatch(key), batchSeconds * 1000)
    batches.set(key, { notifications: [notification], timer })
  }

  function flushNotificationBatch(roomID: string) {
    const batch = notificationBatchesRef.current.get(roomID)
    notificationBatchesRef.current.delete(roomID)
    if (!batch || batch.notifications.length === 0) return
    const [first] = batch.notifications
    const preferences = notificationPreferences(first)
    if (notificationRoomIsSelected(first)) return
    if (!notificationAllowed(preferences, first.roomId, first.category)) return
    if (batch.notifications.length === 1) {
      deliverNotification(preferences, first, notificationText(preferences, first, notificationRoomName(first)))
      return
    }
    const hidden = preferenceString(preferences, 'notifications.privacy', 'Sender and message preview') === 'Hidden content'
    const senders = [...new Set(batch.notifications.map((item) => item.sender).filter(Boolean))]
    const roomName = notificationRoomName(first)
    const singleSender = senders.length === 1 && first.category !== 'direct'
    const body = `${batch.notifications.length} new messages${senders.length > 0 ? ` from ${senders.slice(0, 3).join(', ')}` : ''}`
    const text: NotificationText = hidden
      ? { title: 'Matrix', subtitle: '', body: 'New activity' }
      : { title: senders.length === 1 ? senders[0] : roomName, subtitle: singleSender ? roomName : '', body }
    deliverNotification(preferences, first, text)
  }

  function scheduleRepeatReminder(preferences: PreferenceValues, notification: MatrixNotification) {
    const minutes = preferenceNumber(preferences, 'notifications.repeat_minutes', 0, 0, 60)
    const reminders = repeatRemindersRef.current
    const key = notificationKey(notification)
    const existing = reminders.get(key)
    if (existing !== undefined) window.clearTimeout(existing)
    reminders.delete(key)
    if (minutes <= 0) return
    const timer = window.setTimeout(() => {
      reminders.delete(key)
      const current = notificationPreferences(notification)
      const room = roomsRef.current.find((item) => item.id === notification.roomId)
      if (!room || (room.unread <= 0 && !room.markedUnread) || notificationRoomIsSelected(notification)) return
      if (!notificationAllowed(current, notification.roomId, notification.category)) return
      const roomName = notificationRoomName(notification)
      const hidden = preferenceString(current, 'notifications.privacy', 'Sender and message preview') === 'Hidden content'
      deliverNotification(current, notification, { title: hidden ? 'Matrix' : `Still unread · ${roomName}`, subtitle: '', body: 'You still have unread messages.' }, false)
    }, minutes * 60_000)
    reminders.set(key, timer)
  }
  matrixUpdateHandlersRef.current = { archivedPreferenceKey, deliverNotification, queueNotificationBatch, showRoom, deliverMatrixNotifications, activeAccountID }
  return { ...app, matrixUpdateHandlersRef, notificationPreferences, notificationRoomIsSelected, deliverMatrixNotifications, deliverNotification, queueNotificationBatch, flushNotificationBatch, scheduleRepeatReminder }
}
