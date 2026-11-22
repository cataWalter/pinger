import { useEffect, useMemo, useRef, type FormEvent } from 'react'
import { AppService, LanguageTutorService } from '../bindings/mychat/desktop'
import { type AIMessage, type Message } from '../bindings/mychat/desktop/models.js'
import { type PromptMessage, endsWithAssistantTurn } from './aiPrompts'
import { resolveAIFeatureTuning, resolveChatLearningLanguage, resolveChatTutorLanguage, type AIFeatureID } from './aiSettings'
import { type AIAcceptAction, type AIStreamHandler, type LanguageTutorState, describeError } from './appShared'
import { clearParkedChatTranslations, parkChatTranslation, takeParkedChatTranslation } from './chatTranslationStash'
import type { useMessageReactions } from './useMessageReactions'

export function useAIRequests(app: ReturnType<typeof useMessageReactions>) {
  const { activeAIRequestRef, activeAccountID, aiEnabled, aiPanel, aiStreamHandlersRef, busy, chatTranslation, chatTranslationAIRequestRef, chatTranslationRequestRef, composeText, composeTextRef, editTarget, generatedImageReview, imageSendRun, languageTutorRequestRef, messages, preferences, preferencesRef, roomDrafts, scrollTimelineToBottom, selectedRoomID, selectedRoomRef, setAIPanel, setBusy, setChatTranslation, setComposeText, setError, setGeneratedImageReview, setHistoryRevision, setImageSendRun, setLanguageTutorState, setMentionBindings, setMentionStart, stageAttachmentFiles, stageDroppedFilesRef, stickToBottomRef, stoppedAIRequestRef, workspaceGenerationRef } = app
  stageDroppedFilesRef.current = stageAttachmentFiles
  function promptMessages(source: Message[]): PromptMessage[] {
    return source.map((message) => ({
      senderName: message.senderName,
      sender: message.sender,
      body: message.body,
      redacted: message.redacted,
    }))
  }

  const hasAIConversationContext = useMemo(
    () => messages.some((message) => message.body.trim().length > 0 && !message.redacted),
    [messages],
  )

  function newAIRequestID() {
    return globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  // registerAIStream routes ai:stream chunks for requestID to handler. The returned function unregisters it.
  function registerAIStream(requestID: string, handler: AIStreamHandler) {
    aiStreamHandlersRef.current.set(requestID, handler)
    return () => {
      if (aiStreamHandlersRef.current.get(requestID) === handler) aiStreamHandlersRef.current.delete(requestID)
    }
  }

  function cancelAIRequest(requestID: string) {
    if (!requestID) return
    void Promise.resolve(AppService.AICancel(requestID)).catch(() => false)
  }

  // Finished translations are parked in RAM when their chat is left and taken back when it is reopened.
  // In-flight translation work still stops on a chat switch.
  const chatTranslationRef = useRef(chatTranslation)
  chatTranslationRef.current = chatTranslation
  const translationOwnerRef = useRef({ accountID: activeAccountID, roomID: selectedRoomID })
  useEffect(() => {
    chatTranslationRequestRef.current++
    cancelAIRequest(chatTranslationAIRequestRef.current)
    chatTranslationAIRequestRef.current = ''
    const previous = translationOwnerRef.current
    translationOwnerRef.current = { accountID: activeAccountID, roomID: selectedRoomID }
    if (previous.accountID !== activeAccountID) {
      clearParkedChatTranslations()
      setChatTranslation(null)
      return
    }
    parkChatTranslation(activeAccountID, chatTranslationRef.current)
    setChatTranslation(takeParkedChatTranslation(activeAccountID, selectedRoomID))
  }, [selectedRoomID, activeAccountID, chatTranslationAIRequestRef, chatTranslationRequestRef, setChatTranslation])

  // aiInstructions returns the tunable prompt for a feature. Built-in defaults are returned when no override is saved.
  function aiInstructions(featureID: AIFeatureID) {
    return resolveAIFeatureTuning(preferencesRef.current, featureID).prompt
  }

  async function runAIRequest(title: string, request: AIMessage[], featureID: AIFeatureID, acceptAction: AIAcceptAction = { kind: 'none' }): Promise<string> {
    const requestID = newAIRequestID()
    const tuning = resolveAIFeatureTuning(preferencesRef.current, featureID)
    activeAIRequestRef.current = requestID
    setAIPanel({ title, busy: true, result: '', error: '', acceptAction, featureID, requestID, conversation: request, followUp: '', stopped: false })
    const unregister = registerAIStream(requestID, (chunk) => {
      setAIPanel((current) => current?.requestID === requestID
        ? { ...current, result: (chunk.reset ? '' : current.result) + chunk.text }
        : current)
    })
    try {
      const reply = await AppService.AIComplete(request, requestID, tuning.temperature, tuning.maxTokens)
      if (activeAIRequestRef.current !== requestID) return ''
      // The resolved reply is authoritative. Stream events can arrive after this resolves.
      setAIPanel((current) => current?.requestID === requestID
        ? { ...current, busy: false, result: reply, conversation: [...request, { role: 'assistant', content: reply }], stopped: stoppedAIRequestRef.current === requestID }
        : current)
      return stoppedAIRequestRef.current === requestID ? '' : reply
    } catch (aiError) {
      if (activeAIRequestRef.current !== requestID) return ''
      const stopped = stoppedAIRequestRef.current === requestID
      setAIPanel((current) => current?.requestID === requestID
        ? stopped
          ? { ...current, busy: false, stopped: true }
          : { ...current, busy: false, error: describeError(aiError) }
        : current)
      return ''
    } finally {
      unregister()
      if (activeAIRequestRef.current === requestID) activeAIRequestRef.current = ''
    }
  }

  // stopAIRequest keeps the partial answer. The conversation is left without an assistant turn, so Regenerate restarts it.
  function stopAIRequest() {
    const requestID = activeAIRequestRef.current
    if (!requestID) return
    stoppedAIRequestRef.current = requestID
    setAIPanel((current) => current?.requestID === requestID ? { ...current, status: 'Stopping…' } : current)
    cancelAIRequest(requestID)
  }

  function regenerateAIResult() {
    if (!aiPanel || aiPanel.busy) return
    const history = endsWithAssistantTurn(aiPanel.conversation) ? aiPanel.conversation.slice(0, -1) : aiPanel.conversation
    if (history.length === 0) return
    void runAIRequest(aiPanel.title, history, aiPanel.featureID, aiPanel.acceptAction)
  }

  function setAIFollowUp(followUp: string) {
    setAIPanel((current) => current ? { ...current, followUp } : current)
  }

  function sendAIFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = aiPanel?.followUp.trim()
    if (!aiPanel || !question || aiPanel.busy || !endsWithAssistantTurn(aiPanel.conversation)) return
    void runAIRequest(aiPanel.title, [...aiPanel.conversation, { role: 'user', content: question }], aiPanel.featureID, aiPanel.acceptAction)
  }

  // generateImageToRoom generates an image from the draft for review. Nothing is sent until the review is approved.
  async function generateImageToRoom() {
    const roomID = selectedRoomID
    const sourceDraft = composeText
    const prompt = sourceDraft.trim()
    if (!roomID || !prompt || busy || editTarget || imageSendRun || generatedImageReview) return
    const requestID = newAIRequestID()
    const generation = workspaceGenerationRef.current
    setError('')
    setImageSendRun({ requestID, roomID, stage: 'starting', step: 0, totalSteps: 0 })
    try {
      const encoded = await AppService.GenerateRoomImage(prompt, requestID)
      if (workspaceGenerationRef.current !== generation) return
      setGeneratedImageReview({ roomID, prompt, sourceDraft, encoded })
    } catch (imageError) {
      if (workspaceGenerationRef.current === generation) setError(describeError(imageError))
    } finally {
      if (workspaceGenerationRef.current === generation) setImageSendRun(null)
    }
  }

  // approveGeneratedImage sends the reviewed image. The draft is cleared only if it was not edited while the image was generating.
  async function approveGeneratedImage() {
    const review = generatedImageReview
    if (!review) return
    setGeneratedImageReview(null)
    setBusy(true)
    setError('')
    try {
      await AppService.SendRoomImage(review.roomID, review.encoded)
      if (roomDrafts.get(review.roomID) === review.sourceDraft) roomDrafts.delete(review.roomID)
      if (selectedRoomRef.current === review.roomID && composeTextRef.current === review.sourceDraft) {
        setComposeText('')
        setMentionBindings([])
        setMentionStart(-1)
      }
      stickToBottomRef.current = true
      scrollTimelineToBottom()
      setHistoryRevision((revision) => revision + 1)
    } catch (sendError) {
      setError(describeError(sendError))
    } finally {
      setBusy(false)
    }
  }

  function stopImageGeneration() {
    if (imageSendRun) cancelAIRequest(imageSendRun.requestID)
  }

  async function analyzeWithLanguageTutor(text: string, mode: LanguageTutorState['mode']) {
    const originalText = text.trim()
    if (!originalText) {
      setError(mode === 'draft' ? 'Write a draft first.' : 'This message has no text to analyze.')
      return
    }
    if (!aiEnabled) {
      setError('Set up AI in Settings > AI to use Language Tutor.')
      return
    }
    const learningLanguage = resolveChatLearningLanguage(preferences, selectedRoomID)
    const explanation = resolveChatTutorLanguage(preferences, selectedRoomID)
    // A new run replaces the one in progress.
    cancelAIRequest(languageTutorRequestRef.current)
    const requestID = newAIRequestID()
    languageTutorRequestRef.current = requestID
    setLanguageTutorState({ accountID: activeAccountID, roomID: selectedRoomID, mode, originalText, learningLanguage, explanationLanguage: explanation, analysis: null, busy: true, error: '', requestID, preview: '' })
    const unregister = registerAIStream(requestID, (chunk) => {
      setLanguageTutorState((current) => current?.requestID === requestID
        ? { ...current, preview: (chunk.reset ? '' : current.preview) + chunk.text }
        : current)
    })
    try {
      const analysis = await LanguageTutorService.Analyze(originalText, mode, learningLanguage, explanation, requestID)
      if (languageTutorRequestRef.current === requestID) {
        setLanguageTutorState((current) => current ? { ...current, analysis, busy: false, preview: '' } : current)
      }
    } catch (analysisError) {
      if (languageTutorRequestRef.current === requestID) {
        setLanguageTutorState((current) => current ? { ...current, busy: false, error: describeError(analysisError) } : current)
      }
    } finally {
      unregister()
      if (languageTutorRequestRef.current === requestID) languageTutorRequestRef.current = ''
    }
  }

  function closeLanguageTutor() {
    cancelAIRequest(languageTutorRequestRef.current)
    languageTutorRequestRef.current = ''
    setLanguageTutorState(null)
  }
  return { ...app, promptMessages, hasAIConversationContext, newAIRequestID, registerAIStream, cancelAIRequest, aiInstructions, runAIRequest, stopAIRequest, regenerateAIResult, setAIFollowUp, sendAIFollowUp, generateImageToRoom, approveGeneratedImage, stopImageGeneration, analyzeWithLanguageTutor, closeLanguageTutor }
}
