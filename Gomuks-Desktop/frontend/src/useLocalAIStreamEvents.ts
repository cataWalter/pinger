import { Events } from '@wailsio/runtime'
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { LocalAIChatStreamChunk, LocalAIImageProgress, LocalAIImageRun, LocalAIRun } from './localAIChatTypes'

type LocalAIStreamEventsOptions = {
  runRef: { current: LocalAIRun | null }
  imageRunRef: { current: LocalAIImageRun | null }
  setRunView: Dispatch<SetStateAction<LocalAIRun | null>>
  setImageRun: Dispatch<SetStateAction<LocalAIImageRun | null>>
}

// Applies backend stream and image progress events to the run that is currently in flight.
export function useLocalAIStreamEvents({ runRef, imageRunRef, setRunView, setImageRun }: LocalAIStreamEventsOptions) {
  useEffect(() => {
    let frame: number | null = null
    const off = Events.On('local-ai:stream', (event: { data: unknown }) => {
      const chunk = event.data as LocalAIChatStreamChunk | undefined
      const run = runRef.current
      if (!run || !chunk || chunk.requestId !== run.requestId || !chunk.text) return
      run.text += chunk.text
      // Chunks can arrive faster than the screen refreshes, so render at most once per frame.
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const current = runRef.current
        if (current) setRunView({ ...current })
      })
    })
    return () => {
      off()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [runRef, setRunView])

  useEffect(() => Events.On('local-ai:image-progress', (event: { data: unknown }) => {
    const update = event.data as LocalAIImageProgress | undefined
    const run = imageRunRef.current
    if (!run || !update || update.requestId !== run.requestId) return
    run.stage = update.stage
    run.step = update.step
    run.totalSteps = update.totalSteps
    if (update.preview) run.preview = update.preview
    setImageRun({ ...run })
  }), [imageRunRef, setImageRun])
}
