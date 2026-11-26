import { type FormEvent } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import { parseCustomEmoticonReplacements, replaceEmoticons } from './composerText'
import { createOptimisticMessage, describeError, preferenceBoolean, preferenceString, type CaptureKind, type StagedAttachment, mediaApprovalItemFromFile, maxVideoMessageMilliseconds, maxAttachmentBytes, preferredVideoMimeType, encodePcmWav, startPcmVoiceCapture, type PcmVoiceCapture } from './appShared'
import { deleteVolatileAIDraft, getVolatileAIDraft } from './volatileAIDrafts'
import type { useMessageDispatch } from './useMessageDispatch'

export function useComposerActions(app: ReturnType<typeof useMessageDispatch>) {
  const { activeAccountID, busy, composeDraftStore, dispatchMessage, editTarget, markRoomSentLocally, mentionBindings, preferences, replyTarget, roomDrafts, scrollTimelineToBottom, selectedAudioInputDeviceId, selectedRoomID, selectedRoomRef, sendAttachmentFiles, sendableStagedAttachments, setAudioInputDevices, setBusy, setCaptureKind, setComposeText, setEditTarget, setError, setHistoryRevision, setMediaApproval, setMentionBindings, setMentionStart, setMessages, setReplyTarget, setStagedAttachments, setVoiceCaptureStatus, setVolatileAIDrafts, snapshot, stickToBottomRef, uploadAttachmentFile, volatileAIDrafts, voiceCaptureStatus, voiceChunksRef, voicePcmRef, voiceRecorderRef, voiceRoomIDRef, voiceStreamRef, voiceTimeoutRef } = app

  function stageAttachmentFiles(files: File[]) {
    const roomID = selectedRoomID
    if (!roomID) {
      setError('Select a room before attaching files.')
      return
    }
    setError('')
    const staged: StagedAttachment[] = []
    for (const file of files) {
      if (file.size > maxAttachmentBytes) {
        setError(`${file.name || 'Attachments'} cannot exceed 50 MiB.`)
        continue
      }
      staged.push({
        id: globalThis.crypto?.randomUUID?.() ?? `staged-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        accountID: activeAccountID,
        roomID,
        file,
        previewURL: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      })
    }
    if (staged.length > 0) setStagedAttachments((current) => [...current, ...staged])
  }

  function removeStagedAttachment(item: StagedAttachment) {
    if (item.previewURL) URL.revokeObjectURL(item.previewURL)
    setStagedAttachments((current) => current.filter((staged) => staged.id !== item.id))
  }

  // sendComposerDraft uploads staged attachments, then sends the text message or edit.
  async function sendComposerDraft(roomID: string, text: string, mentionUserIDs: string[], attachments: StagedAttachment[]) {
    setBusy(true)
    setError('')
    let optimisticID = ''
    try {
      for (const item of attachments) {
        await uploadAttachmentFile(roomID, item.file)
        removeStagedAttachment(item)
      }
      if (!text) {
        stickToBottomRef.current = true
        scrollTimelineToBottom()
        setHistoryRevision((revision) => revision + 1)
        return
      }
      if (editTarget) {
        await AppService.EditMessage(roomID, text, editTarget.id)
        setHistoryRevision((revision) => revision + 1)
      } else {
        const optimistic = createOptimisticMessage({
          sender: snapshot?.profile.userId ?? '',
          senderName: snapshot?.profile.displayName ?? '',
          body: text,
          replyTo: replyTarget,
        })
        optimisticID = optimistic.transactionId
        if (selectedRoomRef.current === roomID) {
          setMessages((current) => [...current, optimistic])
        }
        stickToBottomRef.current = true
        scrollTimelineToBottom()
        await dispatchMessage({ roomID, text, replyTo: replyTarget, mentionUserIDs })
        markRoomSentLocally(roomID, text)
      }
      const nextDraft = editTarget ? roomDrafts.get(roomID) ?? '' : ''
      if (!editTarget) {
        roomDrafts.delete(roomID)
        if (getVolatileAIDraft(volatileAIDrafts, activeAccountID, roomID)) {
          setVolatileAIDrafts((current) => deleteVolatileAIDraft(current, activeAccountID, roomID))
        }
      }
      if (selectedRoomRef.current === roomID) setComposeText(nextDraft)
      setMentionBindings([])
      setMentionStart(-1)
      setReplyTarget(null)
      setEditTarget(null)
      stickToBottomRef.current = true
      scrollTimelineToBottom()
    } catch (sendError) {
      const errorText = describeError(sendError)
      if (optimisticID) {
        setMessages((current) => current.map((msg) => msg.transactionId === optimisticID ? { ...msg, sending: false, sendError: errorText } : msg))
      }
      setError(errorText)
    } finally {
      setBusy(false)
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const roomID = selectedRoomID
    const draftText = composeDraftStore.getText()
    const customReplacements = parseCustomEmoticonReplacements(preferenceString(preferences, 'emoji.emoticon_replacements', ''))
    const text = (preferenceBoolean(preferences, 'emoji.replace_emoticons', true) ? replaceEmoticons(draftText, customReplacements) : draftText).trim()
    if (!roomID || (!text && sendableStagedAttachments.length === 0) || busy) return
    const mentionUserIDs = [...new Set(mentionBindings.filter(({ token }) => text.includes(token)).map(({ userID }) => userID))]
    await sendComposerDraft(roomID, text, mentionUserIDs, sendableStagedAttachments)
  }

  function handleAttachmentInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) stageAttachmentFiles([file])
  }

  function finishVoiceNote(capture: PcmVoiceCapture) {
    const roomID = voiceRoomIDRef.current
    voicePcmRef.current = null
    if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current)
    voiceTimeoutRef.current = null
    setVoiceCaptureStatus('processing')
    try {
      const { samples, sampleRate } = capture.stop()
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
      voiceStreamRef.current = null
      if (samples.length === 0) throw new Error('No microphone audio was captured.')
      const durationMilliseconds = Math.max(1, Math.round((samples.length / sampleRate) * 1000))
      const file = new File([encodePcmWav(samples, sampleRate)], `voice-note-${Date.now()}.wav`, { type: 'audio/wav' })
      const previewURL = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''
      const revokePreview = () => {
        if (previewURL && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previewURL)
      }
      setMediaApproval({
        items: [mediaApprovalItemFromFile(file.name, file, previewURL)],
        onApprove: () => {
          revokePreview()
          void sendAttachmentFiles([file], roomID, { kind: 'voice', durationMilliseconds }).finally(() => setVoiceCaptureStatus(null))
        },
        onCancel: () => {
          revokePreview()
          setVoiceCaptureStatus(null)
        },
      })
    } catch (recordError) {
      setError(describeError(recordError))
      setVoiceCaptureStatus(null)
    }
  }

  function stopRecording() {
    const capture = voicePcmRef.current
    if (capture) {
      finishVoiceNote(capture)
      return
    }
    const recorder = voiceRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current)
    voiceTimeoutRef.current = null
    recorder.stop()
  }

  async function startRecording(kind: CaptureKind) {
    if (!selectedRoomID || busy || voiceCaptureStatus) return
    if (!navigator.mediaDevices?.getUserMedia || (kind === 'video' ? typeof MediaRecorder === 'undefined' : typeof AudioContext === 'undefined')) {
      setError(`${kind === 'video' ? 'Video' : 'Voice'} recording is not supported in this environment.`)
      return
    }
    let stream: MediaStream | null = null
    let audioContext: AudioContext | null = null
    try {
      audioContext = kind === 'voice' ? new AudioContext() : null
      const audioConstraints: MediaStreamConstraints['audio'] = selectedAudioInputDeviceId
        ? { deviceId: { exact: selectedAudioInputDeviceId } }
        : true
      const constraints: MediaStreamConstraints = kind === 'video'
        ? { audio: audioConstraints, video: { width: { ideal: 640 }, height: { ideal: 480 } } }
        : { audio: audioConstraints }
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      void navigator.mediaDevices.enumerateDevices?.().then((devices) => {
        setAudioInputDevices(devices.filter((device) => device.kind === 'audioinput'))
      }).catch(() => { })
      voiceRoomIDRef.current = selectedRoomID
      voiceStreamRef.current = stream
      if (audioContext) {
        voicePcmRef.current = startPcmVoiceCapture(audioContext, stream)
      } else {
        const startedAt = Date.now()
        const mimeType = preferredVideoMimeType()
        const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_000_000 })
        voiceChunksRef.current = []
        voiceRecorderRef.current = recorder
        recorder.ondataavailable = (event) => { if (event.data.size > 0) voiceChunksRef.current.push(event.data) }
        recorder.onstop = () => {
          const roomID = voiceRoomIDRef.current
          const chunks = voiceChunksRef.current
          voiceChunksRef.current = []
          voiceRecorderRef.current = null
          voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
          voiceStreamRef.current = null
          if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current)
          voiceTimeoutRef.current = null
          if (chunks.length === 0) {
            setVoiceCaptureStatus(null)
            return
          }
          setVoiceCaptureStatus('processing')
          const durationMilliseconds = Math.max(1, Math.min(Date.now() - startedAt, maxVideoMessageMilliseconds))
          const extension = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'
          const file = new File(chunks, `video-message-${Date.now()}.${extension}`, { type: recorder.mimeType || `video/${extension}` })
          const previewURL = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''
          const revokePreview = () => {
            if (previewURL && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previewURL)
          }
          setMediaApproval({
            items: [mediaApprovalItemFromFile(file.name, file, previewURL)],
            onApprove: () => {
              revokePreview()
              void sendAttachmentFiles([file], roomID, { kind: 'video', durationMilliseconds }).finally(() => setVoiceCaptureStatus(null))
            },
            onCancel: () => {
              revokePreview()
              setVoiceCaptureStatus(null)
            },
          })
        }
        recorder.onerror = () => {
          voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
          voiceStreamRef.current = null
          voiceRecorderRef.current = null
          if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current)
          voiceTimeoutRef.current = null
          setVoiceCaptureStatus(null)
          setError('Camera recording failed.')
        }
        recorder.start(250)
      }
      setError('')
      setCaptureKind(kind)
      setVoiceCaptureStatus('recording')
      voiceTimeoutRef.current = window.setTimeout(stopRecording, kind === 'video' ? maxVideoMessageMilliseconds : 4 * 60 * 1000)
    } catch (recordError) {
      stream?.getTracks().forEach((track) => track.stop())
      voiceStreamRef.current = null
      voiceRecorderRef.current = null
      void audioContext?.close().catch(() => { })
      setError(describeError(recordError))
    }
  }
  return { ...app, submitMessage, sendComposerDraft, stageAttachmentFiles, removeStagedAttachment, handleAttachmentInput, startRecording, stopRecording }
}
