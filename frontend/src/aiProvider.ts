import { type PreferenceValues } from './appTypes'
import { preferenceString } from './preferences'

export type TextAIProvider = 'local' | 'online'

// Must match aiOnlineDefaultEndpoint in desktop/ai_online.go.
export const ONLINE_AI_DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1'

export function textAIProviderOf(preferences: PreferenceValues): TextAIProvider {
  return preferenceString(preferences, 'ai.provider', 'local') === 'online' ? 'online' : 'local'
}

// validOnlineAIEndpoint applies the HTTPS-only rules of preferences.ValidateOnlineAIEndpoint.
export function validOnlineAIEndpoint(raw: string) {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && parsed.hostname !== '' && parsed.username === '' && parsed.password === '' && parsed.search === '' && parsed.hash === ''
}

export function onlineAIEndpointOf(preferences: PreferenceValues) {
  return preferenceString(preferences, 'ai.online.endpoint', '').trim() || ONLINE_AI_DEFAULT_ENDPOINT
}

// Consent stores the exact endpoint it was given for, so changing the endpoint revokes it. The backend compares the same strings.
export function onlineAIConsented(preferences: PreferenceValues) {
  const endpoint = onlineAIEndpointOf(preferences)
  return validOnlineAIEndpoint(endpoint) && preferenceString(preferences, 'ai.online.consent_endpoint', '').trim() === endpoint
}

export function onlineAIReady(preferences: PreferenceValues) {
  return onlineAIConsented(preferences) && preferenceString(preferences, 'ai.online.model', '').trim() !== ''
}

export function localAIEndpointConfigured(preferences: PreferenceValues) {
  return preferenceString(preferences, 'ai.endpoint', '').trim() !== ''
}

// textAIConfigured reports whether replies, the Language Tutor, chat goals, and language detection have a provider to call.
// Voice transcription and image generation always use the local endpoint.
export function textAIConfigured(preferences: PreferenceValues) {
  return textAIProviderOf(preferences) === 'online' ? onlineAIReady(preferences) : localAIEndpointConfigured(preferences)
}
