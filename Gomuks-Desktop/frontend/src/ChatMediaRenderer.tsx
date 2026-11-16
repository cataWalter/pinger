type MediaKind = 'image' | 'audio' | 'video'

export function matrixMediaURL(roomID: string, eventID: string) {
  if (!roomID || !eventID) return ''
  return `/media/matrix/${encodeURIComponent(roomID)}/${encodeURIComponent(eventID)}`
}

export function matrixMXCMediaURL(uri: string) {
  const match = /^mxc:\/\/([^/]+)\/([^/]+)$/.exec(uri)
  if (!match) return ''
  return `/media/mxc/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`
}

export default function ChatMediaRenderer({ roomID, eventID, kind, alt = '', className }: {
  roomID: string
  eventID: string
  kind: MediaKind
  alt?: string
  className?: string
}) {
  const src = matrixMediaURL(roomID, eventID)
  if (!src) return null

  if (kind === 'image') return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" />
  if (kind === 'audio') return <audio className={className} controls preload="metadata" src={src} aria-label={alt || 'Audio attachment'} />
  return <video className={className} controls preload="metadata" src={src} aria-label={alt || 'Video attachment'} />
}