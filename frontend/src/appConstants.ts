import { type Room } from '../bindings/mychat/desktop/models.js'
import { type MediaGalleryFilter, type MediaApprovalItem } from './appTypes'

export const MEDIA_GALLERY_FILTERS: { value: MediaGalleryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'images', label: 'Images' },
  { value: 'videos', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'files', label: 'Files' },
]

export const IN_APP_NOTICE_TIMEOUT_MS = 10_000

export const EMPTY_ROOMS: Room[] = []

export const MAX_CACHED_AVATARS = 128

export const MAX_MISSING_AVATARS = 512

export const ROOM_LIST_VIRTUALIZATION_THRESHOLD = 100

export const ROOM_LIST_RANGE_PREFETCH = 20

export const ROOM_LIST_MAX_SYNC_RANGE = 200

export const VIRTUAL_TIMELINE_THRESHOLD = 200

// Trimming only happens while the user is at the bottom. KEEP must stay above VIRTUAL_TIMELINE_THRESHOLD so the list does not remount after a trim.
export const TIMELINE_TRIM_THRESHOLD = 500

export const TIMELINE_KEEP_COUNT = 300

export const chatWallpapers = [
  { name: 'None', swatch: 'var(--paper)' },
  { name: 'Meadow', swatch: 'linear-gradient(135deg, #e8f2e8, #f7f5e9)' },
  { name: 'Tide', swatch: 'linear-gradient(135deg, #e3eff1, #f1f3eb)' },
  { name: 'Rose', swatch: 'linear-gradient(135deg, #f1e5e8, #f5efe4)' },
] as const

export const notificationTones: Record<string, { type: OscillatorType; frequency: number; duration: number; gain: number }> = {
  Chime: { type: 'sine', frequency: 720, duration: 0.12, gain: 0.035 },
  Pulse: { type: 'square', frequency: 480, duration: 0.09, gain: 0.012 },
  Soft: { type: 'triangle', frequency: 360, duration: 0.2, gain: 0.02 },
}

export const builtInQuickReactions = ['👍', '❤️', '😂', '🎉', '👀', '🙏']

export const mediaApprovalKindLabels: Record<MediaApprovalItem['kind'], string> = { image: 'Image', video: 'Video', audio: 'Audio', file: 'File' }

export const maxVideoMessageMilliseconds = 3 * 60 * 1000

export const maxAttachmentBytes = 50 * 1024 * 1024
