import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ghostTextDraftReady, remainingGhostText } from './ghostText'
import { useComposerGhostText } from './useComposerGhostText'

const service = vi.hoisted(() => ({ AIGhostText: vi.fn(), AICancel: vi.fn() }))
vi.mock('../bindings/mychat/desktop', () => ({ AppService: service }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('account-scoped ghost text', () => {
  it('does not restore an old completion after switching away and back', async () => {
    vi.useFakeTimers()
    service.AIGhostText.mockResolvedValueOnce(' world')
    const { result, rerender } = renderHook(({ accountID }) => useComposerGhostText({
      enabled: true, accountID, roomID: '!shared:example.org', text: 'Hello', caretAtEnd: true,
    }), { initialProps: { accountID: 'primary' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(result.current.suffix).toBe(' world')
    rerender({ accountID: 'second' })
    rerender({ accountID: 'primary' })
    expect(result.current.suffix).toBe('')
  })

  it('cancels old suggestions when only the account changes', async () => {
    vi.useFakeTimers()
    let complete!: (text: string) => void
    service.AIGhostText.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    service.AICancel.mockResolvedValue(true)
    const { result, rerender } = renderHook(({ accountID }) => useComposerGhostText({
      enabled: true, accountID, roomID: '!shared:example.org', text: 'Hello', caretAtEnd: true,
    }), { initialProps: { accountID: 'primary' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    const requestID = service.AIGhostText.mock.calls[0][2]
    rerender({ accountID: 'second' })
    expect(service.AICancel).toHaveBeenCalledWith(requestID)
    await act(async () => complete(' from the primary account'))
    expect(result.current.suffix).toBe('')
  })
})

describe('ghostTextDraftReady', () => {
  it('skips short drafts, blank drafts, and slash commands', () => {
    expect(ghostTextDraftReady('')).toBe(false)
    expect(ghostTextDraftReady('   ')).toBe(false)
    expect(ghostTextDraftReady('he')).toBe(false)
    expect(ghostTextDraftReady('/me waves')).toBe(false)
  })

  it('accepts drafts long enough to continue', () => {
    expect(ghostTextDraftReady('hel')).toBe(true)
    expect(ghostTextDraftReady('  hello there ')).toBe(true)
  })
})

describe('remainingGhostText', () => {
  it('returns the whole suggestion right after it arrives', () => {
    expect(remainingGhostText('hello', ' world', 'hello')).toBe(' world')
  })

  it('keeps the rest visible while the user types the suggestion', () => {
    expect(remainingGhostText('hello', ' world', 'hello w')).toBe('orld')
    expect(remainingGhostText('hello', ' world', 'hello world')).toBe('')
  })

  it('hides the suggestion when the typed text diverges', () => {
    expect(remainingGhostText('hello', ' world', 'hello x')).toBe('')
    expect(remainingGhostText('hello', ' world', 'help')).toBe('')
  })

  it('hides the suggestion when text was deleted before the anchor', () => {
    expect(remainingGhostText('hello', ' world', 'hell')).toBe('')
  })

  it('returns nothing without a suggestion', () => {
    expect(remainingGhostText('hello', '', 'hello')).toBe('')
  })
})
