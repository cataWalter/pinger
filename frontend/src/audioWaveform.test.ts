import { afterEach, describe, expect, it, vi } from 'vitest'
import { WAVEFORM_BARS, decodeWaveformPeaks, placeholderWaveform, waveformPeaks } from './audioWaveform'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('waveformPeaks', () => {
  it('buckets by absolute peak and scales the loudest bucket to 1', () => {
    expect(waveformPeaks([0, 0.25, 0.5, -1], 2)).toEqual([0.25, 1])
  })

  it('returns zeros for silence', () => {
    expect(waveformPeaks([0, 0, 0, 0], 2)).toEqual([0, 0])
  })

  it('returns no bars for empty input or a non-positive bar count', () => {
    expect(waveformPeaks([], 4)).toEqual([])
    expect(waveformPeaks([0.5], 0)).toEqual([])
  })

  it('keeps trailing bars at zero when there are more bars than samples', () => {
    expect(waveformPeaks([0.5, -0.5], 4)).toEqual([1, 1, 0, 0])
  })
})

describe('placeholderWaveform', () => {
  it('returns one value per bar', () => {
    expect(placeholderWaveform('$event:example', WAVEFORM_BARS)).toHaveLength(WAVEFORM_BARS)
  })

  it('is stable for the same seed and differs between seeds', () => {
    expect(placeholderWaveform('mxc://a', 16)).toEqual(placeholderWaveform('mxc://a', 16))
    expect(placeholderWaveform('mxc://a', 16)).not.toEqual(placeholderWaveform('mxc://b', 16))
  })

  it('keeps every bar between 0.25 and 1', () => {
    for (const value of placeholderWaveform('mxc://bounds', 200)) {
      expect(value).toBeGreaterThanOrEqual(0.25)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

describe('decodeWaveformPeaks', () => {
  it('returns null without fetching when the webview has no AudioContext', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    vi.stubGlobal('fetch', fetchMock)

    await expect(decodeWaveformPeaks('https://example.test/voice.ogg', 2)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('decodes the first channel into peaks and closes the context', async () => {
    const closeContext = vi.fn(() => Promise.resolve())
    class FakeAudioContext {
      decodeAudioData = async () => ({ getChannelData: () => new Float32Array([0, 0.25, 0.5, 1]) })
      close = closeContext
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))

    await expect(decodeWaveformPeaks('https://example.test/voice.ogg', 2)).resolves.toEqual([0.25, 1])
    expect(closeContext).toHaveBeenCalledTimes(1)
  })

  it('returns null when the file cannot be fetched', async () => {
    const closeContext = vi.fn(() => Promise.resolve())
    class FakeAudioContext {
      decodeAudioData = async () => ({ getChannelData: () => new Float32Array([1]) })
      close = closeContext
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))

    await expect(decodeWaveformPeaks('https://example.test/missing.ogg', 2)).resolves.toBeNull()
    expect(closeContext).toHaveBeenCalledTimes(1)
  })
})
