import { activeLocale, i18n } from './i18n'
import { type PreferenceValues } from './appTypes'
import { preferenceBoolean } from './preferences'

export function isSameDay(left: number, right: number) {
  if (!left || !right) return true
  const a = new Date(left)
  const b = new Date(right)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatDayLabel(timestamp: number) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const isPreviousYear = date.getFullYear() < today.getFullYear()
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(date, today)) return i18n.t('time.today')
  if (!isPreviousYear && sameDay(date, yesterday)) return i18n.t('time.yesterday')
  return new Intl.DateTimeFormat(activeLocale(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(isPreviousYear ? { year: 'numeric' } : {}),
  }).format(date)
}

export function localDateTimeInputValue(timestamp: number) {
  const localTime = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000)
  return localTime.toISOString().slice(0, 16)
}

export function formatScheduledTime(timestamp: number) {
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

export function parseTimeSuggestionMinutes(value: string) {
  const parts = value.split(',').map((part) => part.trim())
  if (parts.length < 1 || parts.length > 6 || parts.some((part) => !/^\d+$/.test(part))) return []
  const minutes = parts.map(Number)
  if (minutes.some((value) => value < 1 || value > 10080) || new Set(minutes).size !== minutes.length) return []
  return minutes
}

export function formatTimeSuggestion(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  if (minutes % 60 === 0) return `${minutes / 60} hr`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

export function formatTime(timestamp: number, use24Hour = false) {
  return new Intl.DateTimeFormat(activeLocale(), { hour: 'numeric', minute: '2-digit', hour12: !use24Hour }).format(new Date(timestamp))
}

export function isWithinDay(timestamp: number) {
  return Math.abs(Date.now() - timestamp) < 24 * 60 * 60_000
}

export function formatTimeOrDate(timestamp: number, use24Hour = false) {
  if (isSameDay(timestamp, Date.now())) return formatTime(timestamp, use24Hour)
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'short' }).format(new Date(timestamp))
}

export function formatTimelineTime(timestamp: number, preferences: PreferenceValues) {
  return createTimelineTimeFormatter(preferences)(timestamp)
}

export function createTimelineTimeFormatter(preferences: PreferenceValues): (timestamp: number) => string {
  const useRelativeTime = preferenceBoolean(preferences, 'appearance.relative_timestamps')
  const use24Hour = preferenceBoolean(preferences, 'appearance.time_24_hour')
  let clock: Intl.DateTimeFormat | undefined
  let relative: Intl.RelativeTimeFormat | undefined
  return (timestamp) => {
    if (useRelativeTime && isWithinDay(timestamp)) {
      const minutes = Math.round((timestamp - Date.now()) / 60_000)
      relative ??= new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'auto' })
      if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
      return relative.format(Math.round(minutes / 60), 'hour')
    }
    clock ??= new Intl.DateTimeFormat(activeLocale(), { hour: 'numeric', minute: '2-digit', hour12: !use24Hour })
    return clock.format(new Date(timestamp))
  }
}

export function formatMediaGalleryDateTime(timestamp: number, preferences: PreferenceValues) {
  return new Intl.DateTimeFormat(activeLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: !preferenceBoolean(preferences, 'appearance.time_24_hour'),
  }).format(new Date(timestamp))
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${(bytes / 1024 ** (unitIndex + 1)).toFixed(1)} ${units[unitIndex]}`
}
