import { type MatrixNotification, type NotificationText, type PreferenceValues } from './appTypes'
import { notificationTones } from './appConstants'
import { preferenceBoolean, preferenceString } from './preferences'

export function playNotificationSound(volume: number, tone = 'Chime') {
  const profile = notificationTones[tone]
  if (volume <= 0 || !profile) return
  try {
    const audio = new AudioContext()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = profile.type
    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.onended = () => { void audio.close() }
    void audio.resume().then(() => {
      const startTime = audio.currentTime
      oscillator.frequency.setValueAtTime(profile.frequency, startTime)
      gain.gain.setValueAtTime(profile.gain * volume / 100, startTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + profile.duration)
      oscillator.start(startTime)
      oscillator.stop(startTime + profile.duration)
    }).catch(() => { void audio.close() })
  } catch {
    return
  }
}

export function notificationAllowed(preferences: PreferenceValues, roomID: string, category: string) {
  if (!preferenceBoolean(preferences, 'notifications.enabled', true)) return false
  if (preferenceBoolean(preferences, `room.muted.${roomID}`)) return false
  switch (category) {
    case 'group': return preferenceBoolean(preferences, 'notifications.group')
    case 'mention': return preferenceBoolean(preferences, 'notifications.mentions', true)
    case 'direct': return preferenceBoolean(preferences, 'notifications.direct', true)
    default: return true
  }
}

export function notificationTone(preferences: PreferenceValues, category: string) {
  const keys: Record<string, string> = { direct: 'notifications.sound_direct', mention: 'notifications.sound_mention', group: 'notifications.sound_group' }
  return preferenceString(preferences, keys[category] ?? 'notifications.sound_mention', 'Chime')
}

export function notificationText(preferences: PreferenceValues, notification: MatrixNotification, roomName: string): NotificationText {
  // The sender is the title. Group and mention alerts show the room as the subtitle.
  const direct = notification.category === 'direct'
  let title = notification.sender || roomName
  let subtitle = notification.sender && !direct ? roomName : ''
  let body = notification.body
  switch (preferenceString(preferences, 'notifications.privacy', 'Sender and message preview')) {
    case 'Sender only':
      body = 'New message'
      break
    case 'Hidden content':
      title = 'Matrix'
      subtitle = ''
      body = 'New activity'
      break
  }
  return { title, subtitle, body }
}

export function detectOneTimeCode(body: string) {
  if (!/\b(code|otp|one[- ]time|verification|passcode|2fa)\b/i.test(body)) return null
  return /\b(\d{4,8})\b/.exec(body)?.[1] ?? null
}
