import { useEffect, useRef, useState } from 'react'
import type { LocalAIChatMessage } from '../bindings/mychat/desktop/models.js'
import type { LocalAIRun } from './localAIChatTypes'

type LocalAIScrollOptions = {
  shouldFollowRef: { current: boolean }
  messages: LocalAIChatMessage[]
  runView: LocalAIRun | null
}

// Keeps the transcript pinned to the latest message unless the user scrolls up.
export function useLocalAIScroll({ shouldFollowRef, messages, runView }: LocalAIScrollOptions) {
  const [showJump, setShowJump] = useState(false)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript && shouldFollowRef.current) transcript.scrollTop = transcript.scrollHeight
  }, [messages, runView, shouldFollowRef])

  function handleTranscriptScroll() {
    const transcript = transcriptRef.current
    if (!transcript) return
    const atLatest = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48
    shouldFollowRef.current = atLatest
    setShowJump(!atLatest)
  }

  function jumpToLatest() {
    const transcript = transcriptRef.current
    shouldFollowRef.current = true
    setShowJump(false)
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }

  return { transcriptRef, showJump, setShowJump, handleTranscriptScroll, jumpToLatest }
}
