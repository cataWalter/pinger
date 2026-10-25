import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WAVEFORM_BARS } from './audioWaveform'
import { VoiceMessagePlayer } from './VoiceMessagePlayer'

type Props = Parameters<typeof VoiceMessagePlayer>[0]

function renderPlayer(overrides: Partial<Props> = {}) {
  const props: Props = {
    label: 'voice.ogg',
    waveformKey: 'mxc://example/voice',
    durationMs: 19840,
    sizeBytes: 1024,
    source: '',
    onRequestSource: vi.fn(async () => 'blob:voice'),
    onEnded: vi.fn(),
    ...overrides,
  }
  const view = render(<VoiceMessagePlayer {...props} />)
  return { ...view, props }
}

function audioElement(container: HTMLElement) {
  const audio = container.querySelector('audio')
  if (!audio) throw new Error('audio element missing')
  return audio
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('VoiceMessagePlayer', () => {
  it('requests the media on first play and starts it once the source arrives', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const onRequestSource = vi.fn(async () => 'blob:voice')
    const { container, rerender, props } = renderPlayer({ onRequestSource })

    const slider = screen.getByRole('slider', { name: 'Seek voice.ogg' })
    expect(slider.getAttribute('aria-disabled')).toBe('true')
    expect(document.querySelectorAll('.voice-waveform-bar')).toHaveLength(WAVEFORM_BARS)

    fireEvent.click(screen.getByRole('button', { name: 'Play audio' }))
    await waitFor(() => expect(onRequestSource).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1))
    expect(audioElement(container).getAttribute('src')).toBe('blob:voice')

    rerender(<VoiceMessagePlayer {...props} source="blob:voice" />)
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1))
  })

  it('requests and plays the next voice note when auto-play starts without a source', async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const onRequestSource = vi.fn(async () => 'blob:next-voice')
    const { container } = renderPlayer({ autoPlay: true, onRequestSource })

    await waitFor(() => expect(onRequestSource).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1))
    expect(audioElement(container).getAttribute('src')).toBe('blob:next-voice')
  })

  it('pauses while playing and returns the label to Play audio', async () => {
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const { container } = renderPlayer({ source: 'blob:voice' })
    const audio = audioElement(container)
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false })

    fireEvent.play(audio)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause audio' }))
    expect(pauseSpy).toHaveBeenCalledTimes(1)

    fireEvent.pause(audio)
    expect(screen.getByRole('button', { name: 'Play audio' }).getAttribute('aria-label')).toBe('Play audio')
  })

  it('seeks from the keyboard with the arrow, home and end keys', () => {
    const { container } = renderPlayer({ source: 'blob:voice' })
    const audio = audioElement(container)
    const slider = screen.getByRole('slider', { name: 'Seek voice.ogg' })

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider.getAttribute('aria-valuenow')).toBe('5')
    expect(slider.getAttribute('aria-valuetext')).toBe('0:05 of 0:19')
    expect(audio.currentTime).toBe(5)

    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider.getAttribute('aria-valuenow')).toBe('19.84')

    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slider.getAttribute('aria-valuenow')).toBe('0')
  })

  it('cycles the playback speed through 1x, 1.5x and 2x', () => {
    const { container } = renderPlayer({ source: 'blob:voice' })
    const audio = audioElement(container)

    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 1x' }))
    expect(audio.playbackRate).toBe(1.5)

    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 1.5x' }))
    expect(audio.playbackRate).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 2x' }))
    expect(audio.playbackRate).toBe(1)
  })

  it('shows elapsed time and fills the played bars as playback advances', () => {
    const { container } = renderPlayer({ source: 'blob:voice' })
    const audio = audioElement(container)

    audio.currentTime = 10
    fireEvent.timeUpdate(audio)

    expect(container.querySelector('.audio-clock')?.textContent).toBe('0:10 / 0:19')
    expect(container.querySelectorAll('.voice-waveform-bar.is-played')).toHaveLength(Math.round((10 / 19.84) * WAVEFORM_BARS))
  })

  it('resets to the start and reports the end of the voice note', () => {
    const onEnded = vi.fn()
    const { container } = renderPlayer({ source: 'blob:voice', onEnded })
    const audio = audioElement(container)

    fireEvent.play(audio)
    audio.currentTime = 19
    fireEvent.timeUpdate(audio)
    fireEvent.ended(audio)

    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Play audio' }).getAttribute('aria-label')).toBe('Play audio')
    expect(container.querySelector('.audio-clock')?.textContent).toBe('0:00 / 0:19')
  })

  it('shows the browser playback failure message', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('Playback was blocked.'))
    renderPlayer({ source: 'blob:voice' })

    fireEvent.click(screen.getByRole('button', { name: 'Play audio' }))
    expect((await screen.findByRole('status')).textContent).toBe('Playback was blocked.')
  })

  it('shows an error when the audio file cannot be decoded', () => {
    const { container } = renderPlayer({ source: 'blob:voice' })

    fireEvent.error(audioElement(container))
    expect(screen.getByRole('status').textContent).toBe('This audio file could not be played.')
  })
})
