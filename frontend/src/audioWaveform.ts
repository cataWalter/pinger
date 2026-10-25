export const WAVEFORM_BARS = 48

type WebkitGlobal = typeof globalThis & { webkitAudioContext?: typeof AudioContext }

// Buckets samples by absolute peak and scales the loudest bucket to 1.
export function waveformPeaks(samples: ArrayLike<number>, bars: number): number[] {
  if (bars <= 0 || samples.length === 0) return []
  const samplesPerBar = Math.ceil(samples.length / bars)
  const peaks = Array.from({ length: bars }, (_, bar) => {
    let peak = 0
    const end = Math.min(samples.length, (bar + 1) * samplesPerBar)
    for (let index = bar * samplesPerBar; index < end; index++) {
      peak = Math.max(peak, Math.abs(samples[index]))
    }
    return peak
  })
  const loudest = Math.max(...peaks)
  return loudest > 0 ? peaks.map((peak) => peak / loudest) : peaks
}

// Decorative, deterministic shape for media whose samples are not decoded yet.
export function placeholderWaveform(seed: string, bars: number): number[] {
  let state = 2166136261
  for (let index = 0; index < seed.length; index++) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619) >>> 0
  }
  return Array.from({ length: bars }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return 0.25 + (state / 0xffffffff) * 0.75
  })
}

// Fetches and decodes the first channel of an audio file. Resolves null when the webview cannot decode it.
export async function decodeWaveformPeaks(url: string, bars: number): Promise<number[] | null> {
  const AudioContextClass = globalThis.AudioContext ?? (globalThis as WebkitGlobal).webkitAudioContext
  if (!AudioContextClass) return null
  let context: AudioContext | null = null
  try {
    context = new AudioContextClass()
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = await context.decodeAudioData(await response.arrayBuffer())
    return waveformPeaks(buffer.getChannelData(0), bars)
  } catch {
    return null
  } finally {
    void context?.close().catch(() => undefined)
  }
}
