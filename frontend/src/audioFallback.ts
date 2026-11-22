import { encodePcmWav } from './recording'

export async function decodeOggOpusToWavURL(source: string): Promise<string> {
  const response = await fetch(source)
  if (!response.ok) throw new Error(`Audio request failed with status ${response.status}.`)
  const { OggOpusDecoder } = await import('ogg-opus-decoder')
  const decoder = new OggOpusDecoder()
  try {
    await decoder.ready
    const decoded = await decoder.decodeFile(new Uint8Array(await response.arrayBuffer()))
    if (decoded.samplesDecoded === 0) throw new Error('Audio contains no decodable samples.')
    const wav = encodePcmWav(mixToMono(decoded.channelData, decoded.samplesDecoded), decoded.sampleRate)
    return URL.createObjectURL(wav)
  } finally {
    decoder.free()
  }
}

function mixToMono(channels: Float32Array[], length: number) {
  const mono = new Float32Array(length)
  for (const channel of channels) {
    for (let index = 0; index < length; index++) mono[index] += channel[index] / channels.length
  }
  return mono
}
