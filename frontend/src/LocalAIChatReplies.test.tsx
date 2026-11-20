import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderChat, sendDraft } from './localAIChatTestHarness'
import { eventHandlers, markdownRender, resetLocalAIChatMocks, service } from './localAIChatTestMocks'

vi.mock('../bindings/mychat/desktop', async () => (await import('./localAIChatTestMocks')).desktopMock)

vi.mock('@wailsio/runtime', async () => (await import('./localAIChatTestMocks')).runtimeMock)

vi.mock('./MarkdownMessage', async () => {
  const actual = await vi.importActual<typeof import('./MarkdownMessage')>('./MarkdownMessage')
  const { markdownRender: renderMarkdown } = await import('./localAIChatTestMocks')
  return {
    ...actual,
    default: (props: { body: string; className?: string }) => {
      renderMarkdown(props.body)
      return createElement(actual.default, props)
    },
  }
})

describe('LocalAIChat', () => {
  afterEach(cleanup)

  beforeEach(() => resetLocalAIChatMocks())

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

    fireEvent.change(screen.getByRole('textbox', { name: 'Message AI' }), { target: { value: 'Explain this formula' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to AI' }))

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
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('Waiting for the model')

    emitChunk(requestID, 'The reply is arriving')
    await waitFor(() => expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving'))
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('true')

    act(() => {
      for (const text of [' in', ' small', ' chunks.']) eventHandlers.get('local-ai:stream')?.({ data: { requestId: requestID, text } })
    })
    await waitFor(() => expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving in small chunks.'))

    emitChunk(requestID, ' Done.')
    await act(async () => resolveReply('The reply is arriving in small chunks. Done.'))
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    expect(container.querySelector('.local-ai-message.is-assistant')?.textContent).toContain('The reply is arriving in small chunks. Done.')
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('false')
  })

  it('does not re-render finished messages for each streaming frame', async () => {
    service.LoadLocalAIChatMessages.mockResolvedValueOnce([{
      seq: 1,
      role: 'assistant',
      content: 'Finished answer',
      status: 'complete',
      attachments: [],
      createdAt: 1,
    }])
    let resolveReply!: (reply: string) => void
    service.LocalAIChat.mockImplementationOnce(() => new Promise((resolve) => { resolveReply = resolve }))
    const { container } = renderChat({ chatId: 'chat-1' })

    await screen.findByText('Finished answer')
    await sendDraft('Ask another question')
    await waitFor(() => expect(service.LocalAIChat).toHaveBeenCalledTimes(1))

    const requestID = (service.LocalAIChat.mock.calls[0][0] as { requestId: string }).requestId
    const emitChunk = (text: string) => act(() => eventHandlers.get('local-ai:stream')?.({
      data: { requestId: requestID, text },
    }))
    emitChunk('A new answer')
    await waitFor(() => expect(container.textContent).toContain('A new answer'))
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    const finishedMessageRenders = markdownRender.mock.calls.filter(([body]) => body === 'Finished answer').length

    act(() => {
      for (const text of [' keeps', ' streaming', ' smoothly']) {
        eventHandlers.get('local-ai:stream')?.({ data: { requestId: requestID, text } })
      }
    })
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

    expect(markdownRender.mock.calls.filter(([body]) => body === 'Finished answer')).toHaveLength(finishedMessageRenders)
    await act(async () => resolveReply('A new answer keeps streaming smoothly'))
  })

  it('keeps the draft editable while a reply runs but blocks sending', async () => {
    let resolveReply!: (reply: string) => void
    service.LocalAIChat.mockImplementationOnce(() => new Promise((resolve) => { resolveReply = resolve }))
    renderChat({ chatId: 'chat-1' })

    await sendDraft('Summarize the room')
    await waitFor(() => expect(service.LocalAIChat).toHaveBeenCalledTimes(1))
    const composer = screen.getByRole('textbox', { name: 'Message AI' }) as HTMLTextAreaElement
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeTruthy()

    fireEvent.change(composer, { target: { value: 'Summarize only the decisions' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(composer.disabled).toBe(false)
    expect(composer.value).toBe('Summarize only the decisions')
    expect(service.LocalAIChat).toHaveBeenCalledTimes(1)

    await act(async () => resolveReply('Done.'))
  })

  it('asks for an AI title after a complete reply', async () => {
    service.LocalAIChat.mockResolvedValueOnce('Here is a plan.')
    const { props } = renderChat({ chatId: 'chat-1' })

    await sendDraft('Plan a trip')

    await waitFor(() => expect(service.GenerateLocalAIChatTitle).toHaveBeenCalledWith('chat-1'))
    await waitFor(() => expect(props.onChatsChanged).toHaveBeenCalled())
  })

  it('creates the first chat with the kind it was opened with', async () => {
    service.LocalAIChat.mockResolvedValueOnce('Summary of the thread.')
    renderChat({ newChatKind: 'summary' })

    await sendDraft('Summarize this')

    await waitFor(() => expect(service.CreateLocalAIChat).toHaveBeenCalledWith('', 'summary'))
  })

  it('shows a clear failure and retries the same turn', async () => {
    service.LocalAIChat
      .mockRejectedValueOnce(new Error('could not parse argument #0: json: cannot unmarshal array into Go value of type desktop.LocalAIChatRequest'))
      .mockResolvedValueOnce('Recovered reply')
    renderChat({ chatId: 'chat-1' })

    await sendDraft('Ciao')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('AI could not reply')
    expect(alert.textContent).toContain('AI chat is out of date. Quit and reopen the app to load it.')
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
    expect(await screen.findByText('AI · Stopped')).toBeTruthy()
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
