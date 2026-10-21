import { describe, expect, it } from 'vitest'
import {
  boundedTranscript,
  buildAgentPrompt,
  buildChatTranslationPrompt,
  buildConversationAnalysisPrompt,
  buildExplainPrompt,
  buildReplyPrompt,
  buildRewritePrompt,
  buildTopicInsightsPrompt,
  parseChatAgents,
  parseChatTranslationResponse,
  splitChatTranslationBatches,
} from './aiPrompts'

const messages = [
  { senderName: 'Alice', sender: '@alice:example.org', body: 'first topic' },
  { senderName: 'Bob', sender: '@bob:example.org', body: 'removed content', redacted: true },
  { senderName: 'Alice', sender: '@alice:example.org', body: 'second topic' },
]

describe('local AI prompts', () => {
  it('filters redacted and blank messages and caps transcript context', () => {
    const longTranscript = Array.from({ length: 55 }, (_, index) => ({
      senderName: 'Alice',
      sender: '@alice:example.org',
      body: `message ${index}`,
    }))

    expect(boundedTranscript([...messages, { senderName: '', sender: '', body: '  ' }])).toEqual([
      'Alice: first topic',
      'Alice: second topic',
    ])
    expect(boundedTranscript(longTranscript)).toHaveLength(50)
    expect(boundedTranscript(longTranscript)[0]).toBe('Alice: message 5')
  })

  it('builds a reply prompt with the target and bounded context', () => {
    const prompt = buildReplyPrompt(messages[2], messages.slice(0, 2))

    expect(prompt[0].role).toBe('system')
    expect(prompt[0].content).toContain('untrusted data')
    expect(prompt[1].content).toContain('Alice: first topic')
    expect(prompt[1].content).toContain('second topic')
    expect(prompt[1].content).not.toContain('removed content')
  })

  it('builds rewrite and explanation prompts without adding room context', () => {
    expect(buildRewritePrompt('My draft', 'shorten')).toEqual([
      expect.objectContaining({ role: 'system', content: expect.stringContaining('Shorten') }),
      { role: 'user', content: 'My draft' },
    ])
    expect(buildExplainPrompt(messages[0])[1].content).toBe('Message from Alice:\nfirst topic')
  })

  it('builds topic and custom-agent prompts with redacted messages excluded', () => {
    expect(buildTopicInsightsPrompt(messages)[1].content).not.toContain('removed content')
    const prompt = buildAgentPrompt({ id: 'tutor', name: 'Language tutor', instructions: 'Teach Spanish gently.' }, 'Explain the idiom', messages, 'I am trying to say hello naturally.')
    expect(prompt[0].content).toContain('Teach Spanish gently.')
    expect(prompt[1].content).toContain('Explain the idiom')
    expect(prompt[1].content).toContain('Current composer draft:\nI am trying to say hello naturally.')
    expect(prompt[1].content).not.toContain('removed content')
  })

  it('translates every eligible message in numbered batches', () => {
    const translationMessages = Array.from({ length: 13 }, (_, index) => ({
      senderName: index % 2 === 0 ? 'Alice' : 'Bob',
      sender: index % 2 === 0 ? '@alice:example.org' : '@bob:example.org',
      body: `message ${index + 1}`,
    }))
    translationMessages.splice(3, 0, { senderName: 'Alice', sender: '@alice:example.org', body: 'redacted', redacted: true } as typeof translationMessages[number])

    const batches = splitChatTranslationBatches(translationMessages)
    expect(batches.map((batch) => batch.length)).toEqual([12, 1])
    expect(batches.flat().some((message) => message.body === 'redacted')).toBe(false)

    const prompt = buildChatTranslationPrompt(batches[0], 1)
    expect(prompt[0].content).toContain('Translate every message body into English')
    expect(prompt[0].content).toContain('one valid JSON array of strings')
    expect(prompt[0].content).toContain('Never return an object, duplicate keys')
    expect(prompt[1].content).toContain('"sender":"Alice"')
    expect(prompt[1].content).toContain('"body":"message 1"')
    expect(prompt[1].content).not.toContain('redacted')
  })

  it('parses ordered chat translations and rejects malformed output', () => {
    expect(parseChatTranslationResponse('["ciao","buongiorno"]', 2)).toEqual(['ciao', 'buongiorno'])
    expect(parseChatTranslationResponse('```json\n["ciao"]\n```', 1)).toEqual(['ciao'])
    expect(parseChatTranslationResponse('{"body":"hello"},{"body":"good morning"}', 2)).toEqual(['hello', 'good morning'])
    expect(parseChatTranslationResponse('[{"body":"hello"},{"body":"good morning"}]', 2)).toEqual(['hello', 'good morning'])
    expect(parseChatTranslationResponse('{"translations":[{"translation":"hello"},{"text":"good morning"}]}', 2)).toEqual(['hello', 'good morning'])
    expect(parseChatTranslationResponse('1. hello\n2) good morning', 2)).toEqual(['hello', 'good morning'])
    expect(() => parseChatTranslationResponse('The translation is Hola, not JSON.', 1)).toThrow('not valid JSON')
    expect(parseChatTranslationResponse('"hello"', 1)).toEqual(['hello'])
    const responseBodies = [
      "I'm looking at the videos",
      'You?',
      'Random',
      "Yeah. That's how I'm planning it",
      "I don't know if I'll work out",
      "There's a museum tour the day before, I might get tired",
      'Going somewhere in Istanbul is very tiring😁',
      'Do I need to wear sportswear for ping pong',
      'Works of music',
      "A friend told me but I don't know either",
    ]
    const response = responseBodies.map((body) => JSON.stringify({ body })).join(',\n')
    expect(parseChatTranslationResponse(response, 10)).toEqual(responseBodies)
    expect(parseChatTranslationResponse(`${response}]`, 10)).toEqual(responseBodies)
    const repeatedBodyObject = '{"body":"Come here","body":"Beautiful","body":"Today is my first day of work","body":"AMAZING","body":"Finally I found a proper job","body":"Hahahaha thanks","body":"Tomorrow","body":"Heheheh","body":"I\'m in Nişantaşı anyway","body":"Yes, sir"}'
    expect(parseChatTranslationResponse(repeatedBodyObject, 10)).toEqual([
      'Come here',
      'Beautiful',
      'Today is my first day of work',
      'AMAZING',
      'Finally I found a proper job',
      'Hahahaha thanks',
      'Tomorrow',
      'Heheheh',
      "I'm in Nişantaşı anyway",
      'Yes, sir',
    ])
    expect(() => parseChatTranslationResponse('["only one"]', 2)).toThrow('The AI returned 1 translation; expected exactly 2 translations.')
    expect(() => parseChatTranslationResponse('{"status":"ok"}', 1)).toThrow('The AI response must contain a JSON array')
  })

  it('builds a bounded, evidence-based conversation analysis prompt', () => {
    const transcript = Array.from({ length: 55 }, (_, index) => ({
      senderName: index % 2 === 0 ? 'Alice' : 'Bob',
      sender: index % 2 === 0 ? '@alice:example.org' : '@bob:example.org',
      body: `message ${index}`,
    }))
    const prompt = buildConversationAnalysisPrompt([
      ...transcript,
      { senderName: 'Bob', sender: '@bob:example.org', body: 'redacted message', redacted: true },
      { senderName: 'Alice', sender: '@alice:example.org', body: '   ' },
    ])

    expect(prompt[0].content).toContain('untrusted data')
    expect(prompt[0].content).toContain('"Chat summary"')
    expect(prompt[0].content).toContain('"How they communicate"')
    expect(prompt[0].content).toContain('do not infer personality, motives, relationship status, or mental health')
    expect(prompt[0].content).toContain('only one person speaks')
    expect(prompt[1].content).toContain('message 5')
    expect(prompt[1].content).toContain('message 54')
    expect(prompt[1].content.split('\n')).not.toContain('Alice: message 4')
    expect(prompt[1].content).not.toContain('redacted message')
  })

  it('falls back to an empty collection for malformed agent preferences', () => {
    expect(parseChatAgents('not json')).toEqual({ agents: [], defaultAgentId: '' })
    const oversizedUnicode = JSON.stringify({
      agents: [{ id: 'tutor', name: 'Tutor', instructions: 'Offer a suggestion.' }],
      defaultAgentId: 'tutor',
      extra: 'é'.repeat(17_000),
    })
    expect(parseChatAgents(oversizedUnicode)).toEqual({ agents: [], defaultAgentId: '' })
  })
})