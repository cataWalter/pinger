import { type FormEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { type MatrixNotification, type PreferenceValues, type OutgoingMessage, describeError, displayMessageBody, preferenceBoolean, preferenceString, preferenceNumber, playNotificationSound, notificationTone, type RecordedUpload, maxAttachmentBytes, requestLocalAsset } from './appShared'
import type { useSessionActions } from './useSessionActions'

export function useMessageDispatch(app: ReturnType<typeof useSessionActions>) {
  const { activeAccountID, busy, composeTextRef, editTarget, forwardBusy, forwardTargetRoomID, forwardingMessage, mediaApproval, preferences, preferencesRef, refreshScheduledJobs, roomDrafts, rooms, roomsRef, scheduledBusyID, scheduledDraft, scheduledDueAt, scheduledSaving, scheduledTimes, selectedRoomID, selectedRoomRef, setAutoPlayNextMessageId, setBusy, setComposeText, setError, setForwardBusy, setForwardError, setForwardingMessage, setHistoryRevision, setMediaApproval, setMentionBindings, setMentionStart, setReplyTarget, setRoomArchived, setScheduledBusyID, setScheduledDialogError, setScheduledDraft, setScheduledJobsError, setScheduledSaving, setSnapshot, stagedAttachments, visibleMessages, workspaceGenerationRef } = app

  async function submitScheduledDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!scheduledDraft || scheduledSaving) return
    const dueAt = new Date(scheduledDueAt).getTime()
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
      setScheduledDialogError('Choose a time in the future.')
      return
    }
    setScheduledSaving(true)
    setScheduledDialogError('')
    const generation = workspaceGenerationRef.current
    const sourceDraft = roomDrafts.get(scheduledDraft.roomID) ?? scheduledDraft.text
    try {
      if (scheduledDraft.kind === 'message') {
        if (scheduledDraft.replyToEventID) {
          await AppService.ScheduleReply(scheduledDraft.roomID, scheduledDraft.text, scheduledDraft.replyToEventID, dueAt)
        } else {
          await AppService.ScheduleMessage(scheduledDraft.roomID, scheduledDraft.text, dueAt)
        }
        if (workspaceGenerationRef.current !== generation) return
        if (roomDrafts.get(scheduledDraft.roomID) === sourceDraft) roomDrafts.delete(scheduledDraft.roomID)
        if (selectedRoomRef.current === scheduledDraft.roomID && composeTextRef.current === sourceDraft) {
          setComposeText('')
          setMentionBindings([])
          setMentionStart(-1)
          setReplyTarget((current) => current?.id === scheduledDraft.replyToEventID ? null : current)
        }
      } else {
        await AppService.ScheduleReminder(scheduledDraft.roomID, scheduledDraft.eventID, scheduledDraft.text, dueAt)
        if (workspaceGenerationRef.current !== generation) return
        if (scheduledDraft.archiveAfter) await setRoomArchived(scheduledDraft.roomID, true)
      }
      setScheduledDraft((current) => current === scheduledDraft ? null : current)
      await refreshScheduledJobs()
    } catch (scheduleError) {
      if (workspaceGenerationRef.current === generation) setScheduledDialogError(describeError(scheduleError))
    } finally {
      if (workspaceGenerationRef.current === generation) setScheduledSaving(false)
    }
  }

  async function manageScheduledJob(id: string, action: 'reschedule' | 'cancel' | 'retry' | 'dismiss') {
    if (scheduledBusyID) return
    setScheduledBusyID(id)
    setScheduledJobsError('')
    try {
      if (action === 'reschedule') {
        const dueAt = new Date(scheduledTimes[id] ?? '').getTime()
        if (!Number.isFinite(dueAt) || dueAt <= Date.now()) throw new Error('Choose a time in the future.')
        await AppService.UpdateScheduledJob(id, dueAt)
      } else if (action === 'cancel') {
        await AppService.CancelScheduledJob(id)
      } else if (action === 'retry') {
        await AppService.RetryScheduledMessage(id)
      } else {
        await AppService.DismissScheduledJob(id)
      }
      await refreshScheduledJobs()
    } catch (jobError) {
      setScheduledJobsError(describeError(jobError))
    } finally {
      setScheduledBusyID('')
    }
  }

  async function dispatchMessage(message: OutgoingMessage) {
    if (message.replyTo) await AppService.SendReply(message.roomID, message.text, message.replyTo.id)
    else if (message.mentionUserIDs.length > 0) await AppService.SendMessageWithMentions(message.roomID, message.text, message.mentionUserIDs)
    else await AppService.SendMessage(message.roomID, message.text)
    const soundEffects = preferenceString(preferencesRef.current, 'sounds.effects', 'Off')
    if (soundEffects === 'Sent messages' || soundEffects === 'Incoming and sent messages') {
      playNotificationSound(preferenceNumber(preferencesRef.current, 'notifications.volume', 50), 'Soft')
    }
  }

  async function refreshRoomSnapshotAfterSend() {
    try {
      setSnapshot(await AppService.Snapshot())
    } catch {
    }
  }

  async function confirmMessageForward() {
    if (!forwardingMessage || forwardBusy) return
    const destination = rooms.find((candidate) => candidate.id === forwardTargetRoomID)
    const body = displayMessageBody(forwardingMessage).trim()
    if (!destination || !body) return
    setForwardBusy(true)
    setForwardError('')
    try {
      const sender = forwardingMessage.senderName || forwardingMessage.sender || 'Unknown sender'
      await dispatchMessage({ roomID: destination.id, text: `Forwarded from ${sender}:\n\n${body}`, replyTo: null, mentionUserIDs: [] })
      setForwardingMessage(null)
      void refreshRoomSnapshotAfterSend()
    } catch (sendError) {
      setForwardError(describeError(sendError))
    } finally {
      setForwardBusy(false)
    }
  }

  function notificationRoomName(notification: MatrixNotification) {
    return notification.room || roomsRef.current.find((room) => room.id === notification.roomId)?.name || notification.roomId
  }

  function notificationKey(notification: MatrixNotification) {
    return JSON.stringify([notification.accountId ?? activeAccountID, notification.roomId])
  }

  function playNotificationAlert(preferences: PreferenceValues, category: string) {
    if (!preferenceBoolean(preferences, 'notifications.sound')) return
    playNotificationSound(preferenceNumber(preferences, 'notifications.volume', 50), notificationTone(preferences, category))
  }

  function handleTimelineAudioEnded(messageID: string) {
    if (!preferenceBoolean(preferences, 'voice.autoplay_next')) return
    const index = visibleMessages.findIndex((message) => message.id === messageID)
    for (let nextIndex = index + 1; nextIndex < visibleMessages.length; nextIndex++) {
      const message = visibleMessages[nextIndex]
      const mime = message.mediaMime || ''
      if (message.mediaUri && !message.redacted && !message.decryptionError && (mime.startsWith('audio/') || message.mediaType === 'm.audio')) {
        setAutoPlayNextMessageId(message.id)
        return
      }
    }
    setAutoPlayNextMessageId(null)
  }

  // Staged files are sent with the next message and are held back while a message is being edited.
  const stagedRoomAttachments = stagedAttachments.filter((item) => item.accountID === activeAccountID && item.roomID === selectedRoomID)
  const sendableStagedAttachments = editTarget ? [] : stagedRoomAttachments

  // resolveMediaApproval closes the media approval dialog and runs the pending send only when approved. Cancelling keeps staged attachments in the composer.
  function resolveMediaApproval(approved: boolean) {
    const request = mediaApproval
    setMediaApproval(null)
    if (!request) return
    if (approved) request.onApprove()
    else request.onCancel?.()
  }

  async function uploadAttachmentFile(roomID: string, file: File, recording?: RecordedUpload) {
    const query = new URLSearchParams({
      filename: file.name,
      voiceNote: String(recording?.kind === 'voice'),
      videoMessage: String(recording?.kind === 'video'),
      durationMs: String(recording?.durationMilliseconds ?? 0),
    })
    // WKWebView can deliver a File body as an empty stream on the app's custom scheme; raw bytes arrive intact.
    const bytes = new Uint8Array(await file.arrayBuffer())
    await requestLocalAsset(`/media/ipc/attachment/${encodeURIComponent(roomID)}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: bytes,
    })
  }

  async function sendAttachmentFiles(files: File[], roomID = selectedRoomID, recording?: RecordedUpload) {
    if (files.length === 0) return
    if (!roomID) {
      setError('Select a room before uploading files.')
      return
    }
    if (busy) return
    setBusy(true)
    setError('')
    try {
      let uploadedAny = false
      for (const file of files) {
        if (file.size > maxAttachmentBytes) {
          setError(`${file.name || 'Attachments'} cannot exceed 50 MiB.`)
          continue
        }
        await uploadAttachmentFile(roomID, file, recording)
        uploadedAny = true
      }
      if (uploadedAny) setHistoryRevision((revision) => revision + 1)
    } catch (uploadError) {
      setError(describeError(uploadError))
    } finally {
      setBusy(false)
    }
  }
  return { ...app, confirmMessageForward, submitScheduledDraft, manageScheduledJob, dispatchMessage, refreshRoomSnapshotAfterSend, notificationRoomName, notificationKey, playNotificationAlert, handleTimelineAudioEnded, stagedRoomAttachments, sendableStagedAttachments, resolveMediaApproval, uploadAttachmentFile, sendAttachmentFiles }
}
