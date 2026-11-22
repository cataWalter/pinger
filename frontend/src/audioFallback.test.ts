import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeOggOpusToWavURL } from './audioFallback'
import { encodePcmWav } from './recording'

const decoder = vi.hoisted(() => ({ decodeFile: vi.fn(), free: vi.fn() }))

vi.mock('ogg-opus-decoder', () => ({
  OggOpusDecoder: class {
    ready = Promise.resolve()
    decodeFile = decoder.decodeFile
    free = decoder.free
  },
}))

vi.mock('./recording', () => ({
  encodePcmWav: vi.fn(() => new Blob(['wav'], { type: 'audio/wav' })),
}))

const createObjectURL = vi.fn(() => 'blob:decoded-voice')

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([79, 103, 103, 83]))))
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(URL, 'createObjectURL')
})

describe('decodeOggOpusToWavURL', () => {
  it('mixes decoded channels to mono and returns a WAV object URL', async () => {
    decoder.decodeFile.mockResolvedValue({
      channelData: [new Float32Array([0.5, -0.5]), new Float32Array([0.5, 0.5])],
      samplesDecoded: 2,
      sampleRate: 48000,
      errors: [],
    })

    await expect(decodeOggOpusToWavURL('/media/matrix/room/event')).resolves.toBe('blob:decoded-voice')

    expect(fetch).toHaveBeenCalledWith('/media/matrix/room/event')
    expect(encodePcmWav).toHaveBeenCalledWith(new Float32Array([0.5, 0]), 48000)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(decoder.free).toHaveBeenCalledTimes(1)
  })

  it('rejects when the media request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))

    await expect(decodeOggOpusToWavURL('/media/matrix/room/missing')).rejects.toThrow('Audio request failed with status 404.')
    expect(decoder.decodeFile).not.toHaveBeenCalled()
  })

  it('rejects and frees the decoder when no samples can be decoded', async () => {
    decoder.decodeFile.mockResolvedValue({ channelData: [new Float32Array()], samplesDecoded: 0, sampleRate: 48000, errors: [] })

    await expect(decodeOggOpusToWavURL('/media/matrix/room/event')).rejects.toThrow('Audio contains no decodable samples.')
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(decoder.free).toHaveBeenCalledTimes(1)
  })
})
