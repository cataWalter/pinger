import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderChat, sendDraft } from './localAIChatTestHarness'
import { eventHandlers, resetLocalAIChatMocks, service } from './localAIChatTestMocks'

vi.mock('../bindings/mychat/desktop', async () => (await import('./localAIChatTestMocks')).desktopMock)

vi.mock('@wailsio/runtime', async () => (await import('./localAIChatTestMocks')).runtimeMock)

describe('LocalAIChat image generation', () => {
  afterEach(cleanup)

  beforeEach(() => resetLocalAIChatMocks())

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
