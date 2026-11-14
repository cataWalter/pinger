import { type Message } from '../bindings/mychat/desktop/models.js'
import { type PreferenceValues } from './appTypes'
import { builtInQuickReactions } from './appConstants'

export function preferenceBoolean(preferences: PreferenceValues, key: string, fallback = false) {
  const value = preferences[key]
  return typeof value === 'boolean' ? value : fallback
}

export function preferenceString(preferences: PreferenceValues, key: string, fallback: string) {
  const value = preferences[key]
  return typeof value === 'string' ? value : fallback
}

export function preferenceNumber(preferences: PreferenceValues, key: string, fallback: number, minimum = 0, maximum = 100) {
  const value = preferences[key]
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

// Previews ask the homeserver to fetch the link, so encrypted rooms need a separate opt-in.
export function linkPreviewsEnabled(preferences: PreferenceValues, message: Message) {
  if (message.mediaUri || message.redacted || message.decryptionError || message.sending || message.sendError) return false
  if (!preferenceBoolean(preferences, 'messages.url_previews', true)) return false
  return !message.encrypted || preferenceBoolean(preferences, 'messages.url_previews_encrypted')
}

export function quickReactionOptions(preferences: PreferenceValues) {
  const custom = preferenceString(preferences, 'reactions.quick_source', 'Frequent') === 'Custom'
    ? preferenceString(preferences, 'reactions.custom_emojis', '').split(/\s+/).filter(Boolean)
    : []
  if (custom.length > 0) return [...new Set(custom)].slice(0, 6)
  const defaultEmoji = preferenceString(preferences, 'reactions.default_emoji', '')
  return [...new Set(defaultEmoji ? [defaultEmoji, ...builtInQuickReactions] : builtInQuickReactions)].slice(0, 6)
}

// Mirrors preferences/validate_features.go: 1 to 6 whitespace-separated emoji, each at most 32 bytes.
export function customQuickReactionsError(value: string) {
  const fields = value.trim().split(/\s+/).filter(Boolean)
  if (fields.length < 1 || fields.length > 6) return 'Enter 1 to 6 emoji separated by spaces.'
  if (fields.some((field) => new TextEncoder().encode(field).length > 32)) return 'Each emoji must be 32 bytes or fewer.'
  return ''
}
