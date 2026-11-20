import { type MediaApprovalItem } from './appTypes'

// mediaKindForFile returns the approval category for a file. Anything that is not an image, video, or audio file is a plain file.
export function mediaKindForFile(file: File): MediaApprovalItem['kind'] {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'file'
}

export function mediaApprovalItemFromFile(key: string, file: File, previewURL: string): MediaApprovalItem {
  return { key, name: file.name || 'Attachment', kind: mediaKindForFile(file), sizeBytes: file.size, previewURL }
}

export function preferredVideoMimeType() {
  return ['video/mp4', 'video/webm'].find((type) => MediaRecorder.isTypeSupported?.(type)) ?? ''
}

export async function requestLocalAsset(path: string, init: RequestInit) {
  const response = await fetch(path, init)
  if (!response.ok) {
    const detail = (await response.text()).trim()
    throw new Error(detail || `Local request failed with status ${response.status}.`)
  }
  return response
}

export type PcmVoiceCapture = { stop: () => { samples: Float32Array; sampleRate: number } }

// startPcmVoiceCapture reads microphone samples through Web Audio. The context must be created inside the click that starts recording, or WebKit keeps it suspended and no samples arrive.
export function startPcmVoiceCapture(context: AudioContext, stream: MediaStream): PcmVoiceCapture {
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const blocks: Float32Array[] = []
  processor.onaudioprocess = (event) => { blocks.push(new Float32Array(event.inputBuffer.getChannelData(0))) }
  source.connect(processor)
  // The processor only runs while connected to the destination; it writes no output, so nothing is played back.
  processor.connect(context.destination)
  void context.resume().catch(() => { })
  return {
    stop() {
      processor.onaudioprocess = null
      source.disconnect()
      processor.disconnect()
      void context.close().catch(() => { })
      const samples = new Float32Array(blocks.reduce((total, block) => total + block.length, 0))
      let offset = 0
      for (const block of blocks) {
        samples.set(block, offset)
        offset += block.length
      }
      return { samples, sampleRate: context.sampleRate }
    },
  }
}

export function encodePcmWav(samples: Float32Array, sampleRate: number) {
  const dataLength = samples.length * 2
  if (dataLength + 44 > 50 * 1024 * 1024) throw new Error('Voice note cannot exceed 50 MiB.')
  const buffer = new ArrayBuffer(dataLength + 44)
  const view = new DataView(buffer)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, dataLength + 36, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataLength, true)
  for (let frame = 0; frame < samples.length; frame++) {
    const clamped = Math.max(-1, Math.min(1, samples[frame]))
    view.setInt16(44 + frame * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
