import { buildAIFeatureSystemPrompt } from './aiSettings'

export type ToneSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ToneAssessment {
  is_hostile_or_unprofessional: boolean
  severity: ToneSeverity
  tone_tags: string[]
  calmer_alternative: string
}

export const TONE_GUARD_TIMEOUT_MS = 1200

// buildToneGuardSystemPrompt combines the editable guidance with the fixed JSON output contract.
export function buildToneGuardSystemPrompt(instructions = ''): string {
  return buildAIFeatureSystemPrompt('tone_guard', instructions)
}

const HIGH_TENSION_PATTERNS = [
  /\byou always\b/i,
  /\byou never\b/i,
  /\bwhat is wrong with you\b/i,
  /\bthis is unacceptable\b/i,
  /\bthis is ridiculous\b/i,
  /\bcalm down\b/i,
  /\bas usual\b/i,
  /\bnot my problem\b/i,
  /\bcan't you\b/i,
  /\bidiot|stupid|useless|incompetent\b/i,
]
const SIMPLE_GREETING = /^(?:hi|hello|hey|howdy|yo|good (?:morning|afternoon|evening))(?:[,!?.\s]+[\p{L}\p{M}'’-]+)?[!?.\s]*$/iu
const SINGLE_EMOJI = /^(?:[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}\uFE0F?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}\uFE0F?(?:\p{Emoji_Modifier})?)*)$/u

export function countDraftWords(draft: string) {
  return draft.trim().split(/\s+/u).filter(Boolean).length
}

export function isOffHours(date: Date) {
  const hour = date.getHours()
  return hour >= 22 || hour < 6
}

export function hasHighTensionCue(message: string) {
  return HIGH_TENSION_PATTERNS.some((pattern) => pattern.test(message))
}

export function shouldCheckToneGuard(draft: string, enabledForRoom: boolean, date: Date, incomingMessages: string[]) {
  const trimmed = draft.trim()
  if (!trimmed || SIMPLE_GREETING.test(trimmed) || SINGLE_EMOJI.test(trimmed)) return false
  return countDraftWords(trimmed) > 10 || enabledForRoom || isOffHours(date) || incomingMessages.some(hasHighTensionCue)
}

export async function raceWithToneGuardDeadline<T>(request: Promise<T>, timeoutMs = TONE_GUARD_TIMEOUT_MS): Promise<T | null> {
  let timeoutID: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timeoutID = setTimeout(() => resolve(null), timeoutMs)
  })
  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timeoutID !== undefined) clearTimeout(timeoutID)
  }
}

export function parseToneAssessment(response: string): ToneAssessment | null {
  const cleaned = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      return null
    }
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const value = parsed as Record<string, unknown>
  if (typeof value.is_hostile_or_unprofessional !== 'boolean') return null
  if (value.severity !== 'LOW' && value.severity !== 'MEDIUM' && value.severity !== 'HIGH') return null
  if (!Array.isArray(value.tone_tags) || value.tone_tags.some((tag) => typeof tag !== 'string')) return null
  if (typeof value.calmer_alternative !== 'string') return null

  const assessment: ToneAssessment = {
    is_hostile_or_unprofessional: value.is_hostile_or_unprofessional,
    severity: value.severity,
    tone_tags: value.tone_tags.map((tag) => (tag as string).trim()).filter(Boolean).slice(0, 4),
    calmer_alternative: value.calmer_alternative.trim(),
  }
  if (assessment.is_hostile_or_unprofessional && assessment.severity !== 'LOW' && !assessment.calmer_alternative) return null
  return assessment
}