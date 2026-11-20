import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocalAIChat from './LocalAIChat'
import { renderChat, sendDraft } from './localAIChatTestHarness'
import { resetLocalAIChatMocks, service } from './localAIChatTestMocks'

vi.mock('../bindings/mychat/desktop', async () => (await import('./localAIChatTestMocks')).desktopMock)

vi.mock('@wailsio/runtime', async () => (await import('./localAIChatTestMocks')).runtimeMock)

describe('LocalAIChat composer', () => {
  afterEach(cleanup)

  beforeEach(() => resetLocalAIChatMocks())

  it('attaches a pasted screenshot and sends it with the message', async () => {
    service.LocalAIChat.mockResolvedValueOnce('The screenshot shows a chart.')
    renderChat({ chatId: 'chat-1' })
    const composer = screen.getByRole('textbox', { name: 'Message AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))

    const screenshot = new File(['png-bytes'], '', { type: 'image/png' })
    fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }], files: [] } })

    const pending = await screen.findByRole('list', { name: 'Pending attachments' })
    await waitFor(() => expect(pending.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/))
    expect(pending.textContent).toContain('pasted-image-')

    fireEvent.click(screen.getByRole('button', { name: 'Send to AI' }))

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
    const composer = screen.getByRole('textbox', { name: 'Message AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))

    const notPrevented = fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] } })

    expect(notPrevented).toBe(true)
    expect(screen.queryByRole('list', { name: 'Pending attachments' })).toBeNull()
  })

  it('keeps each chat draft and attachments separate when switching chats', async () => {
    const { props, rerender } = renderChat({ chatId: 'chat-1' })
    const composer = screen.getByRole('textbox', { name: 'Message AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))
    fireEvent.change(composer, { target: { value: 'Draft for the first chat' } })
    const screenshot = new File(['png-bytes'], 'first.png', { type: 'image/png' })
    fireEvent.paste(composer, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }], files: [] } })
    expect(await screen.findByRole('list', { name: 'Pending attachments' })).toBeTruthy()

    rerender(<LocalAIChat {...props} chatId="chat-2" />)
    await waitFor(() => expect(composer.value).toBe(''))
    expect(screen.queryByRole('list', { name: 'Pending attachments' })).toBeNull()
    fireEvent.change(composer, { target: { value: 'Second chat draft' } })

    rerender(<LocalAIChat {...props} chatId="chat-1" />)
    await waitFor(() => expect(composer.value).toBe('Draft for the first chat'))
    expect((await screen.findByRole('list', { name: 'Pending attachments' })).textContent).toContain('first.png')

    rerender(<LocalAIChat {...props} chatId="chat-2" />)
    await waitFor(() => expect(composer.value).toBe('Second chat draft'))
  })

  it('returns a failed send to the chat that sent it after switching chats', async () => {
    let failAppend!: (error: Error) => void
    service.AppendLocalAIChatMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => { failAppend = reject }))
    const { props, rerender } = renderChat({ chatId: 'chat-1' })
    await sendDraft('Message that will fail')
    await waitFor(() => expect(service.AppendLocalAIChatMessage).toHaveBeenCalledTimes(1))
    const composer = screen.getByRole('textbox', { name: 'Message AI' }) as HTMLTextAreaElement

    rerender(<LocalAIChat {...props} chatId="chat-2" />)
    await waitFor(() => expect(service.LoadLocalAIChatMessages).toHaveBeenCalledWith('chat-2'))
    await act(async () => failAppend(new Error('disk full')))
    expect(composer.value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()

    rerender(<LocalAIChat {...props} chatId="chat-1" />)
    await waitFor(() => expect(composer.value).toBe('Message that will fail'))
  })

  it('keeps a starting draft when a new chat opens with one', async () => {
    const { props, rerender } = renderChat({ chatId: 'chat-1' })
    const composer = screen.getByRole('textbox', { name: 'Message AI' }) as HTMLTextAreaElement
    await waitFor(() => expect(composer.disabled).toBe(false))
    fireEvent.change(composer, { target: { value: 'Unsent text in chat one' } })

    rerender(<LocalAIChat {...props} chatId={null} initialDraft="Summarize this message" initialDraftVersion={1} />)
    await waitFor(() => expect(composer.value).toBe('Summarize this message'))

    rerender(<LocalAIChat {...props} chatId="chat-1" initialDraft="Summarize this message" initialDraftVersion={1} />)
    await waitFor(() => expect(composer.value).toBe('Unsent text in chat one'))
  })

  it('creates an agent from the chat and selects it for that chat', async () => {
    const { props } = renderChat({ chatId: 'chat-1' })
    const composer = screen.getByRole('textbox', { name: 'Message AI' }) as HTMLTextAreaElement
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
})
