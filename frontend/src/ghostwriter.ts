export type GhostwriterProvider = 'ollama' | 'openai-compatible'
export type GhostwriterMode = 'chips' | 'autocomplete' | 'slash'
export type GhostSuggestionType = 'chip' | 'autocomplete' | 'slash_result'

export interface GhostwriterRequest {
  roomId: string
  mode: GhostwriterMode
  draft: string
  intent: string
}

export interface GhostSuggestion {
  id: string
  type: GhostSuggestionType
  label: string
  text: string
}

export interface MessageContextEntry {
  sender: string
  text: string
  timestamp: number
  own: boolean
}

export interface MessageContext {
  contactId: string
  contactName: string
  platform: string
  messages: MessageContextEntry[]
}

export interface EmojiFrequency {
  emoji: string
  count: number
}

export interface UserStyleProfile {
  sampleCount: number
  casing: string
  lowercaseRate: number
  noFinalPunctuationRate: number
  periodRate: number
  ellipsisRate: number
  exclamationRate: number
  questionRate: number
  emojis: EmojiFrequency[]
  averageWordCount: number
  averageMessagesPerBurst: number
  formalityScore: number
}

export const ghostwriterDefaultEndpoints: Record<GhostwriterProvider, string> = {
  ollama: 'http://127.0.0.1:11434',
  'openai-compatible': 'http://127.0.0.1:8080',
}

export function isLoopbackEndpoint(value: string) {
  try {
    const endpoint = new URL(value.trim())
    if (endpoint.protocol !== 'http:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false
    if (endpoint.pathname !== '/' && endpoint.pathname !== '') return false
    const host = endpoint.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
  } catch {
    return false
  }
}

export function parseGhostCommand(value: string): string | null {
  const match = /^\/ghost(?:\s+([\s\S]*))?$/i.exec(value.trim())
  return match ? (match[1]?.trim() ?? '') : null
}

export function isGhostCommandDraft(value: string) {
  return /^\/ghost(?:\s|$)/i.test(value.trimStart())
}

export function appendGhostCompletion(draft: string, completion: string) {
  const suffix = completion.trimStart()
  if (!suffix) return draft
  const needsSpace = Boolean(draft) && !/\s$/.test(draft) && !/^[,.;!?):\]}]/.test(suffix)
  return `${draft}${needsSpace ? ' ' : ''}${suffix}`
}

export function isGhostSuggestion(value: { type: string }): value is GhostSuggestion {
  return value.type === 'chip' || value.type === 'autocomplete' || value.type === 'slash_result'
}