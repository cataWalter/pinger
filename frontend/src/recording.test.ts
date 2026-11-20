import { describe, expect, it, vi } from 'vitest'
import { encodePcmWav, startPcmVoiceCapture } from './recording'

function readBlob(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

describe('encodePcmWav', () => {
  it('writes a 16-bit mono WAV header and clamps out-of-range samples', async () => {
    const blob = encodePcmWav(Float32Array.of(0, 2, -2), 8000)
    expect(blob.type).toBe('audio/wav')

    const view = new DataView(await readBlob(blob))
    const text = (offset: number, length: number) => String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)))
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(text(36, 4)).toBe('data')
    expect(view.getUint32(24, true)).toBe(8000)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(-32768)
  })
})

describe('startPcmVoiceCapture', () => {
  it('concatenates captured blocks at the context sample rate and closes the context on stop', () => {
    const close = vi.fn(async () => undefined)
    const processor = {
      onaudioprocess: null as ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null,
      connect: vi.fn(() => {
        processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => Float32Array.of(0.5, -0.5) } })
        processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => Float32Array.of(0.25) } })
      }),
      disconnect: vi.fn(),
    }
    const context = {
      sampleRate: 16000,
      destination: {},
      resume: vi.fn(async () => undefined),
      close,
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      createScriptProcessor: vi.fn(() => processor),
    }

    const capture = startPcmVoiceCapture(context as unknown as AudioContext, {} as MediaStream)
    const { samples, sampleRate } = capture.stop()

    expect(Array.from(samples)).toEqual([0.5, -0.5, 0.25])
    expect(sampleRate).toBe(16000)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
