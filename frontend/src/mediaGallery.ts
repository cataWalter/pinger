import { type Message } from '../bindings/mychat/desktop/models.js'
import { type MediaGalleryFilter } from './appTypes'

export function mediaGalleryCategory(message: Message): Exclude<MediaGalleryFilter, 'all'> {
  if (message.mediaMime.startsWith('audio/') || message.mediaType === 'm.audio') return 'audio'
  if (message.mediaMime.startsWith('image/') || message.mediaType === 'm.image') return 'images'
  if (message.mediaMime.startsWith('video/') || message.mediaType === 'm.video') return 'videos'
  return 'files'
}

export function filterMediaGalleryItems(items: Message[], filter: MediaGalleryFilter) {
  return filter === 'all' ? items : items.filter((message) => mediaGalleryCategory(message) === filter)
}

export function hasGalleryMedia(message: Message) {
  return Boolean(message.mediaUri && !message.redacted && !message.decryptionError)
}

export function mediaGalleryMessageKey(message: Message) {
  return message.id || message.transactionId || `${message.timestamp}:${message.sender}:${message.mediaUri}:${message.body}`
}
