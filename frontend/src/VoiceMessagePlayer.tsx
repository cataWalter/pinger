import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { WAVEFORM_BARS, decodeWaveformPeaks, placeholderWaveform } from './audioWaveform'

const PLAYBACK_RATES = [1, 1.5, 2]
const SEEK_STEP_SECONDS = 5
const WAVEFORM_DECODE_MAX_BYTES = 50 * 1024 * 1024
const waveformCache = new Map<string, number[]>()

export function formatAudioTime(seconds: number) {
  const totalSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

async function startPlayback(player: HTMLAudioElement, onFailure: (message: string) => void) {
  try {
    await player.play()
  } catch (playError) {
    onFailure(playError instanceof Error ? playError.message : 'Audio playback failed.')
  }
}

export function VoiceMessagePlayer({ label, waveformKey, durationMs, sizeBytes, source, autoPlay, onRequestSource, onEnded }: {
  label: string
  waveformKey: string
  durationMs: number
  sizeBytes: number
  source: string
  autoPlay?: boolean
  onRequestSource: () => Promise<string>
  onEnded?: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(Math.max(0, durationMs / 1000))
  const [rate, setRate] = useState(1)
  const [loading, setLoading] = useState(false)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [playerError, setPlayerError] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const pendingPlayRef = useRef(false)
  const autoPlayAttemptedRef = useRef(false)
  const requestAndPlayRef = useRef<() => void>(() => { })
  const scrubbingRef = useRef(false)
  const placeholder = useMemo(() => placeholderWaveform(waveformKey || label, WAVEFORM_BARS), [waveformKey, label])
  const bars = peaks ?? placeholder
  const canSeek = source !== '' && duration > 0
  const playedBars = duration > 0 ? Math.round(Math.min(currentTime / duration, 1) * WAVEFORM_BARS) : 0

  useEffect(() => {
    if (!source) return
    const cached = waveformCache.get(waveformKey)
    if (cached) {
      setPeaks(cached)
      return
    }
    if (sizeBytes > WAVEFORM_DECODE_MAX_BYTES) return
    let cancelled = false
    void decodeWaveformPeaks(source, WAVEFORM_BARS).then((decoded) => {
      if (!decoded) return
      waveformCache.set(waveformKey, decoded)
      if (!cancelled) setPeaks(decoded)
    })
    return () => {
      cancelled = true
    }
  }, [source, waveformKey, sizeBytes])

  useEffect(() => {
    const player = audioRef.current
    if (!player) return
    if (!source) {
      if (player.hasAttribute('src')) {
        player.removeAttribute('src')
        player.load()
      }
      return
    }
    if (player.getAttribute('src') !== source) player.src = source
  }, [source])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate, source])

  useEffect(() => {
    if (!autoPlay) {
      autoPlayAttemptedRef.current = false
      return
    }
    if (autoPlayAttemptedRef.current) return
    autoPlayAttemptedRef.current = true
    requestAndPlayRef.current()
  }, [autoPlay])

  async function requestAndPlay() {
    if (pendingPlayRef.current) return
    pendingPlayRef.current = true
    setLoading(true)
    setPlayerError('')
    try {
      const url = source || await onRequestSource()
      if (!url || !audioRef.current) return
      if (audioRef.current.getAttribute('src') !== url) audioRef.current.src = url
      await startPlayback(audioRef.current, setPlayerError)
    } catch (playError) {
      setPlayerError(playError instanceof Error ? playError.message : 'Audio playback failed.')
    } finally {
      pendingPlayRef.current = false
      setLoading(false)
    }
  }

  requestAndPlayRef.current = () => { void requestAndPlay() }

  async function togglePlayback() {
    if (!source) {
      void requestAndPlay()
      return
    }
    const player = audioRef.current
    if (!player) return
    if (!player.paused) {
      setPlayerError('')
      player.pause()
      return
    }
    if (player.ended) player.currentTime = 0
    setPlayerError('')
    await startPlayback(player, setPlayerError)
  }

  function seekTo(seconds: number) {
    if (!canSeek) return
    const next = Math.min(Math.max(seconds, 0), duration)
    if (audioRef.current) audioRef.current.currentTime = next
    setCurrentTime(next)
  }

  function seekFromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width > 0) seekTo(((event.clientX - rect.left) / rect.width) * duration)
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canSeek) return
    scrubbingRef.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    seekFromPointer(event)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (scrubbingRef.current) seekFromPointer(event)
  }

  function endScrub(event: PointerEvent<HTMLDivElement>) {
    scrubbingRef.current = false
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleWaveKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!canSeek) return
    const targets: Partial<Record<string, number>> = {
      ArrowLeft: currentTime - SEEK_STEP_SECONDS,
      ArrowRight: currentTime + SEEK_STEP_SECONDS,
      Home: 0,
      End: duration,
    }
    const target = targets[event.key]
    if (target === undefined) return
    event.preventDefault()
    seekTo(target)
  }

  function cycleRate() {
    setRate((current) => PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(current) + 1) % PLAYBACK_RATES.length])
  }

  return (
    <div className="voice-player" role="group" aria-label={label} aria-busy={loading}>
      <div className="audio-player-bar">
        <button className="audio-play-button" type="button" aria-label={loading ? 'Loading audio' : playing ? 'Pause audio' : 'Play audio'} aria-pressed={playing} title={loading ? 'Loading audio' : playing ? 'Pause audio' : 'Play audio'} disabled={loading} onClick={() => void togglePlayback()}>
          {loading ? <Loader2 className="audio-loading-icon" size={15} /> : playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <div
          className="voice-waveform"
          role="slider"
          tabIndex={canSeek ? 0 : -1}
          aria-label={`Seek ${label}`}
          aria-disabled={!canSeek}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.min(currentTime, duration)}
          aria-valuetext={`${formatAudioTime(currentTime)} of ${formatAudioTime(duration)}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onKeyDown={handleWaveKeyDown}
        >
          {bars.map((level, index) => (
            <span
              key={index}
              className={index < playedBars ? 'voice-waveform-bar is-played' : 'voice-waveform-bar'}
              style={{ height: `${Math.round(Math.max(level, 0.15) * 100)}%` }}
            />
          ))}
        </div>
        <span className="audio-time audio-clock">{formatAudioTime(currentTime)} / {formatAudioTime(duration)}</span>
        <button className="voice-speed" type="button" aria-label={`Playback speed ${rate}x`} title="Playback speed" onClick={cycleRate}>{rate}x</button>
      </div>
      <audio
        ref={audioRef}
        className="audio-playback"
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
          onEnded?.()
        }}
        onError={() => setPlayerError('This audio file could not be played.')}
      />
      {playerError && <span className="media-error" role="status">{playerError}</span>}
    </div>
  )
}
