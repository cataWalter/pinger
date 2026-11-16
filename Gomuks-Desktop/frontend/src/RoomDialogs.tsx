import { ArrowUpRight, RotateCcw, X } from 'lucide-react'
import type { Message, Room } from '../bindings/mychat/desktop/models.js'
import { DialogSurface } from './DialogSurface'
import {
  MEDIA_GALLERY_FILTERS,
  MessageMedia,
  displayMessageBody,
  filterMediaGalleryItems,
  formatMediaGalleryDateTime,
  mediaGalleryCategory,
  mediaGalleryMessageKey,
  preferenceString,
  type MediaGalleryFilter,
  type PreferenceValues,
} from './appShared'

export function ForwardMessageDialog({ message, destinations, targetRoomID, busy, error, onTargetChange, onClose, onConfirm }: {
  message: Message
  destinations: Room[]
  targetRoomID: string
  busy: boolean
  error: string
  onTargetChange: (roomID: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="room-info-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <DialogSurface className="room-info-dialog forward-message-dialog" labelledBy="forward-message-title" onClose={onClose} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header">
          <div><span className="eyebrow">FORWARD MESSAGE</span><h2 id="forward-message-title">Forward message</h2></div>
          <button className="icon-button" type="button" aria-label="Close forward message" title="Close forward message" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="room-info-content forward-message-content">
          <div className="forward-message-preview">{displayMessageBody(message)}</div>
          <label className="forward-message-destination"><span>Send to</span><select aria-label="Forward destination" value={targetRoomID} onChange={(event) => onTargetChange(event.target.value)}>
            {destinations.map((room) => <option key={room.id} value={room.id}>{room.name || room.id}</option>)}
          </select></label>
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
        <div className="forward-message-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="is-primary" type="button" onClick={onConfirm} disabled={busy || !targetRoomID}><ArrowUpRight size={15} />{busy ? 'Forwarding...' : 'Forward'}</button>
        </div>
      </DialogSurface>
    </div>
  )
}

export function MediaGalleryDialog({ roomID, roomName, items, filter, loading, scanned, error, preferences, onFilterChange, onClose, onRetry }: {
  roomID: string
  roomName: string
  items: Message[]
  filter: MediaGalleryFilter
  loading: boolean
  scanned: number
  error: string
  preferences: PreferenceValues
  onFilterChange: (filter: MediaGalleryFilter) => void
  onClose: () => void
  onRetry: () => void
}) {
  const visible = filterMediaGalleryItems(items, filter)
  return (
    <div className="media-gallery-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <DialogSurface className="media-gallery-dialog" labelledBy="media-gallery-title" onClose={onClose} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header media-gallery-header">
          <div><span className="eyebrow">ROOM MEDIA</span><h2 id="media-gallery-title">Media in {roomName}</h2></div>
          <button className="icon-button" type="button" aria-label="Close media gallery" title="Close media gallery" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="media-gallery-toolbar">
          <div className="media-gallery-filters" role="group" aria-label="Filter media">
            {MEDIA_GALLERY_FILTERS.map((option) => (
              <button key={option.value} className="media-gallery-filter" type="button" aria-label={`${option.label}, ${filterMediaGalleryItems(items, option.value).length}`} aria-pressed={filter === option.value} onClick={() => onFilterChange(option.value)}>
                {option.label}<span>{filterMediaGalleryItems(items, option.value).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="media-gallery-content">
          {loading && <p className="media-gallery-status" role="status">Scanning room history, {scanned} messages checked.</p>}
          {error && <div className="media-gallery-error" role="alert"><span>{error}</span><button className="media-gallery-retry" type="button" onClick={onRetry}><RotateCcw size={14} />Retry</button></div>}
          {visible.length === 0
            ? <p className="media-gallery-empty">{loading ? 'No media found yet.' : `No ${filter === 'all' ? 'media' : filter} in this room.`}</p>
            : <div className="media-gallery-grid">
              {visible.map((message) => (
                <article key={mediaGalleryMessageKey(message)} className="media-gallery-item" aria-label={`${mediaGalleryCategory(message)} attachment ${message.body || 'attachment'} from ${message.senderName || message.sender}`}>
                  <div className="media-gallery-item-meta">
                    <span title={message.senderName || message.sender}>{message.senderName || message.sender || 'Unknown sender'}</span>
                    {message.timestamp > 0 && <time dateTime={new Date(message.timestamp).toISOString()}>{formatMediaGalleryDateTime(message.timestamp, preferences)}</time>}
                  </div>
                  <MessageMedia roomID={roomID} message={message} aiEnabled={Boolean(preferenceString(preferences, 'ai.endpoint', '').trim())} canUseDraft={false} onUseDraft={() => { }} />
                </article>
              ))}
            </div>}
        </div>
      </DialogSurface>
    </div>
  )
}
