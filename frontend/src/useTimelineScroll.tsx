/* eslint-disable react-hooks/exhaustive-deps -- deps mirror the original component closure; setters and refs come from other hooks */
import { useEffect } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type Message } from '../bindings/mychat/desktop/models.js'
import { preferredScrollBehavior } from './appShared'
import { localDateTimeInputValue, preferenceBoolean, timelineMessageID, isNeedsReplyRoom } from './appShared'
import type { useInboxState } from './useInboxState'

export function useTimelineScroll(app: ReturnType<typeof useInboxState>) {
  const { activeThread, answeredShortcut, composeText, defaultScheduleDelayMinutes, editTarget, leaveConfirmOpen, markRoomAnsweredRef, messageContextMenu, messagesRef, newRoomMode, pinnedScrollTopRef, preferencesRef, quickSwitcherOpen, reactingMessageID, redactTarget, replyTarget, roomContextMenu, roomInfoOpen, roomsRef, selectedRoomID, selectedRoomRef, setMessageContextMenu, setOpenThread, setPreferenceRef, setReactingMessageID, setRoomContextMenu, setScheduledDialogError, setScheduledDraft, setScheduledDueAt, settingsOpen, singleKeyShortcuts, snapshot, stickToBottomRef, timelineListRef, timelineRef, visibleMessages } = app

  function openScheduleMessage() {
    if (!selectedRoomID || !composeText.trim() || editTarget) return
    setScheduledDraft({
      kind: 'message',
      roomID: selectedRoomID,
      text: composeText.trim(),
      replyToEventID: replyTarget?.id,
      replyToSender: replyTarget?.senderName || replyTarget?.sender,
      replyToPreview: replyTarget?.body,
    })
    setScheduledDueAt(localDateTimeInputValue(Date.now() + defaultScheduleDelayMinutes('schedule.default_send_minutes', 5) * 60_000))
    setScheduledDialogError('')
  }

  function openReminder(message: Message) {
    if (!selectedRoomID || !message.id || message.id.startsWith('~') || message.redacted) return
    setScheduledDraft({ kind: 'reminder', roomID: selectedRoomID, eventID: message.id, text: '', archiveAfter: false })
    setScheduledDueAt(localDateTimeInputValue(Date.now() + defaultScheduleDelayMinutes('schedule.default_reminder_minutes', 60) * 60_000))
    setScheduledDialogError('')
  }

  useEffect(() => {
    selectedRoomRef.current = selectedRoomID
    void AppService.SetActiveRoom(selectedRoomID)
  }, [selectedRoomID, snapshot?.activeAccountId])

  useEffect(() => {
    const handleContentBlurShortcut = (event: globalThis.KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      if (!event.shiftKey || event.altKey || event.repeat || event.isComposing || event.key.toLowerCase() !== 'p') return
      event.preventDefault()
      event.stopPropagation()
      void setPreferenceRef.current('privacy.incognito', !preferenceBoolean(preferencesRef.current, 'privacy.incognito'))
    }
    const handleHideImagesShortcut = (event: globalThis.KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      if (!event.shiftKey || event.altKey || event.repeat || event.isComposing || event.key.toLowerCase() !== 'i') return
      event.preventDefault()
      event.stopPropagation()
      void setPreferenceRef.current('appearance.hide_images_and_videos', !preferenceBoolean(preferencesRef.current, 'appearance.hide_images_and_videos'))
    }

    window.addEventListener('keydown', handleContentBlurShortcut)
    window.addEventListener('keydown', handleHideImagesShortcut)
    return () => {
      window.removeEventListener('keydown', handleContentBlurShortcut)
      window.removeEventListener('keydown', handleHideImagesShortcut)
    }
  }, [])

  useEffect(() => {
    const handleGlobalAnsweredShortcut = (event: globalThis.KeyboardEvent) => {
      if (!singleKeyShortcuts || event.repeat || event.altKey || event.metaKey || event.ctrlKey || event.key.toUpperCase() !== answeredShortcut) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (settingsOpen || roomInfoOpen || activeThread || newRoomMode || leaveConfirmOpen || redactTarget || quickSwitcherOpen) return
      const roomID = roomContextMenu?.roomID ?? selectedRoomID
      const room = roomsRef.current.find((candidate) => candidate.id === roomID)
      if (!room || !isNeedsReplyRoom(room)) return
      event.preventDefault()
      void markRoomAnsweredRef.current(roomID)
    }
    window.addEventListener('keydown', handleGlobalAnsweredShortcut)
    return () => window.removeEventListener('keydown', handleGlobalAnsweredShortcut)
  }, [activeThread, answeredShortcut, singleKeyShortcuts, leaveConfirmOpen, newRoomMode, quickSwitcherOpen, roomContextMenu, roomInfoOpen, redactTarget, selectedRoomID, settingsOpen])

  useEffect(() => {
    if (!roomContextMenu && !messageContextMenu) return
    const dismissOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element) {
        if (event.target.closest('.room-context-menu')) return
        if (event.target.closest('.message-context-menu')) return
      }
      setRoomContextMenu(null)
      setMessageContextMenu(null)
    }
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setRoomContextMenu(null)
      setMessageContextMenu(null)
    }
    // Only one menu is ever open: opening one clears the other.
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(roomContextMenu ? '.room-context-menu button' : '.message-context-menu button')?.focus())
    document.addEventListener('pointerdown', dismissOnOutsideClick)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', dismissOnOutsideClick)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [roomContextMenu, messageContextMenu])

  // The reaction picker used to be toggled off by its own toolbar button, which
  // now lives in the right-click menu. Give it a dismissal path of its own.
  useEffect(() => {
    if (!reactingMessageID) return
    const dismissOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.reaction-picker')) return
      setReactingMessageID('')
    }
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setReactingMessageID('')
    }
    document.addEventListener('pointerdown', dismissOnOutsideClick)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsideClick)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [reactingMessageID])

  function isNearBottom(element: HTMLElement, tolerance = 96) {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= tolerance
  }

  function isNearTop(element: HTMLElement, tolerance = 240) {
    return element.scrollTop <= tolerance
  }

  function pinTimelineToBottom(timeline: HTMLElement) {
    timeline.scrollTop = timeline.scrollHeight
    pinnedScrollTopRef.current = timeline.scrollTop
  }

  function scrollTimelineToBottom(behavior: ScrollBehavior = 'auto') {
    const timeline = timelineRef.current
    if (!timeline) return
    if (typeof timeline.scrollTo === 'function') timeline.scrollTo({ top: timeline.scrollHeight, behavior: preferredScrollBehavior(behavior) })
    else timeline.scrollTop = timeline.scrollHeight
  }

  function jumpToLatest() {
    stickToBottomRef.current = true
    scrollTimelineToBottom('smooth')
  }

  function openThreadPanel(rootID: string) {
    const roomID = selectedRoomRef.current
    if (roomID && rootID.startsWith('$')) setOpenThread({ roomID, rootID })
  }

  function focusTimelineMessage(eventID: string) {
    const timeline = timelineRef.current
    if (!timeline || !eventID) return
    // Replies shown under a loaded thread root open their thread instead.
    const loaded = messagesRef.current
    const threadReply = loaded.find((message) => message.id === eventID && message.threadRootId)
    if (threadReply && loaded.some((message) => message.id === threadReply.threadRootId)) {
      if (selectedRoomRef.current) setOpenThread({ roomID: selectedRoomRef.current, rootID: threadReply.threadRootId })
      return
    }
    const target = Array.from(timeline.querySelectorAll<HTMLElement>('[data-event-id]'))
      .find((element) => element.dataset.eventId === eventID)
    stickToBottomRef.current = false
    if (!target) {
      timelineListRef.current?.focusMessage(eventID)
      return
    }
    target.scrollIntoView?.({ behavior: preferredScrollBehavior(), block: 'center' })
    target.focus({ preventScroll: true })
  }

  function focusTimelineItem(index: number) {
    const message = visibleMessages[index]
    if (message) focusTimelineMessage(timelineMessageID(message))
  }

  function moveTimelineFocus(direction: number, boundary?: 'first' | 'last') {
    const timeline = timelineRef.current
    if (!timeline) return
    const items = visibleMessages
    if (items.length === 0) return
    if (boundary) {
      focusTimelineItem(boundary === 'first' ? 0 : items.length - 1)
      return
    }
    const activeItem = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-event-id]')
      : null
    const currentIndex = activeItem ? items.findIndex((message) => timelineMessageID(message) === activeItem.dataset.eventId) : -1
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : items.length - 1
      : currentIndex + direction
    if (nextIndex >= 0 && nextIndex < items.length) focusTimelineItem(nextIndex)
  }
  return { ...app, openScheduleMessage, openReminder, isNearBottom, isNearTop, pinTimelineToBottom, scrollTimelineToBottom, jumpToLatest, openThreadPanel, focusTimelineMessage, focusTimelineItem, moveTimelineFocus }
}
