import { describe, expect, it } from 'vitest'
import { ONLINE_AI_DEFAULT_ENDPOINT, localAIEndpointConfigured, textAIConfigured, validOnlineAIEndpoint } from './aiProvider'

const onlineReady = {
  'ai.provider': 'online',
  'ai.endpoint': 'http://localhost:8080',
  'ai.online.endpoint': 'https://openrouter.ai/api/v1',
  'ai.online.model': 'openai/gpt-4o-mini',
  'ai.online.consent_endpoint': 'https://openrouter.ai/api/v1',
}

describe('text AI provider gating', () => {
  it('uses the local endpoint when no provider is set', () => {
    expect(textAIConfigured({ 'ai.endpoint': 'http://localhost:8080' })).toBe(true)
    expect(textAIConfigured({ 'ai.endpoint': '' })).toBe(false)
  })

  it('never falls back to the local endpoint when the online provider is selected', () => {
    expect(textAIConfigured({ ...onlineReady, 'ai.online.consent_endpoint': '' })).toBe(false)
    expect(textAIConfigured({ ...onlineReady, 'ai.online.model': '' })).toBe(false)
    expect(textAIConfigured({ ...onlineReady, 'ai.online.model': '   ' })).toBe(false)
  })

  it('accepts the online provider only after consent for the exact saved endpoint', () => {
    expect(textAIConfigured(onlineReady)).toBe(true)
    expect(textAIConfigured({ ...onlineReady, 'ai.online.consent_endpoint': 'https://example.com/v1' })).toBe(false)
    expect(textAIConfigured({ ...onlineReady, 'ai.online.endpoint': 'https://example.com/v1' })).toBe(false)
  })

  it('treats a blank online endpoint as the OpenRouter default', () => {
    const preferences = { ...onlineReady, 'ai.online.endpoint': '', 'ai.online.consent_endpoint': ONLINE_AI_DEFAULT_ENDPOINT }
    expect(textAIConfigured(preferences)).toBe(true)
  })
})

describe('background language detection gating', () => {
  it('needs only the local endpoint, even when replies use the online provider', () => {
    expect(localAIEndpointConfigured({ ...onlineReady, 'ai.online.consent_endpoint': '' })).toBe(true)
    expect(localAIEndpointConfigured({ ...onlineReady, 'ai.endpoint': '' })).toBe(false)
  })
})

describe('online endpoint validation', () => {
  it('requires HTTPS without credentials, query, or fragment', () => {
    expect(validOnlineAIEndpoint('https://openrouter.ai/api/v1')).toBe(true)
    expect(validOnlineAIEndpoint('http://openrouter.ai/api/v1')).toBe(false)
    expect(validOnlineAIEndpoint('https://user:pass@openrouter.ai/api/v1')).toBe(false)
    expect(validOnlineAIEndpoint('https://openrouter.ai/api/v1?key=1')).toBe(false)
    expect(validOnlineAIEndpoint('https://openrouter.ai/api/v1#top')).toBe(false)
    expect(validOnlineAIEndpoint('not a url')).toBe(false)
  })
})
