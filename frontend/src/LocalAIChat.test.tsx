import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocalAIChat, { type LocalAIChatProps } from './LocalAIChat'

const { eventHandlers, service } = vi.hoisted(() => ({
  eventHandlers: new Map<string, (event: { data: unknown }) => void>(),
  service: {
    AICancel: vi.fn(),
    AppendLocalAIChatMessage: vi.fn(),
    CreateLocalAIChat: vi.fn(),
    GenerateLocalAIChatTitle: vi.fn(),
    LoadLocalAIChatMessages: vi.fn(),
    LocalAIChat: vi.fn(),
    LocalAIChatGenerateImage: vi.fn(),
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
    // Start above the fixture seqs (1, 2, ...) so appended messages never share a React key.
    let seq = 100
    service.AICancel.mockResolvedValue(true)
    service.GenerateLocalAIChatTitle.mockResolvedValue('')
    service.AppendLocalAIChatMessage.mockImplementation(async (_chatID: string, message: object) => ({ ...message, seq: ++seq, createdAt: 1 }))
    service.CreateLocalAIChat.mockResolvedValue({ id: 'chat-1', title: '', agentId: '', updatedAt: 1 })
    service.LoadLocalAIChatMessages.mockResolvedValue([])
    service.LocalAIChatGenerateImage.mockResolvedValue([])
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
      onCreateAgent: vi.fn(async () => true),
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

  it('keeps the draft editable while a reply runs but blocks sending', async () => {
    let resolveReply!: (reply: string) => void
    service.LocalAIChat.mockImplementationOnce(() => new Promise((resolve) => { resolveReply = resolve }))
    renderChat({ chatId: 'chat-1' })

    await sendDraft('Summarize the room')
    await waitFor(() => expect(service.LocalAIChat).toHaveBeenCalledTimes(1))
    const composer = screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
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

  it('attaches a pasted screenshot and sends it with the message', async () => {
    service.LocalAIChat.mockResolvedValueOnce('The screenshot shows a chart.')
    renderChat({ chatId: 'chat-1' })
    const composer = screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))

    const screenshot = new File(['png-bytes'], '', { type: 'image/png' })
    fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }], files: [] } })

    const pending = await screen.findByRole('list', { name: 'Pending attachments' })
    await waitFor(() => expect(pending.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/))
    expect(pending.textContent).toContain('pasted-image-')

    fireEvent.click(screen.getByRole('button', { name: 'Send to local AI' }))

    await waitFor(() => expect(service.AppendLocalAIChatMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      role: 'user',
      attachments: [expect.objectContaining({ kind: 'image', mediaType: 'image/png' })],
    })))
    expect(service.LocalAIChat).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ role: 'user', images: [expect.objectContaining({ mediaType: 'image/png' })] })],
    }))
    expect(await screen.findByText('The screenshot shows a chart.')).toBeTruthy()
  })

  it('leaves plain-text paste to the textarea', async () => {
    renderChat({ chatId: 'chat-1' })
    const composer = screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))

    const notPrevented = fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] } })

    expect(notPrevented).toBe(true)
    expect(screen.queryByRole('list', { name: 'Pending attachments' })).toBeNull()
  })

  it('creates an agent from the chat and selects it for that chat', async () => {
    const { props } = renderChat({ chatId: 'chat-1' })
    const composer = screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: 'New agent' }))
    const form = screen.getByRole('form', { name: 'Create agent' })
    const save = within(form).getByRole('button', { name: 'Save agent' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(within(form).getByRole('textbox', { name: 'Agent name' }), { target: { value: 'Tutor' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Agent instructions' }), { target: { value: 'Explain step by step.' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => expect(props.onCreateAgent).toHaveBeenCalledWith({ id: expect.any(String), name: 'Tutor', instructions: 'Explain step by step.' }))
    const agentID = vi.mocked(props.onCreateAgent).mock.calls[0][0].id
    await waitFor(() => expect(service.SetLocalAIChatAgent).toHaveBeenCalledWith('chat-1', agentID))
    expect(props.onAgentChange).toHaveBeenCalledWith(agentID)
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Create agent' })).toBeNull())
  })

  describe('image generation', () => {
    const generatedImage = { name: 'generated-image.png', kind: 'image', mediaType: 'image/png', size: 9, data: 'iVBORw0KGgo=' }

    function generatedTurns(prompt: string) {
      return [
        { seq: 1, role: 'user', content: prompt, status: 'complete', attachments: [], createdAt: 1 },
        { seq: 2, role: 'assistant', content: '', status: 'complete', attachments: [generatedImage], createdAt: 2 },
      ]
    }

    async function startImage(prompt: string) {
      const composer = screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
      await waitFor(() => expect(composer.disabled).toBe(false))
      fireEvent.change(composer, { target: { value: prompt } })
      fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    }

    it('generates an image from the draft and shows it in the chat', async () => {
      service.LocalAIChatGenerateImage.mockResolvedValueOnce(generatedTurns('A red fox'))
      renderChat({ chatId: 'chat-1' })

      await startImage('A red fox')

      expect(await screen.findByRole('img', { name: 'generated-image.png' })).toBeTruthy()
      expect(service.LocalAIChatGenerateImage).toHaveBeenCalledWith('chat-1', 'A red fox', expect.any(String))
      expect(service.LocalAIChat).not.toHaveBeenCalled()
      expect((screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement).value).toBe('')
    })

    it('enables the image button only when the draft has a prompt', async () => {
      renderChat({ chatId: 'chat-1' })
      const composer = screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement
      await waitFor(() => expect(composer.disabled).toBe(false))
      const button = screen.getByRole('button', { name: 'Generate image' }) as HTMLButtonElement

      expect(button.disabled).toBe(true)
      fireEvent.change(composer, { target: { value: 'A lighthouse' } })
      expect(button.disabled).toBe(false)
    })

    it('shows progress for its own run and ignores other requests', async () => {
      let finish!: (messages: unknown[]) => void
      service.LocalAIChatGenerateImage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      renderChat({ chatId: 'chat-1' })
      await startImage('A lighthouse')
      await waitFor(() => expect(service.LocalAIChatGenerateImage).toHaveBeenCalledTimes(1))
      const requestID = service.LocalAIChatGenerateImage.mock.calls[0][2] as string
      const emitProgress = (id: string, step: number, preview?: string) => act(() => eventHandlers.get('local-ai:image-progress')?.({
        data: { requestId: id, stage: 'generating', step, totalSteps: 4, preview },
      }))

      emitProgress('stale-request', 3)
      expect(screen.queryByText('Generating image, step 3 of 4')).toBeNull()

      emitProgress(requestID, 2, 'cHJldmlldw==')
      expect(await screen.findByText('Generating image, step 2 of 4')).toBeTruthy()
      expect(screen.getByRole('progressbar', { name: 'Image generation progress' }).getAttribute('value')).toBe('2')
      expect(screen.getByRole('img', { name: 'Image generation preview' }).getAttribute('src')).toBe('data:image/png;base64,cHJldmlldw==')

      emitProgress(requestID, 3)
      expect(screen.getByText('Generating image, step 3 of 4')).toBeTruthy()
      expect(screen.getByRole('img', { name: 'Image generation preview' }).getAttribute('src')).toBe('data:image/png;base64,cHJldmlldw==')

      await act(async () => finish(generatedTurns('A lighthouse')))
      expect(await screen.findByRole('img', { name: 'generated-image.png' })).toBeTruthy()
      expect(screen.queryByRole('img', { name: 'Image generation preview' })).toBeNull()
    })

    it('stops a run and puts the prompt back in the composer', async () => {
      let rejectImage!: (error: Error) => void
      service.LocalAIChatGenerateImage.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectImage = reject }))
      service.AICancel.mockImplementationOnce(async () => {
        rejectImage(new Error('AI request was stopped'))
        return true
      })
      renderChat({ chatId: 'chat-1' })

      await startImage('A lighthouse at dusk')
      await waitFor(() => expect(service.LocalAIChatGenerateImage).toHaveBeenCalledTimes(1))
      const requestID = service.LocalAIChatGenerateImage.mock.calls[0][2] as string
      fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }))

      await waitFor(() => expect(service.AICancel).toHaveBeenCalledWith(requestID))
      expect(await screen.findByText('Image generation stopped.')).toBeTruthy()
      expect((screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement).value).toBe('A lighthouse at dusk')
    })

    it('restores the prompt and shows the error when generation fails', async () => {
      service.LocalAIChatGenerateImage.mockRejectedValueOnce(new Error('image engine failed to start'))
      renderChat({ chatId: 'chat-1' })

      await startImage('A lighthouse')

      expect(await screen.findByText('image engine failed to start')).toBeTruthy()
      expect((screen.getByRole('textbox', { name: 'Message local AI' }) as HTMLTextAreaElement).value).toBe('A lighthouse')
    })

    it('hides edit and regenerate on image turns', async () => {
      service.LoadLocalAIChatMessages.mockResolvedValueOnce(generatedTurns('A red fox'))
      renderChat({ chatId: 'chat-1' })

      expect(await screen.findByRole('img', { name: 'generated-image.png' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Regenerate response' })).toBeNull()
    })

    it('sends only a note for a generated image in the next message', async () => {
      service.LoadLocalAIChatMessages.mockResolvedValueOnce(generatedTurns('A red fox'))
      service.LocalAIChat.mockResolvedValueOnce('It is a fox.')
      renderChat({ chatId: 'chat-1' })

      await sendDraft('Describe it')

      await waitFor(() => expect(service.LocalAIChat).toHaveBeenCalledTimes(1))
      expect(service.LocalAIChat.mock.calls[0][0]).toEqual(expect.objectContaining({
        messages: [
          { role: 'user', content: 'A red fox' },
          { role: 'assistant', content: '[Generated image]' },
          { role: 'user', content: 'Describe it' },
        ],
      }))
    })
  })
})
