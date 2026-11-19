import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Copy, FileText, Sparkles, X, Download, ZoomIn, ZoomOut } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { type Message } from '../bindings/mychat/desktop/models.js'
import { AI_ACTION_SHORTCUTS } from './aiSettings'
import { matrixMediaPreviewURL, matrixMediaURL } from './ChatMediaRenderer'
import { VoiceMessagePlayer } from './VoiceMessagePlayer'
import { DialogSurface } from './DialogSurface'
import { observeMediaVisibility } from './avatar'
import { describeError } from './messages'
import { formatBytes } from './format'
import { primaryShiftShortcutLabel } from './actionMenu'

export function MessageMedia({ roomID, message, onAudioEnded, autoPlayNext, aiEnabled, canUseDraft, onUseDraft }: {
  roomID: string
  message: Message
  onAudioEnded?: () => void
  autoPlayNext?: boolean
  aiEnabled: boolean
  canUseDraft: boolean
  onUseDraft: (text: string) => void
}) {
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [transcription, setTranscription] = useState('')
  const [transcriptionLoading, setTranscriptionLoading] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState('')
  const [transcriptCopyFeedback, setTranscriptCopyFeedback] = useState('')
  const [viewerOpen, setViewerOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [copyFeedback, setCopyFeedback] = useState('')
  const [nearViewport, setNearViewport] = useState(false)
  const attachmentRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef('')
  const mountedRef = useRef(false)
  const nearViewportRef = useRef(false)
  const loadingRef = useRef(false)
  const mimeType = message.mediaMime || 'application/octet-stream'
  const isImage = mimeType.startsWith('image/')
  const isAudio = mimeType.startsWith('audio/') || message.mediaType === 'm.audio'
  const isVideo = !isAudio && mimeType.startsWith('video/')
  const filename = message.body.trim() || 'matrix-attachment'
  const fileType = mimeType === 'application/pdf' ? 'PDF document' : mimeType.startsWith('text/') ? 'Text document' : 'File attachment'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sourceRef.current = ''
    }
  }, [])

  useEffect(() => {
    sourceRef.current = ''
    setSource('')
    setError('')
  }, [roomID, message.id])

  useEffect(() => {
    if (!viewerOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setViewerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [viewerOpen])

  useEffect(() => {
    if (!isImage) return
    const attachment = attachmentRef.current
    if (!attachment) return
    return observeMediaVisibility(attachment, (isNearViewport) => {
      nearViewportRef.current = isNearViewport
      setNearViewport(isNearViewport)
    })
  }, [isImage, roomID, message.id])

  const prepareMediaRef = useRef(prepareMedia)
  prepareMediaRef.current = prepareMedia

  useEffect(() => {
    if (isImage && nearViewport) void prepareMediaRef.current()
  }, [isImage, nearViewport, roomID, message.id])

  useEffect(() => {
    if (!isImage || nearViewport || !sourceRef.current) return
    sourceRef.current = ''
    setSource('')
  }, [isImage, nearViewport, source])

  async function prepareMedia() {
    if (source) return source
    if (loadingRef.current) return ''
    loadingRef.current = true
    setLoading(true)
    setError('')
    try {
      const mediaURL = matrixMediaURL(roomID, message.id)
      if (!mediaURL) throw new Error('This media event has no server ID.')
      if (!mountedRef.current || (isImage && !nearViewportRef.current)) return ''
      sourceRef.current = mediaURL
      setSource(mediaURL)
      return mediaURL
    } catch (mediaError) {
      setError(describeError(mediaError))
      return ''
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  async function openImage() {
    if (await prepareMedia()) {
      setZoom(1)
      setCopyFeedback('')
      setViewerOpen(true)
    }
  }

  async function downloadFile() {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError('')
    setSavedPath('')
    try {
      const path = await AppService.SaveMedia(message.mediaUri, filename)
      if (path) setSavedPath(path)
    } catch (downloadError) {
      setError(describeError(downloadError))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  async function revealSavedFile() {
    if (!savedPath) return
    try {
      await AppService.RevealFile(savedPath)
    } catch (revealError) {
      setError(describeError(revealError))
    }
  }

  function renderSavedFile() {
    return (
      <>
        Saved to{' '}
        <button className="media-reveal" type="button" title="Show in file manager" onClick={() => void revealSavedFile()}>{savedPath}</button>
      </>
    )
  }

  async function transcribeAudio() {
    if (!aiEnabled || transcriptionLoading) return
    setTranscriptionLoading(true)
    setTranscriptionError('')
    setTranscription('')
    setTranscriptCopyFeedback('')
    try {
      const result = (await AppService.AITranscribeMedia(message.mediaUri, filename, mimeType)).trim()
      if (!result) throw new Error('The AI endpoint returned an empty transcription.')
      if (mountedRef.current) setTranscription(result)
    } catch (transcriptionError) {
      if (mountedRef.current) setTranscriptionError(describeError(transcriptionError))
    } finally {
      if (mountedRef.current) setTranscriptionLoading(false)
    }
  }

  async function copyTranscript() {
    setTranscriptCopyFeedback('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is not available.')
      await navigator.clipboard.writeText(transcription)
      if (mountedRef.current) setTranscriptCopyFeedback('Transcript copied')
    } catch (copyError) {
      if (mountedRef.current) setTranscriptCopyFeedback(describeError(copyError))
    }
  }

  async function copyImage() {
    setCopyFeedback('')
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Image copying is not supported by this webview.')
      }
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not prepare the image for copying.')
      context.drawImage(image, 0, 0)
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the image.')), 'image/png')
      })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setCopyFeedback('Image copied')
    } catch (copyError) {
      setCopyFeedback(describeError(copyError))
    }
  }

  return (
    <div ref={attachmentRef} className={`message-attachment ${isAudio ? 'audio-attachment' : ''} ${isImage ? 'is-image' : ''}`}>
      {isAudio && <VoiceMessagePlayer key={message.id} label={filename} waveformKey={message.mediaUri} durationMs={message.mediaDurationMs} sizeBytes={message.mediaSize} source={source} autoPlay={autoPlayNext} onRequestSource={prepareMedia} onEnded={onAudioEnded} />}
      {isAudio && <div className="audio-attachment-footer">
        <span className="audio-filename" title={filename}>{filename}</span>
        <button className="icon-button audio-download" type="button" title={loading ? `Saving ${filename}` : `Download ${filename}`} aria-label={loading ? `Saving ${filename}` : `Download ${filename}`} disabled={loading} onClick={() => void downloadFile()}>{loading ? <span className="loading-mark" /> : <Download size={15} />}</button>
      </div>}
      {isAudio && savedPath && <small className="audio-download-status" role="status">{renderSavedFile()}</small>}
      {isAudio && <div className="audio-transcription-controls">
        <button className="audio-transcribe-button" type="button" aria-label={transcriptionLoading ? 'Transcribing audio' : 'Transcribe with AI'} aria-keyshortcuts={`Control+Shift+${AI_ACTION_SHORTCUTS.transcribeAudio.key} Meta+Shift+${AI_ACTION_SHORTCUTS.transcribeAudio.key}`} title={`${aiEnabled ? 'Upload this audio to the configured endpoint for transcription.' : 'Set an AI endpoint in Settings > AI.'} (${primaryShiftShortcutLabel(AI_ACTION_SHORTCUTS.transcribeAudio.key)})`} disabled={!aiEnabled || transcriptionLoading} onClick={() => void transcribeAudio()}>
          {transcriptionLoading ? <span className="loading-mark" /> : <Sparkles size={14} />}
          {transcriptionLoading ? 'Transcribing…' : 'Transcribe with AI'}
          <kbd aria-hidden="true">{primaryShiftShortcutLabel(AI_ACTION_SHORTCUTS.transcribeAudio.key)}</kbd>
        </button>
        <small>{aiEnabled ? 'Audio is sent to the configured endpoint, which may be remote.' : 'Set an AI endpoint in Settings > AI to transcribe audio.'}</small>
      </div>}
      {transcriptionLoading && <p className="audio-transcription-status" role="status">Transcribing audio…</p>}
      {transcriptionError && <span className="media-error" role="alert">{transcriptionError}</span>}
      {transcription && <section className="audio-transcript" aria-label="Audio transcript">
        <header className="audio-transcript-header">
          <strong>Transcript</strong>
          <div className="audio-transcript-actions">
            <button className="icon-button audio-transcript-copy" type="button" title="Copy transcript" aria-label="Copy transcript" onClick={() => void copyTranscript()}><Copy size={14} /></button>
            <button className="audio-transcript-draft" type="button" title={canUseDraft ? 'Put this transcript in the message composer' : 'Finish editing the current message first'} disabled={!canUseDraft} onClick={() => onUseDraft(transcription)}><ArrowUpRight size={13} />Use as draft</button>
          </div>
        </header>
        <p>{transcription}</p>
        {transcriptCopyFeedback && <span className="audio-transcript-feedback" role="status">{transcriptCopyFeedback}</span>}
      </section>}
      {!source && (isImage || isVideo) && <button className="media-load" type="button" title={loading ? 'Loading media' : `Load ${filename}`} disabled={loading} onClick={() => void prepareMedia()}>
        <Download size={14} />{loading ? 'Loading media…' : isImage ? `Preview ${filename}` : 'Load video'}
        {message.mediaSize > 0 && <span>{formatBytes(message.mediaSize)}</span>}
      </button>}
      {error && <span className="media-error" role="status">{error}</span>}
      {source && isImage && <>
        <button className="media-preview-button" type="button" aria-label={`Open image ${filename}`} title={`Open image ${filename}`} onClick={() => void openImage()}>
          <img className="media-preview" src={matrixMediaPreviewURL(roomID, message.id)} alt={filename} loading="lazy" onError={() => setError('This image could not be loaded.')} />
        </button>
        <div className="media-toolbar"><button className="media-download" type="button" aria-label={`Download ${filename}`} onClick={() => void downloadFile()}><Download size={13} />Download</button>{savedPath && <small className="media-download-status" role="status">{renderSavedFile()}</small>}</div>
      </>}
      {source && isVideo && <>
        <video className="media-player" controls preload="metadata" src={source} aria-label={filename} onError={() => setError('This video could not be played.')} />
        <button className="media-download" type="button" onClick={() => void downloadFile()}><Download size={13} />Download {filename}</button>
        {savedPath && <small className="media-download-status" role="status">{renderSavedFile()}</small>}
      </>}
      {!isImage && !isAudio && !isVideo && <div className="file-card">
        <span className="file-card-icon"><FileText size={17} /></span>
        <span className="file-card-copy"><strong title={filename}>{filename}</strong><small>{fileType}{message.mediaSize > 0 && ` · ${formatBytes(message.mediaSize)}`}</small>{savedPath && <small className="media-download-status" role="status">{renderSavedFile()}</small>}</span>
        <button className="icon-button" type="button" title={loading ? `Saving ${filename}` : `Download ${filename}`} aria-label={loading ? `Saving ${filename}` : `Download ${filename}`} disabled={loading} onClick={() => void downloadFile()}>{loading ? <span className="loading-mark" /> : <Download size={15} />}</button>
      </div>}
      {viewerOpen && source && createPortal(
        <div className="media-viewer-scrim" role="presentation" onClick={() => setViewerOpen(false)}>
          <DialogSurface className="media-viewer" label={`Preview ${filename}`} onClose={() => setViewerOpen(false)} onClick={(event) => event.stopPropagation()}>
            <header className="media-viewer-toolbar">
              <strong>{filename}</strong>
              <div>
                <button className="icon-button" type="button" title="Zoom out" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((current) => Math.max(1, current / 1.25))}><ZoomOut size={15} /></button>
                <button className="icon-button" type="button" title="Zoom in" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((current) => Math.min(4, current * 1.25))}><ZoomIn size={15} /></button>
                <button className="icon-button" type="button" title="Copy image" aria-label="Copy image" onClick={() => void copyImage()}><Copy size={14} /></button>
                <button className="media-download" type="button" onClick={() => void downloadFile()}><Download size={14} />Download</button>
                <button className="icon-button" type="button" aria-label="Close image preview" title="Close image preview" onClick={() => setViewerOpen(false)}><X size={15} /></button>
              </div>
            </header>
            {copyFeedback && <span className="media-viewer-feedback" role="status">{copyFeedback}</span>}
            {savedPath && <span className="media-viewer-feedback" role="status">{renderSavedFile()}</span>}
            <div className="media-viewer-image-wrap">
              <img className="media-viewer-image" src={source} alt={filename} style={{ maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? 'calc(100vh - 100px)' : 'none', transform: `scale(${zoom})` }} />
            </div>
          </DialogSurface>
        </div>,
        document.body,
      )}
    </div>
  )
}
