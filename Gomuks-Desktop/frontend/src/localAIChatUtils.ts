import type { LocalAIChatAttachment, LocalAIChatMessage } from '../bindings/mychat/desktop/models.js'
import { isLocalAIImageTurn } from './localAIChats'
import type { LocalAIImageRun } from './localAIChatTypes'

export function createLocalAIRequestID() {
  return globalThis.crypto?.randomUUID?.() ?? `local-ai-${Date.now()}-${Math.random()}`
}

export function localAIImageURL(attachment: LocalAIChatAttachment) {
  return `data:${attachment.mediaType ?? ''};base64,${attachment.data ?? ''}`
}

// Clipboard screenshots often arrive without a usable file name.
export function namePastedImage(file: File, index: number) {
  if (file.name.trim()) return file
  const extension = file.type.split('/')[1] || 'png'
  return new File([file], `pasted-image-${Date.now()}-${index + 1}.${extension}`, { type: file.type })
}

// User turns that asked for an image. Editing one would send its prompt to the text model, so Edit is hidden for them.
export function localAIImagePromptSeqs(messages: LocalAIChatMessage[]) {
  const seqs = new Set<number>()
  messages.forEach((message, index) => {
    const next = messages[index + 1]
    if (message.role === 'user' && next && isLocalAIImageTurn(next)) seqs.add(message.seq)
  })
  return seqs
}

export function imageRunStatus(run: LocalAIImageRun) {
  if (run.stopping) return 'Stopping…'
  if (run.stage === 'starting') return 'Starting the image engine…'
  if (run.totalSteps > 0) return `Generating image, step ${run.step} of ${run.totalSteps}`
  return 'Generating image…'
}
