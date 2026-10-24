import { describe, expect, it } from 'vitest'
import { createBusyReply, detectBusyReplyLanguage, detectConversationLanguage, hasBusyReplyTemplate } from './busyMode'

describe('busy replies', () => {
  it('detects the majority language from the latest ten messages', () => {
    const english = 'We can review the project details together after the meeting tomorrow.'
    const spanish = 'Podemos revisar los detalles del proyecto después de la reunión de mañana.'

    expect(detectBusyReplyLanguage([spanish, spanish, english, english, english, english, english, english, english, english, spanish])).toBe('eng')
    expect(detectBusyReplyLanguage([spanish, spanish, spanish, english, spanish])).toBe('spa')
  })

  it('returns a polished localized reply with the account name', () => {
    const spanish = 'Podemos revisar los detalles del proyecto después de la reunión de mañana.'

    expect(createBusyReply([spanish, spanish], 'María')).toContain('Soy el asistente de IA de María')
    expect(createBusyReply([spanish, spanish], 'María')).toContain('Gracias por tu paciencia.')
  })

  it('detects languages that can use the AI translation fallback', () => {
    const czech = 'Můžeme zítra po schůzce společně projít podrobnosti projektu a domluvit další postup.'
    const language = detectBusyReplyLanguage([czech, czech, czech])

    expect(language).toBe('ces')
    expect(hasBusyReplyTemplate(language)).toBe(false)
  })

  it('returns a display name for the detected conversation language', () => {
    expect(detectConversationLanguage([
      'Günaydınnn',
      'Daha iyiyim',
      'Çok mu yoruldun dün?',
      'bugün telefonda konuşalım mı',
    ])).toBe('Turkish')
    expect(detectConversationLanguage(['', '👍'])).toBe('')
  })

  it('falls back to English when the chat has no detectable text', () => {
    expect(createBusyReply(['', '👍'], 'Alex')).toContain("I'm the AI assistant for Alex")
  })
})