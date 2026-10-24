import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocalAIChat from './LocalAIChat'

const { eventHandlers, localAIChat } = vi.hoisted(() => ({
  eventHandlers: new Map<string, (event: { data: unknown }) => void>(),
  localAIChat: vi.fn(),
}))

vi.mock('../bindings/mychat/desktop', () => ({
  AppService: { LocalAIChat: localAIChat },
}))

vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: vi.fn() },
  Clipboard: { SetText: vi.fn() },
  Events: {
    On: vi.fn((name: string, handler: (event: { data: unknown }) => void) => {
      eventHandlers.set(name, handler)
      return () => eventHandlers.delete(name)
    }),
  },
}))

describe('LocalAIChat', () => {
  afterEach(cleanup)

  beforeEach(() => {
    localAIChat.mockReset()
    eventHandlers.clear()
  })

  it('renders markdown and inline and display math in assistant replies', async () => {
    localAIChat.mockResolvedValueOnce([
      '## A useful answer',
      '',
      'This is **important** and inline math $e^x$.',
      '',
      '$$',
      '\\int e^x\\,dx = e^x + C',
      '$$',
    ].join('\n'))
    const { container } = render(<LocalAIChat />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Message local AI' }), { target: { value: 'Explain this formula' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to local AI' }))

    expect(await screen.findByRole('heading', { name: 'A useful answer' }, { timeout: 5000 })).toBeTruthy()
    expect(container.querySelector('strong')?.textContent).toBe('important')
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('.katex-display')).not.toBeNull()
  })

  it('renders streamed response chunks before the chat request resolves', async () => {
    let resolveReply!: (reply: string) => void
    localAIChat.mockImplementationOnce(() => new Promise((resolve) => { resolveReply = resolve }))
    const { container } = render(<LocalAIChat />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Message local AI' }), { target: { value: 'Explain streaming' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to local AI' }))
    await waitFor(() => expect(localAIChat).toHaveBeenCalledTimes(1))

    const requestID = localAIChat.mock.calls[0][1] as string
    const emitChunk = (id: string, text: string) => act(() => eventHandlers.get('local-ai:stream')?.({
      data: { requestId: id, text },
    }))
    emitChunk('stale-request', 'ignored')
    expect(container.querySelector('.local-ai-message.is-assistant')).toBeNull()

    emitChunk(requestID, 'The reply is arriving')
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving')
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('true')

    emitChunk(requestID, ' in chunks.')
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving in chunks.')

    await act(async () => resolveReply('The reply is arriving in chunks.'))
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving in chunks.')
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('false')
  })
})