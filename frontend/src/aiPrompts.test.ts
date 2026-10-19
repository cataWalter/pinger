import { describe, expect, it } from 'vitest'
import {
  boundedTranscript,
  buildAgentPrompt,
  buildExplainPrompt,
  buildReplyPrompt,
  buildRewritePrompt,
  buildTopicInsightsPrompt,
  parseChatAgents,
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
    const prompt = buildAgentPrompt({ id: 'tutor', name: 'Language tutor', instructions: 'Teach Spanish gently.' }, 'Explain the idiom', messages)
    expect(prompt[0].content).toContain('Teach Spanish gently.')
    expect(prompt[1].content).toContain('Explain the idiom')
    expect(prompt[1].content).not.toContain('removed content')
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