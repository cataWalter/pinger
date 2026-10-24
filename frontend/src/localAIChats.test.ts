import { describe, expect, it, vi } from 'vitest'
import { localAIErrorMessage } from './localAIChats'

vi.mock('../bindings/mychat/desktop', () => ({
  AppService: {},
}))

describe('localAIErrorMessage', () => {
  it('explains a stale backend instead of showing the binding id', () => {
    const error = new Error('Binding call failed: unknown bound method id 3542693216')

    expect(localAIErrorMessage(error, 'Chats could not be loaded.')).toBe('Local AI is out of date. Quit and reopen the app to load it.')
  })

  it('explains an argument mismatch between the app and its bindings', () => {
    const parse = new Error('could not parse argument #0: json: cannot unmarshal array into Go value of type desktop.LocalAIChatRequest')
    const count = new Error('desktop.AppService.LocalAIChat expects 1 arguments, got 2')

    expect(localAIErrorMessage(parse, 'Fallback')).toBe('Local AI is out of date. Quit and reopen the app to load it.')
    expect(localAIErrorMessage(count, 'Fallback')).toBe('Local AI is out of date. Quit and reopen the app to load it.')
  })

  it('returns other error messages and falls back when there is none', () => {
    expect(localAIErrorMessage(new Error('Disk is full'), 'Fallback')).toBe('Disk is full')
    expect(localAIErrorMessage('Plain text', 'Fallback')).toBe('Plain text')
    expect(localAIErrorMessage(new Error(''), 'Fallback')).toBe('Fallback')
    expect(localAIErrorMessage({}, 'Fallback')).toBe('Fallback')
  })
})
