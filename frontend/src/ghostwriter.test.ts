import { describe, expect, it } from 'vitest'
import { ghostwriterDefaultEndpoints, isGhostCommandDraft, isGhostSuggestion, isLoopbackEndpoint, parseGhostCommand } from './ghostwriter'

describe('Ghostwriter helpers', () => {
  it('recognizes only loopback HTTP endpoints', () => {
    expect(isLoopbackEndpoint(ghostwriterDefaultEndpoints.ollama)).toBe(true)
    expect(isLoopbackEndpoint('http://localhost:8080')).toBe(true)
    expect(isLoopbackEndpoint('http://[::1]:8080')).toBe(true)
    expect(isLoopbackEndpoint('https://localhost:11434')).toBe(false)
    expect(isLoopbackEndpoint('http://example.com:11434')).toBe(false)
    expect(isLoopbackEndpoint('http://localhost:11434/v1')).toBe(false)
  })

  it('parses slash commands without consuming ordinary messages', () => {
    expect(parseGhostCommand('/ghost decline politely')).toBe('decline politely')
    expect(parseGhostCommand('/GHOST  follow up tomorrow')).toBe('follow up tomorrow')
    expect(parseGhostCommand('/ghost')).toBe('')
    expect(parseGhostCommand('please /ghost decline')).toBeNull()
    expect(isGhostCommandDraft('/ghost decline politely')).toBe(true)
    expect(isGhostCommandDraft('/ghost')).toBe(true)
    expect(isGhostCommandDraft('hello /ghost')).toBe(false)
  })

  it('narrows generated binding suggestions to supported modes', () => {
    expect(isGhostSuggestion({ type: 'chip' })).toBe(true)
    expect(isGhostSuggestion({ type: 'next_reply' })).toBe(true)
    expect(isGhostSuggestion({ type: 'unknown' })).toBe(false)
  })
})
