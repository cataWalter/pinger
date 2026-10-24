import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocalAIChat, { type LocalAIChatProps } from './LocalAIChat'

const { eventHandlers, service } = vi.hoisted(() => ({
  eventHandlers: new Map<string, (event: { data: unknown }) => void>(),
  service: {
    AICancel: vi.fn(),
    AppendLocalAIChatMessage: vi.fn(),
    CreateLocalAIChat: vi.fn(),
    LoadLocalAIChatMessages: vi.fn(),
    LocalAIChat: vi.fn(),
    SetLocalAIChatAgent: vi.fn(),
    TruncateLocalAIChat: vi.fn(),
  },
}))

vi.mock('../bindings/mychat/desktop', () => ({
  AppService: service,
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
    Object.values(service).forEach((mock) => mock.mockReset())
    eventHandlers.clear()
    let seq = 0
    service.AICancel.mockResolvedValue(true)
    service.AppendLocalAIChatMessage.mockImplementation(async (_chatID: string, message: object) => ({ ...message, seq: ++seq, createdAt: 1 }))
    service.CreateLocalAIChat.mockResolvedValue({ id: 'chat-1', title: '', agentId: '', updatedAt: 1 })
    service.LoadLocalAIChatMessages.mockResolvedValue([])
    service.SetLocalAIChatAgent.mockResolvedValue(undefined)
    service.TruncateLocalAIChat.mockResolvedValue(undefined)
  })

  function renderChat(overrides: Partial<LocalAIChatProps> = {}) {
    const props: LocalAIChatProps = {
      chatId: null,
      chatTitle: '',
      agentId: '',
      agents: [],
      hidden: false,
      onAgentChange: vi.fn(),
      onChatCreated: vi.fn(),
      onChatsChanged: vi.fn(),
      ...overrides,
    }
    return { props, ...render(<LocalAIChat {...props} />) }
  }

  async function sendDraft(text: string) {
    const composer = screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))
    fireEvent.change(composer, { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to local AI' }))
  }

  it('renders markdown and inline and display math in assistant replies', async () => {
    service.LocalAIChat.mockResolvedValueOnce([
      '## A useful answer',
      '',
      'This is **important** and inline math $e^x$.',
      '',
      '$$',
      '\\int e^x\\,dx = e^x + C',
      '$$',
    ].join('\n'))
    const { container, props } = renderChat()

    fireEvent.change(screen.getByRole('textbox', { name: 'Message local AI' }), { target: { value: 'Explain this formula' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to local AI' }))

    expect(await screen.findByRole('heading', { name: 'A useful answer' }, { timeout: 5000 })).toBeTruthy()
    expect(container.querySelector('strong')?.textContent).toBe('important')
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(props.onChatCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'chat-1' }))
  })

  it('renders streamed response chunks before the chat request resolves', async () => {
    let resolveReply!: (reply: string) => void
    service.LocalAIChat.mockImplementationOnce(() => new Promise((resolve) => { resolveReply = resolve }))
    const { container } = renderChat({ chatId: 'chat-1' })

    await sendDraft('Explain streaming')
    await waitFor(() => expect(service.LocalAIChat).toHaveBeenCalledTimes(1))

    const requestID = (service.LocalAIChat.mock.calls[0][0] as { requestId: string }).requestId
    const emitChunk = (id: string, text: string) => act(() => eventHandlers.get('local-ai:stream')?.({
      data: { requestId: id, text },
    }))
    emitChunk('stale-request', 'ignored')
    expect(container.textContent).not.toContain('ignored')
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('Waiting for the local model')

    emitChunk(requestID, 'The reply is arriving')
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving')
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('true')

    emitChunk(requestID, ' in chunks.')
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving in chunks.')

    await act(async () => resolveReply('The reply is arriving in chunks.'))
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving in chunks.')
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('false')
  })

  it('shows a clear failure and retries the same turn', async () => {
    service.LocalAIChat
      .mockRejectedValueOnce(new Error('could not parse argument #0: json: cannot unmarshal array into Go value of type desktop.LocalAIChatRequest'))
      .mockResolvedValueOnce('Recovered reply')
    renderChat({ chatId: 'chat-1' })

    await sendDraft('Ciao')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Local AI could not reply')
    expect(alert.textContent).toContain('Local AI is out of date. Quit and reopen the app to load it.')
    expect(alert.textContent).not.toContain('could not parse argument')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered reply', undefined, { timeout: 5000 })).toBeTruthy()
    expect(service.LocalAIChat).toHaveBeenCalledTimes(2)
    expect(service.LocalAIChat.mock.calls[1][0]).toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ role: 'user', content: 'Ciao' })],
    }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the partial reply when a run is stopped', async () => {
    let rejectReply!: (error: Error) => void
    service.LocalAIChat.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectReply = reject }))
    service.AICancel.mockImplementationOnce(async () => {
      rejectReply(new Error('AI request was stopped'))
      return true
    })
    renderChat({ chatId: 'chat-1' })

    await sendDraft('Write a long answer')
    await waitFor(() => expect(service.LocalAIChat).toHaveBeenCalledTimes(1))
    const requestID = (service.LocalAIChat.mock.calls[0][0] as { requestId: string }).requestId
    act(() => eventHandlers.get('local-ai:stream')?.({ data: { requestId: requestID, text: 'Partial answer' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }))

    await waitFor(() => expect(service.AppendLocalAIChatMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({ role: 'assistant', content: 'Partial answer', status: 'stopped' })))
    expect(service.AICancel).toHaveBeenCalledWith(requestID)
    expect(await screen.findByText('Local AI · Stopped')).toBeTruthy()
  })

  it('edits a user turn and resends from that point', async () => {
    service.LoadLocalAIChatMessages.mockResolvedValueOnce([
      { seq: 1, role: 'user', content: 'First question', status: 'complete', attachments: [], createdAt: 1 },
      { seq: 2, role: 'assistant', content: 'First answer', status: 'complete', attachments: [], createdAt: 2 },
    ])
    service.LocalAIChat.mockResolvedValueOnce('Edited answer')
    renderChat({ chatId: 'chat-1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Edit message' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'Edited question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and send' }))

    await waitFor(() => expect(service.TruncateLocalAIChat).toHaveBeenCalledWith('chat-1', 1))
    await waitFor(() => expect(service.LocalAIChat).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'Edited question' }], requestId: expect.any(String), agentInstructions: '' }))
    expect(await screen.findByText('Edited answer')).toBeTruthy()
  })

  it('saves an agent change for the open chat', async () => {
    const agents = [
      { id: 'writer', name: 'Writer', instructions: 'Write clearly.' },
      { id: 'tutor', name: 'Tutor', instructions: 'Explain step by step.' },
    ]
    const { props } = renderChat({ chatId: 'chat-1', agentId: 'writer', agents })
    const picker = (await screen.findByRole('combobox', { name: 'Agent for this chat' })) as HTMLSelectElement
    await waitFor(() => expect(picker.disabled).toBe(false))

    fireEvent.change(picker, { target: { value: 'tutor' } })

    await waitFor(() => expect(service.SetLocalAIChatAgent).toHaveBeenCalledWith('chat-1', 'tutor'))
    expect(props.onAgentChange).toHaveBeenCalledWith('tutor')
  })
})